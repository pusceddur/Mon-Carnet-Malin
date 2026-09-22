import Foundation

/// What the help can be asked to do. The raw values are the path segments of `POST /api/ai/:op`.
public enum AIOperation: String, Codable, CaseIterable, Sendable {
    case explainWord = "explain_word"
    case explainText = "explain_text"
    case simplifyText = "simplify_text"
    case summarize
    case generateQuestions = "generate_questions"
    case correctAnswer = "correct_answer"
    case questionOnText = "question_on_text"
    case recognizeHandwriting = "recognize_handwriting"
    case freeQuestion = "free_question"
    case correctWriting = "correct_writing"

    /// Never kept on the device: a handwriting image and its text, a question a child typed about anything at all,
    /// a text they asked to have corrected. The server answers or refuses every time, and keeps a trace for the
    /// parent every time — which a local copy would silently skip.
    public var isCachedLocally: Bool {
        switch self {
        case .recognizeHandwriting, .freeQuestion, .correctWriting: return false
        default: return true
        }
    }
}

public enum AIRoute: String, Codable, Sendable {
    case local, light, complex
}

/// The numbers the server enforces, repeated here so the app never sends something it knows will be refused.
/// Ported from `shared/src/constants.ts` (`LIMITS`, `TIMINGS`, `AI_DEADLINES`).
public enum AILimits {
    public static let chunkMaxChars = 6000
    public static let chunkTextMaxChars = 12000
    public static let explainTextMaxChars = 1200
    public static let selectionMaxChars = 4000
    public static let questionOnTextMaxChars = 200
    public static let freeQuestionMaxChars = 300
    public static let answerMaxChars = 1000
    public static let pagesMaxTotalChars = 200_000
    public static let wordMaxChars = 100
    public static let paragraphMaxChars = 8000
    public static let summarizeChunkParallelism = 2

    /// End-to-end deadlines of the two routes, in milliseconds.
    public static let lightDeadlineMs = 40_000
    public static let complexDeadlineMs = 170_000
    /// Added to a deadline on the client side, so the server always gets to answer « trop long » itself.
    public static let clientTimeoutMarginMs = 15_000
    public static let jobPollMs = 3_000
    /// Upper bound of a server-provided `waitMs` (the home computer can take a while, §17.4).
    public static let maxJobWaitMs = 15 * 60_000
    /// How long one poll may wait on the server for the answer to arrive.
    public static let jobHoldMs = 15_000

    /// Version of the prompts. Part of every cache key, so a better prompt never loses to an old cached answer.
    public static let promptVersion = "2026-09-16.1"
}

/// The sentences the child reads when the help cannot help. Ported word for word from `KID_MESSAGES`.
///
/// None of them says « erreur ». A child who asked what a word means and got an error message has learnt that asking
/// is risky; these say what happened and what they can still do.
public enum KidMessages {
    public static let notInText = "Je ne trouve pas cette information dans le texte."
    public static let blocked = "Je ne peux pas t'aider pour ce passage. Tu peux demander à un adulte."
    public static let adultRedirect = "Ce passage parle de choses difficiles. Parles-en avec un adulte de confiance. 💛"
    public static let offline = "Pas de connexion pour le moment. Tu peux continuer à lire et à écouter."
    public static let unavailable = "L'aide n'est pas disponible pour le moment. Tu peux continuer à lire."
    public static let quota = "Tu as beaucoup travaillé aujourd'hui ! L'aide revient demain."
    public static let budget = "Tu as beaucoup travaillé ce mois-ci ! L'aide revient bientôt."
    public static let strict = "Demande à un adulte de t'aider pour ce passage."
    public static let sourceWarning = "⚠️ Une partie du texte a peut-être été mal lue."
    public static let questionBlocked =
        "Je ne peux pas répondre à cette question. Tu peux en parler avec un adulte de confiance."
    public static let questionAdultRedirect =
        "Cette question est importante. Parles-en avec un adulte de confiance, il saura t’aider. 💛"
    public static let questionStrict = "Pour cette question, demande plutôt à un adulte."

    public static func forUnavailable(_ reason: AIUnavailableReason) -> String {
        switch reason {
        case .offline: return offline
        case .quota: return quota
        case .budget: return budget
        default: return unavailable
        }
    }

