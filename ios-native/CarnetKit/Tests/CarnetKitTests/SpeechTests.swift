import XCTest
@testable import CarnetKit

/// The queue the voice works through, and the mapping that keeps the highlight under the word being said.
/// The synthesizer itself cannot run here; what is tested is everything that decides *what* it is asked to say and
/// *where* the mark goes.
final class SpeechQueueTests: XCTestCase {
    private func page(_ index: Int, _ texts: [String], status: PageStatus = .ready) -> PageModel {
        let blocks = texts.enumerated().map { blockIndex, text in
            ReaderModel.buildBlock(pageIndex: index, blockIndex: blockIndex, block: TextBlock(kind: .paragraph, text: text))
        }
        return PageModel(pageIndex: index, status: status, blocks: blocks)
    }

    func testOneItemPerSentenceInReadingOrder() {
        let items = SpeechQueue.build(from: [
            page(1, ["Troisième page."]),
            page(0, ["Le chat dort. Le chien joue.", "Un autre paragraphe."]),
        ])
        XCTAssertEqual(items.map(\.text), [
            "Le chat dort.", "Le chien joue.", "Un autre paragraphe.", "Troisième page.",
        ], "pages are read in order whatever order they arrive in")
        XCTAssertEqual(items.map(\.id), ["0:0:0", "0:0:1", "0:1:0", "1:0:0"])
    }

    func testAPageThatCannotBeReadYetIsSkipped() {
        let items = SpeechQueue.build(from: [
            page(0, ["Prête."], status: .ready),
            page(1, ["Pas encore lue."], status: .processing),
            // A page read with doubts is still read aloud: the child sees a warning, not a blank.
            page(2, ["Douteuse."], status: .lowConfidence),
        ])
        XCTAssertEqual(items.map(\.text), ["Prête.", "Douteuse."])
    }

    func testASentenceWithoutWordsNeverBecomesAnItem() {
        // Pure punctuation would make the voice pause on nothing and the highlight jump to a blank.
        let items = SpeechQueue.build(from: [page(0, ["Le chat dort. ... ! Le chien joue."])])
        for item in items {
            XCTAssertTrue(item.text.contains(where: { $0.isLetter }), "« \(item.text) » has nothing to say")
        }
    }

    func testIdentifiersSurviveTheRoundTrip() {
        let id = SpeechQueue.itemId(pageIndex: 3, blockIndex: 2, sentenceIndex: 7)
        XCTAssertEqual(id, "3:2:7")
        let position = SpeechQueue.position(fromItemId: id)
        XCTAssertEqual(position?.pageIndex, 3)
        XCTAssertEqual(position?.blockIndex, 2)
        XCTAssertEqual(position?.sentenceIndex, 7)

        XCTAssertNil(SpeechQueue.position(fromItemId: nil))
        XCTAssertNil(SpeechQueue.position(fromItemId: "nope"))
        XCTAssertNil(SpeechQueue.position(fromItemId: "1:2"))
        XCTAssertNil(SpeechQueue.position(fromItemId: "-1:0:0"))
    }

    func testStartsAtTheAskedSentenceOrTheFirstOneAfterIt() {
        let items = SpeechQueue.build(from: [page(0, ["Une. Deux.", "Trois."]), page(1, ["Quatre."])])

        XCTAssertEqual(SpeechQueue.startIndex(in: items, at: SpeechPosition(pageIndex: 0)), 0)
        XCTAssertEqual(SpeechQueue.startIndex(in: items, at: SpeechPosition(pageIndex: 0, blockIndex: 0, sentenceIndex: 1)), 1)
        XCTAssertEqual(SpeechQueue.startIndex(in: items, at: SpeechPosition(pageIndex: 0, blockIndex: 1)), 2)
        XCTAssertEqual(SpeechQueue.startIndex(in: items, at: SpeechPosition(pageIndex: 1)), 3)
        // Past the end: reading starts somewhere rather than refusing.
        XCTAssertEqual(SpeechQueue.startIndex(in: items, at: SpeechPosition(pageIndex: 99)), items.count - 1)
    }

