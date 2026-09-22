import Foundation

/// The domain of the app, mirroring `shared/src/types/domain.ts`. The names match the JSON the server already sends,
/// so `Codable` needs no key mapping: anything renamed here would silently stop decoding.
///
/// Times are milliseconds since the epoch, as everywhere else in the app.
public typealias Millis = Int64

public struct ParentUser: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let email: String
    public let displayName: String
    public let createdAt: Millis
    /// The account that manages invitations (the first one of the server).
    public let isOwner: Bool

    public init(id: String, email: String, displayName: String, createdAt: Millis, isOwner: Bool) {
        self.id = id
        self.email = email
        self.displayName = displayName
        self.createdAt = createdAt
        self.isOwner = isOwner
    }
}

public enum ReadingLevel: String, Codable, CaseIterable, Sendable {
    case debutant, intermediaire, avance
}

public enum ExplanationDifficulty: String, Codable, CaseIterable, Sendable {
    case tresSimple = "tres_simple"
    case simple
    case normal
}

public enum ReadingFont: String, Codable, CaseIterable, Sendable {
    case lexend, andika, atkinson, opendyslexic, systeme
}

public enum ReadingTheme: String, Codable, CaseIterable, Sendable {
    case creme, clair, sombre
}

/// §31 the set of colours the app draws with, on top of the paper colour.
///
/// `separees` replaces every pair that asks you to tell red from green with blue and orange, which stay different
/// for everyone; about one boy in twelve cannot see the first pair apart, and §26 leans on colour more than anything
/// else in the app. `contraste` darkens the text and thickens the lines instead. Named for what they do.
public enum ReadingPalette: String, Codable, CaseIterable, Sendable {
    case standard, separees, contraste
}

public enum LayoutMode: String, Codable, CaseIterable, Sendable {
    case page, continu
}

/// §26 « Couleurs de lecture »: the marks drawn on the text, each one on or off.
public struct ReadingAids: Codable, Equatable, Sendable {
    /// Syllables in two alternating colours.
    public var syllables: Bool
    /// Silent letters in light grey.
    public var silentLetters: Bool
    /// Letters making one sound together, on a coloured background.
    public var sounds: Bool
    /// Letters that do not make their usual sound, underlined with dots.
    public var changedLetters: Bool
    /// Arc joining the words of a liaison.
    public var liaisons: Bool

    public static let none = ReadingAids(syllables: false, silentLetters: false, sounds: false, changedLetters: false, liaisons: false)

    public init(syllables: Bool, silentLetters: Bool, sounds: Bool, changedLetters: Bool, liaisons: Bool) {
        self.syllables = syllables
        self.silentLetters = silentLetters
        self.sounds = sounds
        self.changedLetters = changedLetters
        self.liaisons = liaisons
    }
}

/// Comfort of the text for one child. The ranges are the ones the parent settings enforce (`PREFERENCE_RANGES`).
public struct ReadingPreferences: Codable, Equatable, Sendable {
    public var font: ReadingFont
    /// 16...44
    public var fontSizePx: Double
    /// 1.2...2.6
    public var lineHeight: Double
    /// 0...0.3, in em
    public var letterSpacingEm: Double
    /// 0...0.8, in em
    public var wordSpacingEm: Double
    /// 18...48, in em
    public var columnWidthEm: Double
    public var theme: ReadingTheme
    /// §31, default `.standard`.
    public var palette: ReadingPalette
    public var layoutMode: LayoutMode
    public var sentenceHighlight: Bool
    /// Reading ruler.
    public var readingGuide: Bool
    public var aids: ReadingAids

    public static let standard = ReadingPreferences(
        font: .lexend, fontSizePx: 24, lineHeight: 1.8, letterSpacingEm: 0.04, wordSpacingEm: 0.16,
        columnWidthEm: 30, theme: .creme, palette: .standard, layoutMode: .page, sentenceHighlight: true,
        readingGuide: false, aids: .none
    )

    public init(
        font: ReadingFont, fontSizePx: Double, lineHeight: Double, letterSpacingEm: Double, wordSpacingEm: Double,
        columnWidthEm: Double, theme: ReadingTheme, palette: ReadingPalette = .standard, layoutMode: LayoutMode,
        sentenceHighlight: Bool, readingGuide: Bool, aids: ReadingAids
    ) {
        self.font = font
        self.fontSizePx = fontSizePx
        self.lineHeight = lineHeight
        self.letterSpacingEm = letterSpacingEm
        self.wordSpacingEm = wordSpacingEm
        self.columnWidthEm = columnWidthEm
        self.theme = theme
        self.palette = palette
        self.layoutMode = layoutMode
        self.sentenceHighlight = sentenceHighlight
        self.readingGuide = readingGuide
        self.aids = aids
    }

    /// Reads a profile written by an older version, or by a server that does not know a setting yet.
    ///
    /// Swift's own decoder refuses a row with a key missing, even when the property has a default. A child's reading
    /// settings are the last thing that should stop the app from opening, so every field falls back to the standard
    /// one instead — and a profile saved before §31 simply reads as « couleurs habituelles ».
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let d = ReadingPreferences.standard
        font = try container.decodeIfPresent(ReadingFont.self, forKey: .font) ?? d.font
        fontSizePx = try container.decodeIfPresent(Double.self, forKey: .fontSizePx) ?? d.fontSizePx
        lineHeight = try container.decodeIfPresent(Double.self, forKey: .lineHeight) ?? d.lineHeight
        letterSpacingEm = try container.decodeIfPresent(Double.self, forKey: .letterSpacingEm) ?? d.letterSpacingEm
        wordSpacingEm = try container.decodeIfPresent(Double.self, forKey: .wordSpacingEm) ?? d.wordSpacingEm
        columnWidthEm = try container.decodeIfPresent(Double.self, forKey: .columnWidthEm) ?? d.columnWidthEm
        theme = try container.decodeIfPresent(ReadingTheme.self, forKey: .theme) ?? d.theme
        palette = try container.decodeIfPresent(ReadingPalette.self, forKey: .palette) ?? d.palette
        layoutMode = try container.decodeIfPresent(LayoutMode.self, forKey: .layoutMode) ?? d.layoutMode
        sentenceHighlight = try container.decodeIfPresent(Bool.self, forKey: .sentenceHighlight) ?? d.sentenceHighlight
        readingGuide = try container.decodeIfPresent(Bool.self, forKey: .readingGuide) ?? d.readingGuide
        aids = try container.decodeIfPresent(ReadingAids.self, forKey: .aids) ?? d.aids
    }
}

