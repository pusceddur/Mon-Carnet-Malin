import XCTest
@testable import CarnetKit

/// Cutting a page into paragraphs, sentences and sendable pieces, and building blocks back out of layout lines.
/// Cases follow `shared/test/text/lines-blocks.test.ts` and the passage helpers.
final class PassageTests: XCTestCase {
    private func texts(_ text: String, _ ranges: [TextRange]) -> [String] {
        let units = Array(text.utf16)
        return ranges.map { String(decoding: units[$0.start..<$0.end], as: UTF16.self) }
    }

    func testSplitsParagraphsOnBlankLinesAndTrimsThem() {
        let text = "  Premier paragraphe.  \n\n  Deuxième paragraphe.\n\n\n Troisième. "
        XCTAssertEqual(
            texts(text, Passages.paragraphs(in: text)),
            ["Premier paragraphe.", "Deuxième paragraphe.", "Troisième."]
        )
    }

    func testASingleLineBreakDoesNotStartAParagraph() {
        let text = "Le chat dort\nsur le tapis."
        XCTAssertEqual(texts(text, Passages.paragraphs(in: text)), ["Le chat dort\nsur le tapis."])
    }

    func testATextWithoutBlankLinesIsOneParagraph() {
        XCTAssertEqual(Passages.paragraphs(in: "Un seul."), [TextRange(start: 0, end: 8)])
        XCTAssertEqual(Passages.paragraphs(in: "   "), [])
        XCTAssertEqual(Passages.paragraphs(in: ""), [])
    }

    func testLocatesEverySentenceWithItsExactText() {
        let pages = [
            (pageIndex: 0, text: "Le chat dort. Le chien joue.\n\nUne autre idée."),
            (pageIndex: 1, text: "La suite arrive."),
        ]
        let sentences = Passages.locateSentences(in: pages)

        XCTAssertEqual(sentences.count, 4)
        XCTAssertEqual(sentences.map(\.text), ["Le chat dort.", "Le chien joue.", "Une autre idée.", "La suite arrive."])
        XCTAssertEqual(sentences.map(\.order), [0, 1, 2, 3])
        XCTAssertEqual(sentences.map(\.pageIndex), [0, 0, 0, 1])
        XCTAssertEqual(sentences.map(\.paragraphIndex), [0, 0, 1, 0])

        // The offsets must point back into the page, which is what a quotation check relies on.
        for sentence in sentences {
            let page = pages.first { $0.pageIndex == sentence.pageIndex }!
            let units = Array(page.text.utf16)
            XCTAssertEqual(String(decoding: units[sentence.start..<sentence.end], as: UTF16.self), sentence.text)
        }
    }

    func testHardSplitCutsAtSpacesWhenItCan() {
        let text = "un deux trois quatre cinq six sept"
        let pieces = texts(text, Passages.hardSplit(text, start: 0, end: text.utf16.count, limit: 12))
        for piece in pieces {
            XCTAssertLessThanOrEqual(piece.utf16.count, 12)
            XCTAssertFalse(piece.hasPrefix(" "))
            XCTAssertFalse(piece.hasSuffix(" "))
        }
        // Nothing is lost: the words come back in order.
        XCTAssertEqual(pieces.joined(separator: " ").split(separator: " ").count, 7)
    }

    func testHardSplitNeverCutsACharacterInHalf() {
        // Each emoji is two UTF-16 units: a cut between them would produce an unreadable piece.
        let text = String(repeating: "🦊", count: 10)
        let pieces = Passages.hardSplit(text, start: 0, end: text.utf16.count, limit: 5)
        let units = Array(text.utf16)
        for piece in pieces {
            let slice = String(decoding: units[piece.start..<piece.end], as: UTF16.self)
            XCTAssertFalse(slice.unicodeScalars.contains { $0.value == 0xFFFD }, "a piece must not hold a broken character")
        }
    }

    func testHardSplitOnAWordLongerThanTheLimit() {
        let text = "anticonstitutionnellement"
        let pieces = Passages.hardSplit(text, start: 0, end: text.utf16.count, limit: 10)
        XCTAssertGreaterThan(pieces.count, 1)
        XCTAssertEqual(texts(text, pieces).joined(), text)
    }
}

final class BlockBuilderTests: XCTestCase {
    private func line(_ text: String, top: Double, height: Double = 10, left: Double = 0, font: Double? = nil) -> LayoutLine {
        LayoutLine(text: text, top: top, height: height, left: left, fontSize: font)
    }

    func testJoinsTheLinesOfAParagraphAndSeparatesOnALargeGap() {
        let blocks = BlockBuilder.blocks(from: [
            line("Le chat dort sur le tapis", top: 0),
            line("et le chien joue dehors.", top: 12),
            line("Une autre idée commence ici", top: 60),
        ])
        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(blocks[0].text, "Le chat dort sur le tapis et le chien joue dehors.")
        XCTAssertEqual(blocks[0].kind, .paragraph)
    }

    func testRecognisesATitleByItsLargerFont() {
        let blocks = BlockBuilder.blocks(from: [
            line("Le Soleil", top: 0, height: 16, font: 22),
            line("Le Soleil est une étoile très chaude qui éclaire la Terre.", top: 40, height: 10, font: 12),
            line("Il brille depuis des milliards d'années sans jamais s'arrêter.", top: 52, height: 10, font: 12),
        ])
        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(blocks[0].kind, .title)
        XCTAssertEqual(blocks[0].text, "Le Soleil")
        XCTAssertEqual(blocks[1].kind, .paragraph)
    }

    func testRecognisesATitleWrittenInCapitals() {
        let blocks = BlockBuilder.blocks(from: [
            line("LES VOLCANS", top: 0),
            line("Un volcan est une montagne qui crache de la lave brûlante.", top: 40),
        ])
        XCTAssertEqual(blocks[0].kind, .title)
    }

    func testPutsBackAWordCutAtTheEndOfALine() {
        let blocks = BlockBuilder.blocks(from: [
            line("La pho-", top: 0),
            line("tosynthèse nourrit la plante.", top: 12),
        ])
        XCTAssertEqual(blocks[0].text, "La photosynthèse nourrit la plante.")
    }

    func testEmptyAndBlankLinesGiveNothing() {
        XCTAssertEqual(BlockBuilder.blocks(from: []).count, 0)
        XCTAssertEqual(BlockBuilder.blocks(from: [line("   ", top: 0)]).count, 0)
    }

    func testPlainTextSeparatesBlocksWithABlankLine() {
        let blocks = [TextBlock(kind: .title, text: "Titre"), TextBlock(kind: .paragraph, text: "Corps.")]
        XCTAssertEqual(BlockBuilder.plainText(blocks), "Titre\n\nCorps.")
    }
}
