import Foundation

/// The French the exercises say to the child: « tu », short, and never only « faux ».
///
/// A child using this app has usually been told they got it wrong many times already. A wrong answer here says what
/// the right one was, why, and where to read again — that is the whole difference between a correction and a verdict.
enum ExerciseTexts {
    /// Several ways of saying well done, so the same words do not come back at every question.
    static let correct = [
        "Bravo, c’est la bonne réponse !",
        "Exactement ! Tu as bien lu.",
        "Oui, c’est juste. Bien joué !",
    ]
    static let multipleChoiceIncorrect = "Pas tout à fait. La bonne réponse est « {answer} »."
    static let shouldBeTrue = "Pas tout à fait : d’après le texte, c’est vrai."
    static let shouldBeFalse = "Pas tout à fait : d’après le texte, c’est faux."
    static let matchingPartial = "Presque ! Tu as trouvé {found} bonnes paires sur {total}. Regarde encore les autres."
    static let matchingIncorrect = "Ce n’est pas encore ça : tu as trouvé {found} bonne paire sur {total}."
    static let matchingIncorrectPlural = "Ce n’est pas encore ça : tu as trouvé {found} bonnes paires sur {total}."
    static let orderingPartial = "Presque ! Une bonne partie est dans l’ordre. Regarde encore où vont les autres phrases."
    static let orderingIncorrect = "L’ordre n’est pas encore le bon."
    static let rereadAndRetry = "Relis le passage du texte, puis essaie encore."
    static let rereadToUnderstand = "Relis le passage pour bien comprendre."

    // Asked by the questions the app writes on its own, with no model.
    static let fillInPrompt = "Quel mot manque ? « {sentence} »"
    static let fillInExplanation = "Dans le texte, on lit : « {sentence} »"
    static let trueOrFalsePrompt = "D’après le texte, est-ce vrai ou faux ? « {sentence} »"
    static let trueOrFalseExplanation = "C’est vrai : cette phrase est écrite dans le texte."
    static let orderingPrompt = "Remets ces phrases dans l’ordre du texte."
    /// What stands in for the missing word.
    static let blank = "_____"

    static func format(_ template: String, _ values: [String: String]) -> String {
        var out = template
        for (key, value) in values { out = out.replacingOccurrences(of: "{\(key)}", with: value) }
        return out
    }
}

/// Judging the closed questions on the device, with no model and no network.
/// Ported from `shared/src/exercises/localCorrection.ts`.
///
/// Everything but a free answer can be judged here, which matters more than it sounds: a child doing exercises on a
/// train gets an answer straight away instead of « pas de connexion ».
public enum ExerciseCorrection {
    /// Half right is « partiel »: below that it is wrong.
    private static let partialRatio = 0.5
    /// Kept short on purpose: a paragraph of feedback is not read by the child it is written for.
    private static let feedbackMaxWords = 50

    /// Always the same praise for the same question, so a child who answers it twice is not told two different things.
    private static func praise(for questionId: String) -> String {
        var hash: UInt32 = 0
        for scalar in questionId.unicodeScalars { hash = hash &* 31 &+ scalar.value }
        return ExerciseTexts.correct[Int(hash % UInt32(ExerciseTexts.correct.count))]
    }

    private static func wordCount(_ text: String) -> Int {
        Tokenizer.countWords(text)
    }

