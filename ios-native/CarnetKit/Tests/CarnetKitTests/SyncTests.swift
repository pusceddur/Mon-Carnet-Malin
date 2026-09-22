import XCTest
@testable import CarnetKit

/// A server that answers what the test tells it to, and keeps what it was sent.
private final class FakeTransport: SyncTransport, @unchecked Sendable {
    struct Call {
        let cursor: String?
        let deviceId: String
        let changes: [SyncTable: [Data]]
    }

    private let lock = NSLock()
    private var answers: [SyncResponse] = []
    private(set) var calls: [Call] = []
    var failWith: Error?

    func enqueue(_ response: SyncResponse) {
        lock.lock()
        defer { lock.unlock() }
        answers.append(response)
    }

    func exchange(cursor: String?, deviceId: String, changes: [SyncTable: [Data]]) async throws -> SyncResponse {
        lock.lock()
        defer { lock.unlock() }
        calls.append(Call(cursor: cursor, deviceId: deviceId, changes: changes))
        if let failWith { throw failWith }
        guard !answers.isEmpty else {
            return SyncResponse(cursor: cursor ?? "0", hasMore: false, serverTime: 0, changes: [:], rejected: [])
        }
        return answers.removeFirst()
    }
}

private func json(_ object: [String: Any]) -> Data {
    try! JSONSerialization.data(withJSONObject: object)
}

private func child(id: String, name: String, updatedAt: Millis = 1) -> StoredEntity {
    StoredEntity(
        table: .children,
        key: .id(id),
        updatedAt: updatedAt,
        json: json(["id": id, "nickname": name, "updatedAt": updatedAt])
    )
}

final class LocalStoreTests: XCTestCase {
    func testKeepsRowsAndFindsThemAgain() throws {
        let store = InMemoryStore()
        try store.put(child(id: "c1", name: "Léa"))
        XCTAssertEqual(try store.entity(.children, .id("c1"))?.updatedAt, 1)
        XCTAssertNil(try store.entity(.children, .id("c2")))
        XCTAssertEqual(try store.entities(.children).count, 1)

        try store.delete(.children, .id("c1"))
        XCTAssertNil(try store.entity(.children, .id("c1")))
    }

    func testTheOutboxKeepsOrderAndDoesNotRepeatARow() throws {
        let store = InMemoryStore()
        try store.enqueue(.children, .id("c1"))
        try store.enqueue(.documents, .id("d1"))
        // The same row changed twice keeps its first place: what gets sent is the row as it is when it goes.
        try store.enqueue(.children, .id("c1"))

        let waiting = try store.outbox(limit: 10)
        XCTAssertEqual(waiting.count, 2)
        XCTAssertEqual(waiting[0].key, .id("c1"))
        XCTAssertEqual(waiting[1].key, .id("d1"))
        XCTAssertEqual(try store.outboxCount(), 2)
    }

    func testRemovingFromTheOutboxLeavesWhatArrivedMeanwhile() throws {
        let store = InMemoryStore()
        try store.enqueue(.children, .id("c1"))
        let sent = try store.outbox(limit: 10)
        // A change made while the request was in flight.
        try store.enqueue(.children, .id("c2"))

        try store.removeFromOutbox(upTo: sent[0].sequence, keys: [.id("c1")])
        let left = try store.outbox(limit: 10)
        XCTAssertEqual(left.map(\.key), [.id("c2")], "a change made during the request must not be lost")
    }

    func testCompositeKeysReadAndWriteTheWayTheServerWritesThem() {
        XCTAssertEqual(EntityKey.page(documentId: "d1", pageIndex: 3).description, "d1:3")
        XCTAssertEqual(EntityKey.parse("d1:3", table: .pages), .page(documentId: "d1", pageIndex: 3))
        XCTAssertEqual(EntityKey.parse("c1:d1", table: .progress), .progress(childId: "c1", documentId: "d1"))
        XCTAssertEqual(EntityKey.parse("x1", table: .documents), .id("x1"))
        XCTAssertNil(EntityKey.parse("nope", table: .pages))
    }
}

