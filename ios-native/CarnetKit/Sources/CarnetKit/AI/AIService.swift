import Foundation

/// The two calls the help needs from the network. Behind a protocol so the whole client can be tested without one.
public protocol AITransport: Sendable {
    /// `POST /api/ai/:operation`. Answers either the result or a job to wait for.
    func postAI(_ operation: AIOperation, body: Data, timeout: TimeInterval) async throws -> Data
    /// `GET /api/ai/jobs/:jobId?waitMs=`. The server holds the request until the job is done, at most `waitMs`.
    func pollAIJob(_ jobId: String, waitMs: Int, timeout: TimeInterval) async throws -> Data
}

extension APIClient: AITransport {
    public func postAI(_ operation: AIOperation, body: Data, timeout: TimeInterval) async throws -> Data {
        try await performRaw(
            method: "POST", path: "/api/ai/\(operation.rawValue)", body: body,
            contentType: "application/json", timeout: timeout
        )
    }

    public func pollAIJob(_ jobId: String, waitMs: Int, timeout: TimeInterval) async throws -> Data {
        let id = jobId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? jobId
        let query = waitMs > 0 ? "?waitMs=\(waitMs)" : ""
        return try await performRaw(
            method: "GET", path: "/api/ai/jobs/\(id)\(query)", body: nil, contentType: nil, timeout: timeout
        )
    }
}

/// Answers kept on the device, so a word looked up once can be looked up again on the train.
///
/// Files in the Caches folder, one per answer: the system may empty it when the iPad runs short of space, which is
/// exactly right for something that can always be asked for again.
///
/// Every key carries the family: the same iPad can be signed into by two families in turn, and one family must never
/// be handed an answer written from another's book.
public struct AICache: Sendable {
    public static let timeToLive: TimeInterval = 30 * 24 * 60 * 60

