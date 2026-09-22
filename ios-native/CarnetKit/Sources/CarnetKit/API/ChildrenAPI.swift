import Foundation

/// A new reader, as the parent fills it in.
public struct NewChild: Encodable, Equatable, Sendable {
    public var firstName: String
    public var age: Int
    public var avatar: String
    public var readingLevel: ReadingLevel
    public var explanationDifficulty: ExplanationDifficulty
    public var reading: ReadingPreferences
    public var tts: TTSPreferences
    public var exercises: ExercisePreferences

    public init(
        firstName: String = "", age: Int = 10, avatar: String = "🦊", readingLevel: ReadingLevel = .intermediaire,
        explanationDifficulty: ExplanationDifficulty = .simple, reading: ReadingPreferences = .standard,
        tts: TTSPreferences = .standard, exercises: ExercisePreferences = .standard
    ) {
        self.firstName = firstName
        self.age = age
        self.avatar = avatar
        self.readingLevel = readingLevel
        self.explanationDifficulty = explanationDifficulty
        self.reading = reading
        self.tts = tts
        self.exercises = exercises
    }

    /// The ranges the server enforces (`PREFERENCE_RANGES`), checked before sending so the parent is told what is
    /// wrong on the form rather than by a refusal.
    public var problems: Set<Field> {
        var found: Set<Field> = []
        let name = firstName.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty || name.count > 40 { found.insert(.firstName) }
        if !(5...15).contains(age) { found.insert(.age) }
        if avatar.trimmingCharacters(in: .whitespaces).isEmpty || avatar.count > 32 { found.insert(.avatar) }
        if exercises.enabledTypes.isEmpty { found.insert(.questionTypes) }
        return found
    }

    public enum Field: Hashable, Sendable {
        case firstName, age, avatar, questionTypes
    }
}

/// The readers of the family, through their own routes rather than the sync.
///
/// On purpose: the sync accepts only a child's reading and voice settings — the ones the child may change
/// themselves. Everything else about a reader (name, age, levels, which exercises) is the parent's, and goes through
/// routes that need the adult area open. Sent through the sync instead, those changes are ignored and reported as
/// refused, and the parent's edit simply never happens.
extension APIClient {
    private func sendJSON<Body: Encodable>(
        _ method: String, _ path: String, _ body: Body?
    ) async throws -> Data {
        let data = try body.map { try JSONEncoder().encode($0) }
        return try await performRaw(
            method: method, path: path, body: data, contentType: data == nil ? nil : "application/json", timeout: 30
        )
    }

    private func decodeChild(_ data: Data) throws -> ChildProfile {
        do {
            return try JSONDecoder().decode(ChildProfile.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }

    private func childPath(_ id: String) -> String {
        "/api/children/" + (id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)
    }

    /// `POST /api/children`. Needs the adult area open.
    public func createChild(_ child: NewChild) async throws -> ChildProfile {
        var clean = child
        clean.firstName = child.firstName.trimmingCharacters(in: .whitespacesAndNewlines)
        return try decodeChild(try await sendJSON("POST", "/api/children", clean))
    }

    /// `PUT /api/children/:id`. Needs the adult area open. Answers the profile as the server stored it.
    public func updateChild(_ child: ChildProfile) async throws -> ChildProfile {
        try decodeChild(try await sendJSON("PUT", childPath(child.id), child))
    }

    /// `DELETE /api/children/:id`. Needs the adult area open.
    public func deleteChild(id: String) async throws {
        _ = try await sendJSON("DELETE", childPath(id), Optional<String>.none)
    }
}
