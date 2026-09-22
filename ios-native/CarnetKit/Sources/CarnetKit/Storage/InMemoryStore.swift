import Foundation

/// A complete store that keeps everything in memory.
///
/// It is not a stub: it behaves exactly as the real one, outbox order included, so the sync engine can be tested
/// without a database and without a device. On the phone it also serves as the fallback when the file cannot be
/// opened — the app then works for as long as it stays open instead of refusing to start.
public final class InMemoryStore: LocalStore, @unchecked Sendable {
    private struct TableKey: Hashable {
        let table: SyncTable
        let key: EntityKey
    }

    private let lock = NSLock()
    private var rows: [TableKey: StoredEntity] = [:]
    private var pending: [Int: OutboxEntry] = [:]
    /// Where each waiting row sits in the queue, so marking it again does not move it.
    private var pendingPlace: [TableKey: Int] = [:]
    private var nextSequence = 1
    private var values: [String: String] = [:]

    public init() {}

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    // MARK: - Rows

    public func entity(_ table: SyncTable, _ key: EntityKey) throws -> StoredEntity? {
        locked { rows[TableKey(table: table, key: key)] }
    }

    public func entities(_ table: SyncTable) throws -> [StoredEntity] {
        locked {
            rows.values
                .filter { $0.table == table }
                // A stable order: the caller should never depend on how a dictionary happened to be laid out.
                .sorted { $0.key.description < $1.key.description }
        }
    }

    public func put(_ entity: StoredEntity) throws {
        locked { rows[TableKey(table: entity.table, key: entity.key)] = entity }
    }

    public func delete(_ table: SyncTable, _ key: EntityKey) throws {
        locked { _ = rows.removeValue(forKey: TableKey(table: table, key: key)) }
    }

    // MARK: - Outbox

    public func enqueue(_ table: SyncTable, _ key: EntityKey) throws {
        locked {
            let identity = TableKey(table: table, key: key)
            // Already waiting: it keeps its place, since what will be sent is the row as it is at that moment.
            guard pendingPlace[identity] == nil else { return }
            let sequence = nextSequence
            nextSequence += 1
            pending[sequence] = OutboxEntry(sequence: sequence, table: table, key: key)
            pendingPlace[identity] = sequence
        }
    }

    public func outbox(limit: Int) throws -> [OutboxEntry] {
        locked { Array(pending.values.sorted { $0.sequence < $1.sequence }.prefix(max(0, limit))) }
    }

    public func outboxCount() throws -> Int {
        locked { pending.count }
    }

    public func removeFromOutbox(upTo sequence: Int, keys: Set<EntityKey>) throws {
        locked {
            for (place, entry) in pending where entry.sequence <= sequence && keys.contains(entry.key) {
                pending.removeValue(forKey: place)
                pendingPlace.removeValue(forKey: TableKey(table: entry.table, key: entry.key))
            }
        }
    }

    // MARK: - Values

    public func value(forKey key: String) throws -> String? {
        locked { values[key] }
    }

    public func setValue(_ value: String?, forKey key: String) throws {
        locked {
            if let value {
                values[key] = value
            } else {
                values.removeValue(forKey: key)
            }
        }
    }

    // MARK: - Leaving the device

    public func removeEverything(keepingValues keys: Set<String>) throws {
        locked {
            rows = [:]
            pending = [:]
            pendingPlace = [:]
            values = values.filter { keys.contains($0.key) }
            // `nextSequence` keeps climbing: a row queued after the wipe must never land behind one that was
            // already sent, and nothing outside this class reads the number itself.
        }
    }

    // MARK: - Tests

    /// Empties everything, as a fresh install would be.
    public func reset() {
        locked {
            rows = [:]
            pending = [:]
            pendingPlace = [:]
            nextSequence = 1
            values = [:]
        }
    }
}
