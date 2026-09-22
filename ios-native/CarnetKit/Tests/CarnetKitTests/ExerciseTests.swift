import XCTest
@testable import CarnetKit

/// Judging the closed questions on the device.
///
/// Two things are checked throughout: the verdict is right, and the child is never simply told « faux ». A wrong
/// answer must say what the right one was and where to look — for a child who has been corrected all day, that is the
/// whole difference between help and another mark against them.
final class ExerciseCorrectionTests: XCTestCase {
    private let source = SourceRef(pageIndex: 0, quote: "Le chat dort.")

    private func question(_ id: String, _ kind: Question.Kind) -> Question {
        Question(id: id, prompt: "Une question ?", source: source, kind: kind)
    }

    private func assertHelpful(_ correction: Correction?, file: StaticString = #filePath, line: UInt = #line) {
        let feedback = correction?.feedback ?? ""
        XCTAssertFalse(feedback.isEmpty, "a wrong answer must say something", file: file, line: line)
        XCTAssertGreaterThan(feedback.split(separator: " ").count, 3,
                             "« \(feedback) » does not tell the child anything", file: file, line: line)
    }

    // MARK: - Multiple choice

    func testARightChoiceIsPraised() {
        let q = question("q1", .multipleChoice(choices: ["le chat", "le chien"], correctIndex: 0, explanation: "Le texte dit chat."))
        let result = ExerciseCorrection.correct(q, .multipleChoice(choiceIndex: 0))
        XCTAssertEqual(result?.verdict, .correct)
        XCTAssertFalse(result?.feedback.isEmpty ?? true)
    }

    func testAWrongChoiceIsToldWhatTheAnswerWas() throws {
        let q = question("q1", .multipleChoice(choices: ["le chat", "le chien"], correctIndex: 0, explanation: "Le texte dit chat."))
        let result = try XCTUnwrap(ExerciseCorrection.correct(q, .multipleChoice(choiceIndex: 1)))
        XCTAssertEqual(result.verdict, .incorrect)
        XCTAssertTrue(result.feedback.contains("le chat"), "the child is told the answer, not just that they were wrong")
        XCTAssertTrue(result.feedback.contains("Relis"), "and where to look")
        assertHelpful(result)
    }

    func testThePraiseIsTheSameForTheSameQuestion() {
        let q = question("q-stable", .trueOrFalse(answer: true, explanation: "Oui."))
        let first = ExerciseCorrection.correct(q, .trueOrFalse(value: true))?.feedback
        let second = ExerciseCorrection.correct(q, .trueOrFalse(value: true))?.feedback
        XCTAssertEqual(first, second, "answering twice must not bring two different answers")
    }

    // MARK: - True or false

    func testTrueOrFalse() throws {
        let q = question("q2", .trueOrFalse(answer: false, explanation: "Le texte dit le contraire."))
        XCTAssertEqual(ExerciseCorrection.correct(q, .trueOrFalse(value: false))?.verdict, .correct)

        let wrong = try XCTUnwrap(ExerciseCorrection.correct(q, .trueOrFalse(value: true)))
        XCTAssertEqual(wrong.verdict, .incorrect)
        XCTAssertTrue(wrong.feedback.contains("faux"), "the child is told which way it was")
        assertHelpful(wrong)
    }

    // MARK: - Matching

    private var pairsQuestion: Question {
        question("q3", .matching(pairs: [
            Question.Pair(left: "chat", right: "miaule"),
            Question.Pair(left: "chien", right: "aboie"),
            Question.Pair(left: "oiseau", right: "chante"),
            Question.Pair(left: "vache", right: "meugle"),
        ]))
    }

    func testAllPairsRight() {
        let given = AnswerResponse.matching(pairs: [
            Question.Pair(left: "chat", right: "miaule"),
            Question.Pair(left: "chien", right: "aboie"),
            Question.Pair(left: "oiseau", right: "chante"),
            Question.Pair(left: "vache", right: "meugle"),
        ])
        XCTAssertEqual(ExerciseCorrection.correct(pairsQuestion, given)?.verdict, .correct)
    }

