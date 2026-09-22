import Foundation

/// Canonical forms of a text, ported from `shared/src/text/normalize.ts`.
///
/// Two different jobs live here and must not be mixed up:
/// `normalizedForMatch` throws away everything that is not a letter, to compare and to build cache keys;
/// `normalizedForDisplay` keeps the text as the child should see it, only cleaning what would break the layout.
public enum TextNormalizer {
    private static let apostrophes: Set<Unicode.Scalar> = [
        "\u{2018}", "\u{2019}", "\u{201A}", "\u{201B}", "\u{02BC}", "\u{02B9}", "`", "\u{00B4}", "\u{2032}"
    ]
    private static let quotes: Set<Unicode.Scalar> = [
        "«", "»", "\u{201C}", "\u{201D}", "\u{201E}", "\u{201F}", "\u{2039}", "\u{203A}", "\u{2033}"
    ]
    private static let dashes: Set<Unicode.Scalar> = [
        "\u{2010}", "\u{2011}", "\u{2012}", "\u{2013}", "\u{2014}", "\u{2015}", "\u{2212}",
        "\u{FE58}", "\u{FE63}", "\u{FF0D}"
    ]

    /// True for a combining mark: what stays behind after a decomposition and has to go when comparing texts.
    private static func isCombiningMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark: return true
        default: return false
        }
    }

    private static func isLetterOrNumber(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }

    /// Form used to compare texts, to build cache keys and to hash: compatibility decomposition, lower case, no
    /// diacritics, ligatures opened, quotes and dashes unified, anything else turned into a single space.
    ///
    /// « L'Élève a mangé » and « l eleve a mange » compare equal, which is the whole point.
    public static func normalizedForMatch(_ text: String) -> String {
        // NFKC then lower case, exactly like the web app: the order matters for ligatures.
        let folded = text.precomposedStringWithCompatibilityMapping.lowercased()
        var out = String.UnicodeScalarView()
        var pendingSpace = false
        var wroteAnything = false

        for scalar in folded.decomposedStringWithCanonicalMapping.unicodeScalars {
            if isCombiningMark(scalar) { continue }

            let replacement: String
            switch scalar {
            case "œ": replacement = "oe"
            case "æ": replacement = "ae"
            default:
                if apostrophes.contains(scalar) {
                    replacement = "'"
                } else if quotes.contains(scalar) {
                    replacement = "\""
                } else if dashes.contains(scalar) {
                    replacement = "-"
                } else {
                    replacement = String(scalar)
                }
            }

            for produced in replacement.unicodeScalars {
                if isLetterOrNumber(produced) {
                    // Runs of anything else became one space, but never a leading one.
                    if pendingSpace && wroteAnything { out.append(" ") }
                    pendingSpace = false
                    out.append(produced)
                    wroteAnything = true
                } else {
                    pendingSpace = true
                }
            }
        }
        return String(out)
    }

    private static let horizontalSpaces: Set<Unicode.Scalar> = [
        " ", "\u{00A0}", "\u{202F}", "\u{2007}", "\u{2009}", "\u{200A}", "\u{3000}"
    ]
    /// Removed outright: soft hyphen, zero-width space, byte order mark, word joiner.
    private static let invisibles: Set<Unicode.Scalar> = ["\u{00AD}", "\u{200B}", "\u{FEFF}", "\u{2060}"]

    private static func isControl(_ scalar: Unicode.Scalar) -> Bool {
        let value = scalar.value
        if value <= 0x08 || value == 0x0B || value == 0x0C { return true }
        if value >= 0x0E && value <= 0x1F { return true }
        if value >= 0x7F && value <= 0x9F { return true }
        return false
    }

    /// A run of spaces collapses to one, but French typography wins: a run holding a (narrow) no-break space keeps it,
    /// so « mot ! » and « 10 % » are not pulled apart at the end of a line.
    private static func collapsed(_ run: [Unicode.Scalar]) -> Unicode.Scalar {
        if run.contains("\u{202F}") { return "\u{202F}" }
        if run.contains("\u{00A0}") { return "\u{00A0}" }
        return " "
    }

    /// The text as the child reads it: composed form, no control characters or invisible spaces, runs of spaces
    /// collapsed, line breaks kept with at most one blank line in a row, French no-break spaces preserved.
    public static func normalizedForDisplay(_ text: String) -> String {
        var scalars: [Unicode.Scalar] = []
        // Line endings first, so that the rest only ever sees \n.
        var previousWasCarriageReturn = false
        for scalar in text.precomposedStringWithCanonicalMapping.unicodeScalars {
            if scalar == "\r" {
                scalars.append("\n")
                previousWasCarriageReturn = true
                continue
            }
            if scalar == "\n" && previousWasCarriageReturn {
                previousWasCarriageReturn = false
                continue
            }
            previousWasCarriageReturn = false
            if invisibles.contains(scalar) || isControl(scalar) { continue }
            scalars.append(scalar == "\t" ? " " : scalar)
        }

        // Collapse runs of horizontal space, then drop the space around every line break.
        var collapsedScalars: [Unicode.Scalar] = []
        var run: [Unicode.Scalar] = []
        func flushRun() {
            guard !run.isEmpty else { return }
            collapsedScalars.append(run.count == 1 ? run[0] : collapsed(run))
            run.removeAll(keepingCapacity: true)
        }
        for scalar in scalars {
            if horizontalSpaces.contains(scalar) {
                run.append(scalar)
                continue
            }
            if scalar == "\n" {
                // Space before a line break disappears with it.
                run.removeAll(keepingCapacity: true)
            } else {
                flushRun()
            }
            collapsedScalars.append(scalar)
        }
        flushRun()

        // Space just after a line break disappears too, and three line breaks or more become one blank line.
        var out: [Unicode.Scalar] = []
        var afterNewline = false
        var consecutiveNewlines = 0
        for scalar in collapsedScalars {
            if scalar == "\n" {
                consecutiveNewlines += 1
                afterNewline = true
                if consecutiveNewlines <= 2 { out.append(scalar) }
                continue
            }
            if afterNewline && horizontalSpaces.contains(scalar) { continue }
            afterNewline = false
            consecutiveNewlines = 0
            out.append(scalar)
        }

        var view = String.UnicodeScalarView()
        view.append(contentsOf: out)
        return String(view).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
