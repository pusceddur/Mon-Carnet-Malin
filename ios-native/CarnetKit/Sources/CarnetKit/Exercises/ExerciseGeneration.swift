import Foundation

/// Making an exercise out of what the help wrote. Ported from `client/src/features/exercises/lib/generation.ts`.
///
/// Nothing is made on the device when the help cannot answer (decision of 2026-09-19): the child is told the questions
/// are not available right now. `LocalQuestions` exists and is tested, but neither app calls it — questions built from
/// the text alone were judged too thin to put in front of a child as an exercise.
public enum ExerciseGeneration {
    /// The types a child's profile allows, in the canonical order. Every type when the profile lists none: a child
    /// with no question types would have no exercises, and nothing on their screen would say why.
    public static func allowedTypes(_ enabled: [QuestionType]) -> [QuestionType] {
        let kept = QuestionType.allCases.filter(enabled.contains)
        return kept.isEmpty ? QuestionType.allCases : kept
    }

    /// Whether a question can be shown and answered at all.
    ///
    /// The help is checked before anything reaches the child: a multiple-choice question whose right answer points
    /// past the end of its choices cannot be answered correctly, and a child who gets it « wrong » will not know it
    /// was never their fault.
    public static func isPlayable(_ question: Question) -> Bool {
        func filled(_ text: String) -> Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard filled(question.id), filled(question.prompt) else { return false }

        switch question.kind {
        case let .multipleChoice(choices, correctIndex, _):
            return choices.count >= 2 && choices.allSatisfy(filled) && choices.indices.contains(correctIndex)
        case .trueOrFalse:
            return true
        case let .freeAnswer(expectedAnswer, _):
            return filled(expectedAnswer)
        case let .matching(pairs):
            return pairs.count >= 2 && pairs.allSatisfy { filled($0.left) && filled($0.right) }
        case let .ordering(items):
            return items.count >= 2 && items.allSatisfy(filled)
        }
    }

    /// Playable questions of the wanted types, each with its own id, at most `count` of them.
    public static func clean(_ questions: [Question], types: [QuestionType], count: Int) -> [Question] {
        var seen: Set<String> = []
        var kept: [Question] = []
        for question in questions {
            guard kept.count < count else { break }
            guard types.contains(question.type), isPlayable(question) else { continue }
            var id = question.id
            var suffix = 2
            while seen.contains(id) {
                id = "\(question.id)-\(suffix)"
                suffix += 1
            }
            seen.insert(id)
            kept.append(id == question.id
                ? question
                : Question(id: id, prompt: question.prompt, source: question.source, kind: question.kind))
        }
        return kept
    }

    public enum Outcome: Sendable {
        case created(Exercise)
        case blocked(message: String)
        case unavailable(message: String, canRetry: Bool)
        /// The help answered, but nothing it wrote could be used.
        case empty
    }

    /// Asks the help for questions on some pages and turns the answer into an exercise, not yet saved.
    public static func create(
        pages: [PageContent],
        document: DocumentMeta,
        child: ChildProfile,
        count: Int,
        types: [QuestionType],
        ai: AIService,
        now: Millis
    ) async -> Outcome {
        let (inputs, _) = AIPageInput.from(pages)
        guard !inputs.isEmpty, !types.isEmpty else { return .empty }

        let result = await ai.request(GenerateQuestionsRequest(
            childId: child.id, documentId: document.id,
            documentHash: document.sourceHash.isEmpty ? nil : document.sourceHash,
            count: count, types: types, pages: inputs
        ), for: child)

        switch result {
        case let .unavailable(reason, message, _):
            return .unavailable(message: message, canRetry: reason.isWorthRetrying)
        case let .blocked(reason, message, _) where reason != .validation:
            return .blocked(message: message)
        case let .ok(data, meta):
            let questions = clean(data.questions, types: types, count: count)
            guard !questions.isEmpty else { return .empty }
            return .created(Exercise(
                id: UUID().uuidString,
                childId: child.id,
                documentId: document.id,
                pageIndexes: Array(Set(inputs.map(\.pageIndex))).sorted(),
                questions: questions,
                origin: meta.route == .local ? .local : .ai,
                createdAt: now,
                updatedAt: now
            ))
        default:
            return .empty
        }
    }

    /// « Refaire le quiz »: the same questions in a new exercise, so the earlier answers stay in the history.
    public static func duplicate(_ exercise: Exercise, now: Millis) -> Exercise {
        Exercise(
            id: UUID().uuidString, childId: exercise.childId, documentId: exercise.documentId,
            pageIndexes: exercise.pageIndexes, questions: exercise.questions, origin: exercise.origin,
            createdAt: now, updatedAt: now
        )
    }

    /// The pages sent with a written answer: the question's own page and its neighbours. All of them when its page
    /// is not among them. Keeps the request small and the correction about the right passage.
    public static func pagesAround<T>(_ pages: [T], source pageIndex: Int, index: (T) -> Int) -> [T] {
        let near = pages.filter { abs(index($0) - pageIndex) <= 1 }
        return near.contains { index($0) == pageIndex } ? near : pages
    }

    /// How a written answer was judged, or that it could not be.
    public enum FreeCorrection: Sendable {
        case corrected(Correction, rereadRef: SourceRef?)
        /// No correction possible — offline, turned off, a drawing. The child compares with the expected answer.
        case selfCheck(message: String?)
        case adultRedirect(message: String)
    }

    /// A written answer, read by the help.
    public static func correctFreeAnswer(
        question: Question,
        text: String,
        pages: [PageContent],
        document: DocumentMeta,
        child: ChildProfile,
        ai: AIService?
    ) async -> FreeCorrection {
        let answer = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let nearby = pagesAround(pages, source: question.source.pageIndex, index: \.pageIndex)
        let (inputs, _) = AIPageInput.from(nearby)
        guard let ai, !answer.isEmpty, !inputs.isEmpty else { return .selfCheck(message: nil) }

        let result = await ai.request(CorrectAnswerRequest(
            childId: child.id, documentId: document.id,
            documentHash: document.sourceHash.isEmpty ? nil : document.sourceHash,
            question: question, answerText: answer, pages: inputs
        ), for: child)

        switch result {
        case let .ok(data, _):
            return .corrected(
                Correction(verdict: data.verdict, feedback: data.feedback),
                rereadRef: data.rereadRef ?? (data.verdict == .correct ? nil : question.source)
            )
        case let .blocked(.adultRedirect, message, _):
            return .adultRedirect(message: message)
        default:
            return .selfCheck(message: result.message)
        }
    }
}
