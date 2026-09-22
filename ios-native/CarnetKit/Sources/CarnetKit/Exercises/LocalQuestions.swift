import Foundation

/// A page as the question generator reads it.
public struct PageText: Equatable, Sendable {
    public let pageIndex: Int
    public let text: String

    public init(pageIndex: Int, text: String) {
        self.pageIndex = pageIndex
        self.text = text
    }
}

/// Deterministic pseudo-random numbers (mulberry32), written to give the same sequence as the web app's.
///
/// Determinism is not a nicety here: the same book with the same seed must produce the same exercise on the iPad and
/// in the browser, or a child would be handed different questions depending on which device they picked up.
final class SeededRandom {
    private var state: UInt32

    init(seed: UInt32) {
        state = seed
    }

    /// A number in [0, 1).
    func next() -> Double {
        state = state &+ 0x6d2b79f5
        var t = state
        t = (t ^ (t >> 15)) &* (t | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4294967296
    }

    /// Fisher-Yates, taking the numbers in the same order as the web app so both shuffles agree.
    func shuffled<V>(_ items: [V]) -> [V] {
        var out = items
        guard out.count > 1 else { return out }
        for i in stride(from: out.count - 1, to: 0, by: -1) {
            let j = Int(next() * Double(i + 1))
            out.swapAt(i, min(j, i))
        }
        return out
    }
}

/// Comprehension questions built from the text alone — no model, no network.
/// Ported from `shared/src/exercises/localQuestions.ts`.
///
/// This is what a child gets on a train, in a waiting room, or on the evening the connection is down. The questions
/// are humbler than a model's — a missing word, an order to put back, a sentence to confirm — but they are always
/// about the book in front of them, and they arrive instantly.
public enum LocalQuestions {
    private static let maxQuestions = 20
    private static let quoteMaxChars = 2000
    private static let itemMaxChars = 1000
    /// The only three kinds that can be built honestly from the text itself. A free answer needs someone to read it,
    /// and pairs invented without understanding the text would be pairs of nothing.
    private static let localTypes: [QuestionType] = [.multipleChoice, .ordering, .trueOrFalse]

    /// « je », « tu », « nous »: a sentence that speaks of someone cannot be judged true or false out of its context.
    private static let personalWords: Set<String> = [
        "je", "j", "tu", "te", "toi", "nous", "vous", "me", "moi", "mon", "ma", "mes",
        "ton", "ta", "tes", "notre", "votre", "nos", "vos",
    ]

    private static let determiners: Set<String> = [
        "le", "la", "les", "l", "un", "une", "des", "du", "de", "d", "au", "aux", "ce", "cet", "cette", "ces", "mon",
        "ma", "mes", "ton", "ta", "tes", "son", "sa", "ses", "notre", "nos", "votre", "vos", "leur", "leurs",
        "chaque", "quelques", "plusieurs",
    ]

    private static let subjectPronouns: Set<String> = [
        "je", "j", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles", "qui", "ne", "n", "se", "s",
    ]

    /// Rough grammatical place of a word, read from the word before it: a noun after « les », a verb after « il ».
    /// Crude, but enough to stop the app offering a verb where only a noun could go.
    enum WordClass {
        case afterDeterminer
        case afterPronoun
        case other
    }

    static func wordClass(after previous: String?) -> WordClass {
        guard let previous else { return .other }
        let p = TextNormalizer.normalizedForMatch(previous)
        if determiners.contains(p) { return .afterDeterminer }
        return subjectPronouns.contains(p) ? .afterPronoun : .other
    }

    /// One word of the book, seen everywhere it appears.
    struct VocabularyWord {
        let surface: String
        let normalized: String
        let stem: String
        var classes: Set<WordClass>
    }

    private struct Sentence {
        let located: LocatedSentence
        let words: Int
        let normalized: String

        var pageIndex: Int { located.pageIndex }
        var order: Int { located.order }
        var start: Int { located.start }
        var end: Int { located.end }
        var text: String { located.text }
    }

