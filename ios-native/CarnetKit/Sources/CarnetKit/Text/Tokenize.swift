import Foundation

/// One word of a text, with its place in it. Ported from `shared/src/text/tokenize.ts`.
///
/// The offsets are **UTF-16 code units**, like everywhere else in the app. That is not a detail: pencil annotations are
/// anchored to the text by these offsets and travel between devices through the sync, so a native app counting
/// differently would put the marks of a book on the wrong words.
public struct WordToken: Equatable, Sendable {
    public let start: Int
    public let end: Int
    public let word: String

    public init(start: Int, end: Int, word: String) {
        self.start = start
        self.end = end
        self.word = word
    }
}

public enum Tokenizer {
    private static let apostrophes: Set<Unicode.Scalar> = ["'", "\u{2019}", "\u{02BC}"]
    /// Inner separators that keep a compound together: « arc-en-ciel », « quatre‑vingts ».
    private static let innerHyphens: Set<Unicode.Scalar> = ["-", "\u{2010}", "\u{2011}", "\u{00B7}"]

    /// Words whose apostrophe belongs to the word itself instead of marking an elision.
    private static let apostropheWords: Set<String> = [
        "aujourd'hui", "presqu'île", "presqu'îles", "quelqu'un", "quelqu'une", "prud'homme", "prud'hommes",
        "main-d'œuvre", "hors-d'œuvre", "entr'acte", "entr'actes"
    ]

    private static func isWordScalar(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber,
             .nonspacingMark, .spacingMark, .enclosingMark:
            return true
        default:
            return false
        }
    }

    private static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
        default: return false
        }
    }

    private static func isDigit(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.generalCategory == .decimalNumber
    }

    /// True when a token ends on an apostrophe, which is how an elided « l’ », « qu’ », « j’ » looks.
    public static func isElisionToken(_ word: String) -> Bool {
        guard let last = word.unicodeScalars.last else { return false }
        return apostrophes.contains(last)
    }

    /// How many words a text holds, as a reader would count them: « l’arbre » is one word, not two.
    /// Used wherever a length has to be budgeted — a summary, the feedback of an exercise, a passage to read aloud.
    public static func countWords(_ text: String) -> Int {
        tokenizeWords(text).reduce(0) { $0 + (isElisionToken($1.word) ? 0 : 1) }
    }

    /// Words of a text with their UTF-16 offsets.
    ///
    /// « arc-en-ciel » is one token, « 3,5 » is one token, « l’arbre » is two (« l’ » then « arbre »), and the handful
    /// of French words that carry an apostrophe inside stay whole.
    public static func tokenizeWords(_ text: String) -> [WordToken] {
        let scalars = Array(text.unicodeScalars)
        // Offset in UTF-16 code units of every scalar, so a token can report the same numbers the web app reports.
        var utf16Offsets = [Int](repeating: 0, count: scalars.count + 1)
        var offset = 0
        for (index, scalar) in scalars.enumerated() {
            utf16Offsets[index] = offset
            offset += UTF16.width(Unicode.Scalar(scalar))
        }
        utf16Offsets[scalars.count] = offset

        // First pass: runs of word scalars, extended through inner hyphens and decimal separators.
        var raw: [(start: Int, end: Int)] = []
        var index = 0
        while index < scalars.count {
            guard isWordScalar(scalars[index]) else {
                index += 1
                continue
            }
            let start = index
            while index < scalars.count {
                if isWordScalar(scalars[index]) {
                    index += 1
                    continue
                }
                let separator = scalars[index]
                let next = index + 1 < scalars.count ? scalars[index + 1] : nil
                guard let next else { break }
                let joinsCompound = innerHyphens.contains(separator) && (isLetter(next) || isDigit(next))
                let joinsDecimal = (separator == "." || separator == ",")
                    && isDigit(scalars[index - 1]) && isDigit(next)
                guard joinsCompound || joinsDecimal else { break }
                index += 2
            }
            raw.append((start, index))
        }

        // Second pass: an apostrophe between two runs either keeps a whole word together or marks an elision.
        var tokens: [WordToken] = []
        var position = 0
        while position < raw.count {
            let current = raw[position]
            let next = position + 1 < raw.count ? raw[position + 1] : nil
            let apostropheIndex = current.end
            let hasApostrophe = apostropheIndex < scalars.count && apostrophes.contains(scalars[apostropheIndex])

            if hasApostrophe, let next, next.start == apostropheIndex + 1, isLetter(scalars[next.start]) {
                let joined = String(String.UnicodeScalarView(scalars[current.start..<next.end]))
                if apostropheWords.contains(normalizedApostropheWord(joined)) {
                    tokens.append(WordToken(
                        start: utf16Offsets[current.start], end: utf16Offsets[next.end], word: joined
                    ))
                    position += 2
                    continue
                }
                // Elision: the clitic keeps its apostrophe, the word that follows is a token of its own.
                let elided = String(String.UnicodeScalarView(scalars[current.start...apostropheIndex]))
                tokens.append(WordToken(
                    start: utf16Offsets[current.start], end: utf16Offsets[apostropheIndex + 1], word: elided
                ))
                position += 1
                continue
            }

            tokens.append(WordToken(
                start: utf16Offsets[current.start],
                end: utf16Offsets[current.end],
                word: String(String.UnicodeScalarView(scalars[current.start..<current.end]))
            ))
            position += 1
        }
        return tokens
    }

    private static func normalizedApostropheWord(_ word: String) -> String {
        var out = String.UnicodeScalarView()
        for scalar in word.lowercased().unicodeScalars {
            out.append(apostrophes.contains(scalar) ? "'" : scalar)
        }
        return String(out)
    }
}