    static func forBlocked(_ operation: AIOperation, _ reason: AIBlockedReason) -> String {
        if operation == .freeQuestion {
            return reason == .adultRedirect ? questionAdultRedirect : questionBlocked
        }
        return reason == .adultRedirect ? adultRedirect : blocked
    }
}

// MARK: - Results

public enum AIBlockedReason: String, Codable, Sendable {
    case safetyInput = "safety_input"
    case safetyOutput = "safety_output"
    case validation
    case refusal
    case adultRedirect = "adult_redirect"
}

public enum AIUnavailableReason: String, Codable, Sendable {
    case aiDisabled = "ai_disabled"
    case featureDisabled = "feature_disabled"
    case quota
    case budget
    case offline
    case providerError = "provider_error"
    case notConfigured = "not_configured"
    case missingChunks = "missing_chunks"
    case timeout
    case payloadTooLarge = "payload_too_large"
    case busy

    /// Whether trying again in a moment has a chance of working. A parent who turned the help off has not changed
    /// their mind in the last ten seconds.
    public var isWorthRetrying: Bool {
        switch self {
        case .offline, .timeout, .busy, .providerError: return true
        default: return false
        }
    }
}

public struct AIMeta: Codable, Equatable, Sendable {
    public var cached: Bool
    public let route: AIRoute
    public let promptVersion: String
    /// Part of the text the answer relies on was read by a machine and may be wrong.
    public let sourceWarning: Bool
    public let requestId: String

    public init(cached: Bool, route: AIRoute, promptVersion: String, sourceWarning: Bool, requestId: String) {
        self.cached = cached
        self.route = route
        self.promptVersion = promptVersion
        self.sourceWarning = sourceWarning
        self.requestId = requestId
    }
}

/// What the help answered. Four outcomes, and the app has something to say for each of them.
public enum AIResult<Output: Sendable>: Sendable {
    case ok(Output, AIMeta)
    /// The answer is not in the text. Said plainly rather than invented.
    case notInText(message: String, meta: AIMeta)
    case blocked(reason: AIBlockedReason, message: String, meta: AIMeta)
    case unavailable(reason: AIUnavailableReason, message: String, missingChunkIndexes: [Int])

    /// The help could not answer, with the sentence the child is shown for that reason.
    public static func failed(_ reason: AIUnavailableReason) -> AIResult {
        .unavailable(reason: reason, message: KidMessages.forUnavailable(reason), missingChunkIndexes: [])
    }

    public var value: Output? {
        if case let .ok(value, _) = self { return value }
        return nil
    }

    public var meta: AIMeta? {
        switch self {
        case let .ok(_, meta), let .notInText(_, meta), let .blocked(_, _, meta): return meta
        case .unavailable: return nil
        }
    }

    /// The sentence to show the child when there is no answer to show.
    public var message: String? {
        switch self {
        case .ok: return nil
        case let .notInText(message, _), let .blocked(_, message, _), let .unavailable(_, message, _): return message
        }
    }

    public var isUnavailable: Bool {
        if case .unavailable = self { return true }
        return false
    }
}

// MARK: - Inputs

/// A page as it is sent to the help: its text, its hash, and whether a machine read it.
public struct AIPageInput: Codable, Equatable, Sendable {
    public let pageIndex: Int
    public let text: String
    public let contentHash: String
    public let ocrLowConfidence: Bool

    public init(pageIndex: Int, text: String, contentHash: String, ocrLowConfidence: Bool) {
        self.pageIndex = pageIndex
        self.text = text
        self.contentHash = contentHash
        self.ocrLowConfidence = ocrLowConfidence
    }

