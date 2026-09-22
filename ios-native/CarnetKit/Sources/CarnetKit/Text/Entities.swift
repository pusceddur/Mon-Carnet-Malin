import Foundation

/// The figures and names a text contains. Ported from `shared/src/text/entities.ts`.
///
/// This exists for one reason: checking that a model did not invent anything. When the app explains a passage, the
/// answer may only carry numbers and names that are in the page. A date turned from 1789 into 1798, or a name that
/// was never there, has to be caught before a child reads it.
public struct Entities: Equatable, Sendable {
    /// Canonical values, years excluded.
    public let numbers: [String]
    /// Four-digit years, 1000 to 2199.
    public let years: [String]
    /// Runs of capitalised words.
    public let properNouns: [String]
}

public enum EntityExtractor {
    /// Common nouns that school texts capitalise out of habit. They are never names.
    public static let capitalizedCommon: Set<String> = [
        "soleil", "terre", "lune", "univers", "galaxie", "voie lactée", "système solaire", "ciel", "espace", "nature",
        "état", "états", "église", "églises", "moyen âge", "haut moyen âge", "antiquité", "préhistoire",
        "paléolithique", "néolithique", "renaissance", "révolution", "révolution française", "révolution industrielle",
        "république", "empire", "royaume", "temps modernes", "lumières", "siècle des lumières", "âge du bronze",
        "âge du fer", "grande guerre", "guerre mondiale", "première guerre mondiale", "seconde guerre mondiale",
        "deuxième guerre mondiale", "résistance", "libération", "nation", "gouvernement", "parlement",
        "assemblée nationale", "sénat", "constitution", "président", "ministre", "premier ministre", "roi", "reine",
        "empereur", "impératrice", "prince", "princesse", "pape", "seigneur", "dieu", "dieux", "océan", "mer",
        "nord", "sud", "est", "ouest", "pôle nord", "pôle sud", "équateur", "hémisphère nord", "hémisphère sud",
        "occident", "orient", "hexagone", "région", "département", "commune", "homme", "humanité", "histoire",
        "géographie", "monsieur", "madame", "mademoiselle", "maman", "papa", "mamie", "papi", "papy", "maître",
        "maîtresse", "noël", "pâques", "nouvel an",
    ]

    private static let commonNormalized: Set<String> = Set(capitalizedCommon.map(TextNormalizer.normalizedForMatch))
    /// Titles after which the next capitalised word is a name.
    private static let honorifics: Set<String> = [
        "m", "mm", "mme", "mmes", "mlle", "mlles", "dr", "pr", "me", "mgr", "monsieur", "madame", "mademoiselle",
    ]
    /// Words after which a bare roman numeral is a number: « chapitre IV ».
    private static let romanAfter: Set<String> = [
        "chapitre", "tome", "partie", "livre", "acte", "scène", "volume", "leçon", "titre", "article", "épisode",
    ]
    /// Words that announce one: « XVe siècle ».
    private static let romanBefore: Set<String> = [
        "siècle", "siècles", "millénaire", "millénaires", "république", "dynastie", "arrondissement",
    ]
    /// A capitalised run of at most this many words can still be a common noun in the list above.
    private static let maxCommonWords = 4

    // MARK: - Small helpers

    private static func slice(_ units: [UInt16], _ from: Int, _ to: Int) -> String {
        guard from >= 0, from <= to, to <= units.count else { return "" }
        return String(decoding: units[from..<to], as: UTF16.self)
    }

    /// Only plain or no-break spaces: what may sit inside one number or one name.
    private static func isSpacesOnly(_ text: String) -> Bool {
        !text.isEmpty && text.allSatisfy { $0 == " " || $0 == "\u{00A0}" || $0 == "\u{202F}" }
    }

    private static func startsWithCapital(_ word: String) -> Bool {
        word.first?.isUppercase ?? false
    }

