import Foundation

/// Joining the lines a page was read as, back into a text. Ported from `shared/src/text/dehyphenate.ts`.
///
/// The hard part is the hyphen at the end of a line. « pho- » + « tosynthèse » is one word cut in two and the hyphen
/// must go; « arc-en- » + « ciel » and « Jean- » + « Pierre » are real compounds and it must stay. When a word list is
/// given, « grand- » + « mère » is also kept whole, because both halves are words on their own while « grandmère » is not.
public enum LineJoiner {
    private static let hyphens: Set<Unicode.Scalar> = ["-", "\u{2010}", "\u{2011}", "\u{00AC}"]
    private static let softHyphen: Unicode.Scalar = "\u{00AD}"

    private static func isLetterOrNumber(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }

    private static func isLetterOrMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .nonspacingMark, .spacingMark, .enclosingMark:
            return true
        default:
            return false
        }
    }

    private static func isLowercase(_ scalar: Unicode.Scalar) -> Bool {
        scalar.properties.generalCategory == .lowercaseLetter
    }

    /// Runs of whitespace inside a line become one space, and the line is trimmed.
    private static func tidy(_ line: String) -> String {
        line.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    /// The word that ends `text`, hyphen included, or nil when it does not end on one.
    private static func trailingHyphenatedWord(_ scalars: [Unicode.Scalar]) -> [Unicode.Scalar]? {
        guard let last = scalars.last, hyphens.contains(last) else { return nil }
        var start = scalars.count - 1
        while start > 0 {
            let previous = scalars[start - 1]
            guard isLetterOrNumber(previous) || hyphens.contains(previous) else { break }
            start -= 1
        }
        let word = Array(scalars[start...])
        // « - » alone at the end of a line is punctuation, not a cut word.
        guard word.count > 1, isLetterOrNumber(word[0]) else { return nil }
        return word
    }

    private static func leadingLetters(_ line: String) -> String {
        var out = String.UnicodeScalarView()
        for scalar in line.unicodeScalars {
            guard isLetterOrMark(scalar) else { break }
            out.append(scalar)
        }
        return String(out)
    }

    /// Joins the lines of a page into one text.
    /// - Parameter isKnownWord: tells whether a word exists in French; without it, compounds are only recognised by
    ///   their shape, which is enough for « arc-en- » but not for « grand- ».
    public static func join(lines: [String], isKnownWord: ((String) -> Bool)? = nil) -> String {
        var out: [Unicode.Scalar] = []

        for rawLine in lines {
            let line = tidy(rawLine)
            if line.isEmpty { continue }
            if out.isEmpty {
                out = Array(line.unicodeScalars)
                continue
            }

            // A soft hyphen is never a real one: the word is simply put back together.
            if out.last == softHyphen {
                out.removeLast()
                out.append(contentsOf: line.unicodeScalars)
                continue
            }

            guard let hyphenatedWord = trailingHyphenatedWord(out) else {
                out.append(" ")
                out.append(contentsOf: line.unicodeScalars)
                continue
            }

            // The half before the hyphen, and the letters the next line starts with.
            let head = String(String.UnicodeScalarView(hyphenatedWord.dropLast()))
            let tail = leadingLetters(line)
            let headEndsLower = hyphenatedWord.dropLast().last.map(isLowercase) ?? false
            let lineStartsLower = line.unicodeScalars.first.map(isLowercase) ?? false
            // Another hyphen inside the word: « arc-en- » is a compound being continued, not a cut.
            let isCompound = hyphenatedWord.dropLast().contains(where: { hyphens.contains($0) })
            let halvesAreWords: Bool = {
                guard let isKnownWord, !tail.isEmpty else { return false }
                return isKnownWord(head.lowercased()) && isKnownWord(tail.lowercased())
                    && !isKnownWord((head + tail).lowercased())
            }()

            if headEndsLower && lineStartsLower && !isCompound && !halvesAreWords {
                // One word cut at the end of the line: the hyphen disappears.
                out.removeLast()
                out.append(contentsOf: line.unicodeScalars)
            } else if let last = out.last, hyphens.contains(last),
                      let first = line.unicodeScalars.first, isLetterOrNumber(first) {
                // A real compound: the hyphen stays and the two halves touch.
                out.append(contentsOf: line.unicodeScalars)
            } else {
                // Anything else keeps a plain hyphen between the halves.
                out.removeLast()
                out.append("-")
                out.append(contentsOf: line.unicodeScalars)
            }
        }

        var view = String.UnicodeScalarView()
        view.append(contentsOf: out)
        return String(view)
    }
}
