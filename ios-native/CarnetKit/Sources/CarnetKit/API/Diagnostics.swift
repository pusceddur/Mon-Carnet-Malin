import Foundation

/// A technical problem seen on this device, sent to `POST /api/diagnostics` so that a failure only an iPad shows can
/// be understood. Ported from `client/src/platform/diagnostics.ts`.
///
/// **Never the text of a document**: only the name and message of the error, the stage it happened at and a few
/// flags about the device. A page a child scanned may carry their name and their school.
public struct ClientDiagnosticReport: Encodable, Equatable, Sendable {
    public enum Kind: String, Encodable, Sendable {
        case ocrEngine = "ocr_engine"
        case processingFailed = "processing_failed"
        case preprocess
        case pdf
        case selfTest = "self_test"
        case other
    }

    public enum Value: Encodable, Equatable, Sendable {
        case string(String)
        case number(Double)
        case bool(Bool)
        case null

        public func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case let .string(value): try container.encode(value)
            case let .number(value):
                // What JSON cannot carry becomes null, as on the web.
                if value.isFinite { try container.encode(value) } else { try container.encodeNil() }
            case let .bool(value): try container.encode(value)
            case .null: try container.encodeNil()
            }
        }
    }

    public let kind: Kind
    public let message: String
    public let stage: String?
    public let context: [String: Value]
    public let userAgent: String
    public let occurredAt: Millis

    enum CodingKeys: String, CodingKey { case kind, message, stage, context, userAgent, occurredAt }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(message, forKey: .message)
        // `nullable()` on the server: the key has to be there.
        try container.encode(stage, forKey: .stage)
        try container.encode(context, forKey: .context)
        try container.encode(userAgent, forKey: .userAgent)
        try container.encode(occurredAt, forKey: .occurredAt)
    }
}

/// The server's limits (`DIAGNOSTIC_LIMITS`), in UTF-16 units like JavaScript's `length`.
public enum DiagnosticLimits {
    public static let reportsMax = 20
    public static let messageMax = 500
    public static let stageMax = 40
    public static let contextKeysMax = 30
    public static let contextKeyMax = 40
    public static let contextValueMax = 200
    public static let userAgentMax = 400
}

/// Collects reports and sends them a moment later, in batches. Best effort: a report that cannot be sent is dropped,
/// never retried in a loop, and nothing here can make the app fail.
public actor Diagnostics {
    public typealias Sender = @Sendable ([ClientDiagnosticReport]) async -> Bool

    /// Enough to understand a problem, not enough to flood the server from a device stuck in a loop.
    public static let maxReportsPerSession = 60
    public static let flushDelay: Duration = .seconds(2)

    private let sender: Sender
    private let userAgent: String
    private let device: [String: ClientDiagnosticReport.Value]
    private let now: @Sendable () -> Millis

    private var queue: [ClientDiagnosticReport] = []
    private var sentThisSession = 0
    private var seen = Set<String>()
    private var flushTask: Task<Void, Never>?

    public init(
        userAgent: String, device: [String: ClientDiagnosticReport.Value] = [:],
        now: @escaping @Sendable () -> Millis = { Millis(Date().timeIntervalSince1970 * 1000) },
        sender: @escaping Sender
    ) {
        self.userAgent = Self.clip(userAgent, DiagnosticLimits.userAgentMax)
        self.device = device
        self.now = now
        self.sender = sender
    }

    /// Queues a report — once per session for the same problem — and sends it shortly after.
    ///
    /// A retry that finally fails (`context["final"] == true`) is reported again; other duplicates only once.
    public func report(
        _ kind: ClientDiagnosticReport.Kind, _ error: Error, stage: String? = nil,
        context: [String: ClientDiagnosticReport.Value] = [:]
    ) {
        report(kind, message: Self.describe(error), stage: stage, context: context)
    }

    public func report(
        _ kind: ClientDiagnosticReport.Kind, message: String, stage: String? = nil,
        context: [String: ClientDiagnosticReport.Value] = [:]
    ) {
        let message = Self.clip(message, DiagnosticLimits.messageMax)
        let final = context["final"] == .bool(true) ? "final" : ""
        let key = "\(kind.rawValue)|\(stage ?? "")|\(message)|\(final)"
        guard !seen.contains(key), sentThisSession + queue.count < Self.maxReportsPerSession else { return }
        seen.insert(key)
        queue.append(ClientDiagnosticReport(
            kind: kind, message: message, stage: stage.map { Self.clip($0, DiagnosticLimits.stageMax) },
            context: sanitize(context), userAgent: userAgent, occurredAt: now()
        ))
        guard flushTask == nil else { return }
        flushTask = Task { [weak self] in
            try? await Task.sleep(for: Self.flushDelay)
            await self?.flush()
        }
    }

    /// Sends what is queued now, in batches the server accepts.
    public func flush() async {
        // Not cancelled: the timer may be the one calling, and a cancelled task would cancel the request too. A timer
        // that fires after an early flush finds nothing to send.
        flushTask = nil
        while !queue.isEmpty {
            let batch = Array(queue.prefix(DiagnosticLimits.reportsMax))
            queue.removeFirst(batch.count)
            sentThisSession += batch.count
            _ = await sender(batch)
        }
    }

    /// Reports waiting to be sent. Tests.
    public var pending: [ClientDiagnosticReport] { queue }

    /// The device's flags first, the report's own on top; keys and values cut to the server's limits.
    private func sanitize(_ context: [String: ClientDiagnosticReport.Value]) -> [String: ClientDiagnosticReport.Value] {
        var merged = device
        for (key, value) in context { merged[key] = value }
        var out: [String: ClientDiagnosticReport.Value] = [:]
        // Sorted so the same report is cut the same way every time.
        for key in merged.keys.sorted() {
            guard out.count < DiagnosticLimits.contextKeysMax, let value = merged[key] else { break }
            let clippedKey = Self.clip(key, DiagnosticLimits.contextKeyMax)
            if case let .string(text) = value {
                out[clippedKey] = .string(Self.clip(text, DiagnosticLimits.contextValueMax))
            } else {
                out[clippedKey] = value
            }
        }
        return out
    }

    /// « Type: message », as far as an error says anything about itself.
    ///
    /// An error from Apple's frameworks gives its domain and code only: its description and user info can carry a
    /// file path, and a file name can carry a child's name.
    public static func describe(_ error: Error) -> String {
        let type = String(describing: Swift.type(of: error))
        if Swift.type(of: error) is NSError.Type {
            let nsError = error as NSError
            return "\(type): \(nsError.domain) \(nsError.code)"
        }
        return "\(type): \(String(describing: error))"
    }

    /// Cut to `max` UTF-16 units with an ellipsis, never inside a character.
    static func clip(_ value: String, _ max: Int) -> String {
        guard value.utf16.count > max else { return value }
        return AIText.clip(value, max - 1) + "…"
    }
}

extension APIClient {
    /// `POST /api/diagnostics`. True when the server took them.
    public func sendDiagnostics(_ reports: [ClientDiagnosticReport]) async -> Bool {
        struct Body: Encodable { let reports: [ClientDiagnosticReport] }
        guard !reports.isEmpty, let body = try? JSONEncoder().encode(Body(reports: reports)) else { return false }
        return (try? await performRaw(
            method: "POST", path: "/api/diagnostics", body: body, contentType: "application/json", timeout: 20
        )) != nil
    }
}
