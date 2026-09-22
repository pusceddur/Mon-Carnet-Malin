import Foundation

/// A word the parent defined for their child. These come before the help's own definitions.
///
/// The parent knows the words of the class — « la frise », « le cahier du jour » — better than any model, and a child
/// meets the same definition at home as at school.
public struct GlossaryEntry: Codable, Equatable, Sendable, Identifiable {
    public enum PartOfSpeech: String, Codable, CaseIterable, Sendable {
        case noun = "nom"
        case verb = "verbe"
        case adjective = "adjectif"
        case adverb = "adverbe"
        case expression
        case other = "autre"
    }

    /// Lower-case base form: « volcan », « grandir ».
    public var headword: String
    public var partOfSpeech: PartOfSpeech
    /// At most 30 words, for a child of 8 to 11.
    public var kidDefinition: String
    @NullCodable public var example: String?
    /// Other forms of the word, left out rather than sent empty.
    public var forms: [String]?

    public var id: String { headword }

    public static let definitionMaxWords = 30

    public init(
        headword: String, partOfSpeech: PartOfSpeech, kidDefinition: String, example: String? = nil,
        forms: [String]? = nil
    ) {
        self.headword = headword
        self.partOfSpeech = partOfSpeech
        self.kidDefinition = kidDefinition
        self.example = example
        self.forms = forms
    }

    /// What would be refused, checked before sending.
    public var problems: [String] {
        var found: [String] = []
        if headword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { found.append("Indiquez le mot.") }
        let words = Tokenizer.countWords(kidDefinition)
        if words == 0 { found.append("Écrivez une définition.") }
        if words > Self.definitionMaxWords { found.append("Maximum \(Self.definitionMaxWords) mots.") }
        return found
    }

    /// Cleaned as the server expects it: a lower-case headword, no empty example, no empty forms.
    public var cleaned: GlossaryEntry {
        var copy = self
        copy.headword = headword.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        copy.kidDefinition = kidDefinition.trimmingCharacters(in: .whitespacesAndNewlines)
        let example = example?.trimmingCharacters(in: .whitespacesAndNewlines)
        copy.example = (example?.isEmpty ?? true) ? nil : example
        let forms = (forms ?? []).map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty }
        copy.forms = forms.isEmpty ? nil : forms
        return copy
    }
}

extension APIClient {
    private func glossaryPath(_ headword: String) -> String {
        "/api/glossary/" + (headword.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? headword)
    }

    /// `GET /api/glossary`.
    public func glossary() async throws -> [GlossaryEntry] {
        let data = try await performRaw(method: "GET", path: "/api/glossary", body: nil, contentType: nil, timeout: 30)
        guard let entries = try? JSONDecoder().decode([GlossaryEntry].self, from: data) else {
            throw APIError.invalidResponse
        }
        return entries
    }

    /// `PUT /api/glossary/:headword`.
    public func saveGlossaryEntry(_ entry: GlossaryEntry) async throws -> GlossaryEntry {
        let clean = entry.cleaned
        let data = try await performRaw(
            method: "PUT", path: glossaryPath(clean.headword), body: try JSONEncoder().encode(clean),
            contentType: "application/json", timeout: 30
        )
        return (try? JSONDecoder().decode(GlossaryEntry.self, from: data)) ?? clean
    }

    /// `DELETE /api/glossary/:headword`.
    public func deleteGlossaryEntry(headword: String) async throws {
        _ = try await performRaw(
            method: "DELETE", path: glossaryPath(headword), body: nil, contentType: nil, timeout: 30
        )
    }
}
