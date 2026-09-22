import Foundation

/// What the app is doing about syncing, as the interface shows it.
public struct SyncStatus: Equatable, Sendable {
    public enum State: String, Sendable {
        case idle, syncing, error, offline
    }

    public var state: State
    public var lastSyncAt: Millis?
    /// Changes still waiting to be sent.
    public var pending: Int
    public var lastError: String?

    public static let initial = SyncStatus(state: .idle, lastSyncAt: nil, pending: 0, lastError: nil)
}

/// Why the server refused a row. The device keeps these so the parent can be told what did not go through.
public enum SyncRejectionReason: String, Codable, Sendable {
    /// The row does not look like what it claims to be.
    case invalid
    /// Someone else's row, or one this account may not touch.
    case forbidden
    /// The server already has a newer version, or the row was deleted.
    case stale
    /// The change needs the adult area open.
    case parentLocked = "parent_locked"
}

public struct SyncRejection: Codable, Equatable, Sendable {
    public let table: SyncTable
    public let entityKey: String
    public let reason: SyncRejectionReason
}

/// What the server answered to a push.
public struct SyncResponse: Sendable {
    /// Where the next pull should start.
    public let cursor: String
    /// More rows are waiting: ask again straight away.
    public let hasMore: Bool
    public let serverTime: Millis
    /// Rows the server sends back, by table, as raw JSON.
    public let changes: [SyncTable: [Data]]
    public let rejected: [SyncRejection]
}

/// One conversation with the server. Kept behind a protocol so the engine can be tested without a network.
public protocol SyncTransport: Sendable {
    /// Sends what changed here and receives what changed there.
    func exchange(cursor: String?, deviceId: String, changes: [SyncTable: [Data]]) async throws -> SyncResponse
}

public enum SyncSettings {
    /// Well under the 25 MB the server accepts, even when every character takes three bytes.
    public static let maxBatchBytes = 4_000_000
    public static let maxBatchEntities = 1_000
    /// A full sync stops after this many rounds rather than looping forever on a server that always says `hasMore`.
    public static let maxRounds = 500
    /// Rejections kept for the parent.
    public static let maxLoggedRejections = 50

    private static let backoffBaseMs = 5_000
    private static let backoffMaxMs = 5 * 60_000

    /// Wait before the n-th retry in a row (1-based): 5 s, 10 s, 20 s… never more than five minutes.
    /// Retrying harder never fixes a server that is down, and an app that keeps a tablet awake for it is worse.
    public static func backoffMs(afterFailures failures: Int) -> Int {
        guard failures > 0 else { return 0 }
        let exponent = min(failures - 1, 16)
        return min(backoffMaxMs, backoffBaseMs * (1 << exponent))
    }
}
