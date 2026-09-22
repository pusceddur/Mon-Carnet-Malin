import Foundation

/// A word of a block, with its place in UTF-16 units.
public struct WordModel: Equatable, Sendable {
    public let offset: Int
    public let end: Int
    public let text: String
}

/// A block is drawn as a run of pieces: the words, which can be tapped and highlighted, and the punctuation and
/// spaces between them, which cannot. Keeping them apart is what lets a tap land on a word rather than near one.
public enum SentencePart: Equatable, Sendable {
    case text(String)
    case word(WordModel)
}

/// One sentence of a block. The reader highlights one of these at a time and the voice reads one at a time.
public struct SentenceModel: Equatable, Sendable {
    public let index: Int
    public let start: Int
    public let end: Int
    public let text: String
    public let parts: [SentencePart]
    public let words: [WordModel]
    /// §22: how this sentence should be said, when a prepared version exists and still holds its words.
    public let spoken: String?
}

/// What lies between two sentences, or before the first: spaces and stray punctuation, drawn but never highlighted.
public enum BlockSegment: Equatable, Sendable {
    case gap(String)
    case sentence(SentenceModel)
}

/// A paragraph or a title, ready to be drawn.
public struct BlockModel: Equatable, Sendable {
    public let pageIndex: Int
    public let blockIndex: Int
    public let kind: TextBlock.Kind
    public let text: String
    public let segments: [BlockSegment]
    public let sentences: [SentenceModel]
    public let words: [WordModel]
}

/// A place in the text: which page, which block, and the stretch inside it.
public struct ReaderRange: Equatable, Sendable {
    public let pageIndex: Int
    public let blockIndex: Int
    public let start: Int
    public let end: Int

    public init(pageIndex: Int, blockIndex: Int, start: Int, end: Int) {
        self.pageIndex = pageIndex
        self.blockIndex = blockIndex
        self.start = start
        self.end = end
    }
}

/// Turning the text of a page into what the reader draws. Ported from `client/src/features/reader/model.ts`.
///
/// Every offset is in UTF-16 units, like everywhere else, because annotations are anchored to them and travel between
/// devices.
public enum ReaderModel {
    private static func isWordCharacter(_ c: Character) -> Bool {
        c.isLetter || c.isNumber
    }

    private static func slice(_ units: [UInt16], _ from: Int, _ to: Int) -> String {
        guard from >= 0, from <= to, to <= units.count else { return "" }
        return String(decoding: units[from..<to], as: UTF16.self)
    }

    private static func isSpace(_ units: [UInt16], _ index: Int) -> Bool {
        guard index >= 0, index < units.count, let scalar = Unicode.Scalar(units[index]) else { return false }
        return scalar.properties.isWhitespace
    }

    /// Sentence spans that together cover every word.
    ///
    /// The segmenter leaves out what it does not recognise as a sentence. Drawn as it is, that text would be visible
    /// but impossible to highlight or to have read aloud, which from the child's side looks like the app skipping
    /// part of the page. Anything holding a letter is therefore pulled into the sentence beside it.
    static func coveringSentences(_ text: String) -> [SentenceSpan] {
        let units = Array(text.utf16)
        var spans = SentenceSegmenter.sentences(in: text).filter { $0.end > $0.start }.sorted { $0.start < $1.start }

        if spans.isEmpty {
            var start = 0
            while start < units.count && isSpace(units, start) { start += 1 }
            guard start < units.count else { return [] }
            var end = units.count
            while end > start && isSpace(units, end - 1) { end -= 1 }
            return [SentenceSpan(start: start, end: end)]
        }

        func firstNonSpace(_ from: Int, _ to: Int) -> Int {
            var i = from
            while i < to && isSpace(units, i) { i += 1 }
            return i
        }
        func lastNonSpace(_ from: Int, _ to: Int) -> Int {
            var i = to
            while i > from && isSpace(units, i - 1) { i -= 1 }
            return i
        }
        func holdsAWord(_ from: Int, _ to: Int) -> Bool {
            slice(units, from, to).contains(where: isWordCharacter)
        }

        var adjusted = spans
        // Text before the first sentence that carries a word belongs to it.
        if holdsAWord(0, adjusted[0].start) {
            adjusted[0] = SentenceSpan(start: firstNonSpace(0, adjusted[0].start), end: adjusted[0].end)
        }
        for index in adjusted.indices {
            let nextStart = index + 1 < adjusted.count ? adjusted[index + 1].start : units.count
            var end = adjusted[index].end
            if holdsAWord(end, nextStart) { end = lastNonSpace(end, nextStart) }
            if index + 1 < adjusted.count && end > nextStart { end = nextStart }
            adjusted[index] = SentenceSpan(start: adjusted[index].start, end: end)
        }
        spans = adjusted
        return spans
    }

    /// §22: the prepared text from the first word of a sentence to the first word of the next one.
    private static func spokenSlice(_ prepared: String, _ said: [WordToken], from: Int, to: Int) -> String {
        let units = Array(prepared.utf16)
        let start = from < said.count ? said[from].start : 0
        let end = to < said.count ? said[to].start : units.count
        var text = slice(units, start, end)
        // The opening punctuation of the next sentence must not be said at the end of this one.
        while let last = text.last, last.isWhitespace || "«\u{201C}\"([—–-".contains(last) { text.removeLast() }
        return text
    }

