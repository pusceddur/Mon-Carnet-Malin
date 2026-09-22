import Foundation

/// Why the home computer cannot prepare a reading (§22).
public enum ReadingPreparationUnavailable: String, Codable, Sendable {
    case notConfigured = "not_configured"
    case aiDisabled = "ai_disabled"
    /// The text of the documents is kept off the server, and the home computer needs it.
    case textNotSynced = "text_not_synced"
}

/// What the server did with a request to prepare a reading.
public struct ReadingPreparation: Decodable, Equatable, Sendable {
    public let queued: Int
    public let unavailable: ReadingPreparationUnavailable?
}

/// The routes for books that the sync does not carry: the ones that need the adult area open, or that start work on
/// the home computer.
extension APIClient {
    private func documentPath(_ id: String) -> String {
        "/api/documents/" + (id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)
    }

    private func postJSON<Body: Encodable>(_ method: String, _ path: String, _ body: Body) async throws -> Data {
        try await performRaw(
            method: method, path: path, body: try JSONEncoder().encode(body), contentType: "application/json",
            timeout: 60
        )
    }

    /// `DELETE /api/documents/:id`. Needs the adult area open.
    ///
    /// Through the route rather than the sync: the server removes the pages, the images and the children's notes on
    /// the book in one go, and every other device learns of it from its next sync.
    public func deleteDocument(id: String) async throws {
        _ = try await performRaw(method: "DELETE", path: documentPath(id), body: nil, contentType: nil, timeout: 60)
    }

    /// `PUT /api/documents/:id/text-mode` (§17.10). Answers the saved document and how many pages were sent to be
    /// read again in the new mode.
    public func setTextMode(
        documentId: String, _ mode: DocumentTextMode
    ) async throws -> (document: DocumentMeta, queued: Int) {
        struct Body: Encodable { let textMode: DocumentTextMode }
        struct Answer: Decodable { let document: DocumentMeta; let queued: Int }
        let data = try await postJSON("PUT", documentPath(documentId) + "/text-mode", Body(textMode: mode))
        guard let answer = try? JSONDecoder().decode(Answer.self, from: data), answer.document.id == documentId else {
            throw APIError.invalidResponse
        }
        return (answer.document, answer.queued)
    }

    /// `POST /api/documents/:id/reading-preparation` (§22): the home computer punctuates the pages for the voice.
    /// The pages on screen when `pageIndexes` is given, the whole book otherwise.
    public func prepareReading(
        documentId: String, pageIndexes: [Int]? = nil, force: Bool = false
    ) async throws -> ReadingPreparation {
        struct Body: Encodable {
            let pageIndexes: [Int]?
            let force: Bool?

            func encode(to encoder: Encoder) throws {
                // Left out rather than null: the server reads « no pages given » as « the whole book ».
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encodeIfPresent(pageIndexes, forKey: .pageIndexes)
                try container.encodeIfPresent(force, forKey: .force)
            }

            enum CodingKeys: String, CodingKey { case pageIndexes, force }
        }
        let data = try await postJSON(
            "POST", documentPath(documentId) + "/reading-preparation",
            Body(pageIndexes: pageIndexes, force: force ? true : nil)
        )
        guard let answer = try? JSONDecoder().decode(ReadingPreparation.self, from: data) else {
            throw APIError.invalidResponse
        }
        return answer
    }

    /// `POST /api/worker/transcriptions` (§17.5): the pages whose image is on the server are read again by the home
    /// computer. `reread` asks for it even when the same image was already read.
    public func relaunchTranscription(
        documentId: String, pageIndexes: [Int]? = nil, reread: Bool = false
    ) async throws -> Int {
        struct Body: Encodable {
            let documentId: String
            let pageIndexes: [Int]?
            let reread: Bool?

            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(documentId, forKey: .documentId)
                try container.encodeIfPresent(pageIndexes, forKey: .pageIndexes)
                try container.encodeIfPresent(reread, forKey: .reread)
            }

            enum CodingKeys: String, CodingKey { case documentId, pageIndexes, reread }
        }
        struct Answer: Decodable { let queued: Int }
        let data = try await postJSON(
            "POST", "/api/worker/transcriptions",
            Body(documentId: documentId, pageIndexes: pageIndexes, reread: reread ? true : nil)
        )
        guard let answer = try? JSONDecoder().decode(Answer.self, from: data), answer.queued >= 0 else {
            throw APIError.invalidResponse
        }
        return answer.queued
    }
}
