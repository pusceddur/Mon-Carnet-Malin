import CarnetKit
import Foundation

/// Reading and writing the family's own things — children, books, pages, marks, answers — through the local store.
///
/// Everything the child sees comes from here and never from the network. The sync fills the same store in the
/// background; a page that is on the iPad opens whether or not there is a connection, which is the whole point of an
/// app a child takes to school.
actor LibraryStore {
    private let store: LocalStore
    private let now: @Sendable () -> Millis
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(store: LocalStore, now: @escaping @Sendable () -> Millis = { Millis(Date().timeIntervalSince1970 * 1000) }) {
        self.store = store
        self.now = now
    }

    // MARK: - Reading

    private func all<T: Decodable>(_ table: SyncTable, as type: T.Type) throws -> [T] {
        try store.entities(table).compactMap { try? decoder.decode(T.self, from: $0.json) }
    }

    private func one<T: Decodable>(_ table: SyncTable, _ key: EntityKey, as type: T.Type) throws -> T? {
        guard let row = try store.entity(table, key) else { return nil }
        return try? decoder.decode(T.self, from: row.json)
    }

    func children() throws -> [ChildProfile] {
        try all(.children, as: ChildProfile.self)
            .filter { !$0.isDeleted }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func child(_ id: String) throws -> ChildProfile? {
        try one(.children, .id(id), as: ChildProfile.self)
    }

    /// The books one child may open, newest first — which is where a lesson imported this evening belongs.
    func documents(forChild childId: String) throws -> [DocumentMeta] {
        try all(.documents, as: DocumentMeta.self)
            .filter { !$0.isDeleted && $0.childIds.contains(childId) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    /// Every book of the family, for the adult area: whichever child it is for, newest first.
    func allDocuments() throws -> [DocumentMeta] {
        try all(.documents, as: DocumentMeta.self)
            .filter { !$0.isDeleted }
            .sorted { $0.createdAt > $1.createdAt }
    }

    /// Keeps a book exactly as the server returned it, without sending it back.
    func storeFromServer(_ document: DocumentMeta) throws {
        let json = try encoder.encode(document)
        try store.put(StoredEntity(table: .documents, key: .id(document.id), updatedAt: document.updatedAt, json: json))
    }

    func document(_ id: String) throws -> DocumentMeta? {
        try one(.documents, .id(id), as: DocumentMeta.self)
    }

    func pages(ofDocument documentId: String) throws -> [PageContent] {
        try all(.pages, as: PageContent.self)
            .filter { $0.documentId == documentId }
            .sorted { $0.pageIndex < $1.pageIndex }
    }

    func page(documentId: String, pageIndex: Int) throws -> PageContent? {
        try one(.pages, .page(documentId: documentId, pageIndex: pageIndex), as: PageContent.self)
    }

    func progress(childId: String, documentId: String) throws -> ReadingProgress? {
        try one(.progress, .progress(childId: childId, documentId: documentId), as: ReadingProgress.self)
    }

    /// Where the child was reading last, across every book.
    func lastRead(childId: String) throws -> (document: DocumentMeta, progress: ReadingProgress)? {
        let all = try self.all(.progress, as: ReadingProgress.self).filter { $0.childId == childId }
        guard let latest = all.max(by: { $0.updatedAt < $1.updatedAt }),
              let document = try document(latest.documentId), !document.isDeleted
        else { return nil }
        return (document, latest)
    }

    func annotations(documentId: String, childId: String) throws -> [Annotation] {
        try all(.annotations, as: Annotation.self)
            .filter { !$0.isDeleted && $0.childId == childId && $0.documentId == documentId }
    }

    func annotations(childId: String) throws -> [Annotation] {
        try all(.annotations, as: Annotation.self).filter { !$0.isDeleted && $0.childId == childId }
    }

    func exercises(childId: String, documentId: String? = nil) throws -> [Exercise] {
        try all(.exercises, as: Exercise.self)
            .filter { $0.deletedAt == nil && $0.childId == childId }
            .filter { documentId == nil || $0.documentId == documentId }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func answers(exerciseId: String) throws -> [Answer] {
        try all(.answers, as: Answer.self).filter { $0.exerciseId == exerciseId }
    }

    func answers(childId: String) throws -> [Answer] {
        try all(.answers, as: Answer.self).filter { $0.childId == childId }
    }

    // MARK: - Writing
    //
    // Every write goes through here so that two things always happen together: the row is stored, and it is put in
    // the outbox. A mark saved but never queued would look right on this iPad and never exist anywhere else.

    private func save<T: Encodable>(_ table: SyncTable, _ key: EntityKey, _ value: T, updatedAt: Millis) throws {
        let json = try encoder.encode(value)
        try store.put(StoredEntity(table: table, key: key, updatedAt: updatedAt, json: json))
        try store.enqueue(table, key)
    }

    func save(_ annotation: Annotation) throws {
        try save(.annotations, .id(annotation.id), annotation, updatedAt: annotation.updatedAt)
    }

    func save(_ answer: Answer) throws {
        try save(.answers, .id(answer.id), answer, updatedAt: answer.updatedAt)
    }

    func save(_ exercise: Exercise) throws {
        try save(.exercises, .id(exercise.id), exercise, updatedAt: exercise.updatedAt)
    }

    /// Saves a child's own reading and voice settings, which the sync carries. Anything else about a reader goes
    /// through the server's routes first and comes back through `storeFromServer`.
    func save(_ child: ChildProfile) throws {
        try save(.children, .id(child.id), child, updatedAt: child.updatedAt)
    }

    /// Keeps a reader exactly as the server just returned it. Not put in the outbox: the server already has it, and
    /// sending it back would only earn a refusal for the fields the sync does not accept.
    func storeFromServer(_ child: ChildProfile) throws {
        let json = try encoder.encode(child)
        try store.put(StoredEntity(table: .children, key: .id(child.id), updatedAt: child.updatedAt, json: json))
    }

    func save(_ document: DocumentMeta) throws {
        try save(.documents, .id(document.id), document, updatedAt: document.updatedAt)
    }

    func save(_ page: PageContent) throws {
        try save(.pages, .page(documentId: page.documentId, pageIndex: page.pageIndex), page, updatedAt: page.updatedAt)
    }

    func save(_ session: ReadingSession) throws {
        try save(.sessions, .id(session.id), session, updatedAt: session.updatedAt)
    }

    func save(_ progress: ReadingProgress) throws {
        try save(.progress, .progress(childId: progress.childId, documentId: progress.documentId), progress, updatedAt: progress.updatedAt)
    }

    /// Marks something as removed rather than taking it out of the store.
    ///
    /// The row has to survive long enough to tell every other device that it is gone; a row simply deleted here
    /// would come back on the next sync from the iPad that still has it.
    func markDeleted(_ annotation: Annotation) throws {
        let stamp = now()
        switch annotation {
        case var .ink(ink):
            ink.deletedAt = stamp
            ink.updatedAt = stamp
            try save(.ink(ink))
        case var .highlight(highlight):
            highlight.deletedAt = stamp
            highlight.updatedAt = stamp
            try save(.highlight(highlight))
        case var .textBox(box):
            box.deletedAt = stamp
            box.updatedAt = stamp
            try save(.textBox(box))
        }
    }

    /// Remembers where the child stopped.
    func recordPosition(childId: String, documentId: String, pageIndex: Int, blockIndex: Int, sentenceIndex: Int) throws {
        try save(ReadingProgress(
            childId: childId, documentId: documentId, pageIndex: pageIndex,
            blockIndex: blockIndex, sentenceIndex: sentenceIndex, updatedAt: now()
        ))
    }

    /// Moves every mark on a page onto its new text, and saves the ones that moved.
    ///
    /// Called when a page's text changes under marks that were already there. Orphans are left exactly as they are —
    /// they show up in « Mes notes » and the child can still see what they wrote.
    @discardableResult
    func reanchorAnnotations(documentId: String, pageIndex: Int, to newPage: PageContent) throws -> Int {
        guard !newPage.blocks.isEmpty else { return 0 }
        let oldPage = try page(documentId: documentId, pageIndex: pageIndex)
        var moved = 0

        for annotation in try all(.annotations, as: Annotation.self)
            where !annotation.isDeleted && annotation.documentId == documentId
                && annotation.pageIndex == pageIndex && annotation.isTextAnchored {
            guard let next = Reanchor.move(annotation, from: oldPage, to: newPage), next != annotation else { continue }
            // A stamp strictly later than the one it had, so the change wins wherever it lands.
            try save(stamped(next, at: max(now(), annotation.updatedAt + 1)))
            moved += 1
        }
        return moved
    }

    private func stamped(_ annotation: Annotation, at when: Millis) -> Annotation {
        switch annotation {
        case var .ink(ink):
            ink.updatedAt = when
            return .ink(ink)
        case var .highlight(highlight):
            highlight.updatedAt = when
            return .highlight(highlight)
        case var .textBox(box):
            box.updatedAt = when
            return .textBox(box)
        }
    }

    // MARK: - Device values

    func value(forKey key: String) throws -> String? {
        try store.value(forKey: key)
    }

    func setValue(_ value: String?, forKey key: String) throws {
        try store.setValue(value, forKey: key)
    }

    func pendingChanges() throws -> Int {
        try store.outboxCount()
    }
}

/// Keys of the things this app remembers about itself, which are not the family's data and never sync.
enum AppKeys {
    /// The address of the family's own server.
    static let serverURL = "app.serverURL"
    /// The child who was reading last, so the app opens where it was left.
    static let lastChildId = "app.lastChildId"
    /// The voice chosen on this iPad. It is a property of the device, not of the child: another iPad has other voices.
    static let voiceIdentifier = "app.voiceIdentifier"
    /// Whether a finger draws or scrolls, for a family without an Apple Pencil.
    static let fingerDraws = "app.fingerDraws"
    /// The family signed in, kept so the help's cache stays keyed to it even offline.
    static let parentId = "app.parentId"
    /// The parent's settings as last read, so an offline iPad offers the same help as an online one.
    static let parentSettings = "app.parentSettings"
}