    let directory: URL

    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    /// The default place, in the app's Caches folder.
    public static func standard() -> AICache? {
        guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return nil }
        return AICache(directory: caches.appendingPathComponent("ai-answers", isDirectory: true))
    }

    private func file(_ key: String) -> URL {
        directory.appendingPathComponent(key).appendingPathExtension("json")
    }

    func read(_ key: String, now: Date = Date()) -> Data? {
        let url = file(key)
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let written = attributes[.modificationDate] as? Date
        else { return nil }
        guard now.timeIntervalSince(written) <= Self.timeToLive else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        return try? Data(contentsOf: url)
    }

    func write(_ key: String, _ data: Data) {
        try? data.write(to: file(key), options: .atomic)
    }

    /// Clears answers older than a month. Run once per launch rather than on every read.
    func prune(now: Date = Date()) {
        let keys: [URLResourceKey] = [.contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: keys
        ) else { return }
        for url in files {
            let written = (try? url.resourceValues(forKeys: Set(keys)))?.contentModificationDate ?? .distantPast
            if now.timeIntervalSince(written) > Self.timeToLive { try? FileManager.default.removeItem(at: url) }
        }
    }

    /// Forgets everything: on sign-out, so nothing of one family's reading stays behind for the next.
    public func removeAll() {
        try? FileManager.default.removeItem(at: directory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
}

/// The client side of the help (§11.6, §15.4). Ported from `client/src/ai/aiClient.ts`.
///
/// Every call returns; nothing throws towards the interface. A child who asks what a word means gets either the
/// answer or a sentence saying why not, and never a screen that has stopped responding.
///
/// Nothing is answered on the device any more (decision of 2026-09-19): no built-in dictionary, no local summary.
/// When the help cannot answer, the child is told so and keeps reading.
public actor AIService {
    private let transport: AITransport
    private let cache: AICache?
    /// The family, part of every cache key.
    private let parentId: String
    private let minimumPollMs: Int
    private var pruned = false

    public init(transport: AITransport, cache: AICache?, parentId: String, minimumPollMs: Int = 100) {
        self.transport = transport
        self.cache = cache
        self.parentId = parentId
        self.minimumPollMs = minimumPollMs
    }

    // MARK: - One request

    /// Asks the help. `child` is who the answer is written for: an explanation for an eight-year-old is not the one
    /// for a twelve-year-old, and the cache keeps them apart.
    public func request<R: AIRequest>(_ request: R, for child: ChildProfile) async -> AIResult<R.Output> {
        await perform(request, child: child, bypassCache: false)
    }

    private func perform<R: AIRequest>(
        _ request: R, child: ChildProfile, bypassCache: Bool
    ) async -> AIResult<R.Output> {
        if Task.isCancelled { return .failed(.timeout) }
        pruneOnce()

        let key = R.operation.isCachedLocally ? cacheKey(request, child: child) : nil
        if let key, !bypassCache, let stored = cache?.read(key),
           let hit = Self.decode(stored, as: R.Output.self, operation: R.operation), case .result(var result) = hit {
            switch result {
            case let .ok(value, meta):
                var cachedMeta = meta
                cachedMeta.cached = true
                result = .ok(value, cachedMeta)
                return result
            case let .notInText(message, meta):
                var cachedMeta = meta
                cachedMeta.cached = true
                return .notInText(message: message, meta: cachedMeta)
            default:
                break
            }
        }

        let (result, raw) = await callServer(request)
        // Only real answers are kept: a refusal or an outage today must not be served back tomorrow.
        if let key, let raw {
            switch result {
            case .ok, .notInText: cache?.write(key, raw)
            default: break
            }
        }
        return result
    }

    private func pruneOnce() {
        guard !pruned else { return }
        pruned = true
        cache?.prune()
    }

    /// sha256 of the family, the operation, the request without the child, who it is for, and the prompt version.
    func cacheKey<R: AIRequest>(_ request: R, child: ChildProfile) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(request),
              var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        // The child is left out on purpose: two children of the same age and level asking the same thing about the
        // same page get the same answer, and the family pays for it once.
        object.removeValue(forKey: "childId")
        guard let stable = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return nil }
        let body = String(decoding: stable, as: UTF8.self).precomposedStringWithCanonicalMapping
        return Hashing.sha256Hex([
            parentId, R.operation.rawValue, body, Hashing.profileSignature(child), AILimits.promptVersion,
        ].joined(separator: "|"))
    }

    // MARK: - The server

    private static func clientTimeoutMs(_ route: AIRoute) -> Int {
        (route == .complex ? AILimits.complexDeadlineMs : AILimits.lightDeadlineMs) + AILimits.clientTimeoutMarginMs
    }

    private func pollDelayMs(_ value: Double?) -> Int {
        let ms = value.map { Int($0) } ?? AILimits.jobPollMs
        return min(15_000, max(minimumPollMs, ms))
    }

    private func callServer<R: AIRequest>(_ request: R) async -> (AIResult<R.Output>, Data?) {
        let started = Date()
        var deadline = started.addingTimeInterval(Double(Self.clientTimeoutMs(request.expectedRoute)) / 1000)

        guard let body = try? JSONEncoder().encode(request) else { return (.failed(.providerError), nil) }

        let raw: Data
        do {
            raw = try await transport.postAI(
                R.operation, body: body, timeout: max(1, deadline.timeIntervalSinceNow)
            )
        } catch {
            return (.failed(Self.reason(for: error)), nil)
        }

        switch Self.decode(raw, as: R.Output.self, operation: R.operation) {
        case let .result(result):
            return (result, raw)
        case let .pending(jobId, pollAfterMs, waitMs):
            guard let jobId, !jobId.isEmpty else { return (.failed(.providerError), nil) }
            // The server says how long the job may take — the home computer can take a while (§17.4). Otherwise a
            // job is always the long route.
            if let waitMs, waitMs > 0 {
                deadline = started.addingTimeInterval(min(waitMs, Double(AILimits.maxJobWaitMs)) / 1000)
            } else {
                let complex = started.addingTimeInterval(Double(Self.clientTimeoutMs(.complex)) / 1000)
                deadline = max(deadline, complex)
            }
            return await poll(jobId, as: R.Output.self, operation: R.operation, firstDelay: pollAfterMs, until: deadline)
        case nil:
            return (.failed(.providerError), nil)
        }
    }

    private func poll<Output: Decodable & Sendable>(
        _ jobId: String, as type: Output.Type, operation: AIOperation, firstDelay: Double?, until deadline: Date
    ) async -> (AIResult<Output>, Data?) {
        var delay = pollDelayMs(firstDelay)
        var transientErrors = 0

        while true {
            let remainingMs = Int(deadline.timeIntervalSinceNow * 1000)
            guard remainingMs > 0 else { return (.failed(.timeout), nil) }
            do {
                try await Task.sleep(nanoseconds: UInt64(min(delay, remainingMs)) * 1_000_000)
            } catch {
                return (.failed(.timeout), nil)
            }

            let leftMs = Int(deadline.timeIntervalSinceNow * 1000)
            guard leftMs > 0 else { return (.failed(.timeout), nil) }
            // The server keeps the request open until the answer is there: no time is lost between two polls.
            let waitMs = max(0, min(AILimits.jobHoldMs, leftMs - 1_000))

            let raw: Data
            do {
                raw = try await transport.pollAIJob(
                    jobId, waitMs: waitMs, timeout: Double(max(1_000, min(leftMs, waitMs + 10_000))) / 1000
                )
            } catch {
                if Self.isTransient(error), transientErrors < 3 {
                    transientErrors += 1
                    delay = pollDelayMs(Double(AILimits.jobPollMs))
                    continue
                }
                return (.failed(Self.reason(for: error)), nil)
            }

            switch Self.decode(raw, as: type, operation: operation) {
            case let .pending(_, pollAfterMs, _):
                delay = pollDelayMs(pollAfterMs)
            case let .result(result):
                return (result, raw)
            case nil:
                return (.failed(.providerError), nil)
            }
        }
    }

    // MARK: - Reading answers

    enum Decoded<Output: Sendable> {
        case result(AIResult<Output>)
        case pending(jobId: String?, pollAfterMs: Double?, waitMs: Double?)
    }

    private struct Envelope<Output: Decodable>: Decodable {
        let status: String
        let data: Output?
        let meta: AIMeta?
        let message: String?
        let reason: String?
        let jobId: String?
        let pollAfterMs: Double?
        let waitMs: Double?
        let missingChunkIndexes: [Int]?
    }

    /// Turns what the server sent into a result, filling in the child's sentence when the server left it empty.
    /// Nil when the answer cannot be read at all — which the caller treats as the help being unavailable, never as
    /// something to show.
    static func decode<Output: Decodable & Sendable>(
        _ data: Data, as type: Output.Type, operation: AIOperation
    ) -> Decoded<Output>? {
        guard let envelope = try? JSONDecoder().decode(Envelope<Output>.self, from: data) else { return nil }

        func filled(_ message: String?, _ fallback: String) -> String {
            let trimmed = message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return trimmed.isEmpty ? fallback : trimmed
        }

        switch envelope.status {
        case "pending":
            return .pending(jobId: envelope.jobId, pollAfterMs: envelope.pollAfterMs, waitMs: envelope.waitMs)
        case "ok":
            guard let value = envelope.data, let meta = envelope.meta else { return nil }
            return .result(.ok(value, meta))
        case "not_in_text":
            guard let meta = envelope.meta else { return nil }
            return .result(.notInText(message: filled(envelope.message, KidMessages.notInText), meta: meta))
        case "blocked":
            guard let meta = envelope.meta else { return nil }
            let reason = envelope.reason.flatMap(AIBlockedReason.init(rawValue:)) ?? .validation
            return .result(.blocked(
                reason: reason,
                message: filled(envelope.message, KidMessages.forBlocked(operation, reason)),
                meta: meta
            ))
        case "unavailable":
            let reason = envelope.reason.flatMap(AIUnavailableReason.init(rawValue:)) ?? .providerError
            return .result(.unavailable(
                reason: reason,
                message: filled(envelope.message, KidMessages.forUnavailable(reason)),
                missingChunkIndexes: envelope.missingChunkIndexes ?? []
            ))
        default:
            return nil
        }
    }

    static func reason(for error: Error) -> AIUnavailableReason {
        if error is CancellationError { return .timeout }
        guard let apiError = error as? APIError else { return .providerError }
        switch apiError {
        case .offline: return .offline
        case .timedOut: return .timeout
        case let .api(status, code, _):
            if status == 413 || code == "payload_too_large" { return .payloadTooLarge }
            if status == 429 || status == 503 || code == "busy" { return .busy }
            return .providerError
        case .notAuthenticated, .invalidResponse:
            return .providerError
        }
    }

    static func isTransient(_ error: Error) -> Bool {
        guard let apiError = error as? APIError else { return false }
        switch apiError {
        case .timedOut, .offline: return true
        case let .api(status, _, _): return status == 429 || status >= 500
        default: return false
        }
    }

    // MARK: - The progressive summary

    /// Summarises a whole book, or part of one, a piece at a time (§15.4).
    ///
    /// Each chunk is summarised on its own — two at a time — and then the server writes the whole summary from those.
    /// `progress` counts the chunks and then the final step, so the bar a child watches moves steadily instead of
    /// sitting at zero for two minutes.
    ///
    /// When the server says a chunk summary went missing from its cache, those chunks are sent again and the final
    /// step tried again, twice at most.
    public func summarize(
        pages: [AIPageInput],
        level: SummaryLevel,
        child: ChildProfile,
        documentId: String?,
        documentHash: String?,
        progress: @escaping @Sendable (Int, Int) -> Void = { _, _ in }
    ) async -> AIResult<SummaryData> {
        let readable = pages.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !readable.isEmpty else {
            let meta = AIMeta(
                cached: false, route: .local, promptVersion: AILimits.promptVersion,
                sourceWarning: false, requestId: UUID().uuidString
            )
            return .notInText(message: KidMessages.notInText, meta: meta)
        }

        let chunks = SummaryPlan.chunks(for: readable)
        let planHash = SummaryPlan.hash(of: chunks)
        let total = chunks.count + 1
        let lowConfidence = Dictionary(readable.map { ($0.pageIndex, $0.ocrLowConfidence) }, uniquingKeysWith: { $0 || $1 })
        let sourceWarning = readable.contains(where: \.ocrLowConfidence)
        progress(0, total)

        func chunkRequest(_ chunk: TextChunk) -> SummarizeChunkRequest {
            SummarizeChunkRequest(
                childId: child.id, documentId: documentId, documentHash: documentHash, level: level,
                planHash: planHash, chunk: chunk,
                ocrLowConfidence: chunk.pageIndexes.contains { lowConfidence[$0] == true }
            )
        }

        if let failure = await sendChunks(chunks, build: chunkRequest, child: child, bypassCache: false, onEach: {
            done in progress(done, total)
        }) {
            progress(total, total)
            return .failed(failure)
        }

        for attempt in 0...2 {
            let final = await perform(
                SummarizeFinalRequest(
                    childId: child.id, documentId: documentId, documentHash: documentHash, level: level,
                    planHash: planHash, chunkCount: chunks.count, ocrLowConfidence: sourceWarning
                ),
                child: child,
                bypassCache: false
            )

            if case let .unavailable(reason, _, missing) = final {
                guard reason == .missingChunks, attempt < 2 else {
                    progress(total, total)
                    return final
                }
                let wanted = Set(missing)
                let resend = chunks.filter { wanted.contains($0.chunkIndex) }
                if let failure = await sendChunks(
                    resend.isEmpty ? chunks : resend, build: chunkRequest, child: child, bypassCache: true, onEach: { _ in }
                ) {
                    progress(total, total)
                    return .failed(failure)
                }
                continue
            }
            progress(total, total)
            return final
        }
        progress(total, total)
        return .failed(.missingChunks)
    }

    /// Sends chunk requests two at a time, stopping at the first the help cannot answer. A blocked chunk does not stop
    /// anything: the server leaves it out of the final summary on its own.
    private func sendChunks(
        _ chunks: [TextChunk],
        build: (TextChunk) -> SummarizeChunkRequest,
        child: ChildProfile,
        bypassCache: Bool,
        onEach: @escaping @Sendable (Int) -> Void
    ) async -> AIUnavailableReason? {
        var done = 0
        var index = 0
        while index < chunks.count {
            let batch = chunks[index..<min(index + AILimits.summarizeChunkParallelism, chunks.count)].map(build)
            index += batch.count

            let results = await withTaskGroup(of: AIResult<ChunkSummaryData>.self) { group in
                for request in batch {
                    group.addTask { await self.perform(request, child: child, bypassCache: bypassCache) }
                }
                var collected: [AIResult<ChunkSummaryData>] = []
                for await result in group { collected.append(result) }
                return collected
            }

            for result in results {
                done += 1
                onEach(done)
                if case let .unavailable(reason, _, _) = result { return reason }
            }
        }
        return nil
    }
}
