import XCTest
@testable import CarnetKit

/// §26 « Couleurs de lecture » as the reader draws them, and the layout of the text for one child.
final class ReadingAidsTests: XCTestCase {
    private let allOff = ReadingAids.none
    private func aids(_ change: (inout ReadingAids) -> Void) -> ReadingAids {
        var value = ReadingAids.none
        change(&value)
        return value
    }

    private func runs(_ text: String, _ aids: ReadingAids) -> [AidRun] {
        ReadingAidsModel.build(text: text, aids: aids).runs
    }

    func testNothingIsBuiltWhenEveryAidIsOff() {
        let built = ReadingAidsModel.build(text: "Le chat dort.", aids: allOff)
        XCTAssertTrue(built.isEmpty, "the reader must be able to skip the whole attributed path")
        XCTAssertFalse(ReadingAidsModel.isOn(allOff))
    }

    func testSilentLettersAreMarkedAndOnlyThem() {
        // « dort » ends on a silent t.
        let marked = runs("Le chat dort", aids { $0.silentLetters = true })
        XCTAssertFalse(marked.isEmpty)
        for run in marked {
            XCTAssertTrue(run.style.isSilent)
            XCTAssertNil(run.style.syllableParity, "only the aid that was switched on may appear")
            XCTAssertFalse(run.style.isSoundGroup)
        }
    }

    func testSyllablesAlternateSoTheCutIsVisible() {
        let marked = runs("photosynthèse", aids { $0.syllables = true })
        let parities = marked.compactMap(\.style.syllableParity)
        XCTAssertGreaterThan(parities.count, 1, "a long word has several syllables")
        // Two runs next to each other must differ, or the cut would be invisible.
        for index in 1..<parities.count {
            XCTAssertNotEqual(parities[index], parities[index - 1])
        }
    }

    func testSoundGroupsAlternateToo() {
        // « oiseau » holds two groups side by side.
        let marked = runs("oiseau", aids { $0.sounds = true })
        let groups = marked.filter(\.style.isSoundGroup)
        XCTAssertGreaterThanOrEqual(groups.count, 2)
        XCTAssertTrue(groups.contains { $0.style.isAlternateSoundGroup },
                      "two groups touching must be told apart")
    }

    func testRunsNeverOverlapAndStayInsideTheText() {
        let text = "Les enfants jouent dans le jardin aujourd’hui."
        let everything = aids {
            $0.syllables = true
            $0.silentLetters = true
            $0.sounds = true
            $0.changedLetters = true
        }
        let marked = runs(text, everything)
        let length = text.utf16.count
        var previousEnd = 0
        for run in marked {
            XCTAssertGreaterThanOrEqual(run.start, previousEnd, "runs must not overlap")
            XCTAssertLessThan(run.start, run.end, "an empty run has nothing to draw")
            XCTAssertLessThanOrEqual(run.end, length, "a run must stay inside the text")
            previousEnd = run.end
        }
    }

    func testCharactersOutsideAWordAreNeverMarked() {
        let text = "Le chat, dort !"
        let marked = runs(text, aids { $0.syllables = true })
        let units = Array(text.utf16)
        for run in marked {
            let piece = String(decoding: units[run.start..<run.end], as: UTF16.self)
            XCTAssertTrue(piece.contains(where: { $0.isLetter }), "« \(piece) » is not part of a word")
        }
    }

    func testLiaisonsAppearOnlyWhenAskedFor() {
        let text = "les amis"
        XCTAssertTrue(ReadingAidsModel.build(text: text, aids: aids { $0.syllables = true }).liaisons.isEmpty)
        let withLiaisons = ReadingAidsModel.build(text: text, aids: aids { $0.liaisons = true })
        XCTAssertFalse(withLiaisons.liaisons.isEmpty, "« les‿amis » carries one")
    }

    func testAnEmptyTextGivesNothing() {
        XCTAssertTrue(ReadingAidsModel.build(text: "", aids: aids { $0.syllables = true }).isEmpty)
    }
}

final class TypographyTests: XCTestCase {
    func testTurnsAProfileIntoALayout() {
        var reading = ReadingPreferences.standard
        reading.fontSizePx = 30
        reading.lineHeight = 2
        reading.letterSpacingEm = 0.1
        reading.font = .opendyslexic
        reading.theme = .sombre

        let layout = ReaderTypography.of(reading)
        XCTAssertEqual(layout.pointSize, 30)
        XCTAssertEqual(layout.lineHeight, 60, "the em values of the profile become points")
        XCTAssertEqual(layout.letterSpacing, 3)
        XCTAssertEqual(layout.fontName, "OpenDyslexic-Regular")
        XCTAssertEqual(layout.theme, ReaderTheme.sombre)
    }

    func testTitlesFollowTheChosenSize() {
        var reading = ReadingPreferences.standard
        reading.fontSizePx = 20
        let small = ReaderTypography.of(reading)
        reading.fontSizePx = 40
        let large = ReaderTypography.of(reading)
        XCTAssertGreaterThan(small.titlePointSize, small.pointSize)
        XCTAssertEqual(large.titlePointSize, small.titlePointSize * 2, "a child who enlarges the text enlarges the titles")
    }

    func testAValueOutOfRangeIsBroughtBackRatherThanTrusted() {
        // An older version, or a damaged profile, must not make the text unreadable.
        var reading = ReadingPreferences.standard
        reading.fontSizePx = 500
        reading.lineHeight = 0.1
        reading.columnWidthEm = -4
        let layout = ReaderTypography.of(reading)
        XCTAssertEqual(layout.pointSize, 44)
        XCTAssertEqual(layout.lineHeight, 44 * 1.2)
        XCTAssertEqual(layout.columnWidth, 44 * 18)
    }

    func testTheSystemFontIsAskedForByName() {
        XCTAssertNil(ReaderTypography.fontName(for: .systeme))
        XCTAssertEqual(ReaderTypography.fontName(for: .lexend), "Lexend")
    }

    func testPaperIsNeverPureWhiteAndDarkInkIsNeverPureWhite() {
        // Full brightness is harder to read for a child with dyslexia; pure white on black leaves trails.
        XCTAssertNotEqual(ReaderTheme.creme.paper, ReaderColor(1, 1, 1))
        XCTAssertNotEqual(ReaderTheme.sombre.ink, ReaderColor(1, 1, 1))
    }

    func testColoursAreReadFromHex() {
        XCTAssertEqual(ReaderColor(hex: "#FFFFFF"), ReaderColor(1, 1, 1))
        XCTAssertEqual(ReaderColor(hex: "000000"), ReaderColor(0, 0, 0))
        XCTAssertNil(ReaderColor(hex: "#12"))
        XCTAssertNil(ReaderColor(hex: "#GGGGGG"))
    }
}