    /// The pages of a document, in order, stopping before `maxTotalChars`. The first page is always sent, cut if it
    /// has to be: a child asking about a very long page should get an answer about its beginning, not nothing.
    public static func from(
        _ pages: [PageContent], maxTotalChars: Int = AILimits.pagesMaxTotalChars
    ) -> (inputs: [AIPageInput], truncated: Bool) {
        var inputs: [AIPageInput] = []
        var total = 0
        for page in pages.sorted(by: { $0.pageIndex < $1.pageIndex }) where page.isReadable {
            let full = BlockBuilder.plainText(page.blocks)
            let units = Array(full.utf16)
            let room = maxTotalChars - total
            if units.count > room && !inputs.isEmpty { return (inputs, true) }
            let cut = units.count > room
            let text = cut ? String(decoding: units[0..<max(0, room)], as: UTF16.self) : full
            let hash = (!cut ? page.contentHash : nil)
                ?? Hashing.sha256Hex(TextNormalizer.normalizedForMatch(text))
            inputs.append(AIPageInput(
                pageIndex: page.pageIndex, text: text, contentHash: hash, ocrLowConfidence: page.isLowConfidence
            ))
            total += text.utf16.count
            if cut { return (inputs, true) }
        }
        return (inputs, false)
    }
}

extension PageContent {
    /// There is text on it that a child can read.
    public var isReadable: Bool {
        isAvailable && blocks.contains { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    public var isLowConfidence: Bool {
        status == .lowConfidence || warnings.contains(.lowConfidence)
    }
}

/// A piece of a book sent on its own for the progressive summary (§15.4).
public struct TextChunk: Codable, Equatable, Sendable {
    public let chunkIndex: Int
    public let pageIndexes: [Int]
    public let text: String
    public let contentHash: String

    public init(chunkIndex: Int, pageIndexes: [Int], text: String, contentHash: String) {
        self.chunkIndex = chunkIndex
        self.pageIndexes = pageIndexes
        self.text = text
        self.contentHash = contentHash
    }
}

public enum SummaryLevel: String, Codable, CaseIterable, Sendable {
    case short = "bref"
    case normal
    case detailed = "detaille"
}

// MARK: - Requests
//
// One type per operation, each knowing what it answers with. The fields and their names are the server's, and the
// JSON they produce is exactly what the web app sends: a request built here and one built in the browser must share a
// cache entry on the server, or the family pays twice for the same answer.

/// A request to the help.
public protocol AIRequest: Encodable, Sendable {
    associatedtype Output: Decodable & Sendable
    static var operation: AIOperation { get }
    var childId: String { get }
    /// How much text goes to the model, which decides which route it takes and so how long to wait for it.
    var inputChars: Int { get }
}

extension AIRequest {
    /// The route the server will most likely take, used only to decide how long to wait: the server decides.
    public var expectedRoute: AIRoute {
        switch Self.operation {
        case .explainWord, .correctAnswer, .recognizeHandwriting, .freeQuestion, .correctWriting:
            return .light
        case .explainText, .simplifyText:
            return inputChars <= AILimits.explainTextMaxChars ? .light : .complex
        case .summarize:
            return inputChars > 0 ? .light : .complex
        case .generateQuestions:
            return .complex
        case .questionOnText:
            return .light
        }
    }
}

public struct ExplainWordRequest: AIRequest {
    public typealias Output = ExplanationData
    public static let operation = AIOperation.explainWord

    public let childId: String
    @NullCodable public private(set) var documentId: String?
    @NullCodable public private(set) var documentHash: String?
    public let word: String
    public let sentence: String
    public let paragraph: String
    public let pageIndex: Int
    public let ocrLowConfidence: Bool

    public init(
        childId: String, documentId: String?, documentHash: String?, word: String, sentence: String,
        paragraph: String, pageIndex: Int, ocrLowConfidence: Bool
    ) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.word = AIText.clip(word, AILimits.wordMaxChars)
        self.sentence = AIText.clip(sentence, AILimits.selectionMaxChars)
        self.paragraph = AIText.clip(paragraph, AILimits.paragraphMaxChars)
        self.pageIndex = pageIndex
        self.ocrLowConfidence = ocrLowConfidence
    }

    public var inputChars: Int { word.utf16.count }
}

public struct ExplainTextRequest: AIRequest {
    public typealias Output = ExplanationData
    public static let operation = AIOperation.explainText

    public let childId: String
    @NullCodable public private(set) var documentId: String?
    @NullCodable public private(set) var documentHash: String?
    public let text: String
    public let paragraph: String
    public let pageIndex: Int
    public let ocrLowConfidence: Bool