    /// Joins the pieces of a correction, keeping whole sentences of the explanation while they fit.
    /// Cutting an explanation mid-sentence would leave the child with something they cannot read.
    private static func compose(_ head: String, explanation: String, tail: String) -> String {
        var budget = feedbackMaxWords - wordCount(head) - wordCount(tail)
        let text = explanation.trimmingCharacters(in: .whitespacesAndNewlines)
        let units = Array(text.utf16)
        var kept: [String] = []

        for span in SentenceSegmenter.sentences(in: text) {
            let sentence = String(decoding: units[span.start..<span.end], as: UTF16.self)
            let words = wordCount(sentence)
            if words > budget { break }
            kept.append(sentence)
            budget -= words
        }
        return ([head] + kept + [tail]).filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// Longest run of items that appear in the same order in both lists, used to tell « nearly ordered » from
    /// « shuffled »: a child who put one sentence in the wrong place has not got it all wrong.
    static func longestCommonSubsequence(_ a: [String], _ b: [String]) -> Int {
        guard !a.isEmpty, !b.isEmpty else { return 0 }
        var row = [Int](repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            var previousDiagonal = 0
            for j in 1...b.count {
                let saved = row[j]
                row[j] = a[i - 1] == b[j - 1] ? previousDiagonal + 1 : max(row[j], row[j - 1])
                previousDiagonal = saved
            }
        }
        return row[b.count]
    }

    private static func verdict(for ratio: Double) -> Verdict {
        if ratio >= 1 { return .correct }
        return ratio >= partialRatio ? .partial : .incorrect
    }

    /// Judges a closed question. Nil for a free answer, which only a model can read, and nil when the answer does not
    /// match the question it claims to answer.
    public static func correct(_ question: Question, _ response: AnswerResponse) -> Correction? {
        let wellDone = praise(for: question.id)

        switch (question.kind, response) {
        case let (.multipleChoice(choices, correctIndex, explanation), .multipleChoice(chosen)):
            if chosen == correctIndex { return Correction(verdict: .correct, feedback: wellDone) }
            let answer = correctIndex >= 0 && correctIndex < choices.count ? choices[correctIndex] : ""
            let head = answer.isEmpty ? "" : ExerciseTexts.format(ExerciseTexts.multipleChoiceIncorrect, ["answer": answer])
            return Correction(
                verdict: .incorrect,
                feedback: compose(head, explanation: explanation, tail: ExerciseTexts.rereadToUnderstand)
            )

        case let (.trueOrFalse(expected, explanation), .trueOrFalse(given)):
            if given == expected { return Correction(verdict: .correct, feedback: wellDone) }
            let head = expected ? ExerciseTexts.shouldBeTrue : ExerciseTexts.shouldBeFalse
            return Correction(
                verdict: .incorrect,
                feedback: compose(head, explanation: explanation, tail: ExerciseTexts.rereadToUnderstand)
            )

        case let (.matching(expected), .matching(given)):
            // Compared on their meaning, not their spelling: a capital or an accent must not fail a right answer.
            var answered: [String: String] = [:]
            for pair in given {
                let left = TextNormalizer.normalizedForMatch(pair.left)
                if answered[left] == nil { answered[left] = TextNormalizer.normalizedForMatch(pair.right) }
            }
            let total = expected.count
            let found = expected.filter {
                answered[TextNormalizer.normalizedForMatch($0.left)] == TextNormalizer.normalizedForMatch($0.right)
            }.count

            guard total > 0 else { return Correction(verdict: .correct, feedback: wellDone) }
            let result = verdict(for: Double(found) / Double(total))
            if result == .correct { return Correction(verdict: result, feedback: wellDone) }
            let values = ["found": String(found), "total": String(total)]
            let template = result == .partial
                ? ExerciseTexts.matchingPartial
                : (found > 1 ? ExerciseTexts.matchingIncorrectPlural : ExerciseTexts.matchingIncorrect)
            return Correction(
                verdict: result,
                feedback: "\(ExerciseTexts.format(template, values)) \(ExerciseTexts.rereadAndRetry)"
            )

        case let (.ordering(expectedItems), .ordering(givenItems)):
            let expected = expectedItems.map(TextNormalizer.normalizedForMatch)
            let given = givenItems.map(TextNormalizer.normalizedForMatch)
            if expected.count == given.count && expected == given {
                return Correction(verdict: .correct, feedback: wellDone)
            }
            let ratio = expected.isEmpty ? 0 : Double(longestCommonSubsequence(expected, given)) / Double(expected.count)
            // Never « correct » here: the order is not exactly right, whatever the ratio says.
            let result = verdict(for: min(ratio, 0.99))
            let head = result == .partial ? ExerciseTexts.orderingPartial : ExerciseTexts.orderingIncorrect
            return Correction(verdict: result, feedback: "\(head) \(ExerciseTexts.rereadAndRetry)")

        default:
            // A free answer, or an answer of the wrong shape for its question.
            return nil
        }
    }
}
