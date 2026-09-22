import Foundation

/// What the parent decided the app may do (§15.10). Ported from `shared/src/types/settings.ts`.
///
/// Read by the app to know which kinds of help to offer at all: a button the parent switched off is not shown, rather
/// than shown and then refused. A child pressing « Explique » and reading « pas disponible » every time learns that
/// the button lies.
public struct ParentSettings: Codable, Equatable, Sendable {
    public struct AI: Codable, Equatable, Sendable {
        public struct Features: Codable, Equatable, Sendable {
            public var explainWord: Bool
            public var explainText: Bool
            public var simplify: Bool
            public var summarize: Bool
            public var questions: Bool
            public var correctAnswers: Bool
            public var questionOnText: Bool
            /// §18 « Pose ta question ».
            public var freeQuestion: Bool
            /// §24 « Corriger » in the text boxes.
            public var correctWriting: Bool

            public static let all = Features(
                explainWord: true, explainText: true, simplify: true, summarize: true, questions: true,
                correctAnswers: true, questionOnText: true, freeQuestion: true, correctWriting: true
            )

            public init(
                explainWord: Bool, explainText: Bool, simplify: Bool, summarize: Bool, questions: Bool,
                correctAnswers: Bool, questionOnText: Bool, freeQuestion: Bool, correctWriting: Bool
            ) {
                self.explainWord = explainWord
                self.explainText = explainText
                self.simplify = simplify
                self.summarize = summarize
                self.questions = questions
                self.correctAnswers = correctAnswers
                self.questionOnText = questionOnText
                self.freeQuestion = freeQuestion
                self.correctWriting = correctWriting
            }
        }

        public var enabled: Bool
        public var features: Features
        public var dailyRequestLimitPerChild: Int
        public var monthlyBudgetEur: Double
        /// When off, the long route is not taken: a summary of a whole book is refused rather than paid for.
        public var allowComplexModel: Bool
        public var deepQuestions: Bool
        public var handwritingRecognition: Bool

        public init(
            enabled: Bool, features: Features, dailyRequestLimitPerChild: Int, monthlyBudgetEur: Double,
            allowComplexModel: Bool, deepQuestions: Bool, handwritingRecognition: Bool
        ) {
            self.enabled = enabled
            self.features = features
            self.dailyRequestLimitPerChild = dailyRequestLimitPerChild
            self.monthlyBudgetEur = monthlyBudgetEur
            self.allowComplexModel = allowComplexModel
            self.deepQuestions = deepQuestions
            self.handwritingRecognition = handwritingRecognition
        }
    }

    public struct OCR: Codable, Equatable, Sendable {
        public var autoServerFallback: Bool
        public var lowConfidenceThreshold: Double
        /// §17: pages the device could not read are sent to the home computer.
        public var aiTranscription: Bool

        public init(autoServerFallback: Bool, lowConfidenceThreshold: Double, aiTranscription: Bool) {
            self.autoServerFallback = autoServerFallback
            self.lowConfidenceThreshold = lowConfidenceThreshold
            self.aiTranscription = aiTranscription
        }
    }

    public struct Privacy: Codable, Equatable, Sendable {
        public var syncAnnotations: Bool
        public var syncDocumentText: Bool
        public var uploadPageImages: Bool
        public var uploadOriginals: Bool

        public init(syncAnnotations: Bool, syncDocumentText: Bool, uploadPageImages: Bool, uploadOriginals: Bool) {
            self.syncAnnotations = syncAnnotations
            self.syncDocumentText = syncDocumentText
            self.uploadPageImages = uploadPageImages
            self.uploadOriginals = uploadOriginals
        }
    }

    public enum SafetyLevel: String, Codable, CaseIterable, Sendable {
        case standard, strict
    }

    public struct Safety: Codable, Equatable, Sendable {
        public var level: SafetyLevel

        public init(level: SafetyLevel) { self.level = level }
    }

    public struct Reader: Codable, Equatable, Sendable {
        /// When off, a selection grows by whole words only; when on, the child can drag anywhere.
        public var freeSelection: Bool

        public init(freeSelection: Bool) { self.freeSelection = freeSelection }
    }

    public var ai: AI
    public var ocr: OCR
    public var privacy: Privacy
    public var safety: Safety
    public var reader: Reader
    public var updatedAt: Millis

    public init(ai: AI, ocr: OCR, privacy: Privacy, safety: Safety, reader: Reader, updatedAt: Millis) {
        self.ai = ai
        self.ocr = ocr
        self.privacy = privacy
        self.safety = safety
        self.reader = reader
        self.updatedAt = updatedAt
    }

    /// `DEFAULT_PARENT_SETTINGS`: what a new family starts with, and what the app assumes when it cannot ask.
    public static let standard = ParentSettings(
        ai: AI(
            enabled: true, features: .all, dailyRequestLimitPerChild: 60, monthlyBudgetEur: 10,
            allowComplexModel: true, deepQuestions: false, handwritingRecognition: false
        ),
        ocr: OCR(autoServerFallback: true, lowConfidenceThreshold: 70, aiTranscription: true),
        privacy: Privacy(syncAnnotations: true, syncDocumentText: true, uploadPageImages: true, uploadOriginals: false),
        safety: Safety(level: .standard),
        reader: Reader(freeSelection: false),
        updatedAt: 0
    )

    /// Whether the help may be asked for this at all.
    public func allows(_ operation: AIOperation) -> Bool {
        guard ai.enabled else { return false }
        switch operation {
        case .explainWord: return ai.features.explainWord
        case .explainText: return ai.features.explainText
        case .simplifyText: return ai.features.simplify
        case .summarize: return ai.features.summarize
        case .generateQuestions: return ai.features.questions
        case .correctAnswer: return ai.features.correctAnswers
        case .questionOnText: return ai.features.questionOnText
        case .recognizeHandwriting: return ai.handwritingRecognition
        case .freeQuestion: return ai.features.freeQuestion
        case .correctWriting: return ai.features.correctWriting
        }
    }
}

extension APIClient {
    /// `GET /api/settings`.
    public func settings() async throws -> ParentSettings {
        let data = try await performRaw(method: "GET", path: "/api/settings", body: nil, contentType: nil, timeout: 20)
        do {
            return try JSONDecoder().decode(ParentSettings.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }

    /// `PUT /api/settings`. Needs the adult area open; the server answers the settings as it stored them.
    public func saveSettings(_ settings: ParentSettings) async throws -> ParentSettings {
        let body = try JSONEncoder().encode(settings)
        let data = try await performRaw(
            method: "PUT", path: "/api/settings", body: body, contentType: "application/json", timeout: 20
        )
        do {
            return try JSONDecoder().decode(ParentSettings.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }
}