    private static func isAllCaps(_ word: String) -> Bool {
        let letters = word.filter(\.isLetter)
        guard letters.count >= 2 else { return false }
        return String(letters) == String(letters).uppercased()
    }

    private static func isRomanToken(_ word: String) -> Bool {
        var numeral = ""
        var suffix = ""
        for character in word {
            if suffix.isEmpty && "IVXLCDM".contains(character) {
                numeral.append(character)
            } else {
                suffix.append(character)
            }
        }
        guard !numeral.isEmpty else { return false }
        let allowed: Set<String> = ["", "e", "es", "er", "re", "ère", "ème", "èmes", "eme", "è"]
        return allowed.contains(suffix)
    }

    private static func isKnown(_ word: String, _ isKnownWord: (String) -> Bool) -> Bool {
        let lower = word.lowercased()
        if isKnownWord(lower) { return true }
        let parts = lower.split(whereSeparator: { $0 == "-" || $0 == "\u{2010}" || $0 == "\u{2011}" }).map(String.init)
        return parts.count > 1 && parts.allSatisfy { !$0.isEmpty && isKnownWord($0) }
    }

    private static func isCommonCapitalized(_ normalized: String) -> Bool {
        if commonNormalized.contains(normalized) { return true }
        var singular = normalized
        if singular.hasSuffix("s") || singular.hasSuffix("x") { singular.removeLast() }
        return commonNormalized.contains(singular)
    }

    private static func isAllDigits(_ text: String) -> Bool {
        !text.isEmpty && text.allSatisfy(\.isNumber)
    }

    /// Collects values without repeating one, keeping the order they were met in.
    private struct UniqueList {
        private(set) var values: [String] = []
        private var seen = Set<String>()

        mutating func append(_ value: String, key: String? = nil) {
            let identity = key ?? value
            guard !seen.contains(identity) else { return }
            seen.insert(identity)
            values.append(value)
        }
    }

    // MARK: - Extraction

