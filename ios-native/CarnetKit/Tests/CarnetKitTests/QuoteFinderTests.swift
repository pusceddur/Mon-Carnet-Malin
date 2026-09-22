@testable import CarnetKit
import XCTest

/// Expected ranges computed with the web app's own `findQuote` on the same blocks.
final class QuoteFinderTests: XCTestCase {
    private let blocks = [
        "Le Petit Chaperon rouge",
        "Il était une fois une petite fille de village, la plus jolie qu’on eût su voir ; sa mère en était folle, "
            + "et sa mère-grand plus folle encore.",
        "Cette bonne femme lui fit faire un petit chaperon rouge, qui lui seyait si bien, que partout on l’appelait "
            + "le Petit Chaperon rouge.",
    ]

    private func find(_ quote: String) -> ReaderRange? {
        QuoteFinder.find(quote, pageIndex: 3, blocks: blocks)
    }

    func testExactQuoteDespiteApostropheAndAccents() {
        XCTAssertEqual(find("la plus jolie qu'on eût su voir"), ReaderRange(pageIndex: 3, blockIndex: 1, start: 47, end: 78))
        XCTAssertEqual(find("sa mère-grand plus folle encore"), ReaderRange(pageIndex: 3, blockIndex: 1, start: 108, end: 139))
        XCTAssertEqual(find("Cette bonne femme lui fit"), ReaderRange(pageIndex: 3, blockIndex: 2, start: 0, end: 25))
    }

    func testTheFirstBlockThatHasItWins() {
        XCTAssertEqual(find("petit chaperon rouge"), ReaderRange(pageIndex: 3, blockIndex: 0, start: 3, end: 23))
    }

    func testALongQuoteMatchesByItsEdgesWhenAWordInsideIsWrong() {
        XCTAssertEqual(
            find("Cette bonne femme lui fit faire un XXX chaperon rouge, qui lui seyait si bien"),
            ReaderRange(pageIndex: 3, blockIndex: 2, start: 0, end: 79)
        )
    }

    func testNothingFound() {
        XCTAssertNil(find("LA MÈRE-GRAND plus folle"))
        XCTAssertNil(find("le loup"))
        XCTAssertNil(find(""))
    }
}
