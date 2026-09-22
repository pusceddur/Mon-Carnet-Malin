@testable import CarnetKit
import XCTest

final class ReadingProfileTests: XCTestCase {
    func testANewProfileIsTheComfortableOne() {
        XCTAssertEqual(ReadingProfile.matching(.standard, .standard)?.id, .confort)
    }

    func testApplyingKeepsThePaperTheLayoutAndTheOtherVoiceSettings() {
        var reading = ReadingPreferences.standard
        reading.theme = .sombre
        reading.layoutMode = .continu
        var tts = TTSPreferences.standard
        tts.pitch = 1.1
        tts.sentencePauseMs = 600

        let (applied, voice) = ReadingProfile.profile(.apprenti).applied(to: reading, tts)
        XCTAssertEqual(applied.theme, .sombre)
        XCTAssertEqual(applied.layoutMode, .continu)
        XCTAssertEqual(applied.font, .andika)
        XCTAssertEqual(applied.fontSizePx, 30)
        XCTAssertTrue(applied.aids.liaisons)
        XCTAssertEqual(voice.rate, 0.75)
        XCTAssertEqual(voice.pitch, 1.1)
        XCTAssertEqual(voice.sentencePauseMs, 600)
        XCTAssertEqual(ReadingProfile.matching(applied, voice)?.id, .apprenti)
    }

    func testEveryProfileIsRecognisedAfterBeingApplied() {
        for profile in ReadingProfile.all {
            let (reading, tts) = profile.applied(to: .standard, .standard)
            XCTAssertEqual(ReadingProfile.matching(reading, tts)?.id, profile.id, profile.id.rawValue)
        }
    }

    func testOneChangedValueMakesItPersonal() {
        var (reading, tts) = ReadingProfile.profile(.couleurs).applied(to: .standard, .standard)
        reading.aids.changedLetters = true
        XCTAssertNil(ReadingProfile.matching(reading, tts))
        reading.aids.changedLetters = false
        tts.rate = 0.95
        XCTAssertNil(ReadingProfile.matching(reading, tts))
    }

    func testTheIdsAreTheWebOnes() {
        XCTAssertEqual(
            ReadingProfile.ID.allCases.map(\.rawValue),
            ["confort", "couleurs", "grandes_lettres", "apprenti", "concentration"]
        )
    }
}