    /// Builds one block: its words, its sentences, and the pieces to draw.
    public static func buildBlock(pageIndex: Int, blockIndex: Int, block: TextBlock) -> BlockModel {
        let text = block.text
        let units = Array(text.utf16)
        let words = Tokenizer.tokenizeWords(text).map {
            WordModel(offset: $0.start, end: $0.end, text: $0.word)
        }
        // A prepared version is used only while it still holds exactly the words of the text.
        let prepared = block.spoken.flatMap { SpokenText.align(display: text, prepared: $0) }

        var segments: [BlockSegment] = []
        var sentences: [SentenceModel] = []
        var cursor = 0
        var wordIndex = 0

        for (index, span) in coveringSentences(text).enumerated() {
            if span.start > cursor { segments.append(.gap(slice(units, cursor, span.start))) }

            var parts: [SentencePart] = []
            var sentenceWords: [WordModel] = []
            var partCursor = span.start
            // Words that ended before this sentence began are behind us.
            while wordIndex < words.count && words[wordIndex].offset < span.start { wordIndex += 1 }
            let firstWordIndex = wordIndex

            var end = span.end
            while wordIndex < words.count {
                let word = words[wordIndex]
                if word.offset >= end { break }
                if word.offset > partCursor { parts.append(.text(slice(units, partCursor, word.offset))) }
                parts.append(.word(word))
                sentenceWords.append(word)
                partCursor = word.end
                // A word that reaches past the cut keeps the sentence open: a word is never drawn in two halves.
                end = max(end, word.end)
                wordIndex += 1
            }
            if end > partCursor { parts.append(.text(slice(units, partCursor, end))) }

            let spoken: String? = {
                guard let prepared, block.spoken != nil, !sentenceWords.isEmpty else { return nil }
                return spokenSlice(block.spoken!, prepared.said, from: firstWordIndex, to: wordIndex)
            }()

            let sentence = SentenceModel(
                index: index,
                start: span.start,
                end: end,
                text: slice(units, span.start, end),
                parts: parts,
                words: sentenceWords,
                spoken: spoken
            )
            sentences.append(sentence)
            segments.append(.sentence(sentence))
            cursor = end
        }
        if cursor < units.count { segments.append(.gap(slice(units, cursor, units.count))) }

        return BlockModel(
            pageIndex: pageIndex,
            blockIndex: blockIndex,
            kind: block.kind,
            text: text,
            segments: segments,
            sentences: sentences,
            words: words
        )
    }

    // MARK: - Pointing at things

    /// The word covering `offset`, or nil between two words.
    public static func word(in block: BlockModel, at offset: Int) -> WordModel? {
        block.words.first { offset >= $0.offset && offset < $0.end }
    }

    /// The range of the word under a tap: what « tap a word to hear it » needs.
    public static func selectWord(in block: BlockModel, at offset: Int) -> ReaderRange? {
        guard let word = word(in: block, at: offset) else { return nil }
        return ReaderRange(pageIndex: block.pageIndex, blockIndex: block.blockIndex, start: word.offset, end: word.end)
    }

    public static func words(in block: BlockModel, from start: Int, to end: Int) -> [WordModel] {
        block.words.filter { $0.offset < end && $0.end > start }
    }

    /// Grows a selection backwards to the start of the word it begins inside, so a drag never cuts a word in half.
    public static func extendToPreviousWord(in block: BlockModel, _ range: ReaderRange) -> ReaderRange {
        guard let word = word(in: block, at: range.start), word.offset < range.start else { return range }
        return ReaderRange(pageIndex: range.pageIndex, blockIndex: range.blockIndex, start: word.offset, end: range.end)
    }

    /// Grows a selection forwards to the end of the word it ends inside.
    public static func extendToNextWord(in block: BlockModel, _ range: ReaderRange) -> ReaderRange {
        guard range.end > range.start, let word = word(in: block, at: range.end - 1), word.end > range.end else { return range }
        return ReaderRange(pageIndex: range.pageIndex, blockIndex: range.blockIndex, start: range.start, end: word.end)
    }

    /// The sentence covering `offset`: what the reader highlights and what the voice reads.
    public static func sentence(in block: BlockModel, at offset: Int) -> SentenceModel? {
        block.sentences.first { offset >= $0.start && offset < $0.end } ?? block.sentences.last { $0.end == offset }
    }

    /// Grows a selection to whole sentences.
    public static func sentenceRange(in block: BlockModel, _ range: ReaderRange) -> ReaderRange {
        let touched = block.sentences.filter { $0.start < range.end && $0.end > range.start }
        guard let first = touched.first, let last = touched.last else { return range }
        return ReaderRange(pageIndex: range.pageIndex, blockIndex: range.blockIndex, start: first.start, end: last.end)
    }

    /// The whole paragraph, for « explain this passage ».
    public static func paragraphRange(of block: BlockModel) -> ReaderRange {
        ReaderRange(pageIndex: block.pageIndex, blockIndex: block.blockIndex, start: 0, end: block.text.utf16.count)
    }
}
