import Foundation

/// Keeping the device and the server in step. Ported from `client/src/sync/SyncEngine.ts`.
///
/// The app is usable with no network at all, so syncing is never in the way: changes are written locally and queued,
/// and the queue is emptied when it can be. One round sends what is waiting and receives what changed elsewhere; the
/// server answers `hasMore` while there is more to come.
///
/// Two rules decide what the engine may do on its own:
/// a row refused by the server is never sent again in a loop — it is recorded and the parent is told;
/// text this device read itself is never lost to a page that arrives without any.
public actor SyncEngine {
    private let store: LocalStore
    private let transport: SyncTransport
    private let now: @Sendable () -> Millis

    private var status = SyncStatus.initial
    private var failures = 0
    private var running = false
    private var observers: [UUID: @Sendable (SyncStatus) -> Void] = [:]

    public init(store: LocalStore, transport: SyncTransport, now: @escaping @Sendable () -> Millis = { Millis(Date().timeIntervalSince1970 * 1000) }) {
        self.store = store
        self.transport = transport
        self.now = now
    }

    // MARK: - What the interface sees

    public func currentStatus() -> SyncStatus {
        status
    }

    /// Calls `observer` whenever the status changes, and once straight away. Returns a token to stop watching.
    @discardableResult
    public func observe(_ observer: @escaping @Sendable (SyncStatus) -> Void) -> UUID {
        let token = UUID()
        observers[token] = observer
        observer(status)
        return token
    }

    public func stopObserving(_ token: UUID) {
        observers.removeValue(forKey: token)
    }

    private func publish(_ change: (inout SyncStatus) -> Void) {
        change(&status)
        let snapshot = status
        for observer in observers.values { observer(snapshot) }
    }

    // MARK: - Writing

    /// Records a change made here and queues it. The row is stored whether or not the network is there.
    public func save(_ entity: StoredEntity) throws {
        try store.put(entity)
        try store.enqueue(entity.table, entity.key)
        let pending = try store.outboxCount()
        publish { $0.pending = pending }
    }

    /// Identifier of this device, made once and kept.
    public func deviceId() throws -> String {
        if let existing = try store.value(forKey: StoreKeys.deviceId), !existing.isEmpty { return existing }
        let fresh = UUID().uuidString
        try store.setValue(fresh, forKey: StoreKeys.deviceId)
        return fresh
    }

    // MARK: - One round

    /// Sends what is waiting and takes in what came back. Returns whether the server has more to give.
    private func runRound() async throws -> Bool {
        let cursor = try store.value(forKey: StoreKeys.syncCursor)
        let device = try deviceId()
        let batch = try nextBatch()

        let response = try await transport.exchange(cursor: cursor, deviceId: device, changes: batch.changes)

        // What the server took leaves the queue; what it refused leaves it too, with a note. Keeping a refused row
        // queued would mean pushing it again every round, for ever, and a row the server calls stale comes back in
        // the answer anyway, in the version the server holds.
        try store.removeFromOutbox(upTo: batch.lastSequence, keys: batch.keys)
        if !response.rejected.isEmpty { try recordRejections(response.rejected) }

        try apply(response.changes)
        try store.setValue(response.cursor, forKey: StoreKeys.syncCursor)
        return response.hasMore
    }

    /// The next batch of changes, small enough for one request.
    private func nextBatch() throws -> (changes: [SyncTable: [Data]], keys: Set<EntityKey>, lastSequence: Int) {
        var changes: [SyncTable: [Data]] = [:]
        var keys = Set<EntityKey>()
        var lastSequence = 0
        var bytes = 0
        var count = 0

        // The queue is read in order, but sent grouped by table, because the server applies tables in its own order.
        for entry in try store.outbox(limit: SyncSettings.maxBatchEntities) {
            guard let row = try store.entity(entry.table, entry.key) else {
                // The row was deleted here after being queued: nothing to send, the entry simply goes.
                lastSequence = max(lastSequence, entry.sequence)
                keys.insert(entry.key)
                continue
            }
            if count > 0 && (bytes + row.json.count > SyncSettings.maxBatchBytes || count >= SyncSettings.maxBatchEntities) {
                break
            }
            changes[entry.table, default: []].append(row.json)
            keys.insert(entry.key)
            lastSequence = max(lastSequence, entry.sequence)
            bytes += row.json.count
            count += 1
        }
        return (changes, keys, lastSequence)
    }

    /// Writes what the server sent. A row that arrives is the truth, with one exception, below.
    private func apply(_ changes: [SyncTable: [Data]]) throws {
        for table in SyncTable.pushOrder {
            guard let rows = changes[table] else { continue }
            for json in rows {
                guard let incoming = try? decodeEntity(table: table, json: json) else { continue }
                let merged = try merge(incoming)
                try store.put(merged)
            }
        }
    }

    /// Reads the identity and the date out of a row without needing to know the rest of it.
    private func decodeEntity(table: SyncTable, json: Data) throws -> StoredEntity {
        guard let object = try JSONSerialization.jsonObject(with: json) as? [String: Any] else {
            throw StoreError.unreadable(table: table, key: "?")
        }
        let updatedAt = (object["updatedAt"] as? NSNumber)?.int64Value ?? 0

        let key: EntityKey
        switch table {
        case .pages:
            guard let documentId = object["documentId"] as? String,
                  let pageIndex = (object["pageIndex"] as? NSNumber)?.intValue else {
                throw StoreError.unreadable(table: table, key: "?")
            }
            key = .page(documentId: documentId, pageIndex: pageIndex)
        case .progress:
            guard let childId = object["childId"] as? String, let documentId = object["documentId"] as? String else {
                throw StoreError.unreadable(table: table, key: "?")
            }
            key = .progress(childId: childId, documentId: documentId)
        default:
            guard let id = object["id"] as? String else { throw StoreError.unreadable(table: table, key: "?") }
            key = .id(id)
        }
        return StoredEntity(table: table, key: key, updatedAt: updatedAt, json: json)
    }

    /// The one case where an arriving row does not simply replace the local one.
    ///
    /// When the parent turned off « sync du texte », the server holds pages without any text. Such a page arriving
    /// would wipe the text this device read from the book itself. It keeps the local text whenever both describe the
    /// same page content, which `contentHash` says exactly.
    private func merge(_ incoming: StoredEntity) throws -> StoredEntity {
        guard incoming.table == .pages,
              let local = try store.entity(.pages, incoming.key),
              let remoteObject = try? JSONSerialization.jsonObject(with: incoming.json) as? [String: Any],
              let localObject = try? JSONSerialization.jsonObject(with: local.json) as? [String: Any] else {
            return incoming
        }
        let remoteBlocks = remoteObject["blocks"] as? [Any] ?? []
        let localBlocks = localObject["blocks"] as? [Any] ?? []
        let remoteHash = remoteObject["contentHash"] as? String
        let localHash = localObject["contentHash"] as? String

        guard remoteBlocks.isEmpty, !localBlocks.isEmpty,
              let remoteHash, remoteHash == localHash else { return incoming }

        var merged = remoteObject
        merged["blocks"] = localBlocks
        guard let json = try? JSONSerialization.data(withJSONObject: merged) else { return incoming }
        return StoredEntity(table: incoming.table, key: incoming.key, updatedAt: incoming.updatedAt, json: json)
    }

    private func recordRejections(_ rejections: [SyncRejection]) throws {
        let kept = Array(rejections.prefix(SyncSettings.maxLoggedRejections))
        guard let json = try? JSONEncoder().encode(kept), let text = String(data: json, encoding: .utf8) else { return }
        try store.setValue(text, forKey: StoreKeys.lastRejections)
    }

    /// What is waiting to be sent, table by table, for the parent to see.
    public func pendingCounts() -> [SyncTable: Int] {
        let entries = (try? store.outbox(limit: Int.max)) ?? []
        return entries.reduce(into: [:]) { counts, entry in counts[entry.table, default: 0] += 1 }
    }

    /// Rows the server refused last time, for the parent to see.
    public func lastRejections() -> [SyncRejection] {
        guard let text = try? store.value(forKey: StoreKeys.lastRejections),
              let data = text?.data(using: .utf8),
              let rejections = try? JSONDecoder().decode([SyncRejection].self, from: data) else { return [] }
        return rejections
    }

    // MARK: - The whole cycle

    /// Syncs until the server has nothing more, or until something stops it. Never throws: the outcome is in the status.
    @discardableResult
    public func syncNow() async -> SyncStatus {
        guard !running else { return status }
        running = true
        defer { running = false }

        publish { $0.state = .syncing; $0.lastError = nil }

        var rounds = 0
        do {
            var more = true
            while more && rounds < SyncSettings.maxRounds {
                more = try await runRound()
                rounds += 1
            }
            failures = 0
            let pending = (try? store.outboxCount()) ?? 0
            let finishedAt = now()
            try? store.setValue(String(finishedAt), forKey: StoreKeys.lastSyncAt)
            publish {
                $0.state = .idle
                $0.lastSyncAt = finishedAt
                $0.pending = pending
                $0.lastError = nil
            }
        } catch let error as APIError {
            failures += 1
            let pending = (try? store.outboxCount()) ?? 0
            publish {
                $0.state = error == .offline ? .offline : .error
                $0.pending = pending
                $0.lastError = String(describing: error)
            }
        } catch {
            failures += 1
            publish {
                $0.state = .error
                $0.pending = (try? self.store.outboxCount()) ?? 0
                $0.lastError = String(describing: error)
            }
        }
        return status
    }

    /// Forgets what the last sync was about, after the device was emptied (§28).
    ///
    /// The counts, the time of the last sync and the last error all describe a family that is no longer on this
    /// iPad; left as they were, the adult area would show the next family « 12 éléments en attente » from a queue
    /// that no longer exists.
    public func forgetSyncState() {
        failures = 0
        publish { $0 = SyncStatus.initial }
    }

    /// How long to wait before trying again, after the failures so far.
    public func retryDelayMs() -> Int {
        SyncSettings.backoffMs(afterFailures: failures)
    }
}