    private struct Draft {
        let order: Int
        let prompt: String
        let source: SourceRef
        let kind: Question.Kind
    }

    // MARK: - Words

    /// Lower-case letters, possibly joined by hyphens: « arc-en-ciel » yes, « Paris » no, « 1985 » no.
    /// Proper nouns are left out on purpose — a child asked to complete « ____ est arrivé » with a name is being asked
    /// to remember, not to read.
    static func isPlainLowercaseWord(_ word: String) -> Bool {
        let parts = word.split(separator: "-", omittingEmptySubsequences: false)
        guard !parts.isEmpty else { return false }
        for part in parts {
            if part.isEmpty { return false }
            for scalar in part.unicodeScalars where scalar.properties.generalCategory != .lowercaseLetter {
                return false
            }
        }
        return true
    }

    /// Words of about the same length feel interchangeable to a child skimming the choices; a four-letter word next to
    /// a twelve-letter one gives the answer away by its shape alone.
    static func lengthBucket(_ word: String) -> Int {
        let n = word.replacingOccurrences(of: "-", with: "").count
        if n <= 4 { return 0 }
        return n <= 7 ? 1 : 2
    }

    /// Worth hiding: a real word, long enough to be read rather than guessed, not a grammar word, not a number.
    static func isEligibleWord(_ word: String) -> Bool {
        guard isPlainLowercaseWord(word), word.replacingOccurrences(of: "-", with: "").count >= 4 else { return false }
        let n = TextNormalizer.normalizedForMatch(word)
        return !Stopwords.isStopword(n) && !FrenchNumbers.numberWords.contains(word)
    }

    private static func stem(of normalized: String) -> String {
        Stopwords.lightStem(normalized.replacingOccurrences(of: " ", with: ""))
    }

    private static func buildVocabulary(_ sentences: [Sentence]) -> [VocabularyWord] {
        var byWord: [String: VocabularyWord] = [:]
        // Insertion order, because the ranking below has ties and they must break the same way every time.
        var order: [String] = []

        for sentence in sentences {
            let tokens = Tokenizer.tokenizeWords(sentence.text)
            for (index, token) in tokens.enumerated() {
                guard isEligibleWord(token.word) else { continue }
                let normalized = TextNormalizer.normalizedForMatch(token.word)
                if byWord[normalized] == nil {
                    byWord[normalized] = VocabularyWord(
                        surface: token.word, normalized: normalized, stem: stem(of: normalized), classes: []
                    )
                    order.append(normalized)
                }
                byWord[normalized]?.classes.insert(wordClass(after: index > 0 ? tokens[index - 1].word : nil))
            }
        }
        return order.compactMap { byWord[$0] }
    }

