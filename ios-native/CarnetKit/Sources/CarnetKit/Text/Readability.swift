import Foundation

/// How many spoken syllables a French word has, and how hard a text is to read.
/// Ported from `shared/src/text/readability.ts`.
///
/// Counting syllables is what tells a long word from a short one, and that decides whether a text suits a child. It is
/// the spoken count, not the written one: the mute e at the end and the verbal « -ent » are not heard, so they are not
/// counted (« ils mangent » is one syllable, « école » two, « photosynthèse » four).
public struct ReadabilityReport: Equatable, Sendable {
    public let words: Int
    public let sentences: Int
    public let averageWordsPerSentence: Double
    public let longestSentenceWords: Int
    /// Share of words of four syllables or more.
    public let longWordRatio: Double
    /// Kandel–Moles: 207 − 1.015 × words per sentence − 73.6 × syllables per word. Higher means easier.
    public let kandelMoles: Double
}

public enum Readability {
    private static let vowels = Set("aeiouyàâäéèêëîïôöùûüÿœæ")
    private static let diaereses = Set("ëïü")
    private static let plosives = Set("bcdfgkptv")
    private static let liquids = Set("rl")
    /// A word of four syllables or more is a long one.
    private static let longWordSyllables = 4

    /// Words ending in « -ent » where the ending is heard. The « -ment » words follow a rule instead of a list.
    private static let pronouncedENT: Set<String> = [
        "absent", "accent", "accident", "adjacent", "adolescent", "agent", "apparent", "argent", "client", "coefficient",
        "compétent", "confident", "content", "continent", "convalescent", "décent", "différent", "diligent", "éloquent",
        "équivalent", "évident", "excellent", "expédient", "fréquent", "impatient", "imprudent", "incident", "indécent",
        "indifférent", "indulgent", "ingrédient", "innocent", "insolent", "intelligent", "négligent", "occident",
        "omniprésent", "onguent", "opulent", "orient", "parent", "patient", "permanent", "pertinent", "précédent",
        "présent", "président", "prudent", "quotient", "récent", "récipient", "régent", "résident", "sergent",
        "serpent", "somnolent", "souvent", "strident", "succulent", "talent", "torrent", "transparent", "trident",
        "turbulent", "urgent", "violent", "virulent",
    ]

    /// Irregular words frequent in school texts, where the rules would count wrong.
    private static let specialSyllables: [String: Int] = [
        "pays": 2, "paysage": 3, "paysages": 3, "paysan": 3, "paysans": 3, "paysanne": 3, "paysannes": 3,
        "abbaye": 3, "abbayes": 3,
    ]

    /// Clitics whose vowel disappears into the next word: « l’ami » has the syllables of « ami ».
    private static let silentElisions: Set<String> = ["l", "d", "j", "m", "n", "s", "t", "c", "qu"]

    private static func isVowel(_ c: Character?) -> Bool {
        guard let c else { return false }
        return vowels.contains(c)
    }

    /// A plosive followed by r or l: « bl », « tr »… The two letters cannot be split, which changes how the vowels
    /// around them are counted.
    private static func endsWithCluster(_ letters: ArraySlice<Character>) -> Bool {
        guard letters.count >= 2 else { return false }
        let last = letters[letters.index(before: letters.endIndex)]
        let beforeLast = letters[letters.index(letters.endIndex, offsetBy: -2)]
        return plosives.contains(beforeLast) && liquids.contains(last)
    }

    /// Does the vowel at `i` open a new syllable even though a vowel comes just before it?
    private static func isHiatus(_ letters: [Character], _ i: Int) -> Bool {
        let a = letters[i - 1]
        let b = letters[i]
        let rest = String(letters[(i + 1)...])

        if diaereses.contains(b) { return true }
        if a == "é" {
            // « idée », « idées », « créent »: the mute ending stays in the same syllable.
            if b == "e" && (rest.isEmpty || rest == "s" || rest == "nt") { return false }
            return true
        }
        if (a == "a" || a == "o") && (b == "é" || b == "è") { return true }
        if a == "a" && (b == "o" || b == "ô") { return !(b == "ô" || rest.hasPrefix("n")) }
        if a == "o" && b == "a" { return true }

        let before = letters[0..<(i - 1)]
        if a == "i" && endsWithCluster(before) { return true }
        if a == "u" && "aeéè".contains(b) && endsWithCluster(before) { return true }
        // « crayon », « voyage »: a y between two vowels belongs to both syllables.
        if a == "y" && i >= 2 && isVowel(letters[i - 2]) { return true }
        return false
    }

    /// Groups of vowels heard as one sound.
    private static func vowelGroups(_ word: String) -> Int {
        let letters = Array(word)
        var groups = 0
        for i in letters.indices where isVowel(letters[i]) {
            if i == 0 || !isVowel(letters[i - 1]) || isHiatus(letters, i) { groups += 1 }
        }
        return groups
    }