    public init(
        childId: String, documentId: String?, documentHash: String?, text: String, paragraph: String,
        pageIndex: Int, ocrLowConfidence: Bool
    ) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.text = AIText.clip(text, AILimits.selectionMaxChars)
        self.paragraph = AIText.clip(paragraph, AILimits.paragraphMaxChars)
        self.pageIndex = pageIndex
        self.ocrLowConfidence = ocrLowConfidence
    }

    public var inputChars: Int { text.utf16.count }
}

public struct SimplifyTextRequest: AIRequest {
    public typealias Output = SimplifyData
    public static let operation = AIOperation.simplifyText

    public let childId: String
    @NullCodable public private(set) var documentId: String?
    @NullCodable public private(set) var documentHash: String?
    public let text: String
    public let pageIndex: Int
    public let ocrLowConfidence: Bool

    public init(
        childId: String, documentId: String?, documentHash: String?, text: String, pageIndex: Int,
        ocrLowConfidence: Bool
    ) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.text = AIText.clip(text, AILimits.selectionMaxChars)
        self.pageIndex = pageIndex
        self.ocrLowConfidence = ocrLowConfidence
    }

    public var inputChars: Int { text.utf16.count }
}

/// One stage of the progressive summary. On the wire both are `summarize`; they differ by what they answer.
public struct SummarizeChunkRequest: AIRequest {
    public typealias Output = ChunkSummaryData
    public static let operation = AIOperation.summarize

    public let childId: String
    public let documentId: String?
    public let documentHash: String?
    public let level: SummaryLevel
    public let planHash: String
    public let chunk: TextChunk
    public let ocrLowConfidence: Bool

    public init(
        childId: String, documentId: String?, documentHash: String?, level: SummaryLevel, planHash: String,
        chunk: TextChunk, ocrLowConfidence: Bool
    ) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.level = level
        self.planHash = planHash
        self.chunk = chunk
        self.ocrLowConfidence = ocrLowConfidence
    }

    public var inputChars: Int { chunk.text.utf16.count }

    private enum CodingKeys: String, CodingKey {
        case childId, documentId, documentHash, level, stage, ocrLowConfidence
    }

    private enum StageKeys: String, CodingKey {
        case kind, planHash, chunk
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(childId, forKey: .childId)
        try container.encode(documentId, forKey: .documentId)
        try container.encode(documentHash, forKey: .documentHash)
        try container.encode(level, forKey: .level)
        try container.encode(ocrLowConfidence, forKey: .ocrLowConfidence)
        var stage = container.nestedContainer(keyedBy: StageKeys.self, forKey: .stage)
        try stage.encode("chunk", forKey: .kind)
        try stage.encode(planHash, forKey: .planHash)
        try stage.encode(chunk, forKey: .chunk)
    }
}

public struct SummarizeFinalRequest: AIRequest {
    public typealias Output = SummaryData
    public static let operation = AIOperation.summarize

    public let childId: String
    public let documentId: String?
    public let documentHash: String?
    public let level: SummaryLevel
    public let planHash: String
    public let chunkCount: Int
    public let ocrLowConfidence: Bool

    public init(
        childId: String, documentId: String?, documentHash: String?, level: SummaryLevel, planHash: String,
        chunkCount: Int, ocrLowConfidence: Bool
    ) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.level = level
        self.planHash = planHash
        self.chunkCount = chunkCount
        self.ocrLowConfidence = ocrLowConfidence
    }

    /// The final stage sends no text: the server reads the chunk summaries from its own cache.
    public var inputChars: Int { 0 }

    private enum CodingKeys: String, CodingKey {
        case childId, documentId, documentHash, level, stage, ocrLowConfidence
    }

    private enum StageKeys: String, CodingKey {
        case kind, planHash, chunkCount
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(childId, forKey: .childId)
        try container.encode(documentId, forKey: .documentId)
        try container.encode(documentHash, forKey: .documentHash)
        try container.encode(level, forKey: .level)
        try container.encode(ocrLowConfidence, forKey: .ocrLowConfidence)
        var stage = container.nestedContainer(keyedBy: StageKeys.self, forKey: .stage)
        try stage.encode("final", forKey: .kind)
        try stage.encode(planHash, forKey: .planHash)
        try stage.encode(chunkCount, forKey: .chunkCount)
    }
}

