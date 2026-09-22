import Foundation

/// A sentence inside a text, in UTF-16 offsets, without the spaces around it.
public struct SentenceSpan: Equatable, Sendable {
    public let start: Int
    public let end: Int

    public init(start: Int, end: Int) {
        self.start = start
        self.end = end
    }
}

/// French sentence segmentation, ported from `shared/src/text/segment.ts`.
///
/// A sentence ends after `.` `!` `?` `…` (and the closing quotes that follow) when a space and then a capital, a digit,
/// an opening quote or a dialogue dash come next — but never after the abbreviations, initials and list numbers that
/// look like an ending and are not. Blank lines, dialogue lines and list items always start a new one (§22).
///
/// The reader needs this for the sentence it highlights and for the voice: cutting « M. Dupont » in two would make the
/// app stop in the middle of a name.
public enum SentenceSegmenter {
    /// Titles that never end a sentence, compared as written.
    private static let titleAbbreviations: Set<String> = [
        "M", "MM", "Mme", "Mmes", "Mlle", "Mlles", "Mgr", "Me", "Dr", "Pr", "St", "Ste", "Sts", "Stes"
    ]
    /// Abbreviations that never end a sentence, compared in lower case.
    private static let abbreviations: Set<String> = [
        "p", "pp", "ex", "cf", "av", "apr", "vol", "chap", "fig", "n°", "env", "éd", "réf", "coll", "tél"
    ]
    /// May end a sentence, but only before a capital, an opening quote or a dialogue dash.
    private static let softAbbreviations: Set<String> = ["etc", "j.-c", "j-c"]
    private static let adjacentClosers: Set<Character> = ["\u{201D}", "\"", "\u{2019}", ")", "]"]
    /// « Exercice 1 : », « Page 2 : »… number a label; they are not list items.
    private static let markerLabels: Set<String> = [
        "exercice", "question", "étape", "page", "chapitre", "partie", "leçon", "consigne", "activité", "numéro", "n°",
        "point", "niveau", "tome", "livre", "acte", "scène", "séance", "jour", "semaine", "document", "texte",
        "problème", "figure", "fig", "ex", "lot", "groupe"
    ]

    // The patterns are the ones of the web app. `(?<=\s)` replaces the `(?<=^|\s)` it uses, because a lookbehind that
    // can match nothing is not accepted here; the start of the text is handled beside it.
    private static let terminal = regex("[.!?…]+")
    private static let blankLine = regex("\\n[^\\S\\n]*\\n")
    private static let dialogueLine = regex("\\n[^\\S\\n]*(?:[\\x{2014}\\x{2013}]|-(?=\\s))")
    private static let listLine = regex(
        "\\n[^\\S\\n]*(?=(?:\\d{1,3}|[A-Za-z]|[IVXLCDM]{1,6})[^\\S\\n]?[.):][^\\S\\n]*\\S"
            + "|[\\x{2022}\\x{25AA}\\x{25A0}\\x{25BA}\\x{2023}\\x{25E6}\\x{25CF}*+][^\\S\\n])"
    )
    private static let inlineMarker = regex(
        "(?:^|(?<=\\s))(?:(\\d{1,2})[^\\S\\n]?[.):]|([a-h])[^\\S\\n]?[.)])(?=[^\\S\\n]+\\S)"
    )
    private static let trailingWord = regex("(\\S+)\\s*$")

