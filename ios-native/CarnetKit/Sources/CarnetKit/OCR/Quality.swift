import Foundation

/// How well a page was read.
public struct QualityReport: Equatable, Sendable {
    /// 0 to 100, rounded.
    public let score: Double
    public let wordCount: Int
    /// Mean word confidence, weighted by length, or the engine's page confidence. Nil when nothing said.
    public let meanConfidence: Double?
    /// Share of words the engine was unsure of. Nil without word-level confidences.
    public let lowConfidenceRatio: Double?
    /// Share of words that are real French words. Nil without a word list.
    public let dictionaryRatio: Double?
    /// Share of characters that are neither letters, digits nor ordinary punctuation.
    public let noiseRatio: Double

    public init(
        score: Double, wordCount: Int, meanConfidence: Double?, lowConfidenceRatio: Double?,
        dictionaryRatio: Double?, noiseRatio: Double
    ) {
        self.score = score
        self.wordCount = wordCount
        self.meanConfidence = meanConfidence
        self.lowConfidenceRatio = lowConfidenceRatio
        self.dictionaryRatio = dictionaryRatio
        self.noiseRatio = noiseRatio
    }
}

/// What is being scored.
public struct QualityInput: Sendable {
    public let text: String
    /// Word-level confidences, when the engine gives them.
    public let words: [OcrWord]
    /// Page-level confidence, 0 to 100.
    public let pageConfidence: Double?

    public init(text: String, words: [OcrWord] = [], pageConfidence: Double? = nil) {
        self.text = text
        self.words = words
        self.pageConfidence = pageConfidence
    }
}

/// Scoring how well a page was read, out of 100.
/// Ported from `client/src/ocr/quality.ts`.
///
/// This number decides what a child is shown and what a parent is asked to check. That is why it does not trust the
/// engine's own confidence alone: an engine is confident about nonsense as readily as about words. The strongest
/// signal is the simplest — does what was read look like French? A page of real words scores well even from a mediocre
/// engine, and a page of confident gibberish is caught before the child meets it.
public enum OcrQuality {
    public static let lowWordConfidence = 60.0

    private static let usualPunctuation: Set<Character> = Set(".,;:!?'’‘\"«»“”()[]-‐‑–—…%/°€$&+=*#@§²³ºª·")
    private static let elisions: Set<String> = [
        "l", "d", "j", "m", "n", "s", "t", "c", "qu", "jusqu", "lorsqu", "puisqu", "quoiqu", "presqu",
    ]

    private static func isLetterOrNumber(_ character: Character) -> Bool {
        character.unicodeScalars.contains { scalar in
            switch scalar.properties.generalCategory {
            case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
                 .decimalNumber, .letterNumber, .otherNumber:
                return true
            default:
                return false
            }
        }
    }

    private static func isLetter(_ character: Character) -> Bool {
        character.unicodeScalars.contains { scalar in
            switch scalar.properties.generalCategory {
            case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter:
                return true
            default:
                return false
            }
        }
    }

    private static func isNoise(_ character: Character) -> Bool {
        if character.isWhitespace { return false }
        if isLetterOrNumber(character) { return false }
        return !usualPunctuation.contains(character)
    }

    /// A token counts as known when it is a number, an elided « l’ » or « qu’ », or a word in the list.
    public static func isKnown(_ token: String, in list: WordList) -> Bool {
        if !token.isEmpty, token.allSatisfy({ $0.isNumber || $0 == "." || $0 == "," }) { return true }

        let normalized = TextNormalizer.normalizedForMatch(token)
        if let last = token.last, last == "'" || last == "\u{2019}" || last == "\u{02BC}" {
            return elisions.contains(normalized)
        }
        if normalized.isEmpty { return true }
        if list.contains(normalized: normalized) { return true }

        // « arc-en-ciel » is listed whole; failing that, a compound counts when each part is a word of its own.
        let parts = normalized.split(separator: " ").map(String.init)
        return parts.count > 1 && parts.allSatisfy { list.contains(normalized: $0) }
    }

    public static func score(_ input: QualityInput, against list: WordList?) -> QualityReport {
        let tokens = Tokenizer.tokenizeWords(input.text).map(\.word)
        let wordCount = tokens.count

        var nonSpace = 0
        var noise = 0
        for character in input.text where !character.isWhitespace {
            nonSpace += 1
            if isNoise(character) { noise += 1 }
        }
        let noiseRatio = nonSpace == 0 ? 0 : Double(noise) / Double(nonSpace)

        var meanConfidence: Double?
        var lowConfidenceRatio: Double?
        let words = input.words.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        if !words.isEmpty {
            var weighted = 0.0
            var weight = 0.0
            var low = 0
            for word in words {
                // Weighted by length: a wrong long word costs more than a wrong « à ».
                let length = Double(max(1, word.text.count))
                weighted += word.confidence * length
                weight += length
                if word.confidence < lowWordConfidence { low += 1 }
            }
            meanConfidence = weighted / weight
            lowConfidenceRatio = Double(low) / Double(words.count)
        } else if let page = input.pageConfidence, page.isFinite {
            meanConfidence = min(100, max(0, page))
        }

        var dictionaryRatio: Double?
        if let list, list.count > 0 {
            let alphabetic = tokens.filter { $0.contains(where: isLetter) }
            if !alphabetic.isEmpty {
                let known = alphabetic.filter { isKnown($0, in: list) }.count
                dictionaryRatio = Double(known) / Double(alphabetic.count)
            }
        }

        guard wordCount > 0 else {
            return QualityReport(
                score: 0, wordCount: 0, meanConfidence: meanConfidence, lowConfidenceRatio: lowConfidenceRatio,
                dictionaryRatio: dictionaryRatio, noiseRatio: noiseRatio
            )
        }

        // What is known counts; what is missing is simply left out rather than guessed at.
        var parts: [(weight: Double, value: Double)] = []
        if let meanConfidence { parts.append((0.35, meanConfidence / 100)) }
        if let lowConfidenceRatio { parts.append((0.15, 1 - lowConfidenceRatio)) }
        if let dictionaryRatio { parts.append((0.35, dictionaryRatio)) }
        parts.append((0.15, 1 - min(1, noiseRatio * 4)))

        let totalWeight = parts.reduce(0) { $0 + $1.weight }
        var score = 100 * parts.reduce(0) { $0 + $1.weight * $1.value } / totalWeight
        // Two or three words say almost nothing about a page. Better to look at it than to declare it read.
        if wordCount < 3 { score *= 0.85 }

        return QualityReport(
            score: (min(100, max(0, score))).rounded(),
            wordCount: wordCount,
            meanConfidence: meanConfidence,
            lowConfidenceRatio: lowConfidenceRatio,
            dictionaryRatio: dictionaryRatio,
            noiseRatio: noiseRatio
        )
    }

    public static func score(lines: [OcrLine], pageConfidence: Double?, against list: WordList?) -> QualityReport {
        score(
            QualityInput(
                text: lines.map(\.text).joined(separator: "\n"),
                words: lines.flatMap(\.words),
                pageConfidence: pageConfidence
            ),
            against: list
        )
    }

    public static func score(blocks: [TextBlock], pageConfidence: Double?, against list: WordList?) -> QualityReport {
        score(
            QualityInput(text: blocks.map(\.text).joined(separator: "\n\n"), pageConfidence: pageConfidence),
            against: list
        )
    }
}
