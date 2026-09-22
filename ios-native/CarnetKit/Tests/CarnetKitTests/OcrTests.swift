import XCTest
@testable import CarnetKit

/// Cleaning up what an engine read at the edge of a page.
final class OcrCleanupTests: XCTestCase {
    private func word(_ text: String, _ confidence: Double, _ left: Double, _ right: Double) -> OcrWord {
        OcrWord(text: text, confidence: confidence, left: left, right: right)
    }

    private func line(_ words: [OcrWord], height: Double = 20) -> OcrLine {
        OcrLine(
            text: words.map(\.text).joined(separator: " "),
            top: 0, left: words.first?.left ?? 0, height: height, words: words
        )
    }

    func testACleanLineIsHandedBackUntouched() {
        let good = line([
            word("Le", 96, 0, 20), word("chat", 98, 26, 70), word("dort", 97, 76, 120),
        ])
        XCTAssertEqual(OcrCleanup.removeDebris(from: good), good)
    }

    func testTheShadowOfTheBindingIsNotReadAloud() {
        // Left in, the voice says « l » between the sentences and the child has no way to know the page is fine.
        let dirty = line([
            word("Le", 96, 100, 120), word("chat", 98, 126, 170), word("dort", 97, 176, 220),
            word("l", 20, 400, 404),
        ])
        let cleaned = OcrCleanup.removeDebris(from: dirty)
        XCTAssertEqual(cleaned?.words.map(\.text), ["Le", "chat", "dort"])
        XCTAssertEqual(cleaned?.text, "Le chat dort")
    }

    func testDebrisAtTheStartOfALineGoesToo() {
        let dirty = line([
            word("m", 12, 0, 6), word("Le", 96, 100, 120), word("chat", 98, 126, 170), word("dort", 97, 176, 220),
        ])
        let cleaned = OcrCleanup.removeDebris(from: dirty)
        XCTAssertEqual(cleaned?.words.map(\.text), ["Le", "chat", "dort"])
        XCTAssertEqual(cleaned?.left, 100, "the line now starts where its first real word does")
    }

    func testElisionsAreKeptEvenWhenTheEngineIsUnsureOfThem() {
        // « l’ » and « d’ » are read badly on principle, and they hold French sentences together.
        let elided = line([
            word("l’", 30, 0, 12), word("arbre", 95, 14, 70), word("d’", 25, 76, 88), word("hiver", 94, 90, 140),
        ])
        XCTAssertEqual(OcrCleanup.removeDebris(from: elided)?.words.count, 4)
    }

    func testAShortWordCloseToTheTextIsNotDebris() {
        // « Il a dit » — « a » is two pixels from its neighbours and is a word.
        let sentence = line([
            word("Il", 92, 0, 18), word("a", 88, 22, 30), word("dit", 90, 34, 60),
        ])
        XCTAssertEqual(OcrCleanup.removeDebris(from: sentence)?.words.count, 3)
    }

    func testALineThatIsNothingButDebrisIsDropped() {
        let noise = line([word("l", 8, 0, 4), word("—", 11, 300, 310), word("~", 5, 600, 606)])
        XCTAssertNil(OcrCleanup.removeDebris(from: noise))
    }

    func testTheWholePageIsCleanedAndTheScoreIsBroughtIntoRange() {
        let result = OcrResult(
            lines: [
                line([word("Le", 96, 0, 20), word("chat", 98, 26, 70), word("dort", 95, 76, 120)]),
                line([word("~", 4, 0, 6)]),
            ],
            confidence: 250
        )
        let cleaned = OcrCleanup.clean(result)
        XCTAssertEqual(cleaned.lines.count, 1)
        XCTAssertEqual(cleaned.confidence, 100)
    }

    func testAnImpossibleConfidenceIsNotBelieved() {
        XCTAssertEqual(OcrCleanup.clampConfidence(-5), 0)
        XCTAssertEqual(OcrCleanup.clampConfidence(120), 100)
        XCTAssertEqual(OcrCleanup.clampConfidence(.nan), 0)
        XCTAssertEqual(OcrCleanup.clampConfidence(.infinity), 100)
    }
}

/// The score that decides what a child is shown and what a parent is asked to check.
final class OcrQualityTests: XCTestCase {
    private let french = WordList(words: [
        "le", "la", "les", "chat", "chien", "dort", "joue", "sur", "mur", "renard", "traverse", "clairière",
        "pendant", "nuit", "tranquille", "un", "hibou", "observe", "forêt", "arbre", "hiver", "arc-en-ciel",
    ])

    private func score(_ text: String, words: [OcrWord] = [], page: Double? = nil, list: WordList? = nil) -> QualityReport {
        OcrQuality.score(QualityInput(text: text, words: words, pageConfidence: page), against: list ?? french)
    }

    func testRealFrenchScoresWellEvenFromAMediocreEngine() {
        let report = score("Le renard traverse la clairière pendant la nuit tranquille", page: 72)
        XCTAssertGreaterThan(report.score, 75)
        XCTAssertEqual(report.dictionaryRatio, 1)
    }

