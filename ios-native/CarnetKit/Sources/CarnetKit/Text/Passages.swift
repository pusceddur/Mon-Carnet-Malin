import Foundation

/// A stretch of a text, in UTF-16 offsets.
public struct TextRange: Equatable, Sendable {
    public let start: Int
    public let end: Int

    public init(start: Int, end: Int) {
        self.start = start
        self.end = end
    }
}

/// One sentence of a book, with where it sits. Used to quote a passage back to the child and to check that the model
/// quoted something that really is in the page rather than something it invented.
public struct LocatedSentence: Equatable, Sendable {
    public let pageIndex: Int
    /// Index of the paragraph inside its page.
    public let paragraphIndex: Int
    /// Reading order across every page.
    public let order: Int
    /// Offsets inside the text of the page.
    public let start: Int
    public let end: Int
    /// Exactly the text between those offsets.
    public let text: String
}

/// Cutting a page into paragraphs, sentences and pieces small enough to send.
/// Ported from `shared/src/text/passages.ts`.
public enum Passages {
    private static func isSpace(_ units: [UInt16], _ index: Int) -> Bool {
        guard index >= 0 && index < units.count, let scalar = Unicode.Scalar(units[index]) else { return false }
        return scalar.properties.isWhitespace
    }

    private static func slice(_ units: [UInt16], _ from: Int, _ to: Int) -> String {
        guard from >= 0, from <= to, to <= units.count else { return "" }
        return String(decoding: units[from..<to], as: UTF16.self)
    }

    /// Paragraphs of a page, separated by blank lines, without the spaces around them.
    public static func paragraphs(in text: String) -> [TextRange] {
        let units = Array(text.utf16)
        var ranges: [TextRange] = []

        func append(_ start: Int, _ end: Int) {
            var s = start
            var e = end
            while s < e && isSpace(units, s) { s += 1 }
            while e > s && isSpace(units, e - 1) { e -= 1 }
            if e > s { ranges.append(TextRange(start: s, end: e)) }
        }

        // A blank line: a line break, optional spaces, another line break, then any space that follows.
        var from = 0
        var index = 0
        while index < units.count {
            guard let scalar = Unicode.Scalar(units[index]), scalar == "\n" else {
                index += 1
                continue
            }
            var probe = index + 1
            while probe < units.count, isSpace(units, probe), Unicode.Scalar(units[probe]) != "\n" { probe += 1 }
            guard probe < units.count, let second = Unicode.Scalar(units[probe]), second == "\n" else {
                index += 1
                continue
            }
            probe += 1
            while probe < units.count && isSpace(units, probe) { probe += 1 }
            append(from, index)
            from = probe
            index = probe
        }
        append(from, units.count)
        return ranges
    }

    /// Every sentence of the pages, in reading order, with its exact text and offsets.
    public static func locateSentences(in pages: [(pageIndex: Int, text: String)]) -> [LocatedSentence] {
        var out: [LocatedSentence] = []
        for page in pages {
            let units = Array(page.text.utf16)
            for (paragraphIndex, paragraph) in paragraphs(in: page.text).enumerated() {
                let paragraphText = slice(units, paragraph.start, paragraph.end)
                for sentence in SentenceSegmenter.sentences(in: paragraphText) {
                    let start = paragraph.start + sentence.start
                    let end = paragraph.start + sentence.end
                    out.append(LocatedSentence(
                        pageIndex: page.pageIndex,
                        paragraphIndex: paragraphIndex,
                        order: out.count,
                        start: start,
                        end: end,
                        text: slice(units, start, end)
                    ))
                }
            }
        }
        return out
    }

    /// Cuts `[start, end)` into pieces of at most `limit` UTF-16 units, preferring to cut at a space.
    /// A piece that has to be cut inside a word never lands between the two halves of a surrogate pair.
    public static func hardSplit(_ text: String, start: Int, end: Int, limit: Int) -> [TextRange] {
        let units = Array(text.utf16)
        guard limit > 0, start >= 0, end <= units.count else { return [] }
        var ranges: [TextRange] = []
        var s = start

        while s < end {
            while s < end && isSpace(units, s) { s += 1 }
            if s >= end { break }
            if end - s <= limit {
                ranges.append(TextRange(start: s, end: end))
                break
            }

            var cut = s + limit
            // The last space inside the window, so that a word is not split when it can be helped.
            var lastSpace = -1
            var probe = s
            while probe <= min(cut, units.count - 1) {
                if isSpace(units, probe) { lastSpace = probe }
                probe += 1
            }
            if lastSpace > s {
                cut = lastSpace
            } else if cut < units.count, UTF16.isTrailSurrogate(units[cut]) {
                // Never between the two halves of one character.
                cut -= 1
            }

            var e = cut
            while e > s && isSpace(units, e - 1) { e -= 1 }
            if e > s { ranges.append(TextRange(start: s, end: e)) }
            s = cut
        }
        return ranges
    }
}
