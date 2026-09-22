#if canImport(SQLite3)
import Foundation
import SQLite3

/// The store the app really runs on: the same interface as the in-memory one, over a file.
///
/// SQLite rather than Core Data because what is stored here is already rows with a key and a blob of JSON, which is
/// what the server sends and what the sync engine moves. Core Data would add a model to keep in step with the server's
/// for no gain, and would make the outbox — an ordered queue — harder to express than a table with a counter.
public final class SQLiteStore: LocalStore, @unchecked Sendable {
    private let lock = NSLock()
    private var handle: OpaquePointer?

    /// Tells SQLite to copy the string rather than point at memory that is about to go away.
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    /// Opens (and creates, the first time) the database at `url`.
    public init(url: URL) throws {
        var database: OpaquePointer?
        let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(url.path, &database, flags, nil) == SQLITE_OK, let database else {
            let message = database.map { String(cString: sqlite3_errmsg($0)) } ?? "could not open \(url.lastPathComponent)"
            sqlite3_close_v2(database)
            throw StoreError.database(message)
        }
        self.handle = database
        try migrate()
    }

    deinit {
        sqlite3_close_v2(handle)
    }

    // MARK: - Plumbing

    private func fail() -> StoreError {
        .database(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "no database")
    }

    private func exec(_ sql: String) throws {
        guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw fail() }
    }

    /// Prepares a statement, hands it to `body`, and always finalises it.
    private func statement<T>(_ sql: String, _ body: (OpaquePointer) throws -> T) throws -> T {
        var prepared: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &prepared, nil) == SQLITE_OK, let prepared else { throw fail() }
        defer { sqlite3_finalize(prepared) }
        return try body(prepared)
    }

    private func bind(_ prepared: OpaquePointer, _ index: Int32, _ text: String) {
        sqlite3_bind_text(prepared, index, text, -1, Self.transient)
    }

    private func bind(_ prepared: OpaquePointer, _ index: Int32, _ data: Data) {
        _ = data.withUnsafeBytes { buffer in
            sqlite3_bind_blob(prepared, index, buffer.baseAddress, Int32(buffer.count), Self.transient)
        }
    }

    private func locked<T>(_ body: () throws -> T) throws -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func migrate() throws {
        // WAL keeps reading possible while a sync writes, which is exactly what happens when a child turns a page
        // while the queue is being emptied.
        try exec("PRAGMA journal_mode = WAL;")
        try exec("PRAGMA foreign_keys = ON;")
        try exec("""
            CREATE TABLE IF NOT EXISTS entities (
                tbl        TEXT NOT NULL,
                key        TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                json       BLOB NOT NULL,
                PRIMARY KEY (tbl, key)
            );
            CREATE INDEX IF NOT EXISTS entities_by_table ON entities (tbl, updated_at);

            CREATE TABLE IF NOT EXISTS outbox (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                tbl TEXT NOT NULL,
                key TEXT NOT NULL,
                UNIQUE (tbl, key)
            );

            CREATE TABLE IF NOT EXISTS app_values (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """)
    }

    // MARK: - Rows

    public func entity(_ table: SyncTable, _ key: EntityKey) throws -> StoredEntity? {
        try locked {
            try statement("SELECT updated_at, json FROM entities WHERE tbl = ? AND key = ?;") { prepared in
                bind(prepared, 1, table.rawValue)
                bind(prepared, 2, key.description)
                guard sqlite3_step(prepared) == SQLITE_ROW else { return nil }
                return StoredEntity(
                    table: table,
                    key: key,
                    updatedAt: sqlite3_column_int64(prepared, 0),
                    json: blob(prepared, 1)
                )
            }
        }
    }

    public func entities(_ table: SyncTable) throws -> [StoredEntity] {
        try locked {
            try statement("SELECT key, updated_at, json FROM entities WHERE tbl = ? ORDER BY key;") { prepared in
                bind(prepared, 1, table.rawValue)
                var out: [StoredEntity] = []
                while sqlite3_step(prepared) == SQLITE_ROW {
                    let text = String(cString: sqlite3_column_text(prepared, 0))
                    guard let key = EntityKey.parse(text, table: table) else { continue }
                    out.append(StoredEntity(
                        table: table, key: key, updatedAt: sqlite3_column_int64(prepared, 1), json: blob(prepared, 2)
                    ))
                }
                return out
            }
        }
    }

    private func blob(_ prepared: OpaquePointer, _ column: Int32) -> Data {
        guard let bytes = sqlite3_column_blob(prepared, column) else { return Data() }
        return Data(bytes: bytes, count: Int(sqlite3_column_bytes(prepared, column)))
    }

    public func put(_ entity: StoredEntity) throws {
        try locked {
            try statement("""
                INSERT INTO entities (tbl, key, updated_at, json) VALUES (?, ?, ?, ?)
                ON CONFLICT (tbl, key) DO UPDATE SET updated_at = excluded.updated_at, json = excluded.json;
                """) { prepared in
                bind(prepared, 1, entity.table.rawValue)
                bind(prepared, 2, entity.key.description)
                sqlite3_bind_int64(prepared, 3, entity.updatedAt)
                bind(prepared, 4, entity.json)
                guard sqlite3_step(prepared) == SQLITE_DONE else { throw fail() }
            }
        }
    }

    public func delete(_ table: SyncTable, _ key: EntityKey) throws {
        try locked {
            try statement("DELETE FROM entities WHERE tbl = ? AND key = ?;") { prepared in
                bind(prepared, 1, table.rawValue)
                bind(prepared, 2, key.description)
                guard sqlite3_step(prepared) == SQLITE_DONE else { throw fail() }
            }
        }
    }

    // MARK: - Outbox

    public func enqueue(_ table: SyncTable, _ key: EntityKey) throws {
        try locked {
            // A row already waiting keeps its place in the queue: what will be sent is the row as it is when it goes.
            try statement("INSERT OR IGNORE INTO outbox (tbl, key) VALUES (?, ?);") { prepared in
                bind(prepared, 1, table.rawValue)
                bind(prepared, 2, key.description)
                guard sqlite3_step(prepared) == SQLITE_DONE else { throw fail() }
            }
        }
    }

    public func outbox(limit: Int) throws -> [OutboxEntry] {
        try locked {
            try statement("SELECT seq, tbl, key FROM outbox ORDER BY seq LIMIT ?;") { prepared in
                sqlite3_bind_int(prepared, 1, Int32(max(0, limit)))
                var out: [OutboxEntry] = []
                while sqlite3_step(prepared) == SQLITE_ROW {
                    let raw = String(cString: sqlite3_column_text(prepared, 1))
                    let text = String(cString: sqlite3_column_text(prepared, 2))
                    guard let table = SyncTable(rawValue: raw), let key = EntityKey.parse(text, table: table) else { continue }
                    out.append(OutboxEntry(sequence: Int(sqlite3_column_int64(prepared, 0)), table: table, key: key))
                }
                return out
            }
        }
    }

    public func outboxCount() throws -> Int {
        try locked {
            try statement("SELECT COUNT(*) FROM outbox;") { prepared in
                guard sqlite3_step(prepared) == SQLITE_ROW else { return 0 }
                return Int(sqlite3_column_int64(prepared, 0))
            }
        }
    }

    public func removeFromOutbox(upTo sequence: Int, keys: Set<EntityKey>) throws {
        guard !keys.isEmpty else { return }
        let wanted = Set(keys.map(\.description))
        try locked {
            // Only what was actually sent: a change made while the request was in flight has a larger sequence and
            // stays, otherwise the work of those seconds would be lost.
            try statement("SELECT seq, key FROM outbox WHERE seq <= ?;") { prepared in
                sqlite3_bind_int64(prepared, 1, Int64(sequence))
                var doomed: [Int64] = []
                while sqlite3_step(prepared) == SQLITE_ROW {
                    let key = String(cString: sqlite3_column_text(prepared, 1))
                    if wanted.contains(key) { doomed.append(sqlite3_column_int64(prepared, 0)) }
                }
                for seq in doomed {
                    try statement("DELETE FROM outbox WHERE seq = ?;") { deletion in
                        sqlite3_bind_int64(deletion, 1, seq)
                        guard sqlite3_step(deletion) == SQLITE_DONE else { throw fail() }
                    }
                }
            }
        }
    }

    // MARK: - Values

    public func value(forKey key: String) throws -> String? {
        try locked {
            try statement("SELECT value FROM app_values WHERE key = ?;") { prepared in
                bind(prepared, 1, key)
                guard sqlite3_step(prepared) == SQLITE_ROW, let text = sqlite3_column_text(prepared, 0) else { return nil }
                return String(cString: text)
            }
        }
    }

    public func setValue(_ value: String?, forKey key: String) throws {
        try locked {
            guard let value else {
                return try statement("DELETE FROM app_values WHERE key = ?;") { prepared in
                    bind(prepared, 1, key)
                    guard sqlite3_step(prepared) == SQLITE_DONE else { throw fail() }
                }
            }
            try statement("""
                INSERT INTO app_values (key, value) VALUES (?, ?)
                ON CONFLICT (key) DO UPDATE SET value = excluded.value;
                """) { prepared in
                bind(prepared, 1, key)
                bind(prepared, 2, value)
                guard sqlite3_step(prepared) == SQLITE_DONE else { throw fail() }
            }
        }
    }

    // MARK: - Leaving the device

    public func removeEverything(keepingValues keys: Set<String>) throws {
        try locked {
            // One transaction: a wipe interrupted halfway — the app killed, the iPad out of battery — would leave
            // half of a family's rows on a device that is about to be handed to another one.
            try exec("BEGIN IMMEDIATE;")
            do {
                try exec("DELETE FROM entities;")
                try exec("DELETE FROM outbox;")
                if keys.isEmpty {
                    try exec("DELETE FROM app_values;")
                } else {
                    // The keys are the app's own constants, never anything a family typed; they are still bound
                    // rather than written into the statement.
                    let placeholders = Array(repeating: "?", count: keys.count).joined(separator: ", ")
                    try statement("DELETE FROM app_values WHERE key NOT IN (\(placeholders));") { prepared in
                        for (offset, key) in keys.enumerated() { bind(prepared, Int32(offset + 1), key) }
                        guard sqlite3_step(prepared) == SQLITE_DONE else { throw fail() }
                    }
                }
                try exec("COMMIT;")
            } catch {
                try? exec("ROLLBACK;")
                throw error
            }
            // The file keeps the space the books took; handing it back means the next family's pages are not
            // written over the previous one's, which matters more here than the megabytes.
            try? exec("VACUUM;")
        }
    }
}

public extension SQLiteStore {
    /// Where the app keeps its database, creating the folder the first time.
    static func defaultURL(fileManager: FileManager = .default) throws -> URL {
        let support = try fileManager.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let folder = support.appendingPathComponent("CarnetMalin", isDirectory: true)
        try fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("carnet.sqlite")
    }

    /// The store the app runs on, or the in-memory one when the file cannot be opened. Losing the books on disk is
    /// bad; refusing to start is worse, so the app runs for this session and says so.
    static func openOrFallBack(url: URL? = nil) -> (store: LocalStore, persistent: Bool) {
        do {
            let target = try url ?? defaultURL()
            return (try SQLiteStore(url: target), true)
        } catch {
            return (InMemoryStore(), false)
        }
    }
}
#endif
