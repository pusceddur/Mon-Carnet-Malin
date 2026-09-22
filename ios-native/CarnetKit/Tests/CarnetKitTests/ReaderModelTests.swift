import XCTest
@testable import CarnetKit

/// What the reader draws, and what a tap lands on.
///
/// The rule under most of these: nothing visible may be unreachable. A stretch of text the model leaves out of every
/// sentence would still be drawn, but could not be highlighted nor read aloud — and from the child's side that looks
/// like the app skipping part of the page.
final class ReaderModelTests: XCTestCase {
    private func block(_ text: String, kind: TextBlock.Kind = .paragraph, spoken: String? = nil) -> BlockModel {
        ReaderModel.buildBlock(pageIndex: 0, blockIndex: 0, block: TextBlock(kind: kind, text: text, spoken: spoken))
    }

    func testSplitsAParagraphIntoSentencesAndWords() {
        let model = block("Le chat dort. Le chien joue !")
        XCTAssertEqual(model.sentences.count, 2)
        XCTAssertEqual(model.sentences.map(\.text), ["Le chat dort.", "Le chien joue !"])
        XCTAssertEqual(model.words.map(\.text), ["Le", "chat", "dort", "Le", "chien", "joue"])
        XCTAssertEqual(model.sentences[0].words.map(\.text), ["Le", "chat", "dort"])
    }

    func testEveryWordBelongsToASentence() {
        // Text the segmenter would leave outside a sentence must still be reachable.
        for text in [
            "Le chat dort. Le chien joue !",
            "— Bonjour\n— Salut",
            "Un titre sans ponctuation",
            "« Viens ! » dit-elle. Il vint.",
            "1. Lis le texte 2. Réponds",
        ] {
            let model = block(text)
            let covered = Set(model.sentences.flatMap { sentence in sentence.words.map(\.offset) })
            for word in model.words {
                XCTAssertTrue(covered.contains(word.offset), "« \(word.text) » of « \(text) » is in no sentence")
            }
        }
    }

    func testTheSegmentsRedrawTheOriginalTextExactly() {
        for text in ["Le chat dort. Le chien joue !", "  Espaces  autour. ", "Sans ponctuation finale"] {
            let model = block(text)
            var rebuilt = ""
            for segment in model.segments {
                switch segment {
                case let .gap(gap): rebuilt += gap
                case let .sentence(sentence): rebuilt += sentence.text
                }
            }
            XCTAssertEqual(rebuilt, text, "the drawn pieces must add up to the text itself")
        }
    }

    func testASentenceIsRebuiltExactlyFromItsParts() {
        let model = block("Le chat, qui dort, ronfle.")
        for sentence in model.sentences {
            var rebuilt = ""
            for part in sentence.parts {
                switch part {
                case let .text(text): rebuilt += text
                case let .word(word): rebuilt += word.text
                }
            }
            XCTAssertEqual(rebuilt, sentence.text)
        }
    }

    func testATapLandsOnAWordAndNowhereElse() {
        let model = block("Le chat dort.")
        // « chat » sits at offsets 3..7.
        XCTAssertEqual(ReaderModel.word(in: model, at: 3)?.text, "chat")
        XCTAssertEqual(ReaderModel.word(in: model, at: 6)?.text, "chat")
        XCTAssertNil(ReaderModel.word(in: model, at: 7), "the space after a word is not the word")
        XCTAssertNil(ReaderModel.word(in: model, at: 12), "the full stop is not a word")

        let range = try? XCTUnwrap(ReaderModel.selectWord(in: model, at: 4))
        XCTAssertEqual(range?.start, 3)
        XCTAssertEqual(range?.end, 7)
    }

    func testASelectionGrowsToWholeWords() {
        let model = block("Le chat dort.")
        // Starting and ending in the middle of two words.
        let dragged = ReaderRange(pageIndex: 0, blockIndex: 0, start: 4, end: 10)
        let widened = ReaderModel.extendToNextWord(
            in: model, ReaderModel.extendToPreviousWord(in: model, dragged)
        )
        XCTAssertEqual(widened.start, 3, "« chat » is not cut in half")
        XCTAssertEqual(widened.end, 12, "« dort » is not cut in half")
    }

    func testASelectionGrowsToWholeSentences() {
        let model = block("Le chat dort. Le chien joue !")
        let inside = ReaderRange(pageIndex: 0, blockIndex: 0, start: 4, end: 20)
        let widened = ReaderModel.sentenceRange(in: model, inside)
        XCTAssertEqual(widened.start, model.sentences[0].start)
        XCTAssertEqual(widened.end, model.sentences[1].end)
    }

    func testFindsTheSentenceUnderAPoint() {
        let model = block("Le chat dort. Le chien joue !")
        XCTAssertEqual(ReaderModel.sentence(in: model, at: 2)?.index, 0)
        XCTAssertEqual(ReaderModel.sentence(in: model, at: 20)?.index, 1)
    }

    func testTheWholeParagraphIsOneRange() {
        let model = block("Le chat dort.")
        let range = ReaderModel.paragraphRange(of: model)
        XCTAssertEqual(range.start, 0)
        XCTAssertEqual(range.end, model.text.utf16.count)
    }

    func testAPreparedVersionGivesEachSentenceWhatToSay() {
        // The voice says a punctuated version while the page shows the text as printed.
        let model = block("le chat dort il ronfle", spoken: "Le chat dort. Il ronfle !")
        XCTAssertEqual(model.sentences.count, 1, "the shown text has no punctuation, so it is one sentence")
        XCTAssertEqual(model.sentences[0].spoken, "Le chat dort. Il ronfle !")
    }

    func testAPreparedVersionThatLostAWordIsRefused() {
        // Losing a word would make the voice and the highlight drift apart: better to read the page as written.
        let model = block("le chat dort", spoken: "Le chien dort.")
        XCTAssertNil(model.sentences.first?.spoken)
    }

    func testOffsetsHoldWhenTheTextCarriesEmoji() {
        // An emoji is two UTF-16 units: an offset counted any other way would point between words.
        let model = block("Léa 🦊 mange à côté.")
        let units = Array(model.text.utf16)
        for word in model.words {
            XCTAssertEqual(String(decoding: units[word.offset..<word.end], as: UTF16.self), word.text)
        }
    }

    func testAnEmptyBlockGivesNothingToDraw() {
        let model = block("")
        XCTAssertTrue(model.sentences.isEmpty)
        XCTAssertTrue(model.words.isEmpty)
        XCTAssertTrue(model.segments.isEmpty)
    }

    func testATitleKeepsItsKind() {
        XCTAssertEqual(block("Les volcans", kind: .title).kind, .title)
    }
}
