@testable import CarnetKit
import XCTest

final class NotesTests: XCTestCase {
    private let child = "c1"
    private let text = "Le chat dort sur le tapis."

    private func document(_ id: String, title: String = "Livre", deleted: Bool = false) -> DocumentMeta {
        DocumentMeta(
            id: id, ownerParentId: "p1", childIds: [child], title: title, kind: .pdf, textMode: .faithful,
            purpose: .reading, sourceHash: "h", pageCount: 3, status: .ready, createdAt: 1, updatedAt: 1,
            deletedAt: deleted ? 5 : nil
        )
    }

    private func page(_ documentId: String, _ pageIndex: Int, _ body: String, status: PageStatus = .ready)
        -> PageContent {
        PageContent(
            documentId: documentId, pageIndex: pageIndex, status: status,
            blocks: [TextBlock(kind: .paragraph, text: body)], updatedAt: 1
        )
    }

    private func highlight(
        _ id: String, doc: String, pageIndex: Int = 0, start: Int = 3, end: Int = 7, updatedAt: Millis = 10,
        deleted: Bool = false
    ) -> Annotation {
        .highlight(TextHighlight(
            id: id, childId: child, documentId: doc, color: "#ffe066", pageIndex: pageIndex, blockIndex: 0,
            start: start, end: end, blockTextHash: Anchoring.blockTextHash(text), text: " chat ",
            createdAt: 1, updatedAt: updatedAt, deletedAt: deleted ? 20 : nil
        ))
    }

    private func ink(_ id: String, doc: String, space: InkSpace, updatedAt: Millis = 10) -> Annotation {
        .ink(InkAnnotation(
            id: id, childId: child, documentId: doc, tool: .pencil, color: "#000000", width: 2, opacity: 1,
            space: space, points: [InkPoint(x: 0, y: 0), InkPoint(x: 1, y: 1)], createdAt: 1, updatedAt: updatedAt
        ))
    }

    private func textBox(_ id: String, doc: String) -> Annotation {
        .textBox(TextBoxAnnotation(
            id: id, childId: child, documentId: doc, pageIndex: 0, x: 0.1, y: 0.1, width: 0.3, fontSize: 18,
            color: "#000000", text: "Ma réponse", createdAt: 1, updatedAt: 99
        ))
    }

    private func exercise(_ id: String, doc: String, deleted: Bool = false) -> Exercise {
        Exercise(
            id: id, childId: child, documentId: doc, pageIndexes: [0],
            questions: [
                Question(
                    id: "q1", prompt: "Où dort le chat ?", source: SourceRef(pageIndex: 0, quote: "sur le tapis"),
                    kind: .freeAnswer(expectedAnswer: "Sur le tapis.", keyPoints: ["tapis"])
                ),
                Question(
                    id: "q2", prompt: "Le chat dort-il ?", source: SourceRef(pageIndex: 0, quote: "dort"),
                    kind: .trueOrFalse(answer: true, explanation: "")
                ),
            ],
            origin: .local, createdAt: 1, updatedAt: 1, deletedAt: deleted ? 5 : nil
        )
    }

    private func answer(
        _ id: String, exercise: String, question: String = "q1", response: AnswerResponse, ink: String? = nil,
        updatedAt: Millis
    ) -> Answer {
        Answer(
            id: id, exerciseId: exercise, questionId: question, childId: child, response: response,
            inputMethod: ink == nil ? .keyboard : .handwriting, inkAnnotationId: ink, createdAt: 1, updatedAt: updatedAt
        )
    }

    private let textSpace = InkSpace.text(
        pageIndex: 2, blockIndex: 0, charOffset: 3, blockTextHash: Anchoring.blockTextHash("Le chat dort sur le tapis."),
        contextText: "chat dort sur", endAnchor: nil
    )

    func testReadingNotesLeaveOutAnswersAndTextBoxes() {
        let books = NotesModel.build(
            documents: [document("d1")],
            pages: [page("d1", 0, text), page("d1", 2, text)],
            annotations: [
                highlight("h1", doc: "d1"),
                ink("i1", doc: "d1", space: textSpace),
                ink("i2", doc: "d1", space: .original(pageIndex: 1)),
                ink("i3", doc: "d1", space: .answer(exerciseId: "e1", questionId: "q1")),
                textBox("t1", doc: "d1"),
            ],
            exercises: [], answers: []
        )
        XCTAssertEqual(books.count, 1)
        let book = books[0]
        XCTAssertEqual(book.highlights.map(\.text), ["chat"])
        XCTAssertEqual(book.inkCount, 2)
        XCTAssertEqual(book.firstPageIndex, 0)
        XCTAssertTrue(book.detached.isEmpty)
        // The text box's later date does not count as reading activity.
        XCTAssertEqual(book.lastActivityAt, 10)
    }

