import Foundation

/// One word an OCR engine claims to have read.
public struct OcrWord: Equatable, Sendable {
    public let text: String
    /// 0 to 100.
    public let confidence: Double
    /// Where the word sits across the line, in image pixels, when the engine says.
    public let left: Double?
    public let right: Double?

    public init(text: String, confidence: Double, left: Double? = nil, right: Double? = nil) {
        self.text = text
        self.confidence = confidence
        self.left = left
        self.right = right
    }
}

/// One line of a page, as read.
public struct OcrLine: Equatable, Sendable {
    public let text: String
    public let top: Double
    public let left: Double
    public let height: Double
    public let words: [OcrWord]

    public init(text: String, top: Double, left: Double, height: Double, words: [OcrWord]) {
        self.text = text
        self.top = top
        self.left = left
        self.height = height
        self.words = words
    }

    /// The same line stripped of everything the block builder does not need.
    public var layoutLine: LayoutLine {
        LayoutLine(text: text, top: top, height: height, left: left)
    }

    public func replacingWords(_ words: [OcrWord]) -> OcrLine {
        OcrLine(
            text: words.map(\.text).joined(separator: " "),
            top: top,
            left: words.first?.left ?? left,
            height: height,
            words: words
        )
    }
}

/// A whole page, as read.
public struct OcrResult: Equatable, Sendable {
    public let lines: [OcrLine]
    /// Mean confidence the engine reports for the page, 0 to 100.
    public let confidence: Double

    public init(lines: [OcrLine], confidence: Double) {
        self.lines = lines
        self.confidence = confidence
    }

    public var text: String { lines.map(\.text).joined(separator: "\n") }
    public var words: [OcrWord] { lines.flatMap(\.words) }
}

/// Cleaning up what an OCR engine read at the edges of a page.
/// Ported from `client/src/ocr/ocrLines.ts`.
public enum OcrCleanup {
    public static func clampConfidence(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return min(100, max(0, value))
    }

    private static func alphanumericCount(_ text: String) -> Int {
        text.unicodeScalars.reduce(0) { count, scalar in
            switch scalar.properties.generalCategory {
            case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
                 .decimalNumber, .letterNumber, .otherNumber:
                return count + 1
            default:
                return count
            }
        }
    }

    private static func hasApostrophe(_ text: String) -> Bool {
        text.contains("'") || text.contains("\u{2019}")
    }

    /// Removes what a page's edges leave in the text: the shadow of the binding, the border of the sheet, dust, the
    /// corner of the next page — all of which an engine happily reads as one- or two-character words.
    ///
    /// Left in, they end up read aloud. A child following the voice with their finger hears « l » and « m » between
    /// the sentences and has no way to know the page is fine and the machine is not.
    ///
    /// Words carrying an apostrophe are always kept: engines are unsure of « l’ » and « d’ » on principle, and those
    /// are real French words holding real sentences together.
    public static func removeDebris(from line: OcrLine) -> OcrLine? {
        var words = line.words

        func isWeak(_ word: OcrWord) -> Bool {
            !hasApostrophe(word.text) && (word.confidence < 70 || alphanumericCount(word.text) <= 2)
        }
        func isNearZero(_ word: OcrWord) -> Bool {
            !hasApostrophe(word.text) && word.confidence < 15 && alphanumericCount(word.text) <= 2
        }
        /// A gap wider than the line is tall: on a printed page that is not a space between words.
        func farApart(_ a: OcrWord, _ b: OcrWord) -> Bool {
            guard let right = a.right, let left = b.left else { return false }
            return left - right > line.height * 1.2
        }

        // A run of unsure words at one end, cut off from the text by a wide gap, is debris rather than words.
        var end = words.count
        while end > 0 && isWeak(words[end - 1]) { end -= 1 }
        if end > 0, end < words.count, farApart(words[end - 1], words[end]) {
            words = Array(words[0..<end])
        }
        var start = 0
        while start < words.count && isWeak(words[start]) { start += 1 }
        if start > 0, start < words.count, farApart(words[start - 1], words[start]) {
            words = Array(words[start...])
        }

        // Then single stragglers: alone at their end of the line, or read with almost no confidence at all.
        while let last = words.last, isWeak(last) {
            let previous = words.count >= 2 ? words[words.count - 2] : nil
            guard isNearZero(last) || (previous.map { farApart($0, last) } ?? false) else { break }
            words.removeLast()
        }
        while let first = words.first, isWeak(first) {
            let next = words.count >= 2 ? words[1] : nil
            guard isNearZero(first) || (next.map { farApart(first, $0) } ?? false) else { break }
            words.removeFirst()
        }

        // Nothing solid left: the line was debris from end to end.
        guard words.contains(where: { $0.confidence >= 60 && alphanumericCount($0.text) >= 2 }) else { return nil }
        return words.count == line.words.count ? line : line.replacingWords(words)
    }

    /// Cleans every line of a page and drops the ones that were nothing but debris.
    public static func clean(_ result: OcrResult) -> OcrResult {
        OcrResult(
            lines: result.lines.compactMap(removeDebris(from:)),
            confidence: clampConfidence(result.confidence)
        )
    }
}