final class SyncEngineTests: XCTestCase {
    func testSendsWhatIsWaitingAndClearsTheQueue() async throws {
        let store = InMemoryStore()
        let transport = FakeTransport()
        let engine = SyncEngine(store: store, transport: transport, now: { 1_000 })

        try await engine.save(child(id: "c1", name: "Léa"))
        XCTAssertEqual(try store.outboxCount(), 1)

        transport.enqueue(SyncResponse(cursor: "42", hasMore: false, serverTime: 1_000, changes: [:], rejected: []))
        let status = await engine.syncNow()

        XCTAssertEqual(status.state, .idle)
        XCTAssertEqual(status.pending, 0)
        XCTAssertEqual(status.lastSyncAt, 1_000)
        XCTAssertEqual(try store.value(forKey: StoreKeys.syncCursor), "42")
        XCTAssertEqual(transport.calls.count, 1)
        XCTAssertEqual(transport.calls[0].changes[.children]?.count, 1)
    }

    func testKeepsAskingWhileTheServerSaysThereIsMore() async throws {
        let store = InMemoryStore()
        let transport = FakeTransport()
        let engine = SyncEngine(store: store, transport: transport, now: { 1 })

        transport.enqueue(SyncResponse(cursor: "1", hasMore: true, serverTime: 1, changes: [:], rejected: []))
        transport.enqueue(SyncResponse(cursor: "2", hasMore: true, serverTime: 1, changes: [:], rejected: []))
        transport.enqueue(SyncResponse(cursor: "3", hasMore: false, serverTime: 1, changes: [:], rejected: []))

        await engine.syncNow()
        XCTAssertEqual(transport.calls.count, 3)
        XCTAssertEqual(try store.value(forKey: StoreKeys.syncCursor), "3")
    }

    func testWritesWhatArrivesFromTheServer() async throws {
        let store = InMemoryStore()
        let transport = FakeTransport()
        let engine = SyncEngine(store: store, transport: transport, now: { 1 })

        transport.enqueue(SyncResponse(
            cursor: "7", hasMore: false, serverTime: 1,
            changes: [
                .children: [json(["id": "c9", "nickname": "Tom", "updatedAt": 5])],
                .pages: [json(["documentId": "d1", "pageIndex": 2, "updatedAt": 6, "blocks": []])],
            ],
            rejected: []
        ))
        await engine.syncNow()

        XCTAssertEqual(try store.entity(.children, .id("c9"))?.updatedAt, 5)
        XCTAssertEqual(try store.entity(.pages, .page(documentId: "d1", pageIndex: 2))?.updatedAt, 6)
    }