    /// Takes off an ending that is written but not heard, unless doing so would leave nothing to say.
    private static func strippedMuteEnding(_ word: String) -> String {
        var candidates: [String] = []
        if word.hasSuffix("ent") && !word.hasSuffix("ment") && !pronouncedENT.contains(word) {
            candidates.append(String(word.dropLast(3)))
        }
        if word.hasSuffix("ques") || word.hasSuffix("gues") {
            candidates.append(String(word.dropLast(3)))
        } else if word.hasSuffix("que") || word.hasSuffix("gue") {
            candidates.append(String(word.dropLast(2)))
        }
        let letters = Array(word)
        if letters.count >= 2 {
            let last = letters[letters.count - 1]
            let beforeLast = letters[letters.count - 2]
            if last == "e" && !isVowel(beforeLast) {
                candidates.append(String(word.dropLast()))
            } else if last == "s" && beforeLast == "e" && letters.count >= 3 && !isVowel(letters[letters.count - 3]) {
                candidates.append(String(word.dropLast(2)))
            }
        }
        for candidate in candidates where vowelGroups(candidate) >= 1 { return candidate }
        return word
    }

    private static func countPart(_ part: String) -> Int {
        if part.isEmpty { return 0 }
        if !part.contains(where: \.isLetter) {
            let digits = part.filter(\.isNumber).count
            return digits > 0 ? min(3, digits) : 0
        }
        if let special = specialSyllables[part] { return special }
        return max(1, vowelGroups(strippedMuteEnding(part)))
    }

    /// Spoken syllables of a French word. A hyphenated word adds up its parts.
    public static func countSyllables(_ word: String) -> Int {
        var w = word.precomposedStringWithCanonicalMapping.lowercased()
        w = String(w.unicodeScalars.map { $0 == "\u{2019}" || $0 == "\u{02BC}" ? Character("'") : Character($0) })
        // Punctuation around the word is not part of it.
        while let first = w.first, !first.isLetter && !first.isNumber { w.removeFirst() }
        while let last = w.last, !last.isLetter && !last.isNumber { w.removeLast() }
        if w.isEmpty { return 0 }

        // Split into parts and the separators between them, the way the web app does: part, separator, part…
        // `separators[i]` is what follows `parts[i]`, and the last one is empty.
        var parts: [String] = []
        var separators: [String] = []
        var current = ""
        var separator = ""
        var inSeparator = false

        func isSeparator(_ c: Character) -> Bool {
            c == "-" || c == "\u{2010}" || c == "\u{2011}" || c == "'" || c.isWhitespace
        }

        for character in w {
            if isSeparator(character) {
                if !inSeparator {
                    parts.append(current)
                    current = ""
                    inSeparator = true
                }
                separator.append(character)
            } else {
                if inSeparator {
                    separators.append(separator)
                    separator = ""
                    inSeparator = false
                }
                current.append(character)
            }
        }
        parts.append(current)
        separators.append(separator)

        var total = 0
        for index in parts.indices {
            let part = parts[index]
            let following = index < separators.count ? separators[index] : ""
            if following.contains("'") && silentElisions.contains(part) { continue }
            if following.contains("'") && part.hasSuffix("qu") {
                total += max(0, vowelGroups(part) - 1)
                continue
            }
            total += countPart(part)
        }
        return max(1, total)
    }

    private static func rounded(_ value: Double) -> Double {
        (value * 100).rounded() / 100
    }

    /// Sentence and word statistics of a French text. An elided clitic (« l’ ») is not a word of its own.
    /// - Parameter exemptWords: words of the source text, which never count as long and stay out of the average; an
    ///   explanation quoting « photosynthèse » should not be called hard because of a word the book already used.
    public static func report(for text: String, exemptWords: [String] = []) -> ReadabilityReport {
        var exempt = Set<String>()
        for word in exemptWords {
            for part in TextNormalizer.normalizedForMatch(word).split(separator: " ") where !part.isEmpty {
                exempt.insert(String(part))
            }
        }

        let tokens = Tokenizer.tokenizeWords(text).filter { !Tokenizer.isElisionToken($0.word) }
        let spans = SentenceSegmenter.sentences(in: text)
        var perSentence: [Int] = []
        var tokenIndex = 0
        for span in spans {
            var count = 0
            while tokenIndex < tokens.count && tokens[tokenIndex].start < span.end {
                if tokens[tokenIndex].start >= span.start { count += 1 }
                tokenIndex += 1
            }
            if count > 0 { perSentence.append(count) }
        }

        let words = tokens.count
        let sentences = perSentence.count
        var longWords = 0
        var syllables = 0
        var counted = 0
        for token in tokens {
            let normalized = TextNormalizer.normalizedForMatch(token.word)
            let parts = normalized.split(separator: " ").map(String.init)
            if exempt.contains(normalized) || (!parts.isEmpty && parts.allSatisfy(exempt.contains)) { continue }
            let count = countSyllables(token.word)
            counted += 1
            syllables += count
            if count >= longWordSyllables { longWords += 1 }
        }

        let averageWords = sentences > 0 ? Double(words) / Double(sentences) : 0
        let syllablesPerWord = counted > 0 ? Double(syllables) / Double(counted) : 0
        return ReadabilityReport(
            words: words,
            sentences: sentences,
            averageWordsPerSentence: rounded(averageWords),
            longestSentenceWords: perSentence.max() ?? 0,
            longWordRatio: words > 0 ? rounded(Double(longWords) / Double(words)) : 0,
            kandelMoles: words > 0 ? rounded(207 - 1.015 * averageWords - 73.6 * syllablesPerWord) : 0
        )
    }
}