public struct GenerateQuestionsRequest: AIRequest {
    public typealias Output = QuestionsData
    public static let operation = AIOperation.generateQuestions

    public let childId: String
    @NullCodable public private(set) var documentId: String?
    @NullCodable public private(set) var documentHash: String?
    /// 3, 5 or 10 — the server refuses anything else.
    public let count: Int
    public let types: [QuestionType]
    public let pages: [AIPageInput]

    public init(
        childId: String, documentId: String?, documentHash: String?, count: Int, types: [QuestionType],
        pages: [AIPageInput]
    ) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.count = [3, 5, 10].min(by: { abs($0 - count) < abs($1 - count) }) ?? 5
        self.types = types
        self.pages = pages
    }

    public var inputChars: Int { pages.reduce(0) { $0 + $1.text.utf16.count } }
}

public struct CorrectAnswerRequest: AIRequest {
    public typealias Output = CorrectionData
    public static let operation = AIOperation.correctAnswer

    public let childId: String
    @NullCodable public private(set) var documentId: String?
    @NullCodable public private(set) var documentHash: String?
    /// Always a free-answer question: the closed ones are judged on the device.
    public let question: Question
    public let answerText: String
    public let pages: [AIPageInput]

    public init(
        childId: String, documentId: String?, documentHash: String?, question: Question, answerText: String,
        pages: [AIPageInput]
    ) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.question = question
        self.answerText = AIText.clip(answerText.trimmingCharacters(in: .whitespacesAndNewlines), AILimits.answerMaxChars)
        self.pages = pages
    }

    public var inputChars: Int { answerText.utf16.count }
}

public struct QuestionOnTextRequest: AIRequest {
    public typealias Output = QuestionOnTextData
    public static let operation = AIOperation.questionOnText

    public let childId: String
    @NullCodable public private(set) var documentId: String?
    @NullCodable public private(set) var documentHash: String?
    public let question: String
    public let pages: [AIPageInput]

    public init(childId: String, documentId: String?, documentHash: String?, question: String, pages: [AIPageInput]) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.question = AIText.clip(
            question.trimmingCharacters(in: .whitespacesAndNewlines), AILimits.questionOnTextMaxChars
        )
        self.pages = pages
    }

    public var inputChars: Int { pages.reduce(0) { $0 + $1.text.utf16.count } }
}

/// §18 « Pose ta question »: a question about anything, not tied to a book.
public struct FreeQuestionRequest: AIRequest {
    public typealias Output = FreeQuestionData
    public static let operation = AIOperation.freeQuestion

    public enum Mode: String, Codable, Sendable {
        case normal
        /// « Je n’ai pas compris »: the same question, answered more simply.
        case simpler
    }

    public struct Exchange: Codable, Equatable, Sendable {
        public let question: String
        public let answer: String

        public init(question: String, answer: String) {
            self.question = question
            self.answer = answer
        }
    }

    public let childId: String
    public let question: String
    /// The last exchange, so « et pourquoi ? » means something.
    public let previous: Exchange?
    public let mode: Mode

    public init(childId: String, question: String, previous: Exchange?, mode: Mode) {
        self.childId = childId
        self.question = AIText.clip(
            question.trimmingCharacters(in: .whitespacesAndNewlines), AILimits.freeQuestionMaxChars
        )
        self.previous = previous
        self.mode = mode
    }

    public var inputChars: Int { question.utf16.count }

    private enum CodingKeys: String, CodingKey {
        case childId, documentId, documentHash, question, previous, mode
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(childId, forKey: .childId)
        // Always null, and always present: the server reads the absence of a book as a fact, not as a missing field.
        try container.encodeNil(forKey: .documentId)
        try container.encodeNil(forKey: .documentHash)
        try container.encode(question, forKey: .question)
        try container.encode(previous, forKey: .previous)
        try container.encode(mode, forKey: .mode)
    }
}

/// §24 « Corriger »: spelling, grammar and punctuation of a child's own text, keeping their words and meaning.
public struct CorrectWritingRequest: AIRequest {
    public typealias Output = CorrectWritingData
    public static let operation = AIOperation.correctWriting

