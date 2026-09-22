import XCTest
@testable import CarnetKit

/// What has to be gone from an iPad once a family leaves it (§20, §28).
///
/// The store is checked with every other store behaviour in `StoreConformanceTests`, because a wipe that works on
/// one store and not the other would be worse than none. What is checked here is everything the store does not
/// hold: the photographs of the pages, the answers the help kept, and the list of images still waiting to go up.
final class WipeTests: XCTestCase {
    private var folder: URL!

    override func setUpWithError() throws {
        folder = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: folder)
    }

    func testPageImagesAllGo() throws {
        let images = PageImageStore(root: folder.appendingPathComponent("page-images"))
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x01])
        try images.save(jpeg, documentId: "livre-1", pageIndex: 0)
        try images.save(jpeg, documentId: "livre-1", pageIndex: 1)
        try images.save(jpeg, documentId: "devoirs-mardi", pageIndex: 0)
        XCTAssertTrue(images.has(documentId: "livre-1", pageIndex: 1))

        images.removeAll()

        XCTAssertFalse(images.has(documentId: "livre-1", pageIndex: 0))
        XCTAssertFalse(images.has(documentId: "livre-1", pageIndex: 1))
        XCTAssertFalse(images.has(documentId: "devoirs-mardi", pageIndex: 0),
                       "a photograph of a child's homework is the last thing to leave behind")

        // Still usable: the next family photographs a page on the same iPad a minute later.
        XCTAssertNoThrow(try images.save(jpeg, documentId: "livre-2", pageIndex: 0))
        XCTAssertTrue(images.has(documentId: "livre-2", pageIndex: 0))
    }

    func testAnswersOfTheHelpAllGo() {
        let cache = AICache(directory: folder.appendingPathComponent("ai-answers"))
        cache.write("parent:p1:explique:abc", Data(#"{"text":"Un mot difficile"}"#.utf8))
        cache.write("parent:p1:resume:def", Data(#"{"text":"Le chapitre"}"#.utf8))
        XCTAssertNotNil(cache.read("parent:p1:explique:abc"))

        cache.removeAll()

        XCTAssertNil(cache.read("parent:p1:explique:abc"))
        XCTAssertNil(cache.read("parent:p1:resume:def"))
        cache.write("parent:p2:explique:abc", Data("{}".utf8))
        XCTAssertNotNil(cache.read("parent:p2:explique:abc"), "the cache works again for the next family")
    }

    func testPagesWaitingToGoUpAreForgottenWithTheRest() throws {
        let store = InMemoryStore()
        ImageUploadQueue.add(PendingImageUpload(documentId: "livre-1", pageIndex: 0), to: store)
        ImageUploadQueue.add(PendingImageUpload(documentId: "livre-1", pageIndex: 1), to: store)
        XCTAssertEqual(ImageUploadQueue.pending(in: store).count, 2)

        try store.removeEverything(keepingValues: [StoreKeys.deviceId])

        XCTAssertTrue(ImageUploadQueue.pending(in: store).isEmpty,
                      "a page kept in the queue would be uploaded to the next family's account")
    }

    /// A family that signs back in starts from nothing and asks the server for all of it, rather than believing the
    /// cursor of a sync that happened before everything was erased.
    func testTheNextSyncStartsFromTheBeginning() async throws {
        let store = InMemoryStore()
        let transport = RecordingTransport()
        let engine = SyncEngine(store: store, transport: transport)
        try store.setValue("cursor-500", forKey: StoreKeys.syncCursor)

        try store.removeEverything(keepingValues: [StoreKeys.deviceId])
        _ = await engine.syncNow()

        XCTAssertEqual(transport.cursors.count, 1, "the server was asked once")
        XCTAssertNil(transport.cursors.first ?? "never asked", "the pull must start from scratch")
    }
}

/// A transport that answers nothing and writes down what it was asked for.
private final class RecordingTransport: SyncTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var seen: [String?] = []

    /// The lock is taken here and never in an async function, where it is not allowed.
    private func withLock<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    var cursors: [String?] { withLock { seen } }

    func exchange(cursor: String?, deviceId: String, changes: [SyncTable: [Data]]) async throws -> SyncResponse {
        withLock { seen.append(cursor) }
        return SyncResponse(cursor: "cursor-1", hasMore: false, serverTime: 1, changes: [:], rejected: [])
    }
}