    func testHalfThePairsIsPartialNotWrong() throws {
        // Telling a child who got half of it right that they were wrong is untrue and discouraging.
        let given = AnswerResponse.matching(pairs: [
            Question.Pair(left: "chat", right: "miaule"),
            Question.Pair(left: "chien", right: "aboie"),
            Question.Pair(left: "oiseau", right: "meugle"),
            Question.Pair(left: "vache", right: "chante"),
        ])
        let result = try XCTUnwrap(ExerciseCorrection.correct(pairsQuestion, given))
        XCTAssertEqual(result.verdict, .partial)
        XCTAssertTrue(result.feedback.contains("2"), "the child is told how many they found")
        assertHelpful(result)
    }

    func testCapitalsAndAccentsDoNotFailARightAnswer() {
        let q = question("q4", .matching(pairs: [Question.Pair(left: "éléphant", right: "barrit")]))
        let given = AnswerResponse.matching(pairs: [Question.Pair(left: "ELEPHANT", right: "Barrit")])
        XCTAssertEqual(ExerciseCorrection.correct(q, given)?.verdict, .correct)
    }

    func testTheSingularIsUsedForASinglePair() throws {
        let given = AnswerResponse.matching(pairs: [
            Question.Pair(left: "chat", right: "miaule"),
            Question.Pair(left: "chien", right: "chante"),
            Question.Pair(left: "oiseau", right: "meugle"),
            Question.Pair(left: "vache", right: "aboie"),
        ])
        let result = try XCTUnwrap(ExerciseCorrection.correct(pairsQuestion, given))
        XCTAssertEqual(result.verdict, .incorrect)
        XCTAssertTrue(result.feedback.contains("bonne paire"), "one pair is « bonne paire », not « bonnes paires »")
    }

    // MARK: - Ordering

    func testTheRightOrder() {
        let q = question("q5", .ordering(itemsInOrder: ["Un", "Deux", "Trois", "Quatre"]))
        XCTAssertEqual(
            ExerciseCorrection.correct(q, .ordering(items: ["Un", "Deux", "Trois", "Quatre"]))?.verdict,
            .correct
        )
    }

    func testOneSentenceOutOfPlaceIsPartial() throws {
        let q = question("q5", .ordering(itemsInOrder: ["Un", "Deux", "Trois", "Quatre"]))
        // Three of the four are still in order.
        let result = try XCTUnwrap(ExerciseCorrection.correct(q, .ordering(items: ["Un", "Deux", "Quatre", "Trois"])))
        XCTAssertEqual(result.verdict, .partial)
        assertHelpful(result)
    }

    func testACompletelyShuffledOrderIsWrong() throws {
        let q = question("q5", .ordering(itemsInOrder: ["Un", "Deux", "Trois", "Quatre"]))
        let result = try XCTUnwrap(ExerciseCorrection.correct(q, .ordering(items: ["Quatre", "Trois", "Deux", "Un"])))
        XCTAssertEqual(result.verdict, .incorrect)
    }

    func testTheLongestCommonRunIsCountedProperly() {
        XCTAssertEqual(ExerciseCorrection.longestCommonSubsequence(["a", "b", "c"], ["a", "b", "c"]), 3)
        XCTAssertEqual(ExerciseCorrection.longestCommonSubsequence(["a", "b", "c"], ["a", "c", "b"]), 2)
        XCTAssertEqual(ExerciseCorrection.longestCommonSubsequence(["a", "b", "c"], ["c", "b", "a"]), 1)
        XCTAssertEqual(ExerciseCorrection.longestCommonSubsequence([], ["a"]), 0)
    }

    // MARK: - What the device cannot judge

    func testAFreeAnswerIsLeftToAModel() {
        let q = question("q6", .freeAnswer(expectedAnswer: "Il dort.", keyPoints: ["dormir"]))
        XCTAssertNil(ExerciseCorrection.correct(q, .freeAnswer(text: "Il dort")))
        XCTAssertFalse(q.isClosed)
    }