/// The voice itself is chosen per device, not per child: only its shape is stored here.
public struct TTSPreferences: Codable, Equatable, Sendable {
    /// 0.5...1.5
    public var rate: Double
    /// 0.8...1.2
    public var pitch: Double
    /// Silence after each sentence, 0...1500 ms.
    public var sentencePauseMs: Int
    /// Silence when the next sentence starts a new paragraph, 0...3000 ms.
    public var paragraphPauseMs: Int

    public static let standard = TTSPreferences(rate: 0.85, pitch: 1, sentencePauseMs: 250, paragraphPauseMs: 700)

    public init(rate: Double, pitch: Double, sentencePauseMs: Int, paragraphPauseMs: Int) {
        self.rate = rate
        self.pitch = pitch
        self.sentencePauseMs = sentencePauseMs
        self.paragraphPauseMs = paragraphPauseMs
    }
}

// `QuestionType` lives with the exercises, in `Exercises/ExerciseTypes.swift`.

public struct ExercisePreferences: Codable, Equatable, Sendable {
    /// 3, 5 or 10.
    public var defaultQuestionCount: Int
    public var enabledTypes: [QuestionType]

    public static let standard = ExercisePreferences(defaultQuestionCount: 5, enabledTypes: QuestionType.allCases)

    public init(defaultQuestionCount: Int, enabledTypes: [QuestionType]) {
        self.defaultQuestionCount = defaultQuestionCount
        self.enabledTypes = enabledTypes
    }
}

public struct ChildProfile: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let parentId: String
    /// §32 What the reader is called in the app: a nickname, chosen freely, 1...40 characters.
    ///
    /// Not a first name, and no date of birth beside it. A reading app does not need to know who a child is to help
    /// them read, and what it does not hold cannot leak, be asked for, or be sent anywhere.
    public var nickname: String
    /// Emoji.
    public var avatar: String
    public var readingLevel: ReadingLevel
    public var explanationDifficulty: ExplanationDifficulty
    public var reading: ReadingPreferences
    public var tts: TTSPreferences
    public var exercises: ExercisePreferences
    public let createdAt: Millis
    public var updatedAt: Millis
    /// Set when the profile was removed; the row stays until the server purges it.
    @NullCodable public var deletedAt: Millis?

    public var isDeleted: Bool { deletedAt != nil }

    public init(
        id: String, parentId: String, nickname: String, avatar: String, readingLevel: ReadingLevel,
        explanationDifficulty: ExplanationDifficulty, reading: ReadingPreferences, tts: TTSPreferences,
        exercises: ExercisePreferences, createdAt: Millis, updatedAt: Millis, deletedAt: Millis? = nil
    ) {
        self.id = id
        self.parentId = parentId
        self.nickname = nickname
        self.avatar = avatar
        self.readingLevel = readingLevel
        self.explanationDifficulty = explanationDifficulty
        self.reading = reading
        self.tts = tts
        self.exercises = exercises
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }
}

public enum DocumentKind: String, Codable, CaseIterable, Sendable {
    case pdf, images, epub
}

/// `faithful`: the text as printed. `punctuated`: a text written by a child, where only punctuation is restored.
public enum DocumentTextMode: String, Codable, CaseIterable, Sendable {
    case faithful, punctuated
}

public enum DocumentPurpose: String, Codable, CaseIterable, Sendable {
    case reading, homework
}

/// `partial`: some pages failed or are doubtful.
public enum DocumentStatus: String, Codable, CaseIterable, Sendable {
    case processing, ready, partial
}

public enum PageStatus: String, Codable, CaseIterable, Sendable {
    case pending, processing, ready
    case lowConfidence = "low_confidence"
    case failed
}

public enum PageTextSource: String, Codable, CaseIterable, Sendable {
    case pdfText = "pdf-text"
    case ocrLocal = "ocr-local"
    case ocrServer = "ocr-server"
    case manual
    case epubText = "epub-text"
    /// Transcribed from the page image by the external worker.
    case ocrAi = "ocr-ai"
}

public enum PageWarning: String, Codable, CaseIterable, Sendable {
    case lowConfidence = "low_confidence"
    case serverFallbackUsed = "server_fallback_used"
    case manuallyCorrected = "manually_corrected"
    case suspiciousInstructions = "suspicious_instructions"
    case noTextFound = "no_text_found"
    /// No on-device or server reading yet: the page image waits for the worker.
    case awaitingAi = "awaiting_ai"
}

/// One block of a page: a title or a paragraph. `spoken` is the form read aloud when it differs from the printed one.
public struct TextBlock: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        case title, paragraph
    }

    public var kind: Kind
    public var text: String
    public var spoken: String?

    public init(kind: Kind, text: String, spoken: String? = nil) {
        self.kind = kind
        self.text = text
        self.spoken = spoken
    }
}
