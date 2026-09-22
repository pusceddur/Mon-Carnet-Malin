import Foundation

/// §21: the use of the subscription the home computer last saw.
public struct SubscriptionUsage: Decodable, Equatable, Sendable {
    public enum Status: String, Decodable, Sendable {
        case allowed
        case allowedWarning = "allowed_warning"
        case rejected
    }

    public enum Window: String, Decodable, Sendable {
        case session, week, other

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Window(rawValue: raw) ?? .other
        }
    }

    public let status: Status
    public let window: Window?
    /// Percentage of the window used; nil below the level the service reports.
    public let utilization: Double?
    public let resetsAt: Millis?
    /// When the home computer saw it: the end of its last request. Its clock, not ours.
    public let observedAt: Millis?
}

/// §17.5 the home computer that runs the « lecture intelligente », as the server sees it.
public struct WorkerStatus: Decodable, Equatable, Sendable {
    public struct Queued: Decodable, Equatable, Sendable {
        public let ai: Int
        public let pageText: Int
        /// §22 pages waiting for « Préparer la lecture ».
        public let pageSpeech: Int

        enum CodingKeys: String, CodingKey { case ai, pageText, pageSpeech }

        public init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            ai = try container.decode(Int.self, forKey: .ai)
            pageText = try container.decode(Int.self, forKey: .pageText)
            // Older servers do not send it.
            pageSpeech = try container.decodeIfPresent(Int.self, forKey: .pageSpeech) ?? 0
        }
    }

    public struct Estimate: Decodable, Equatable, Sendable {
        public let monthToDateEur: Double
        /// Only for the account that owns the server.
        public let allAccountsEur: Double?
    }

    /// A worker token is configured on the server.
    public let configured: Bool
    /// A heartbeat in the last 90 s.
    public let connected: Bool
    public let lastSeenAt: Millis?
    /// The usage limit was reached on the worker's side.
    public let limited: Bool
    public let limitResetsAt: Millis?
    public let queued: Queued
    public let usage: SubscriptionUsage?
    public let estimate: Estimate

    enum CodingKeys: String, CodingKey {
        case configured, connected, lastSeenAt, limited, limitResetsAt, queued, usage, estimate
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        configured = try container.decode(Bool.self, forKey: .configured)
        connected = try container.decode(Bool.self, forKey: .connected)
        lastSeenAt = try container.decodeIfPresent(Millis.self, forKey: .lastSeenAt)
        limited = try container.decode(Bool.self, forKey: .limited)
        limitResetsAt = try container.decodeIfPresent(Millis.self, forKey: .limitResetsAt)
        queued = try container.decode(Queued.self, forKey: .queued)
        // The two §21 fields came later; the server defaults them the same way.
        usage = try container.decodeIfPresent(SubscriptionUsage.self, forKey: .usage)
        estimate = try container.decodeIfPresent(Estimate.self, forKey: .estimate)
            ?? Estimate(monthToDateEur: 0, allAccountsEur: nil)
    }
}

extension APIClient {
    /// `GET /api/settings/worker`. Nil when offline, on an error or on an answer this version cannot read: the state
    /// of the home computer is information, never a reason to show the parent an error.
    public func workerStatus() async -> WorkerStatus? {
        guard let data = try? await performRaw(
            method: "GET", path: "/api/settings/worker", body: nil, contentType: nil, timeout: 15
        ) else { return nil }
        return try? JSONDecoder().decode(WorkerStatus.self, from: data)
    }

    /// `PUT /api/auth/pin-required` (§20): whether the adult area asks for the code. The account password confirms
    /// the change either way — turning the code off is exactly what a child who found the iPad unlocked would try.
    public func setPinRequired(_ required: Bool, password: String) async throws -> AuthStatus {
        struct Body: Encodable { let required: Bool; let password: String }
        let data = try await performRaw(
            method: "PUT", path: "/api/auth/pin-required",
            body: try JSONEncoder().encode(Body(required: required, password: password)),
            contentType: "application/json", timeout: 30
        )
        guard let status = try? JSONDecoder().decode(AuthStatus.self, from: data) else {
            throw APIError.invalidResponse
        }
        return status
    }
}