    /// - Parameters:
    ///   - isKnownWord: answers whether a lower-cased French word exists.
    ///   - contextText: the page the text comes from. A capitalised word that also appears in lower case there is an
    ///     ordinary word that happens to start a line, not a name.
    public static func extract(
        from text: String,
        isKnownWord: (String) -> Bool,
        contextText: String = ""
    ) -> Entities {
        let units = Array(text.utf16)
        let tokens = Tokenizer.tokenizeWords(text)
        guard !tokens.isEmpty else { return Entities(numbers: [], years: [], properNouns: []) }

        var numbers = UniqueList()
        var years = UniqueList()
        var properNouns = UniqueList()

        func gap(_ a: WordToken, _ b: WordToken) -> String { slice(units, a.end, b.start) }

        /// Every word that appears in lower case, here or in the page around it.
        var lowercaseForms = Set<String>()
        for source in [text, contextText] where !source.isEmpty {
            for token in Tokenizer.tokenizeWords(source) where !token.word.contains(where: \.isUppercase) {
                lowercaseForms.insert(TextNormalizer.normalizedForMatch(token.word))
            }
        }

        // Which tokens open a sentence: there, a capital means nothing by itself.
        var sentenceStarts = Set<Int>()
        let spans = SentenceSegmenter.sentences(in: text)
        var spanIndex = 0
        for index in tokens.indices {
            while spanIndex < spans.count && spans[spanIndex].end <= tokens[index].start { spanIndex += 1 }
            let span = spanIndex < spans.count ? spans[spanIndex] : nil
            if index == 0 {
                sentenceStarts.insert(index)
                continue
            }
            let previous = tokens[index - 1]
            if let span, previous.end <= span.start {
                sentenceStarts.insert(index)
            } else if gap(previous, tokens[index]).contains(where: { "«\u{201C}\u{2014}\u{2013}:\n".contains($0) }) {
                sentenceStarts.insert(index)
            }
        }

        var consumed = Set<Int>()

        func addNumber(_ raw: String, mayBeYear: Bool) {
            guard let value = FrenchNumbers.normalize(raw) else { return }
            if mayBeYear, raw.count == 4, isAllDigits(raw), let number = Int(value), number >= 1000, number <= 2199 {
                years.append(value)
                return
            }
            numbers.append(value)
        }

        // ---- Numbers

        var i = 0
        while i < tokens.count {
            let token = tokens[i]
            let word = token.word

            if word.first?.isNumber == true {
                // « 14-18 »: two numbers, not one.
                let halves = word.split(whereSeparator: { $0 == "-" || $0 == "\u{2010}" || $0 == "\u{2011}" }).map(String.init)
                if halves.count == 2 && halves.allSatisfy(isAllDigits) {
                    for half in halves { addNumber(half, mayBeYear: true) }
                    consumed.insert(i)
                    i += 1
                    continue
                }

                var j = i
                var joined = word
                // « 1 000 000 »: groups of three joined by a single space.
                if word.count <= 3 && isAllDigits(word) {
                    while j + 1 < tokens.count {
                        let next = tokens[j + 1].word
                        let digits = next.split(separator: ",").map(String.init)
                        let looksLikeGroup = digits.count <= 2 && digits.first?.count == 3
                            && digits.allSatisfy(isAllDigits)
                        guard looksLikeGroup, gap(tokens[j], tokens[j + 1]) == " " else { break }
                        j += 1
                        joined += " " + tokens[j].word
                        if joined.contains(",") { break }
                    }
                }
                // « 2,5 millions »
                if j + 1 < tokens.count {
                    let scale = tokens[j + 1]
                    let scaleWord = scale.word.lowercased()
                    let isScale = ["mille", "million", "millions", "milliard", "milliards"].contains(scaleWord)
                    if isScale, isSpacesOnly(gap(tokens[j], scale)),
                       FrenchNumbers.normalize("\(joined) \(scaleWord)") != nil {
                        j += 1
                        joined = "\(joined) \(scaleWord)"
                    }
                }
                for k in i...j { consumed.insert(k) }
                addNumber(joined, mayBeYear: j == i)
                i = j + 1
                continue
            }

            if isRomanToken(word), !FrenchNumbers.numberWords.contains(word.lowercased()) {
                let numeral = String(word.prefix(while: { "IVXLCDM".contains($0) }))
                let hasSuffix = numeral.count < word.count
                let previous = i > 0 ? tokens[i - 1] : nil
                let next = i + 1 < tokens.count ? tokens[i + 1] : nil

                // « Louis XIV », « chapitre IV »: a name or a label before it.
                let afterName: Bool = {
                    guard let previous, isSpacesOnly(gap(previous, token)) else { return false }
                    let looksLikeName = startsWithCapital(previous.word) && previous.word.dropFirst().first?.isLowercase == true
                        && !Stopwords.isStopword(TextNormalizer.normalizedForMatch(previous.word))
                    return looksLikeName || romanAfter.contains(previous.word.lowercased())
                }()
                let beforeContext = next.map { romanBefore.contains($0.word.lowercased()) } ?? false
                let isFirstOrdinal = ["Ier", "Ire", "Ière"].contains(word)
                let accept = hasSuffix
                    ? (numeral.count >= 2 || isFirstOrdinal || beforeContext)
                    : (afterName || beforeContext || (numeral.count >= 3 && !isKnown(word, isKnownWord)))

                if accept, let value = FrenchNumbers.normalize(word) {
                    consumed.insert(i)
                    addNumber(value, mayBeYear: false)
                    i += 1
                    continue
                }
            }

            // Numbers written in letters: take the longest run that still reads as one number.
            let lower = word.lowercased()
            let parts = lower.split(whereSeparator: { $0 == "-" || $0 == "\u{2010}" || $0 == "\u{2011}" }).map(String.init)
            let looksNumeric = parts.allSatisfy { part in
                FrenchNumbers.numberWords.contains(part) || part == "et"
                    || part.hasSuffix("ième") || part.hasSuffix("ièmes") || part.hasSuffix("ieme") || part.hasSuffix("iemes")
                    || part.hasPrefix("premier") || part.hasPrefix("première")
            }
            if looksNumeric, FrenchNumbers.normalize(lower) != nil {
                var best = i
                var bestValue = FrenchNumbers.normalize(lower)
                var phrase = lower
                var j = i + 1
                while j < tokens.count, isSpacesOnly(gap(tokens[j - 1], tokens[j])) {
                    phrase += " " + tokens[j].word.lowercased()
                    if let value = FrenchNumbers.normalize(phrase) {
                        best = j
                        bestValue = value
                    } else if tokens[j].word.lowercased() != "et" {
                        break
                    }
                    j += 1
                }
                // A lone « un » is an article far more often than a number.
                let isLoneArticle = best == i && (lower == "un" || lower == "une")
                if let bestValue, !isLoneArticle {
                    for k in i...best { consumed.insert(k) }
                    addNumber(bestValue, mayBeYear: false)
                    i = best + 1
                    continue
                }
            }
            i += 1
        }

        // ---- Proper nouns

        // Capitalised runs that are really one of the common nouns above.
        var commonTokens = Set<Int>()
        for index in tokens.indices where startsWithCapital(tokens[index].word) {
            var phrase = TextNormalizer.normalizedForMatch(tokens[index].word)
            var length = 1
            while length <= maxCommonWords && index + length <= tokens.count {
                if length > 1 {
                    let token = tokens[index + length - 1]
                    guard isSpacesOnly(gap(tokens[index + length - 2], token)) else { break }
                    phrase += " " + TextNormalizer.normalizedForMatch(token.word)
                }
                if isCommonCapitalized(phrase) {
                    for k in index..<(index + length) { commonTokens.insert(k) }
                }
                length += 1
            }
        }

        func isProperNoun(_ index: Int) -> Bool {
            let token = tokens[index]
            let word = token.word
            guard startsWithCapital(word), !Tokenizer.isElisionToken(word), word.count >= 2 else { return false }
            let normalized = TextNormalizer.normalizedForMatch(word)
            if honorifics.contains(normalized) { return false }

            // « M. Dupont »: whatever follows a title is a name.
            if index > 0 {
                let previous = tokens[index - 1]
                let between = gap(previous, token)
                let onlyTitleGap = !between.isEmpty && between.allSatisfy { $0 == "." || $0 == " " || $0 == "\u{00A0}" || $0 == "\u{202F}" }
                if honorifics.contains(TextNormalizer.normalizedForMatch(previous.word)) && onlyTitleGap { return true }
            }
            // An acronym is a name unless it is also a word.
            if isAllCaps(word) { return !isKnown(word, isKnownWord) }
            // At the start of a sentence a capital proves nothing: only an unknown word is a name.
            if sentenceStarts.contains(index) { return !isKnown(word, isKnownWord) }
            // Elsewhere, a known word that also appears in lower case is that word, not a name.
            return !(isKnown(word, isKnownWord) && lowercaseForms.contains(normalized))
        }

        var run: [String] = []
        var runEnd: WordToken?

        func flush() {
            if !run.isEmpty {
                let name = run.joined(separator: " ")
                properNouns.append(name, key: TextNormalizer.normalizedForMatch(name))
            }
            run = []
            runEnd = nil
        }

        for index in tokens.indices {
            let token = tokens[index]
            let proper = !consumed.contains(index) && !commonTokens.contains(index) && isProperNoun(index)
            guard proper else {
                flush()
                continue
            }
            // « Jean Dupont » is one name; « Jean, Dupont » is two.
            if let runEnd, !isSpacesOnly(gap(runEnd, token)) { flush() }
            run.append(token.word)
            runEnd = token
        }
        flush()

        return Entities(numbers: numbers.values, years: years.values, properNouns: properNouns.values)
    }
}