    func testMarksWhoseWordsAreGoneAreListedApart() {
        let changed = "Une phrase complètement différente ici."
        let books = NotesModel.build(
            documents: [document("d1")],
            pages: [page("d1", 0, changed), page("d1", 2, changed)],
            annotations: [highlight("h1", doc: "d1"), ink("i1", doc: "d1", space: textSpace)],
            exercises: [], answers: []
        )
        let book = try? XCTUnwrap(books.first)
        XCTAssertEqual(book?.highlights, [])
        XCTAssertEqual(book?.inkCount, 0)
        XCTAssertEqual(book?.detached.map(\.kind), [.highlight, .ink])
        XCTAssertEqual(book?.detached.map(\.text), ["chat", "chat dort sur"])
        XCTAssertEqual(book?.detached.map(\.pageIndex), [0, 2])
    }

    func testAPageNotReadYetIsNotADetachedOne() {
        let books = NotesModel.build(
            documents: [document("d1")],
            pages: [page("d1", 0, "Autre chose.", status: .processing)],
            annotations: [highlight("h1", doc: "d1"), ink("i1", doc: "d1", space: textSpace)],
            exercises: [], answers: []
        )
        XCTAssertEqual(books.first?.highlights.count, 1)
        XCTAssertEqual(books.first?.inkCount, 1)
        XCTAssertEqual(books.first?.detached, [])
    }

    func testTheLatestWrittenOrDrawnAnswerOfEachQuestion() {
        let books = NotesModel.build(
            documents: [document("d1")],
            pages: [],
            annotations: [],
            exercises: [exercise("e1", doc: "d1")],
            answers: [
                answer("a1", exercise: "e1", response: .freeAnswer(text: "Dans son lit"), updatedAt: 10),
                answer("a2", exercise: "e1", response: .freeAnswer(text: "  Sur le tapis  "), updatedAt: 30),
                answer("a3", exercise: "e1", question: "q2", response: .trueOrFalse(value: true), updatedAt: 40),
            ]
        )
        XCTAssertEqual(books.first?.answers.map(\.id), ["a2"])
        XCTAssertEqual(books.first?.answers.first?.text, "Sur le tapis")
        XCTAssertEqual(books.first?.answers.first?.prompt, "Où dort le chat ?")
        XCTAssertEqual(books.first?.lastActivityAt, 30)
    }

    func testADrawnAnswerWithoutTextIsKept() {
        let books = NotesModel.build(
            documents: [document("d1")],
            pages: [], annotations: [],
            exercises: [exercise("e1", doc: "d1")],
            answers: [answer("a1", exercise: "e1", response: .freeAnswer(text: ""), ink: "i9", updatedAt: 10)]
        )
        XCTAssertEqual(books.first?.answers.first?.text, nil)
        XCTAssertEqual(books.first?.answers.first?.drawn, true)
    }

    func testDeletedThingsAndEmptyBooksAreLeftOut() {
        let books = NotesModel.build(
            documents: [document("d1"), document("d2", deleted: true), document("d3")],
            pages: [page("d1", 0, text)],
            annotations: [
                highlight("h1", doc: "d1", deleted: true),
                highlight("h2", doc: "d2"),
                textBox("t1", doc: "d3"),
            ],
            exercises: [exercise("e1", doc: "d1", deleted: true)],
            answers: [answer("a1", exercise: "e1", response: .freeAnswer(text: "x"), updatedAt: 10)]
        )
        XCTAssertEqual(books, [])
    }

    func testMostRecentBookFirstAndHighlightsInReadingOrder() {
        let books = NotesModel.build(
            documents: [document("d1", title: "Ancien"), document("d2", title: "Récent")],
            pages: [page("d1", 0, text), page("d2", 0, text), page("d2", 1, text)],
            annotations: [
                highlight("h1", doc: "d1", updatedAt: 5),
                highlight("h2", doc: "d2", pageIndex: 1, updatedAt: 50),
                highlight("h3", doc: "d2", pageIndex: 0, start: 8, end: 12, updatedAt: 40),
                highlight("h4", doc: "d2", pageIndex: 0, start: 3, end: 7, updatedAt: 45),
            ],
            exercises: [], answers: []
        )
        XCTAssertEqual(books.map(\.title), ["Récent", "Ancien"])
        XCTAssertEqual(books.first?.highlights.map(\.id), ["h4", "h3", "h2"])
        XCTAssertEqual(books.first?.firstPageIndex, 0)
    }

    func testPagesNeededAreTheTextAnchoredOnesOnce() {
        let needed = NotesModel.pagesNeeded(for: [
            highlight("h1", doc: "d1"),
            highlight("h2", doc: "d1"),
            ink("i1", doc: "d1", space: textSpace),
            ink("i2", doc: "d1", space: .original(pageIndex: 1)),
            textBox("t1", doc: "d1"),
        ])
        XCTAssertEqual(needed.map { "\($0.documentId):\($0.pageIndex)" }, ["d1:0", "d1:2"])
    }
}