    public let childId: String
    @NullCodable public private(set) var documentId: String?
    @NullCodable public private(set) var documentHash: String?
    public let text: String
    @NullCodable public private(set) var annotationId: String?
    @NullCodable public private(set) var pageIndex: Int?

    public init(
        childId: String, documentId: String?, documentHash: String?, text: String, annotationId: String?,
        pageIndex: Int?
    ) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.text = text
        self.annotationId = annotationId
        self.pageIndex = pageIndex
    }

    public var inputChars: Int { text.utf16.count }
}

public struct RecognizeHandwritingRequest: AIRequest {
    public typealias Output = HandwritingData
    public static let operation = AIOperation.recognizeHandwriting

    public let childId: String
    @NullCodable public private(set) var documentId: String?
    @NullCodable public private(set) var documentHash: String?
    public let imagePngBase64: String

    public init(childId: String, documentId: String?, documentHash: String?, imagePngBase64: String) {
        self.childId = childId
        self.documentId = documentId
        self.documentHash = documentHash
        self.imagePngBase64 = imagePngBase64
    }

    public var inputChars: Int { 0 }
}

// MARK: - Answers

public struct ExplanationData: Codable, Equatable, Sendable {
    public let explanation: String
    public let example: String?
    public let sourceQuotes: [String]
}

public struct SimplifyData: Codable, Equatable, Sendable {
    public let simplifiedText: String
}

public struct SummaryData: Codable, Equatable, Sendable {
    public let summary: String
    public let keyPoints: [String]
    public let sourceRefs: [SourceRef]
}

public struct ChunkSummaryData: Codable, Equatable, Sendable {
    public let chunkIndex: Int
    public let summary: String
    public let keyQuotes: [SourceRef]
}

public struct QuestionsData: Codable, Equatable, Sendable {
    public let questions: [Question]

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // One question this version cannot read must not cost the child the nine others.
        let raw = try container.decode([LossyQuestion].self, forKey: .questions)
        questions = raw.compactMap(\.question)
    }

    public init(questions: [Question]) {
        self.questions = questions
    }

    private enum CodingKeys: String, CodingKey { case questions }

    private struct LossyQuestion: Decodable {
        let question: Question?
        init(from decoder: Decoder) throws {
            question = try? Question(from: decoder)
        }
    }
}

public struct CorrectionData: Codable, Equatable, Sendable {
    public let verdict: Verdict
    public let feedback: String
    public let rereadRef: SourceRef?
}

public struct QuestionOnTextData: Codable, Equatable, Sendable {
    public let answer: String
    public let sourceRefs: [SourceRef]
}

public struct HandwritingData: Codable, Equatable, Sendable {
    public let text: String
}

public struct FreeQuestionData: Codable, Equatable, Sendable {
    public let answer: String
    public let example: String?
    /// Up to three short follow-up questions, offered as buttons so a child who cannot type fast can keep going.
    public let suggestions: [String]
}

public enum WritingChangeKind: String, Codable, Sendable {
    case accent
    case spelling = "orthographe"
    case grammar = "grammaire"
    /// §24: the words that build the sentence changed — « je suis été » became « j'ai été ». Told apart from
    /// `grammar` because the child hears about it in so many words, and an adult should always read it themselves.
    case construction
    case punctuation = "ponctuation"
    case capital = "majuscule"
    case space = "espace"
}

public struct WritingChange: Codable, Equatable, Sendable {
    public let line: Int
    public let from: String
    public let to: String
    public let kind: WritingChangeKind
    /// A short explanation for the adult, never shown to the child as a mark against them.
    public let rule: String?
}

public struct CorrectWritingData: Codable, Equatable, Sendable {
    public let correctedText: String
    public let changes: [WritingChange]
}

enum AIText {
    /// Cut to a maximum length in UTF-16 units, never inside a character.
    static func clip(_ text: String, _ max: Int) -> String {
        let units = Array(text.utf16)
        guard units.count > max else { return text }
        var end = max
        if end > 0, end < units.count, (0xDC00...0xDFFF).contains(units[end]) { end -= 1 }
        return String(decoding: units[0..<end], as: UTF16.self)
    }
}
