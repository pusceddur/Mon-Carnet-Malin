import Foundation

/// Where a question comes from in the book, so the child can be sent back to the passage rather than just told « non ».
public struct SourceRef: Codable, Equatable, Sendable {
    public let pageIndex: Int
    public let quote: String

    public init(pageIndex: Int, quote: String) {
        self.pageIndex = pageIndex
        self.quote = quote
    }
}

/// The five kinds of question, named as the server names them.
///
/// The raw values are the strings that travel on the wire, so they stay in French and are never renamed: a question
/// written by the web app and answered here must be the same question.
public enum QuestionType: String, Codable, Sendable, CaseIterable {
    case multipleChoice = "qcm"
    case trueOrFalse = "vrai_faux"
    case freeAnswer = "reponse_libre"
    case matching = "association"
    case ordering = "ordre"
}

/// One question. The five kinds are deliberate: a child who cannot yet write an answer can still show they understood
/// by choosing, ordering or matching.
public struct Question: Codable, Equatable, Sendable, Identifiable {
    public enum Kind: Equatable, Sendable {
        /// One answer among several.
        case multipleChoice(choices: [String], correctIndex: Int, explanation: String)
        case trueOrFalse(answer: Bool, explanation: String)
        /// Written in the child's own words; only a model can judge these.
        case freeAnswer(expectedAnswer: String, keyPoints: [String])
        case matching(pairs: [Pair])
        case ordering(itemsInOrder: [String])

        public var type: QuestionType {
            switch self {
            case .multipleChoice: return .multipleChoice
            case .trueOrFalse: return .trueOrFalse
            case .freeAnswer: return .freeAnswer
            case .matching: return .matching
            case .ordering: return .ordering
            }
        }
    }

    public struct Pair: Codable, Equatable, Sendable {
        public let left: String
        public let right: String

        public init(left: String, right: String) {
            self.left = left
            self.right = right
        }
    }

    public let id: String
    public let prompt: String
    public let source: SourceRef
    public let kind: Kind

    public init(id: String, prompt: String, source: SourceRef, kind: Kind) {
        self.id = id
        self.prompt = prompt
        self.source = source
        self.kind = kind
    }

    public var type: QuestionType { kind.type }

    /// True when the app can judge the answer on its own, with no model and no network.
    public var isClosed: Bool {
        if case .freeAnswer = kind { return false }
        return true
    }

    // MARK: - Wire format
    //
    // A question is one flat object with a `type` telling the rest apart, which is what the server stores and what the
    // web app writes. Swift would happily encode the enum its own way; it must not, or a book prepared on one device
    // would arrive unreadable on the other.

    private enum CodingKeys: String, CodingKey {
        case id, prompt, source, type
        case choices, correctIndex, explanation, answer, expectedAnswer, keyPoints, pairs, itemsInOrder
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        prompt = try container.decode(String.self, forKey: .prompt)
        source = try container.decode(SourceRef.self, forKey: .source)

        switch try container.decode(QuestionType.self, forKey: .type) {
        case .multipleChoice:
            kind = .multipleChoice(
                choices: try container.decode([String].self, forKey: .choices),
                correctIndex: try container.decode(Int.self, forKey: .correctIndex),
                explanation: try container.decode(String.self, forKey: .explanation)
            )
        case .trueOrFalse:
            kind = .trueOrFalse(
                answer: try container.decode(Bool.self, forKey: .answer),
                explanation: try container.decode(String.self, forKey: .explanation)
            )
        case .freeAnswer:
            kind = .freeAnswer(
                expectedAnswer: try container.decode(String.self, forKey: .expectedAnswer),
                keyPoints: try container.decode([String].self, forKey: .keyPoints)
            )
        case .matching:
            kind = .matching(pairs: try container.decode([Pair].self, forKey: .pairs))
        case .ordering:
            kind = .ordering(itemsInOrder: try container.decode([String].self, forKey: .itemsInOrder))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(prompt, forKey: .prompt)
        try container.encode(source, forKey: .source)
        try container.encode(kind.type, forKey: .type)

        switch kind {
        case let .multipleChoice(choices, correctIndex, explanation):
            try container.encode(choices, forKey: .choices)
            try container.encode(correctIndex, forKey: .correctIndex)
            try container.encode(explanation, forKey: .explanation)
        case let .trueOrFalse(answer, explanation):
            try container.encode(answer, forKey: .answer)
            try container.encode(explanation, forKey: .explanation)
        case let .freeAnswer(expectedAnswer, keyPoints):
            try container.encode(expectedAnswer, forKey: .expectedAnswer)
            try container.encode(keyPoints, forKey: .keyPoints)
        case let .matching(pairs):
            try container.encode(pairs, forKey: .pairs)
        case let .ordering(itemsInOrder):
            try container.encode(itemsInOrder, forKey: .itemsInOrder)
        }
    }
}

/// What the child answered. Carries the same `type` discriminator as the question it answers.
public enum AnswerResponse: Codable, Equatable, Sendable {
    case multipleChoice(choiceIndex: Int)
    case trueOrFalse(value: Bool)
    case freeAnswer(text: String)
    case matching(pairs: [Question.Pair])
    case ordering(items: [String])