    func testAnAnswerOfTheWrongShapeIsRefusedRatherThanGuessed() {
        let q = question("q7", .trueOrFalse(answer: true, explanation: "Oui."))
        XCTAssertNil(ExerciseCorrection.correct(q, .multipleChoice(choiceIndex: 0)))
        XCTAssertNil(ExerciseCorrection.correct(q, .ordering(items: ["Un"])))
    }

    func testTheFeedbackStaysShortEnoughToBeRead() {
        let longExplanation = String(repeating: "Cette phrase explique quelque chose de long. ", count: 20)
        let q = question("q8", .trueOrFalse(answer: true, explanation: longExplanation))
        let result = ExerciseCorrection.correct(q, .trueOrFalse(value: false))
        let words = result?.feedback.split(separator: " ").count ?? 0
        XCTAssertLessThanOrEqual(words, 60, "a paragraph of feedback is not read by the child it is written for")
        // What is kept must still be whole sentences.
        XCTAssertTrue(result?.feedback.hasSuffix("comprendre.") ?? false)
    }
}

/// What the help wrote, checked before a child meets it.
final class ExerciseGenerationTests: XCTestCase {
    private let source = SourceRef(pageIndex: 0, quote: "Le chat dort.")

    private func question(_ id: String, _ kind: Question.Kind, prompt: String = "Une question ?") -> Question {
        Question(id: id, prompt: prompt, source: source, kind: kind)
    }

    func testAChoiceWhoseAnswerDoesNotExistIsNeverShown() {
        // The right answer points past the end: a child could only ever get it « wrong », through no fault of theirs.
        let broken = question("q1", .multipleChoice(choices: ["a", "b"], correctIndex: 5, explanation: ""))
        XCTAssertFalse(ExerciseGeneration.isPlayable(broken))
        XCTAssertTrue(ExerciseGeneration.isPlayable(
            question("q2", .multipleChoice(choices: ["a", "b"], correctIndex: 1, explanation: ""))
        ))
    }

    func testEmptyPiecesMakeAQuestionUnplayable() {
        XCTAssertFalse(ExerciseGeneration.isPlayable(question("q", .trueOrFalse(answer: true, explanation: ""), prompt: " ")))
        XCTAssertFalse(ExerciseGeneration.isPlayable(question("q", .ordering(itemsInOrder: ["seul"]))))
        XCTAssertFalse(ExerciseGeneration.isPlayable(question("q", .matching(pairs: [
            Question.Pair(left: "a", right: ""), Question.Pair(left: "b", right: "c"),
        ]))))
        XCTAssertFalse(ExerciseGeneration.isPlayable(question("q", .freeAnswer(expectedAnswer: "  ", keyPoints: []))))
    }

    func testOnlyTheWantedKindsAreKeptAndNeverMoreThanAsked() {
        let questions = (0..<6).map {
            question("q\($0)", $0 % 2 == 0
                ? .trueOrFalse(answer: true, explanation: "")
                : .multipleChoice(choices: ["a", "b"], correctIndex: 0, explanation: ""))
        }
        let kept = ExerciseGeneration.clean(questions, types: [.trueOrFalse], count: 2)
        XCTAssertEqual(kept.map(\.id), ["q0", "q2"])
    }

    func testTwoQuestionsWithOneIdAreToldApart() {
        // Answers are stored by question id: two questions sharing one would share one answer.
        let twins = [
            question("q", .trueOrFalse(answer: true, explanation: "")),
            question("q", .trueOrFalse(answer: false, explanation: "")),
        ]
        XCTAssertEqual(ExerciseGeneration.clean(twins, types: [.trueOrFalse], count: 5).map(\.id), ["q", "q-2"])
    }

    func testAProfileWithNoTypesStillGetsQuestions() {
        XCTAssertEqual(ExerciseGeneration.allowedTypes([]), QuestionType.allCases)
        XCTAssertEqual(ExerciseGeneration.allowedTypes([.ordering, .multipleChoice]), [.multipleChoice, .ordering])
    }

