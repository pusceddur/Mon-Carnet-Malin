import Foundation

/// The tables that travel between the device and the server, in the order a push must send them:
/// a page cannot arrive before its document, nor an answer before its exercise.
public enum SyncTable: String, CaseIterable, Codable, Sendable {
    case children, documents, pages, exercises, annotations, answers, progress, sessions

    /// The order the server expects, which is also the order references become valid in.
    public static let pushOrder: [SyncTable] = [
        .children, .documents, .pages, .exercises, .annotations, .answers, .progress, .sessions,
    ]
}

/// What identifies a row. Most tables use an id; pages and progress are identified by a pair, exactly as the web app
/// and the server do, so the three agree on what « the same row » means.
public enum EntityKey: Hashable, Sendable, CustomStringConvertible {
    case id(String)
    case page(documentId: String, pageIndex: Int)
    case progress(childId: String, documentId: String)

    /// The form the server uses in a rejection, so a refused row can be found again.
    public var description: String {
        switch self {
        case let .id(value): return value
        case let .page(documentId, pageIndex): return "\(documentId):\(pageIndex)"
        case let .progress(childId, documentId): return "\(childId):\(documentId)"
        }
    }

    /// Reads back what `description` wrote, for the table it belongs to.
    public static func parse(_ text: String, table: SyncTable) -> EntityKey? {
        switch table {
        case .pages:
            let parts = text.split(separator: ":", maxSplits: 1).map(String.init)
            guard parts.count == 2, let index = Int(parts[1]) else { return nil }
            return .page(documentId: parts[0], pageIndex: index)
        case .progress:
            let parts = text.split(separator: ":", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { return nil }
            return .progress(childId: parts[0], documentId: parts[1])
        default:
            return text.isEmpty ? nil : .id(text)
        }
    }
}

/// One row as it travels: the table it belongs to, what identifies it, when it changed, and its contents as the server
/// sends them. The contents stay as JSON here on purpose — the store moves rows without needing to understand them,
/// and a field added on the server does not have to be taught to it.
public struct StoredEntity: Equatable, Sendable {
    public let table: SyncTable
    public let key: EntityKey
    public let updatedAt: Millis
    public let json: Data

    public init(table: SyncTable, key: EntityKey, updatedAt: Millis, json: Data) {
        self.table = table
        self.key = key
        self.updatedAt = updatedAt
        self.json = json
    }
}

/// A change made on this device, waiting to be sent. The outbox keeps the order changes were made in, because the
/// server applies them in that order and two edits of one row must not swap places.
public struct OutboxEntry: Equatable, Sendable {
    public let sequence: Int
    public let table: SyncTable
    public let key: EntityKey

    public init(sequence: Int, table: SyncTable, key: EntityKey) {
        self.sequence = sequence
        self.table = table
        self.key = key
    }
}

/// Where the app keeps everything between launches: the books, their pages, the annotations, what is waiting to be
/// sent, and a few values of its own.
///
/// It is a protocol rather than a class so that the sync engine can be tested without a database at all, and so that
/// the storage underneath can change without touching anything above it.
public protocol LocalStore: AnyObject, Sendable {
    // Rows
    func entity(_ table: SyncTable, _ key: EntityKey) throws -> StoredEntity?
    func entities(_ table: SyncTable) throws -> [StoredEntity]
    /// Writes a row, replacing whatever was there.
    func put(_ entity: StoredEntity) throws
    func delete(_ table: SyncTable, _ key: EntityKey) throws

    // Outbox
    /// Marks a row as changed here. Marking the same row twice leaves one entry, at its first place in the queue.
    func enqueue(_ table: SyncTable, _ key: EntityKey) throws
    /// The changes waiting, oldest first.
    func outbox(limit: Int) throws -> [OutboxEntry]
    func outboxCount() throws -> Int
    /// Forgets the entries that were accepted. Entries added meanwhile are kept.
    func removeFromOutbox(upTo sequence: Int, keys: Set<EntityKey>) throws

    // Values of the app itself
    func value(forKey key: String) throws -> String?
    func setValue(_ value: String?, forKey key: String) throws
}

/// Keys of the values the sync engine keeps between launches.
public enum StoreKeys {
    /// Where the last pull stopped.
    public static let syncCursor = "sync.cursor"
    /// When the last full sync finished.
    public static let lastSyncAt = "sync.lastSyncAt"
    /// This device, as the server names it in « Appareils connectés ».
    public static let deviceId = "sync.deviceId"
    /// Rows the server refused, kept so the parent can be told.
    public static let lastRejections = "sync.rejections"
}

/// Everything that can go wrong down here.
public enum StoreError: Error, Equatable, Sendable {
    /// The row exists but does not hold what this version of the app expects.
    case unreadable(table: SyncTable, key: String)
    case database(String)
}
