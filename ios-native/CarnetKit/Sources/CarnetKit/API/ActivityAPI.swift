import Foundation

/// What the parent's activity page shows (§7, §15.4, §15.10). Ported from `shared/src/types/api.ts`.
public struct ActivitySummary: Decodable, Sendable {
    /// One request to the help, as logged by the server. Named apart from the `AIRequest` protocol on purpose.
    public struct HelpRequest: Decodable, Sendable, Identifiable {
        public let id: String
        public let createdAt: Millis
        public let childId: String?
        /// Kept as text: an operation this version does not know must not make the whole page unreadable.
        public let operation: String
        public let status: String
        public let cacheHit: Bool
        public let durationMs: Int
    }

    public enum AlertKind: String, Decodable, Sendable {
        /// The child met a passage about something difficult and was told to talk to an adult.
        case adultRedirect = "adult_redirect"
        case safetyInput = "safety_input"
        case safetyOutput = "safety_output"
        case injectionDetected = "injection_detected"
        /// The monthly budget for the help reached 80 %.
        case budgetWarning = "budget_warning"
        case other

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = AlertKind(rawValue: raw) ?? .other
        }
    }

    public struct Alert: Decodable, Sendable, Identifiable {
        public let id: String
        public let createdAt: Millis
        public let childId: String?
        public let kind: AlertKind
        public let detail: String
        public let seenAt: Millis?
    }

    public struct Budget: Decodable, Sendable {
        public let monthToDateEur: Double
        public let monthlyBudgetEur: Double
        /// What the requests the home computer ran this month would cost at list prices. Shown, never enforced.
        public let workerEstimateEur: Double
    }

    public let sessions: [ReadingSession]
    public let aiRequests: [HelpRequest]
    public let alerts: [Alert]
    public let budget: Budget

    /// Minutes read, pages seen and words looked up for one child — counts of effort, never of mistakes.
    public func totals(for childId: String) -> (minutes: Int, pages: Int, wordsLookedUp: Int, helpAsked: Int) {
        let mine = sessions.filter { $0.childId == childId }
        return (
            mine.reduce(0) { $0 + $1.minutes },
            mine.reduce(0) { $0 + Set($1.pagesViewed).count },
            mine.reduce(0) { $0 + $1.wordsLookedUp },
            mine.reduce(0) { $0 + $1.aiRequests }
        )
    }
}

public enum FreeQuestionOutcome: String, Decodable, Sendable {
    case answered, blocked
    case adultRedirect = "adult_redirect"
    case unavailable
    case other

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = FreeQuestionOutcome(rawValue: raw) ?? .other
    }
}

/// One question a child typed in « Pose ta question », as the parent sees it.
public struct FreeQuestionLogEntry: Decodable, Sendable, Identifiable {
    public let id: String
    public let childId: String
    public let question: String
    public let outcome: FreeQuestionOutcome
    public let answer: String?
    public let createdAt: Millis
}

/// §24: a text the child corrected with « Corriger », and what changed.
public struct WritingCorrectionEntry: Decodable, Equatable, Sendable, Identifiable {
    public let id: String
    public let childId: String
    public let documentId: String?
    public let originalText: String
    public let correctedText: String
    public let changes: [WritingChange]
    public let createdAt: Millis
}

/// §24 « Écriture corrigée »: one child's corrected texts over the kept year, what to work on together.
public struct WritingCorrectionHistory: Decodable, Equatable, Sendable {
    /// A mistake made at least twice.
    public struct Frequent: Decodable, Equatable, Sendable, Hashable {
        public let from: String
        public let to: String
        public let kind: WritingChangeKind
        public let count: Int
    }

    /// Newest first.
    public let entries: [WritingCorrectionEntry]
    /// Keyed by the server's names (`orthographe`, `accent`…); read with `count(of:)`.
    public let counts: [String: Int]
    /// Most frequent first.
    public let frequent: [Frequent]

    public func count(of kind: WritingChangeKind) -> Int { counts[kind.rawValue] ?? 0 }

    /// The order the adult reads them in: what matters most for a child's writing first.
    public static let kindOrder: [WritingChangeKind] = [.spelling, .accent, .grammar, .space, .punctuation, .capital]
}

extension APIClient {
    private func getJSON<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        let data = try await performRaw(method: "GET", path: path, body: nil, contentType: nil, timeout: 30)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }

    /// `GET /api/activity`, optionally for one child and a period.
    public func activity(childId: String? = nil, from: Millis? = nil, to: Millis? = nil) async throws -> ActivitySummary {
        var items: [URLQueryItem] = []
        if let childId { items.append(URLQueryItem(name: "childId", value: childId)) }
        if let from { items.append(URLQueryItem(name: "from", value: String(from))) }
        if let to { items.append(URLQueryItem(name: "to", value: String(to))) }
        var components = URLComponents()
        components.queryItems = items.isEmpty ? nil : items
        return try await getJSON("/api/activity" + (components.percentEncodedQuery.map { "?\($0)" } ?? ""),
                                 as: ActivitySummary.self)
    }

    /// `POST /api/activity/alerts/:id/seen`. Needs the adult area open.
    public func markAlertSeen(id: String) async throws {
        let safe = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        _ = try await performRaw(
            method: "POST", path: "/api/activity/alerts/\(safe)/seen", body: nil, contentType: nil, timeout: 20
        )
    }

    /// `GET /api/activity/questions` (§18.3): the free questions of one child over the last 30 days, newest first.
    /// Needs the adult area open.
    public func freeQuestionHistory(childId: String, limit: Int = 100) async throws -> [FreeQuestionLogEntry] {
        struct Answer: Decodable { let entries: [FreeQuestionLogEntry] }
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "childId", value: childId),
            URLQueryItem(name: "limit", value: String(min(200, max(1, limit)))),
        ]
        return try await getJSON(
            "/api/activity/questions?\(components.percentEncodedQuery ?? "")", as: Answer.self
        ).entries
    }

    /// `GET /api/activity/writing` (§24): the texts one child corrected, newest first. Needs the adult area open.
    public func writingHistory(childId: String, limit: Int = 50) async throws -> WritingCorrectionHistory {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "childId", value: childId),
            URLQueryItem(name: "limit", value: String(min(200, max(1, limit)))),
        ]
        return try await getJSON(
            "/api/activity/writing?\(components.percentEncodedQuery ?? "")", as: WritingCorrectionHistory.self
        )
    }
}
