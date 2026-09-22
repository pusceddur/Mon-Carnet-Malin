import Foundation

/// §27 « Profils de lecture »: ready-made reading settings, chosen in one tap on the child profile and named after what
/// they do, never after a diagnosis. Ported from `client/src/features/parent/readingProfiles.ts`.
///
/// Every value stays adjustable one by one; a profile whose values were changed shows as « Personnalisé ». The colour
/// of the paper and the page / continuous layout are a matter of taste and never change with a profile.
public struct ReadingProfile: Equatable, Sendable, Identifiable {
    public enum ID: String, CaseIterable, Sendable {
        case confort, couleurs
        case grandesLettres = "grandes_lettres"
        case apprenti, concentration
    }

    public let id: ID
    public let emoji: String
    public let font: ReadingFont
    public let fontSizePx: Double
    public let lineHeight: Double
    public let letterSpacingEm: Double
    public let wordSpacingEm: Double
    public let columnWidthEm: Double
    public let sentenceHighlight: Bool
    public let readingGuide: Bool
    public let aids: ReadingAids
    public let rate: Double

    private static let noAids = ReadingAids.none
    private static let allAids = ReadingAids(
        syllables: true, silentLetters: true, sounds: true, changedLetters: true, liaisons: true
    )

    /// §31 The three a new reader is offered.
    ///
    /// A parent setting up a reader for the first time should not have to weigh five cards and a dozen sliders.
    /// Three are shown, as unlike each other as the five allow — plain text, text in colour, big and spaced — so the
    /// first choice is quick and obviously reversible. The rest is one tap away.
    public static let quickStart: [ID] = [.confort, .couleurs, .grandesLettres]

    public static let all: [ReadingProfile] = [
        // The settings of a new profile.
        ReadingProfile(
            id: .confort, emoji: "📖", font: .lexend, fontSizePx: 24, lineHeight: 1.8, letterSpacingEm: 0.04,
            wordSpacingEm: 0.16, columnWidthEm: 30, sentenceHighlight: true, readingGuide: false, aids: noAids,
            rate: 0.85
        ),
        // Decoding: syllables, silent letters, sounds and liaisons marked; more space between letters, words, lines.
        ReadingProfile(
            id: .couleurs, emoji: "🌈", font: .lexend, fontSizePx: 26, lineHeight: 2, letterSpacingEm: 0.08,
            wordSpacingEm: 0.3, columnWidthEm: 28, sentenceHighlight: true, readingGuide: false,
            aids: ReadingAids(syllables: true, silentLetters: true, sounds: true, changedLetters: false, liaisons: true),
            rate: 0.8
        ),
        // Letters that move or crowd: a font made to tell letters apart, large and widely spaced, short lines, ruler.
        ReadingProfile(
            id: .grandesLettres, emoji: "🔍", font: .atkinson, fontSizePx: 28, lineHeight: 2.2, letterSpacingEm: 0.12,
            wordSpacingEm: 0.4, columnWidthEm: 24, sentenceHighlight: true, readingGuide: true,
            aids: ReadingAids(syllables: true, silentLetters: true, sounds: false, changedLetters: false, liaisons: false),
            rate: 0.85
        ),
        // CP–CE1: the font of beginning readers, very large, every couleur de lecture, slow voice.
        ReadingProfile(
            id: .apprenti, emoji: "🌱", font: .andika, fontSizePx: 30, lineHeight: 2.2, letterSpacingEm: 0.08,
            wordSpacingEm: 0.36, columnWidthEm: 24, sentenceHighlight: true, readingGuide: false, aids: allAids,
            rate: 0.75
        ),
        // Short lines and the ruler keep the eyes on the line; no colours on the letters (less to look at).
        ReadingProfile(
            id: .concentration, emoji: "🎯", font: .lexend, fontSizePx: 26, lineHeight: 2, letterSpacingEm: 0.06,
            wordSpacingEm: 0.24, columnWidthEm: 26, sentenceHighlight: true, readingGuide: true, aids: noAids,
            rate: 0.9
        ),
    ]

    public static func profile(_ id: ID) -> ReadingProfile {
        all.first { $0.id == id }!
    }

    /// The settings with this profile's values; the paper, the layout and the other voice settings are kept.
    public func applied(to reading: ReadingPreferences, _ tts: TTSPreferences) -> (ReadingPreferences, TTSPreferences) {
        var reading = reading
        reading.font = font
        reading.fontSizePx = fontSizePx
        reading.lineHeight = lineHeight
        reading.letterSpacingEm = letterSpacingEm
        reading.wordSpacingEm = wordSpacingEm
        reading.columnWidthEm = columnWidthEm
        reading.sentenceHighlight = sentenceHighlight
        reading.readingGuide = readingGuide
        reading.aids = aids
        var tts = tts
        tts.rate = rate
        return (reading, tts)
    }

    /// The profile whose values these are; nil when they were adjusted one by one (« Personnalisé »).
    public static func matching(_ reading: ReadingPreferences, _ tts: TTSPreferences) -> ReadingProfile? {
        func same(_ a: Double, _ b: Double) -> Bool { abs(a - b) < 1e-6 }
        return all.first { profile in
            reading.font == profile.font && same(reading.fontSizePx, profile.fontSizePx)
                && same(reading.lineHeight, profile.lineHeight)
                && same(reading.letterSpacingEm, profile.letterSpacingEm)
                && same(reading.wordSpacingEm, profile.wordSpacingEm)
                && same(reading.columnWidthEm, profile.columnWidthEm)
                && reading.sentenceHighlight == profile.sentenceHighlight
                && reading.readingGuide == profile.readingGuide
                && same(tts.rate, profile.rate)
                && reading.aids == profile.aids
        }
    }
}