    public var type: QuestionType {
        switch self {
        case .multipleChoice: return .multipleChoice
        case .trueOrFalse: return .trueOrFalse
        case .freeAnswer: return .freeAnswer
        case .matching: return .matching
        case .ordering: return .ordering
        }
    }

    private enum CodingKeys: String, CodingKey {
        case type, choiceIndex, value, text, pairs, items
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(QuestionType.self, forKey: .type) {
        case .multipleChoice:
            self = .multipleChoice(choiceIndex: try container.decode(Int.self, forKey: .choiceIndex))
        case .trueOrFalse:
            self = .trueOrFalse(value: try container.decode(Bool.self, forKey: .value))
        case .freeAnswer:
            self = .freeAnswer(text: try container.decode(String.self, forKey: .text))
        case .matching:
            self = .matching(pairs: try container.decode([Question.Pair].self, forKey: .pairs))
        case .ordering:
            self = .ordering(items: try container.decode([String].self, forKey: .items))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(type, forKey: .type)
        switch self {
        case let .multipleChoice(choiceIndex): try container.encode(choiceIndex, forKey: .choiceIndex)
        case let .trueOrFalse(value): try container.encode(value, forKey: .value)
        case let .freeAnswer(text): try container.encode(text, forKey: .text)
        case let .matching(pairs): try container.encode(pairs, forKey: .pairs)
        case let .ordering(items): try container.encode(items, forKey: .items)
        }
    }
}

/// How an answer was judged. « partiel » exists because telling a child who got half of it right that they were
/// simply wrong is both untrue and discouraging.
public enum Verdict: String, Codable, Equatable, Sendable {
    case correct
    case partial = "partiel"
    case incorrect
}

public struct Correction: Equatable, Sendable {
    public let verdict: Verdict
    /// Written for the child, in French, and never only « faux ».
    public let feedback: String

    public init(verdict: Verdict, feedback: String) {
        self.verdict = verdict
        self.feedback = feedback
    }
}

/// A set of questions about some pages of a book.
public struct Exercise: Codable, Equatable, Sendable, Identifiable {
    public enum Origin: String, Codable, Sendable {
        case ai, local
    }

    public let id: String
    public let childId: String
    public let documentId: String
    public let pageIndexes: [Int]
    public let questions: [Question]
    public let origin: Origin
    public let createdAt: Millis
    public var updatedAt: Millis
    @NullCodable public var deletedAt: Millis?

    public init(
        id: String, childId: String, documentId: String, pageIndexes: [Int], questions: [Question],
        origin: Origin, createdAt: Millis, updatedAt: Millis, deletedAt: Millis? = nil
    ) {
        self.id = id
        self.childId = childId
        self.documentId = documentId
        self.pageIndexes = pageIndexes
        self.questions = questions
        self.origin = origin
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }
}

/// How the child gave the answer, kept so a parent can see that writing is still hard even when the answers are right.
public enum InputMethod: String, Codable, Sendable {
    case touch = "toucher"
    case keyboard = "clavier"
    case handwriting = "ecriture"
    case dictation = "dictee"
}

public struct Answer: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let exerciseId: String
    public let questionId: String
    public let childId: String
    public var response: AnswerResponse
    public var inputMethod: InputMethod
    /// The handwritten answer, when there is one.
    @NullCodable public var inkAnnotationId: String?
    @NullCodable public var verdict: Verdict?
    @NullCodable public var feedback: String?
    @NullCodable public var correctedBy: Exercise.Origin?
    /// The passage to read again, given with a wrong answer.
    @NullCodable public var rereadRef: SourceRef?
    public let createdAt: Millis
    public var updatedAt: Millis

    public init(
        id: String, exerciseId: String, questionId: String, childId: String, response: AnswerResponse,
        inputMethod: InputMethod, inkAnnotationId: String? = nil, verdict: Verdict? = nil, feedback: String? = nil,
        correctedBy: Exercise.Origin? = nil, rereadRef: SourceRef? = nil, createdAt: Millis, updatedAt: Millis
    ) {
        self.id = id
        self.exerciseId = exerciseId
        self.questionId = questionId
        self.childId = childId
        self.response = response
        self.inputMethod = inputMethod
        self.inkAnnotationId = inkAnnotationId
        self.verdict = verdict
        self.feedback = feedback
        self.correctedBy = correctedBy
        self.rereadRef = rereadRef
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