    func testAWrittenAnswerTravelsWithItsOwnPageAndItsNeighbours() {
        let pages = [0, 1, 2, 3, 4]
        XCTAssertEqual(ExerciseGeneration.pagesAround(pages, source: 2, index: { $0 }), [1, 2, 3])
        XCTAssertEqual(ExerciseGeneration.pagesAround(pages, source: 0, index: { $0 }), [0, 1])
        XCTAssertEqual(ExerciseGeneration.pagesAround(pages, source: 9, index: { $0 }), pages, "unknown page: all of them")
    }

    func testARetakeIsANewExerciseWithTheSameQuestions() {
        let original = Exercise(
            id: "e1", childId: "c1", documentId: "d1", pageIndexes: [0], questions: [
                question("q", .trueOrFalse(answer: true, explanation: "")),
            ], origin: .ai, createdAt: 1, updatedAt: 1
        )
        let again = ExerciseGeneration.duplicate(original, now: 5)
        XCTAssertNotEqual(again.id, original.id, "the earlier answers stay attached to the earlier attempt")
        XCTAssertEqual(again.questions, original.questions)
        XCTAssertEqual(again.createdAt, 5)
    }
}

/// A handwritten answer, turned into the image that is sent to be read.
final class HandwritingTests: XCTestCase {
    private func ink(_ points: [(Double, Double)], tool: InkTool = .pencil, width: Double = 0.004) -> InkAnnotation {
        InkAnnotation(
            id: UUID().uuidString, childId: "c1", documentId: nil, tool: tool, color: "#111111", width: width,
            opacity: 1, space: .answer(exerciseId: "e1", questionId: "q1"),
            points: points.map { InkPoint(x: $0.0, y: $0.1) }, createdAt: 0, updatedAt: 0
        )
    }

    func testTheImageIsCroppedToTheInkWithAMargin() throws {
        let raster = try XCTUnwrap(Handwriting.plan([ink([(0.1, 0.1), (0.3, 0.1)])]))
        // 200 px of stroke across, plus the line width, plus a margin on each side.
        XCTAssertEqual(raster.width, 252)
        let first = try XCTUnwrap(raster.strokes.first?.points.first)
        XCTAssertEqual(first.x, 26, accuracy: 0.01, "the ink starts one margin plus half a line in")
    }

    func testALongAnswerIsScaledDownToFit() throws {
        let raster = try XCTUnwrap(Handwriting.plan([ink([(0, 0), (3, 0)])], maxSide: 800))
        XCTAssertLessThanOrEqual(max(raster.width, raster.height), 800)
    }

    func testAnUnderlineIsNotReadAsALetter() throws {
        let raster = try XCTUnwrap(Handwriting.plan([
            ink([(0.1, 0.1), (0.2, 0.1)]),
            ink([(0.0, 0.5), (0.9, 0.5)], tool: .highlighter, width: 0.02),
        ]))
        XCTAssertEqual(raster.strokes.count, 1)
    }

    func testNoInkMeansNoImage() {
        XCTAssertNil(Handwriting.plan([]))
        XCTAssertNil(Handwriting.plan([ink([])]))
    }

    func testOnlyTheInkOfThisQuestionCounts() {
        let mine = Annotation.ink(ink([(0.1, 0.1)]))
        XCTAssertTrue(Handwriting.isAnswerInk(mine, exerciseId: "e1", questionId: "q1"))
        XCTAssertFalse(Handwriting.isAnswerInk(mine, exerciseId: "e1", questionId: "q2"))
        var erased = ink([(0.1, 0.1)])
        erased.deletedAt = 5
        XCTAssertFalse(Handwriting.isAnswerInk(.ink(erased), exerciseId: "e1", questionId: "q1"))
    }

    func testTheSizeOfAnImageIsKnownBeforeItIsSent() {
        XCTAssertEqual(Handwriting.decodedSize(ofBase64: Data(repeating: 7, count: 1000).base64EncodedString()), 1000)
        XCTAssertEqual(Handwriting.decodedSize(ofBase64: Data(repeating: 7, count: 1001).base64EncodedString()), 1001)
    }
}
