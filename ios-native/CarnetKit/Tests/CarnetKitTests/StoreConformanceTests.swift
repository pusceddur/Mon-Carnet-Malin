import XCTest
@testable import CarnetKit

/// The same behaviour is required of every store, so the checks live once and run against each of them.
///
/// It matters because the sync engine is tested against the in-memory store while the app runs on the SQLite one:
/// any difference between the two would mean the tests prove something about code that never ships.
private func assertStoreBehaves(
    _ make: () throws -> LocalStore,
    file: StaticString = #filePath,
    line: UInt = #line
) throws {
    func entity(_ table: SyncTable, _ key: EntityKey, _ updatedAt: Millis, _ payload: String) -> StoredEntity {
        StoredEntity(table: table, key: key, updatedAt: updatedAt, json: Data(payload.utf8))
    }

    // Rows: written, read back, replaced, removed.
    let store = try make()
    XCTAssertNil(try store.entity(.children, .id("c1")), file: file, line: line)

    try store.put(entity(.children, .id("c1"), 1, #"{"id":"c1"}"#))
    let read = try XCTUnwrap(try store.entity(.children, .id("c1")), file: file, line: line)
    XCTAssertEqual(read.updatedAt, 1, file: file, line: line)
    XCTAssertEqual(String(decoding: read.json, as: UTF8.self), #"{"id":"c1"}"#, file: file, line: line)

    try store.put(entity(.children, .id("c1"), 2, #"{"id":"c1","n":2}"#))
    XCTAssertEqual(try store.entity(.children, .id("c1"))?.updatedAt, 2, "a second write replaces the first", file: file, line: line)
    XCTAssertEqual(try store.entities(.children).count, 1, file: file, line: line)

    // Composite keys survive the round trip.
    try store.put(entity(.pages, .page(documentId: "d1", pageIndex: 7), 3, #"{"pageIndex":7}"#))
    XCTAssertNotNil(try store.entity(.pages, .page(documentId: "d1", pageIndex: 7)), file: file, line: line)
    XCTAssertEqual(try store.entities(.pages).first?.key, .page(documentId: "d1", pageIndex: 7), file: file, line: line)
    try store.put(entity(.progress, .progress(childId: "c1", documentId: "d1"), 4, "{}"))
    XCTAssertNotNil(try store.entity(.progress, .progress(childId: "c1", documentId: "d1")), file: file, line: line)

    // Tables do not see each other.
    XCTAssertEqual(try store.entities(.children).count, 1, file: file, line: line)
    XCTAssertEqual(try store.entities(.documents).count, 0, file: file, line: line)

    try store.delete(.children, .id("c1"))
    XCTAssertNil(try store.entity(.children, .id("c1")), file: file, line: line)

    // Outbox: order kept, no repeats, only what was sent removed.
    let queue = try make()
    try queue.enqueue(.children, .id("a"))
    try queue.enqueue(.documents, .id("b"))
    try queue.enqueue(.children, .id("a"))
    XCTAssertEqual(try queue.outboxCount(), 2, "queuing a row twice leaves one entry", file: file, line: line)

    let waiting = try queue.outbox(limit: 10)
    XCTAssertEqual(waiting.map(\.key), [.id("a"), .id("b")], "the queue keeps its order", file: file, line: line)
    XCTAssertEqual(waiting.map(\.table), [.children, .documents], file: file, line: line)

    try queue.enqueue(.children, .id("c"))
    try queue.removeFromOutbox(upTo: waiting[1].sequence, keys: [.id("a"), .id("b")])
    XCTAssertEqual(try queue.outbox(limit: 10).map(\.key), [.id("c")],
                   "a change queued during the request is kept", file: file, line: line)

    // A row removed from the queue but not sent, because its entry was for a row already deleted.
    try queue.removeFromOutbox(upTo: 0, keys: [.id("c")])
    XCTAssertEqual(try queue.outboxCount(), 1, "nothing at or below sequence 0", file: file, line: line)

    // Values.
    let values = try make()
    XCTAssertNil(try values.value(forKey: StoreKeys.syncCursor), file: file, line: line)
    try values.setValue("42", forKey: StoreKeys.syncCursor)
    XCTAssertEqual(try values.value(forKey: StoreKeys.syncCursor), "42", file: file, line: line)
    try values.setValue("43", forKey: StoreKeys.syncCursor)
    XCTAssertEqual(try values.value(forKey: StoreKeys.syncCursor), "43", file: file, line: line)
    try values.setValue(nil, forKey: StoreKeys.syncCursor)
    XCTAssertNil(try values.value(forKey: StoreKeys.syncCursor), file: file, line: line)

    // Signing out (§20, §28): the family's things go, the iPad's own stay.
    let leaving = try make()
    try leaving.put(entity(.documents, .id("d1"), 5, #"{"title":"Le petit prince"}"#))
    try leaving.put(entity(.pages, .page(documentId: "d1", pageIndex: 0), 5, #"{"text":"Il était une fois"}"#))
    try leaving.put(entity(.annotations, .id("a1"), 5, "{}"))
    try leaving.enqueue(.annotations, .id("a1"))
    try leaving.setValue("cursor-12", forKey: StoreKeys.syncCursor)
    try leaving.setValue("2 pages", forKey: "images.pendingUploads")
    try leaving.setValue("this-ipad", forKey: StoreKeys.deviceId)
    try leaving.setValue("https://maison.example", forKey: "app.serverURL")

    try leaving.removeEverything(keepingValues: [StoreKeys.deviceId, "app.serverURL"])

    for table in SyncTable.allCases {
        XCTAssertEqual(try leaving.entities(table).count, 0, "\(table) still holds rows", file: file, line: line)
    }
    XCTAssertEqual(try leaving.outboxCount(), 0, "changes of a family that left", file: file, line: line)
    XCTAssertNil(try leaving.value(forKey: StoreKeys.syncCursor), file: file, line: line)
    XCTAssertNil(try leaving.value(forKey: "images.pendingUploads"),
                 "pages waiting to go up belonged to the family too", file: file, line: line)
    XCTAssertEqual(try leaving.value(forKey: StoreKeys.deviceId), "this-ipad",
                   "the device keeps its name in « Appareils connectés »", file: file, line: line)
    XCTAssertEqual(try leaving.value(forKey: "app.serverURL"), "https://maison.example",
                   "the address of the server is the iPad's, not the family's", file: file, line: line)

    // And it is a store again afterwards, not a ruin: the next family writes into it.
    try leaving.put(entity(.children, .id("c9"), 9, "{}"))
    try leaving.enqueue(.children, .id("c9"))
    XCTAssertEqual(try leaving.entities(.children).count, 1, file: file, line: line)
    XCTAssertEqual(try leaving.outbox(limit: 10).map(\.key), [.id("c9")], file: file, line: line)

    // Nothing named, nothing kept.
    try leaving.removeEverything(keepingValues: [])
    XCTAssertNil(try leaving.value(forKey: StoreKeys.deviceId), file: file, line: line)
}

final class InMemoryStoreConformanceTests: XCTestCase {
    func testBehavesLikeAStore() throws {
        try assertStoreBehaves { InMemoryStore() }
    }
}

#if canImport(SQLite3)
final class SQLiteStoreConformanceTests: XCTestCase {
    private var folder: URL!

    override func setUpWithError() throws {
        folder = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: folder)
    }

    func testBehavesLikeAStore() throws {
        var made = 0
        try assertStoreBehaves {
            made += 1
            return try SQLiteStore(url: folder.appendingPathComponent("store-\(made).sqlite"))
        }
    }

    func testWhatWasWrittenIsStillThereAfterReopening() throws {
        let url = folder.appendingPathComponent("persist.sqlite")
        do {
            let store = try SQLiteStore(url: url)
            try store.put(StoredEntity(table: .children, key: .id("c1"), updatedAt: 9, json: Data(#"{"id":"c1"}"#.utf8)))
            try store.enqueue(.children, .id("c1"))
            try store.setValue("cursor-7", forKey: StoreKeys.syncCursor)
        }
        // A new handle on the same file: this is what happens when the app is closed and opened again.
        let reopened = try SQLiteStore(url: url)
        XCTAssertEqual(try reopened.entity(.children, .id("c1"))?.updatedAt, 9)
        XCTAssertEqual(try reopened.outboxCount(), 1)
        XCTAssertEqual(try reopened.value(forKey: StoreKeys.syncCursor), "cursor-7")
    }

    func testAnUnusableFileFallsBackInsteadOfRefusingToStart() {
        // A folder is not a database: opening it must fail, and the app must still run.
        let result = SQLiteStore.openOrFallBack(url: folder)
        XCTAssertFalse(result.persistent, "the caller has to know the books will not survive this session")
        XCTAssertNoThrow(try result.store.put(
            StoredEntity(table: .children, key: .id("c1"), updatedAt: 1, json: Data("{}".utf8))
        ))
    }
}
#endif
