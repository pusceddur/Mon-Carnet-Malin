import Foundation

/// Turning « the voice is here » into « highlight this word on the page ».
///
/// When a sentence has a prepared version (§22), the synthesizer reads that one and reports its positions inside it.
/// The page, meanwhile, shows the text as the book prints it. The two hold the same words in the same order — that is
/// checked before the preparation is used at all — so a position in one can be carried over to the other word by word.
///
/// Without this the highlight would drift as soon as the preparation added a comma, and the child would see the mark
/// sitting one word behind the voice.
public struct SpokenWordMapping: Sendable {
    private let shown: [WordToken]
    private let said: [WordToken]

    /// Nil when the two texts do not hold the same words, in which case nothing may be mapped.
    public init?(display: String, spoken: String) {
        guard let alignment = SpokenText.align(display: display, prepared: spoken) else { return nil }
        self.shown = alignment.shown
        self.said = alignment.said
    }

    /// A mapping for a sentence that is read exactly as it is written.
    public init(identity text: String) {
        let words = Tokenizer.tokenizeWords(text)
        self.shown = words
        self.said = words
    }

    /// The stretch of the displayed text matching a stretch of the spoken one, in UTF-16 units.
    ///
    /// The synthesizer usually reports one word, but it may report several at once; every word it covers is carried
    /// over, and the answer spans from the first to the last.
    public func displayRange(forSpokenRange range: NSRange) -> NSRange? {
        guard range.length >= 0 else { return nil }
        let start = range.location
        let end = range.location + range.length

        var first: Int?
        var last: Int?
        for index in said.indices where said[index].offset < max(end, start + 1) && said[index].end > start {
            if first == nil { first = index }
            last = index
        }
        guard let first, let last, first < shown.count, last < shown.count else { return nil }
        let from = shown[first].start
        let to = shown[last].end
        return NSRange(location: from, length: max(0, to - from))
    }

    /// Index of the word being said, for a reader that highlights whole words rather than ranges.
    public func wordIndex(forSpokenRange range: NSRange) -> Int? {
        said.firstIndex { $0.offset < range.location + max(range.length, 1) && $0.end > range.location }
    }
}

private extension WordToken {
    /// Named to read the same way on both sides of the mapping.
    var offset: Int { start }
}