    /// The wrong choices, taken from the same book.
    ///
    /// Inventing words, or pulling them from a general list, produces choices a child can rule out without reading:
    /// the right one is the only one that belongs to the story. So the distractors come from the same text, the same
    /// length class, the same grammatical place and, where possible, the same ending — the child has to read the
    /// sentence to choose.
    private static func pickDistractors(
        answer: VocabularyWord,
        answerClass: WordClass,
        sentence: Sentence,
        vocabulary: [VocabularyWord],
        random: SeededRandom
    ) -> [String] {
        let inSentence = Set(Tokenizer.tokenizeWords(sentence.text).map { TextNormalizer.normalizedForMatch($0.word) })
        let bucket = lengthBucket(answer.surface)
        let plural = endsInPluralMark(answer.normalized)

        let pool = vocabulary.filter {
            $0.normalized != answer.normalized
                && $0.stem != answer.stem
                && !inSentence.contains($0.normalized)
                && lengthBucket($0.surface) == bucket
                && endsInPluralMark($0.normalized) == plural
        }

        func sameClass(_ v: VocabularyWord) -> Bool { answerClass != .other && v.classes.contains(answerClass) }
        func sharesEnding(_ v: VocabularyWord, _ n: Int) -> Bool { lastLetters(v.normalized, n) == lastLetters(answer.normalized, n) }
        // « l’intérieur » but « la pression »: a choice that breaks the elision is spotted without reading the word.
        func startsWithVowel(_ v: VocabularyWord) -> Bool {
            guard let first = v.normalized.first else { return false }
            return "aeiouyh".contains(first)
        }
        func fitsElision(_ v: VocabularyWord) -> Bool {
            startsWithVowel(v) == startsWithVowel(answer) || v.normalized.hasPrefix("h")
        }
        func rank(_ v: VocabularyWord) -> Int {
            (fitsElision(v) ? 0 : 10) + (sameClass(v) ? 0 : 3) + (sharesEnding(v, 2) ? 0 : sharesEnding(v, 1) ? 1 : 2)
        }

        let ranked = stableSorted(random.shuffled(pool)) { rank($0) < rank($1) }
        var chosen: [VocabularyWord] = []
        for candidate in ranked {
            if chosen.count >= 3 { break }
            if chosen.contains(where: { $0.stem == candidate.stem }) { continue }
            chosen.append(candidate)
        }
        return chosen.map(\.surface)
    }

    private static func endsInPluralMark(_ normalized: String) -> Bool {
        guard let last = normalized.last else { return false }
        return last == "s" || last == "x"
    }

    private static func lastLetters(_ text: String, _ n: Int) -> String {
        text.count <= n ? text : String(text.suffix(n))
    }

    /// Swift's sort is not stable, and two candidates ranked the same must keep the order the shuffle gave them, or
    /// the same seed would produce different exercises on different runs.
    private static func stableSorted<V>(_ items: [V], by isBefore: (V, V) -> Bool) -> [V] {
        items.enumerated()
            .sorted { isBefore($0.element, $1.element) || (!isBefore($1.element, $0.element) && $0.offset < $1.offset) }
            .map(\.element)
    }

    // MARK: - The three kinds

