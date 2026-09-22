import Foundation

/// « Mes notes »: the child's marks grouped by book. Ported from `client/src/features/notes/notesModel.ts`.
///
/// Answers and the text boxes of homework pages (§19.2) are not reading notes: an answer shows under its question,
/// a text box on its sheet. Marks whose words are gone are listed apart, never dropped.
public enum NotesModel {
    public struct Highlight: Equatable, Sendable, Identifiable {
        public let id: String
        public let text: String
        public let color: String
        public let pageIndex: Int
    }

    public struct AnswerNote: Equatable, Sendable, Identifiable {
        public let id: String
        public let exerciseId: String
        public let prompt: String
        /// The written answer; nil when only drawn.
        public let text: String?
        public let drawn: Bool
    }

    public struct Detached: Equatable, Sendable, Identifiable {
        public enum Kind: String, Sendable { case highlight, ink }
        public let id: String
        public let kind: Kind
        /// What the mark was on, so the child recognises it.
        public let text: String
        public let pageIndex: Int
    }

    public struct Book: Equatable, Sendable, Identifiable {
        public let documentId: String
        public let title: String
        /// First page carrying a note, to open the reader there.
        public var firstPageIndex: Int?
        public var highlights: [Highlight] = []
        public var inkCount = 0
        public var answers: [AnswerNote] = []
        public var detached: [Detached] = []
        public var lastActivityAt: Millis = 0

        public var id: String { documentId }

        var isEmpty: Bool { highlights.isEmpty && inkCount == 0 && answers.isEmpty && detached.isEmpty }
    }

    /// The pages needed to tell which marks lost their words: `(documentId, pageIndex)`.
    public static func pagesNeeded(for annotations: [Annotation]) -> [(documentId: String, pageIndex: Int)] {
        var seen = Set<String>()
        var out: [(documentId: String, pageIndex: Int)] = []
        for annotation in annotations where !annotation.isDeleted {
            guard let documentId = annotation.documentId, let pageIndex = textAnchorPage(annotation) else { continue }
            if seen.insert("\(documentId):\(pageIndex)").inserted { out.append((documentId, pageIndex)) }
        }
        return out
    }

    /// Groups the child's notes by book, most recent activity first.
    public static func build(
        documents: [DocumentMeta], pages: [PageContent], annotations: [Annotation], exercises: [Exercise],
        answers: [Answer]
    ) -> [Book] {
        var pageByKey: [String: PageContent] = [:]
        for page in pages { pageByKey["\(page.documentId):\(page.pageIndex)"] = page }
        var documentById: [String: DocumentMeta] = [:]
        for document in documents where !document.isDeleted { documentById[document.id] = document }

        var books: [String: Book] = [:]
        var highlightOrder: [String: (Int, Int, Int)] = [:]

        func touch(_ documentId: String, _ update: (inout Book) -> Void) {
            guard let document = documentById[documentId] else { return }
            var book = books[documentId] ?? Book(documentId: documentId, title: document.title)
            update(&book)
            books[documentId] = book
        }
        func firstPage(_ book: inout Book, _ pageIndex: Int) {
            if book.firstPageIndex == nil || pageIndex < book.firstPageIndex! { book.firstPageIndex = pageIndex }
        }

        for annotation in annotations where !annotation.isDeleted {
            guard let documentId = annotation.documentId else { continue }
            switch annotation {
            case .textBox: continue
            case let .ink(ink): if case .answer = ink.space { continue }
            case .highlight: break
            }

            let detached = isDetached(annotation, pages: pageByKey)
            touch(documentId) { book in
                book.lastActivityAt = max(book.lastActivityAt, annotation.updatedAt)
                if detached {
                    let text: String
                    let kind: Detached.Kind
                    switch annotation {
                    case let .highlight(value):
                        text = value.text
                        kind = .highlight
                    case let .ink(value):
                        if case let .text(_, _, _, _, contextText, _) = value.space { text = contextText } else { text = "" }
                        kind = .ink
                    case .textBox:
                        return
                    }
                    book.detached.append(Detached(
                        id: annotation.id, kind: kind, text: text.trimmingCharacters(in: .whitespacesAndNewlines),
                        pageIndex: textAnchorPage(annotation) ?? 0
                    ))
                    return
                }
                switch annotation {
                case let .highlight(value):
                    book.highlights.append(Highlight(
                        id: value.id, text: value.text.trimmingCharacters(in: .whitespacesAndNewlines),
                        color: value.color, pageIndex: value.pageIndex
                    ))
                    highlightOrder[value.id] = (value.pageIndex, value.blockIndex, value.start)
                    firstPage(&book, value.pageIndex)
                case let .ink(value):
                    book.inkCount += 1
                    if let pageIndex = value.space.pageIndex { firstPage(&book, pageIndex) }
                case .textBox:
                    break
                }
            }
        }

        var exerciseById: [String: Exercise] = [:]
        for exercise in exercises where exercise.deletedAt == nil { exerciseById[exercise.id] = exercise }
        var latest: [String: Answer] = [:]
        for answer in answers {
            let key = "\(answer.exerciseId):\(answer.questionId)"
            if let previous = latest[key], previous.updatedAt >= answer.updatedAt { continue }
            latest[key] = answer
        }
        // Stable order whatever the dictionary does: the same notes read the same way every time.
        for answer in latest.values.sorted(by: { ($0.updatedAt, $0.id) < ($1.updatedAt, $1.id) }) {
            guard let exercise = exerciseById[answer.exerciseId] else { continue }
            var text = ""
            if case let .freeAnswer(written) = answer.response {
                text = written.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            let drawn = answer.inkAnnotationId != nil
            if text.isEmpty && !drawn { continue }
            let prompt = exercise.questions.first { $0.id == answer.questionId }?.prompt ?? ""
            touch(exercise.documentId) { book in
                book.answers.append(AnswerNote(
                    id: answer.id, exerciseId: exercise.id, prompt: prompt, text: text.isEmpty ? nil : text,
                    drawn: drawn
                ))
                book.lastActivityAt = max(book.lastActivityAt, answer.updatedAt)
            }
        }

        return books.values
            .map { book -> Book in
                var sorted = book
                sorted.highlights.sort { a, b in
                    let x = highlightOrder[a.id] ?? (0, 0, 0)
                    let y = highlightOrder[b.id] ?? (0, 0, 0)
                    return x < y
                }
                sorted.detached.sort { $0.pageIndex < $1.pageIndex }
                return sorted
            }
            .filter { !$0.isEmpty }
            .sorted { ($0.lastActivityAt, $1.documentId) > ($1.lastActivityAt, $0.documentId) }
    }

    private static func textAnchorPage(_ annotation: Annotation) -> Int? {
        switch annotation {
        case let .highlight(value): return value.pageIndex
        case let .ink(value):
            if case let .text(pageIndex, _, _, _, _, _) = value.space { return pageIndex }
            return nil
        case .textBox: return nil
        }
    }

    /// A page not on this device yet, or still being read, says nothing: unknown is not detached.
    private static func isDetached(_ annotation: Annotation, pages: [String: PageContent]) -> Bool {
        guard let documentId = annotation.documentId, let pageIndex = textAnchorPage(annotation),
              let page = pages["\(documentId):\(pageIndex)"],
              page.status != .pending, page.status != .processing
        else { return false }
        return Reanchor.isOrphan(annotation, on: page)
    }
}