    func testAPageArrivingWithoutTextKeepsTheTextReadOnThisDevice() async throws {
        let store = InMemoryStore()
        let transport = FakeTransport()
        let engine = SyncEngine(store: store, transport: transport, now: { 1 })

        // This device read the page itself.
        let localBlocks: [[String: Any]] = [["kind": "paragraph", "text": "Le chat dort."]]
        try store.put(StoredEntity(
            table: .pages,
            key: .page(documentId: "d1", pageIndex: 0),
            updatedAt: 10,
            json: json(["documentId": "d1", "pageIndex": 0, "updatedAt": 10, "contentHash": "abc", "blocks": localBlocks])
        ))

        // The server holds the same page with no text, because the parent turned off « sync du texte ».
        transport.enqueue(SyncResponse(
            cursor: "1", hasMore: false, serverTime: 1,
            changes: [.pages: [json(["documentId": "d1", "pageIndex": 0, "updatedAt": 20, "contentHash": "abc", "blocks": []])]],
            rejected: []
        ))
        await engine.syncNow()

        let stored = try XCTUnwrap(try store.entity(.pages, .page(documentId: "d1", pageIndex: 0)))
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: stored.json) as? [String: Any])
        let blocks = try XCTUnwrap(object["blocks"] as? [Any])
        XCTAssertEqual(blocks.count, 1, "the text read on this device must not be wiped by a page that carries none")
        XCTAssertEqual(object["updatedAt"] as? Int, 20, "everything else is the server's version")
    }

    func testADifferentPageDoesReplaceTheLocalOne() async throws {
        let store = InMemoryStore()
        let transport = FakeTransport()
        let engine = SyncEngine(store: store, transport: transport, now: { 1 })

        try store.put(StoredEntity(
            table: .pages, key: .page(documentId: "d1", pageIndex: 0), updatedAt: 10,
            json: json(["documentId": "d1", "pageIndex": 0, "updatedAt": 10, "contentHash": "abc",
                        "blocks": [["kind": "paragraph", "text": "ancien"]]])
        ))
        // A different contentHash means a different page: the local text is out of date and must go.
        transport.enqueue(SyncResponse(
            cursor: "1", hasMore: false, serverTime: 1,
            changes: [.pages: [json(["documentId": "d1", "pageIndex": 0, "updatedAt": 20, "contentHash": "zzz", "blocks": []])]],
            rejected: []
        ))
        await engine.syncNow()

        let stored = try XCTUnwrap(try store.entity(.pages, .page(documentId: "d1", pageIndex: 0)))
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: stored.json) as? [String: Any])
        XCTAssertEqual((object["blocks"] as? [Any])?.count, 0)
    }

    func testARefusedRowLeavesTheQueueAndIsRecorded() async throws {
        let store = InMemoryStore()
        let transport = FakeTransport()
        let engine = SyncEngine(store: store, transport: transport, now: { 1 })

        try await engine.save(child(id: "c1", name: "Léa"))
        transport.enqueue(SyncResponse(
            cursor: "1", hasMore: false, serverTime: 1, changes: [:],
            rejected: [SyncRejection(table: .children, entityKey: "c1", reason: .parentLocked)]
        ))
        await engine.syncNow()

        // Keeping it queued would mean pushing a row that will never be accepted, every round, for ever.
        XCTAssertEqual(try store.outboxCount(), 0)
        let recorded = await engine.lastRejections()
        XCTAssertEqual(recorded.count, 1)
        XCTAssertEqual(recorded[0].reason, .parentLocked)
    }

    func testAFailureIsReportedWithoutThrowing() async throws {
        let store = InMemoryStore()
        let transport = FakeTransport()
        transport.failWith = APIError.offline
        let engine = SyncEngine(store: store, transport: transport, now: { 1 })

        try await engine.save(child(id: "c1", name: "Léa"))
        let status = await engine.syncNow()

        XCTAssertEqual(status.state, .offline)
        XCTAssertEqual(status.pending, 1, "nothing was sent, so nothing leaves the queue")
        XCTAssertNotNil(status.lastError)
    }

    func testTheDeviceIdIsMadeOnceAndKept() async throws {
        let store = InMemoryStore()
        let engine = SyncEngine(store: store, transport: FakeTransport(), now: { 1 })
        let first = try await engine.deviceId()
        let second = try await engine.deviceId()
        XCTAssertEqual(first, second)
        XCTAssertFalse(first.isEmpty)
    }

    func testTheRetryDelayGrowsAndThenStops() {
        XCTAssertEqual(SyncSettings.backoffMs(afterFailures: 0), 0)
        XCTAssertEqual(SyncSettings.backoffMs(afterFailures: 1), 5_000)
        XCTAssertEqual(SyncSettings.backoffMs(afterFailures: 2), 10_000)
        XCTAssertEqual(SyncSettings.backoffMs(afterFailures: 3), 20_000)
        // Never more than five minutes: hammering a server that is down helps nobody and empties the battery.
        XCTAssertEqual(SyncSettings.backoffMs(afterFailures: 40), 5 * 60_000)
    }
}