    private static func regex(_ pattern: String) -> NSRegularExpression {
        // The patterns are written here, not received: a failure would be a programming mistake, not bad input.
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern, options: [])
    }

    private static func isSpace(_ units: [UInt16], _ index: Int) -> Bool {
        guard index >= 0 && index < units.count else { return false }
        guard let scalar = Unicode.Scalar(units[index]) else { return false }
        return scalar.properties.isWhitespace
    }

    private static func character(_ units: [UInt16], _ index: Int) -> Character? {
        guard index >= 0 && index < units.count, let scalar = Unicode.Scalar(units[index]) else { return nil }
        return Character(scalar)
    }

    private static func slice(_ units: [UInt16], _ from: Int, _ to: Int) -> String {
        guard from >= 0, from <= to, to <= units.count else { return "" }
        return String(decoding: units[from..<to], as: UTF16.self)
    }

    /// Closing quotes and brackets that belong to the sentence that just ended.
    private static func absorbClosers(_ units: [UInt16], from: Int) -> Int {
        var j = from
        while true {
            var q = j
            while q < units.count, let c = character(units, q), c.isWhitespace, c != "\n" { q += 1 }
            if character(units, q) == "»" {
                j = q + 1
                continue
            }
            if let c = character(units, j), adjacentClosers.contains(c) {
                j += 1
                continue
            }
            return j
        }
    }

    /// The word just before `end`, with where it starts: what decides whether a dot really ends a sentence.
    private static func wordBefore(_ units: [UInt16], end: Int) -> (word: String, start: Int) {
        func isWordCharacter(_ index: Int) -> Bool {
            guard let c = character(units, index) else { return false }
            if c.isLetter || c.isNumber { return true }
            return c == "°" || c == "." || c == "-" || c == "\u{2010}" || c == "\u{2011}"
        }
        var i = end
        while i > 0 && isWordCharacter(i - 1) { i -= 1 }
        var start = i
        while start < end, let c = character(units, start), c == "." || c == "-" || c == "\u{2010}" || c == "\u{2011}" {
            start += 1
        }
        return (slice(units, start, end), start)
    }

    /// A capital, an opening French quote or a dialogue dash: what a real new sentence starts with.
    private static func isStrongStarter(_ c: Character?) -> Bool {
        guard let c else { return false }
        if c.isUppercase { return true }
        return "«\u{201C}\u{2014}\u{2013}¿¡".contains(c)
    }

    private static func isStarter(_ units: [UInt16], _ k: Int) -> Bool {
        guard let c = character(units, k) else { return false }
        if isStrongStarter(c) { return true }
        if c.isNumber || "\"\u{2018}([".contains(c) { return true }
        return c == "-" && isSpace(units, k + 1)
    }

    /// Is a cut allowed after a single dot that follows `word`?
    private static func dotEndsSentence(
        _ units: [UInt16], word: String, wordStart: Int, sentenceStart: Int, nextIndex: Int
    ) -> Bool {
        if word.isEmpty { return true }
        if titleAbbreviations.contains(word) || abbreviations.contains(word.lowercased()) { return false }
        if softAbbreviations.contains(word.lowercased()) { return isStrongStarter(character(units, nextIndex)) }

        let letters = Array(word)
        // An initial (« J. K. Rowling ») or a dotted acronym never ends a sentence.
        if letters.count == 1 && letters[0].isUppercase { return false }
        if word.contains("."), letters.allSatisfy({ $0.isUppercase || $0 == "." }), let last = letters.last, last.isUppercase {
            return false
        }
        // List numbering at the very start of a sentence (« 1. Le Soleil », « II. La Gaule »).
        let isNumbering = letters.allSatisfy(\.isNumber) && letters.count <= 3
            || (letters.count <= 6 && letters.allSatisfy { "IVXLCDM".contains($0) })
        if isNumbering && slice(units, sentenceStart, wordStart).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return false
        }
        return true
    }

    private static func matches(_ expression: NSRegularExpression, _ text: String, _ length: Int) -> [NSTextCheckingResult] {
        expression.matches(in: text, options: [], range: NSRange(location: 0, length: length))
    }

    /// Where inline markers numbered in sequence (1, 2, 3… or a, b, c…) start a sentence, in chains of at least two.
    private static func inlineListCuts(_ text: String, _ units: [UInt16]) -> [Int] {
        var cuts: [Int] = []
        var chain: [(index: Int, value: Int)] = []

        func close() {
            if chain.count >= 2 { cuts.append(contentsOf: chain.map(\.index)) }
            chain = []
        }

        for match in matches(inlineMarker, text, units.count) {
            let index = match.range.location
            // « Exercice 1 : » numbers a label rather than opening a list.
            let lookBack = max(0, index - 40)
            let before = slice(units, lookBack, index)
            let previous = trailingWord
                .firstMatch(in: before, options: [], range: NSRange(location: 0, length: before.utf16.count))
                .flatMap { Range($0.range(at: 1), in: before).map { String(before[$0]).lowercased() } } ?? ""
            if markerLabels.contains(previous) { continue }

            let value: Int
            if match.range(at: 1).location != NSNotFound {
                value = Int(slice(units, match.range(at: 1).location, match.range(at: 1).location + match.range(at: 1).length)) ?? 0
            } else {
                let letter = slice(units, match.range(at: 2).location, match.range(at: 2).location + match.range(at: 2).length)
                value = Int(letter.unicodeScalars.first?.value ?? 96) - 96
            }

            if let last = chain.last, value == last.value + 1 {
                chain.append((index, value))
            } else if value == 1 {
                close()
                chain = [(index, value)]
            }
        }
        close()
        return cuts.filter { $0 > 0 }
    }

    private static func collectCuts(_ text: String, _ units: [UInt16]) -> [Int] {
        var hardCuts: [Int] = []
        for expression in [blankLine, dialogueLine, listLine] {
            hardCuts.append(contentsOf: matches(expression, text, units.count).map(\.range.location))
        }
        hardCuts.append(contentsOf: inlineListCuts(text, units))
        hardCuts.sort()

        var cuts = hardCuts
        var lastCut = 0
        var hardPointer = 0

        for match in matches(terminal, text, units.count) {
            let clusterStart = match.range.location
            let clusterLength = match.range.length
            while hardPointer < hardCuts.count && hardCuts[hardPointer] <= clusterStart {
                lastCut = max(lastCut, hardCuts[hardPointer])
                hardPointer += 1
            }

            let j = absorbClosers(units, from: clusterStart + clusterLength)
            guard j < units.count, isSpace(units, j) else { continue }
            var k = j
            while k < units.count && isSpace(units, k) { k += 1 }
            guard k < units.count, isStarter(units, k) else { continue }

            if clusterLength == 1, character(units, clusterStart) == "." {
                let (word, start) = wordBefore(units, end: clusterStart)
                var sentenceStart = lastCut
                while sentenceStart < clusterStart && isSpace(units, sentenceStart) { sentenceStart += 1 }
                if !dotEndsSentence(units, word: word, wordStart: start, sentenceStart: sentenceStart, nextIndex: k) {
                    continue
                }
            }
            cuts.append(j)
            lastCut = j
        }
        return Array(Set(cuts)).sorted()
    }

    /// The sentences of a text, in UTF-16 offsets, with the spaces around them left out.
    public static func sentences(in text: String) -> [SentenceSpan] {
        let units = Array(text.utf16)
        guard !units.isEmpty else { return [] }
        var spans: [SentenceSpan] = []
        var segmentStart = 0

        for cut in collectCuts(text, units) + [units.count] {
            var start = segmentStart
            var end = cut
            while start < end && isSpace(units, start) { start += 1 }
            while end > start && isSpace(units, end - 1) { end -= 1 }
            if end > start { spans.append(SentenceSpan(start: start, end: end)) }
            segmentStart = cut
        }
        return spans
    }
}