    func testAPreparedSentenceIsSaidAndTheWrittenOneIsShown() {
        let block = ReaderModel.buildBlock(
            pageIndex: 0, blockIndex: 0,
            block: TextBlock(kind: .paragraph, text: "le chat dort il ronfle", spoken: "Le chat dort. Il ronfle !")
        )
        let items = SpeechQueue.build(from: [PageModel(pageIndex: 0, status: .ready, blocks: [block])])
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].text, "le chat dort il ronfle", "the page keeps showing what the book prints")
        XCTAssertEqual(items[0].utterance, "Le chat dort. Il ronfle !", "the voice says the prepared version")
    }
}

final class SpokenWordMappingTests: XCTestCase {
    func testCarriesAPositionFromTheSpokenTextOntoTheShownOne() throws {
        // The voice reads a punctuated version; the page shows the text without punctuation, so the same word sits at
        // a different offset in each. Without the mapping the mark would drift by one character per added comma.
        let display = "le chat dort il ronfle"
        let spoken = "Le chat dort. Il ronfle !"
        let mapping = try XCTUnwrap(SpokenWordMapping(display: display, spoken: spoken))

        // « Il » is the fourth word of the spoken text.
        let saidIl = try XCTUnwrap(Tokenizer.tokenizeWords(spoken).first { $0.word == "Il" })
        let range = NSRange(location: saidIl.start, length: saidIl.end - saidIl.start)

        let shown = try XCTUnwrap(mapping.displayRange(forSpokenRange: range))
        let units = Array(display.utf16)
        XCTAssertEqual(String(decoding: units[shown.location..<(shown.location + shown.length)], as: UTF16.self), "il")
        XCTAssertNotEqual(shown.location, saidIl.start, "the two texts really do differ in where the word sits")
    }

    func testEveryWordOfTheSpokenTextLandsOnTheSameWordOfTheShownOne() throws {
        let display = "le chat dort il ronfle"
        let spoken = "Le chat dort. Il ronfle !"
        let mapping = try XCTUnwrap(SpokenWordMapping(display: display, spoken: spoken))

        let saidWords = Tokenizer.tokenizeWords(spoken)
        let shownWords = Tokenizer.tokenizeWords(display)
        XCTAssertEqual(saidWords.count, shownWords.count)

        for (index, said) in saidWords.enumerated() {
            let range = NSRange(location: said.start, length: said.end - said.start)
            let mapped = try XCTUnwrap(mapping.displayRange(forSpokenRange: range), "word \(index)")
            XCTAssertEqual(mapped.location, shownWords[index].start, "word \(index) « \(said.word) »")
            XCTAssertEqual(mapped.length, shownWords[index].end - shownWords[index].start)
        }
    }

    func testASentenceReadAsWrittenMapsOntoItself() throws {
        let text = "Le chat dort."
        let mapping = SpokenWordMapping(identity: text)
        let range = try XCTUnwrap(mapping.displayRange(forSpokenRange: NSRange(location: 3, length: 4)))
        XCTAssertEqual(range.location, 3)
        XCTAssertEqual(range.length, 4)
    }

    func testTextsThatDoNotHoldTheSameWordsAreRefused() {
        // Mapping these would put the mark on the wrong word, which is worse than no mark at all.
        XCTAssertNil(SpokenWordMapping(display: "le chat dort", spoken: "Le chien dort."))
        XCTAssertNil(SpokenWordMapping(display: "le chat dort", spoken: "Le chat dort vraiment."))
    }

    func testAPositionBetweenWordsMapsToNothingRatherThanToTheWrongWord() {
        let mapping = SpokenWordMapping(identity: "Le chat dort.")
        // The space between two words.
        XCTAssertNil(mapping.displayRange(forSpokenRange: NSRange(location: 2, length: 0)))
    }
}

#if canImport(AVFoundation)
final class SpeechRateTests: XCTestCase {
    func testTheProfileRateIsMappedOntoTheSystemScale() {
        // A parent setting « 1 » must give ordinary speech, and « 0.5 » must really be slower.
        let normal = SpeechReader.systemRate(1.0)
        let slow = SpeechReader.systemRate(0.5)
        let fast = SpeechReader.systemRate(1.5)
        XCTAssertLessThan(slow, normal)
        XCTAssertGreaterThan(fast, normal)
        // Out of range values are brought back rather than producing silence or gibberish.
        XCTAssertEqual(SpeechReader.systemRate(0.1), slow)
        XCTAssertEqual(SpeechReader.systemRate(9), fast)
    }
}
#endif