    func testConfidentGibberishIsCaughtBeforeTheChildMeetsIt() {
        // An engine is as confident about nonsense as about words; the dictionary is what tells them apart.
        let report = score("Lc rcnurd truvcrsc lu cluiricrc pcndunt lu nuit trunquillc", page: 95)
        XCTAssertLessThan(report.score, DocumentParser.lowConfidenceScore)
        XCTAssertLessThan(report.dictionaryRatio ?? 1, 0.3)
    }

    func testNoiseCharactersPullTheScoreDown() {
        let clean = score("Le chat dort sur le mur", page: 90)
        let noisy = score("Le ch@t d#rt §ur |e ¤mur", page: 90)
        XCTAssertGreaterThan(noisy.noiseRatio, clean.noiseRatio)
        XCTAssertLessThan(noisy.score, clean.score)
    }

    func testOrdinaryPunctuationIsNotNoise() {
        let report = score("Le chat dort, sur le mur… « oui ! » (vraiment ?)", page: 90)
        XCTAssertEqual(report.noiseRatio, 0)
    }

    func testWordConfidencesAreWeightedByLength() {
        // A long word read wrong costs more than a short one.
        let report = score(
            "Le chat dort",
            words: [
                OcrWord(text: "Le", confidence: 20),
                OcrWord(text: "chat", confidence: 100),
                OcrWord(text: "dort", confidence: 100),
            ]
        )
        XCTAssertGreaterThan(report.meanConfidence ?? 0, 80, "two long sure words outweigh one short unsure one")
        XCTAssertEqual(report.lowConfidenceRatio ?? 0, 1.0 / 3.0, accuracy: 0.001)
    }

    func testAPageWithNoTextScoresZero() {
        let report = score("   ", page: 90)
        XCTAssertEqual(report.score, 0)
        XCTAssertEqual(report.wordCount, 0)
    }

    func testTwoWordsAreNotEnoughToDeclareAPageRead() {
        // The statistics are fragile on that little text, so the score stays cautious and the parent looks.
        let long = score("Le chat dort sur le mur", page: 100)
        let short = score("Le chat", page: 100)
        XCTAssertLessThan(short.score, long.score)
    }

    func testTheScoreStaysInRange() {
        for text in ["", "a", "Le chat dort.", String(repeating: "¤", count: 50)] {
            for page in [nil, -10, 0, 50, 200] as [Double?] {
                let report = score(text, page: page)
                XCTAssertGreaterThanOrEqual(report.score, 0)
                XCTAssertLessThanOrEqual(report.score, 100)
            }
        }
    }

    func testWithoutAWordListTheDictionaryIsSimplyNotCounted() {
        let report = OcrQuality.score(QualityInput(text: "Le chat dort", pageConfidence: 90), against: nil)
        XCTAssertNil(report.dictionaryRatio)
        XCTAssertGreaterThan(report.score, 0)
    }

    func testWhatCountsAsAKnownWord() {
        XCTAssertTrue(OcrQuality.isKnown("chat", in: french))
        XCTAssertTrue(OcrQuality.isKnown("Chat", in: french), "a capital at the start of a sentence is not an error")
        XCTAssertTrue(OcrQuality.isKnown("forêt", in: french))
        XCTAssertTrue(OcrQuality.isKnown("foret", in: french), "an accent the engine missed is not a wrong word")
        XCTAssertTrue(OcrQuality.isKnown("1985", in: french))
        XCTAssertTrue(OcrQuality.isKnown("3,5", in: french))
        XCTAssertTrue(OcrQuality.isKnown("l’", in: french), "an elision is a word")
        XCTAssertTrue(OcrQuality.isKnown("arc-en-ciel", in: french))
        XCTAssertFalse(OcrQuality.isKnown("rcnurd", in: french))
        XCTAssertFalse(OcrQuality.isKnown("z’", in: french), "« z’ » is not French")
    }

    func testACompoundCountsWhenEachPartIsAWord() {
        let list = WordList(words: ["chat", "chien"])
        XCTAssertTrue(OcrQuality.isKnown("chat-chien", in: list))
        XCTAssertFalse(OcrQuality.isKnown("chat-xyzzy", in: list))
    }

    func testAPageCanBeScoredFromItsLinesOrFromItsBlocks() {
        let lines = [
            OcrLine(text: "Le chat dort", top: 0, left: 0, height: 20, words: [
                OcrWord(text: "Le", confidence: 95), OcrWord(text: "chat", confidence: 97),
                OcrWord(text: "dort", confidence: 96),
            ]),
        ]
        XCTAssertGreaterThan(OcrQuality.score(lines: lines, pageConfidence: 95, against: french).score, 80)

        let blocks = [TextBlock(kind: .paragraph, text: "Le chat dort sur le mur")]
        XCTAssertGreaterThan(OcrQuality.score(blocks: blocks, pageConfidence: 95, against: french).score, 80)
    }
}