    private static func collapseSpaces(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    private static func endsWithAny(_ text: String, _ endings: [Character]) -> Bool {
        guard let last = text.last else { return false }
        return endings.contains(last)
    }

    /// « Quel mot manque ? » — one word taken out of a sentence of the book.
    private static func fillInDraft(_ sentence: Sentence, _ vocabulary: [VocabularyWord], _ random: SeededRandom) -> Draft? {
        // Too short and the sentence gives no context; too long and the child has to hold it all in mind at once.
        guard sentence.words >= 6, sentence.words <= 25, endsWithAny(sentence.text, [".", "!", "…"]) else { return nil }
        let tokens = Tokenizer.tokenizeWords(sentence.text)

        var counts: [String: Int] = [:]
        for token in tokens {
            counts[TextNormalizer.normalizedForMatch(token.word), default: 0] += 1
        }
        // A word that appears twice in the sentence can be read off the other copy.
        let eligible = tokens
            .filter { isEligibleWord($0.word) && counts[TextNormalizer.normalizedForMatch($0.word)] == 1 }
            .sorted { $0.word.count != $1.word.count ? $0.word.count > $1.word.count : $0.start < $1.start }

        for token in random.shuffled(Array(eligible.prefix(4))) {
            let normalized = TextNormalizer.normalizedForMatch(token.word)
            let position = tokens.firstIndex(of: token) ?? 0
            let previous: String? = position > 0 ? tokens[position - 1].word : nil
            let answerClass = wordClass(after: previous)
            let answer = VocabularyWord(
                surface: token.word, normalized: normalized, stem: stem(of: normalized), classes: [answerClass]
            )
            let distractors = pickDistractors(
                answer: answer, answerClass: answerClass, sentence: sentence, vocabulary: vocabulary, random: random
            )
            // Two choices is a coin toss dressed up as a question; below three, the sentence is left alone.
            guard distractors.count >= 2 else { continue }

            let choices = random.shuffled([token.word] + distractors)
            let units = Array(sentence.text.utf16)
            let blanked = String(decoding: units[0..<token.start], as: UTF16.self)
                + ExerciseTexts.blank
                + String(decoding: units[token.end...], as: UTF16.self)

            return Draft(
                order: sentence.order,
                prompt: ExerciseTexts.format(ExerciseTexts.fillInPrompt, ["sentence": collapseSpaces(blanked)]),
                source: SourceRef(pageIndex: sentence.pageIndex, quote: sentence.text),
                kind: .multipleChoice(
                    choices: choices,
                    correctIndex: choices.firstIndex(of: token.word) ?? 0,
                    explanation: ExerciseTexts.format(
                        ExerciseTexts.fillInExplanation, ["sentence": collapseSpaces(sentence.text)]
                    )
                )
            )
        }
        return nil
    }

    /// « Vrai ou faux ? » — always a true sentence, quoted from the book.
    ///
    /// The app never writes a false sentence: making one up would mean understanding the text well enough to
    /// contradict it, and a plausible-sounding falsehood put in front of a child who is still learning to read would
    /// be worse than no question at all.
    private static func trueOrFalseDraft(_ sentence: Sentence) -> Draft? {
        guard sentence.words >= 5, sentence.words <= 20, sentence.text.hasSuffix(".") else { return nil }
        // Dialogue, asides and list items read as fragments once pulled out of the page.
        let awkward: Set<Character> = ["«", "»", "\u{201C}", "\u{201D}", "\"", "\u{2014}", "\u{2013}", "?", "!"]
        if sentence.text.contains(where: { awkward.contains($0) }) { return nil }
        if sentence.text.drop(while: { $0.isWhitespace }).hasPrefix("-") { return nil }
        // « Je suis parti » is neither true nor false on its own: it depends who « je » is.
        if Tokenizer.tokenizeWords(sentence.text).contains(where: {
            personalWords.contains(TextNormalizer.normalizedForMatch($0.word))
        }) { return nil }

        return Draft(
            order: sentence.order,
            prompt: ExerciseTexts.format(
                ExerciseTexts.trueOrFalsePrompt, ["sentence": collapseSpaces(sentence.text)]
            ),
            source: SourceRef(pageIndex: sentence.pageIndex, quote: sentence.text),
            kind: .trueOrFalse(answer: true, explanation: ExerciseTexts.trueOrFalseExplanation)
        )
    }

    /// A real sentence ends on . ! ? or …, possibly behind a closing quote. Headings and captions do not, and a
    /// heading dropped into « remets dans l’ordre » makes the exercise unsolvable.
    static func endsLikeSentence(_ text: String) -> Bool {
        var characters = Array(text)
        if let last = characters.last, "»\u{201D}\"’)".contains(last) { characters.removeLast() }
        while let last = characters.last, last.isWhitespace { characters.removeLast() }
        guard let last = characters.last else { return false }
        return ".!?\u{2026}".contains(last)
    }

    /// « Remets ces phrases dans l’ordre » — three to five sentences that really follow one another.
    private static func orderingDraft(_ window: [Sentence], _ pages: [PageText]) -> Draft? {
        guard let first = window.first, let last = window.last else { return nil }
        guard let page = pages.first(where: { $0.pageIndex == first.pageIndex }) else { return nil }

        let units = Array(page.text.utf16)
        guard first.start >= 0, last.end <= units.count, first.start <= last.end else { return nil }
        let quote = String(decoding: units[first.start..<last.end], as: UTF16.self)
        guard quote.count <= quoteMaxChars else { return nil }

        return Draft(
            order: first.order,
            prompt: ExerciseTexts.orderingPrompt,
            source: SourceRef(pageIndex: first.pageIndex, quote: quote),
            kind: .ordering(itemsInOrder: window.map(\.text))
        )
    }

    // MARK: - Building the set

    /// Builds up to `count` questions of the wanted kinds from the pages given, taking turns between the kinds so a
    /// child does not get twenty of the same thing. The same seed always gives the same questions.
    public static func generate(
        pages: [PageText], count: Int, types: [QuestionType], seed: UInt32 = 1
    ) -> [Question] {
        let wanted = max(0, min(maxQuestions, count))
        // In the order the caller asked for them, so a parent who put « vrai ou faux » first sees it first.
        let kinds = stableSorted(localTypes.filter { types.contains($0) }) {
            (types.firstIndex(of: $0) ?? 0) < (types.firstIndex(of: $1) ?? 0)
        }
        guard wanted > 0, !kinds.isEmpty else { return [] }
        let random = SeededRandom(seed: seed)

        var seen: Set<String> = []
        var sentences: [Sentence] = []
        for located in Passages.locateSentences(in: pages.map { (pageIndex: $0.pageIndex, text: $0.text) }) {
            let normalized = TextNormalizer.normalizedForMatch(located.text)
            // A line repeated across pages — a running header, a refrain — would make two questions with one answer.
            guard !normalized.isEmpty, !seen.contains(normalized) else { continue }
            seen.insert(normalized)
            sentences.append(
                Sentence(located: located, words: Tokenizer.countWords(located.text), normalized: normalized)
            )
        }

        let vocabulary = buildVocabulary(sentences)
        var used: Set<Int> = []
        // Drawn in the same order as the web app: the three shuffles consume the generator one after the other.
        var pools: [QuestionType: [Sentence]] = [:]
        pools[.multipleChoice] = random.shuffled(sentences)
        pools[.trueOrFalse] = random.shuffled(sentences)
        pools[.ordering] = random.shuffled(sentences)
        let byOrder = Dictionary(sentences.map { ($0.order, $0) }, uniquingKeysWith: { first, _ in first })

        func nextDraft(_ kind: QuestionType) -> Draft? {
            while let sentence = pools[kind]?.first {
                pools[kind]?.removeFirst()
                guard !used.contains(sentence.order) else { continue }

                switch kind {
                case .multipleChoice:
                    if let draft = fillInDraft(sentence, vocabulary, random) {
                        used.insert(sentence.order)
                        return draft
                    }
                case .trueOrFalse:
                    if let draft = trueOrFalseDraft(sentence) {
                        used.insert(sentence.order)
                        return draft
                    }
                default:
                    // Three to five sentences, taken forward from this one while they keep following one another.
                    let size = 3 + Int(random.next() * 3)
                    var window: [Sentence] = []
                    var order = sentence.order
                    while window.count < size {
                        guard let next = byOrder[order],
                              !used.contains(order),
                              next.pageIndex == sentence.pageIndex,
                              next.words >= 4, next.words <= 25,
                              next.text.count <= itemMaxChars,
                              endsLikeSentence(next.text)
                        else { break }
                        window.append(next)
                        order += 1
                    }
                    guard window.count >= 3 else { continue }
                    if let draft = orderingDraft(window, pages) {
                        for s in window { used.insert(s.order) }
                        return draft
                    }
                }
            }
            return nil
        }

        var drafts: [Draft] = []
        var exhausted: Set<QuestionType> = []
        var round = 0
        while drafts.count < wanted && exhausted.count < kinds.count {
            let kind = kinds[round % kinds.count]
            round += 1
            guard !exhausted.contains(kind) else { continue }
            if let draft = nextDraft(kind) {
                drafts.append(draft)
            } else {
                exhausted.insert(kind)
            }
        }

        // Back into reading order: the questions follow the book, whatever order they were built in.
        return stableSorted(drafts) { $0.order < $1.order }
            .enumerated()
            .map { Question(id: "local-\($0.offset + 1)", prompt: $0.element.prompt, source: $0.element.source, kind: $0.element.kind) }
    }
}
