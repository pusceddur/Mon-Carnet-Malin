import XCTest
@testable import CarnetKit

/// Hashes that the app and the server have to agree on, character for character.
final class HashingTests: XCTestCase {
    func testTheHexMatchesTheOneEveryoneElseComputes() {
        XCTAssertEqual(Hashing.sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(Hashing.sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(
            Hashing.sha256Hex("Les élèves"),
            "8dbadd1ab3e448d6157c1d3de4445252725b14004ed2daa2317b61140d065c1f"
        )
    }

    func testAPageKeepsItsHashWhenOnlyItsLookChanges() {
        // A page read again by a better engine that only fixed spacing or capitals keeps the same hash — which is how
        // the child keeps their marks, their summary and their place on it.
        let first = [TextBlock(kind: .paragraph, text: "Le chat dort."), TextBlock(kind: .paragraph, text: "Le chien joue.")]
        let second = [TextBlock(kind: .paragraph, text: "LE CHAT  DORT."), TextBlock(kind: .paragraph, text: "le chien joue.")]
        XCTAssertEqual(Hashing.contentHash(of: first), Hashing.contentHash(of: second))
        XCTAssertEqual(
            Hashing.contentHash(of: first),
            "4934f516da63cd024f8af76b6bc35c161ef88f194d6809c931fa8cd02102ad7e"
        )
    }

    func testDifferentTextGivesADifferentHash() {
        let a = [TextBlock(kind: .paragraph, text: "Le chat dort.")]
        let b = [TextBlock(kind: .paragraph, text: "Le chat court.")]
        XCTAssertNotEqual(Hashing.contentHash(of: a), Hashing.contentHash(of: b))
    }

    func testTheOrderOfTheSourceFilesIsPartOfTheirHash() {
        XCTAssertNotEqual(Hashing.sourceHash(ofFileHashes: ["aa", "bb"]), Hashing.sourceHash(ofFileHashes: ["bb", "aa"]))
    }

    func testAProfileSignatureSaysWhoAnAnswerWasWrittenFor() {
        // The same page explained to an eight-year-old and to a twelve-year-old are two different answers, and the
        // cache key has to be able to tell them apart.
        let child = ChildProfile(
            id: "c1", parentId: "p1", firstName: "Léa", age: 10, avatar: "🦊",
            readingLevel: .intermediaire, explanationDifficulty: .simple,
            reading: .standard, tts: .standard, exercises: .standard,
            createdAt: 0, updatedAt: 0
        )
        XCTAssertEqual(Hashing.profileSignature(child), "10|intermediaire|simple")
    }
}

final class DocumentParserTests: XCTestCase {
    private func line(_ text: String, top: Double = 0, height: Double = 12) -> LayoutLine {
        LayoutLine(text: text, top: top, height: height, left: 0)
    }

    // MARK: - Is the PDF's own text worth using?

    func testAScanWithAStrayWatermarkIsNotMistakenForAReadablePage() {
        // Trusting those few characters would give the child three words instead of a page.
        XCTAssertFalse(DocumentParser.hasUsablePdfText([line("Scanné par ACME"), line("p. 42")]))
    }

    func testARealTextPageIsReadRatherThanPhotographed() {
        let lines = [
            line("Le renard traverse la clairière pendant la nuit tranquille."),
            line("Un hibou observe la forêt depuis sa branche préférée.", top: 20),
        ]
        XCTAssertTrue(DocumentParser.hasUsablePdfText(lines))
    }

    func testLettersAreCountedAndDigitsAreNot() {
        XCTAssertEqual(DocumentParser.countLetters("abc"), 3)
        XCTAssertEqual(DocumentParser.countLetters("élève"), 5)
        XCTAssertEqual(DocumentParser.countLetters("12 34 !"), 0)
        XCTAssertEqual(DocumentParser.countLetters(""), 0)
    }

    // MARK: - Blocks

    func testEmptyBlocksAreDropped() {
        let cleaned = DocumentParser.cleanBlocks([
            TextBlock(kind: .paragraph, text: "  Le chat dort.  "),
            TextBlock(kind: .paragraph, text: "   "),
            TextBlock(kind: .title, text: ""),
        ])
        XCTAssertEqual(cleaned.map(\.text), ["Le chat dort."])
    }

    func testTheSpokenFormSurvivesCleaning() {
        // §22: the voice reads the prepared text. Losing it here would silently put the voice back on the printed one.
        let cleaned = DocumentParser.cleanBlocks([
            TextBlock(kind: .paragraph, text: "1. Le chat", spoken: "Un. Le chat"),
        ])
        XCTAssertEqual(cleaned.first?.spoken, "Un. Le chat")
    }

    // MARK: - Files

    func testWhatAFileIs() {
        XCTAssertEqual(DocumentParser.fileKind(type: "application/pdf", name: "x"), .pdf)
        XCTAssertEqual(DocumentParser.fileKind(type: "image/jpeg", name: "x"), .image)
        XCTAssertEqual(DocumentParser.fileKind(type: DocumentParser.epubMIME, name: "x"), .epub)
        XCTAssertNil(DocumentParser.fileKind(type: "text/plain", name: "notes.txt"))
    }

    func testTheExtensionDecidesWhenTheDeviceSaysNothing() {
        // The file picker on iPad often hands over an empty type, so the name has to be able to decide alone.
        XCTAssertEqual(DocumentParser.fileKind(type: "", name: "Ma leçon.PDF"), .pdf)
        XCTAssertEqual(DocumentParser.fileKind(type: "", name: "livre.epub"), .epub)
        XCTAssertEqual(DocumentParser.fileKind(type: "", name: "IMG_0421.HEIC"), .image)
        XCTAssertEqual(DocumentParser.fileKind(type: "", name: "page.tiff"), .image)
        XCTAssertNil(DocumentParser.fileKind(type: "", name: "sans extension"))
    }

    func testPhotosFromAnIPhoneAreRecognisedAsNeedingConversion() {
        XCTAssertTrue(DocumentParser.isHeic(type: "image/heic", name: "x"))
        XCTAssertTrue(DocumentParser.isHeic(type: "", name: "IMG_0421.HEIF"))
        XCTAssertFalse(DocumentParser.isHeic(type: "image/jpeg", name: "x.jpg"))
    }

    func testATitleAParentRecognisesAtAGlance() {
        XCTAssertEqual(DocumentParser.title(fromFileName: "Ma leçon.pdf"), "Ma leçon")
        XCTAssertEqual(DocumentParser.title(fromFileName: "scan_2024_03_11.pdf"), "scan 2024 03 11")
        XCTAssertEqual(DocumentParser.title(fromFileName: "  Le   renard  .epub"), "Le renard")
        XCTAssertEqual(DocumentParser.title(fromFileName: "Sans extension"), "Sans extension")
        // Not an extension: a chapter number.
        XCTAssertEqual(DocumentParser.title(fromFileName: "Chapitre 3.1"), "Chapitre 3.1")
    }

    // MARK: - Pages

    func testAPendingPageExistsFromTheFirstMomentOfTheImport() {
        // So the parent sees the whole book appear at once and watches it fill.
        let page = DocumentParser.pendingPage(documentId: "d1", pageIndex: 3, now: 100)
        XCTAssertEqual(page.status, .pending)
        XCTAssertTrue(page.blocks.isEmpty)
        XCTAssertNil(page.contentHash)
        XCTAssertFalse(page.isAvailable)
    }

    func testAPageTakenFromAPdfHasNoConfidenceToReport() {
        let page = DocumentParser.page(
            documentId: "d1", pageIndex: 0,
            blocks: [TextBlock(kind: .paragraph, text: "Le chat dort.")],
            source: .pdfText, now: 100
        )
        XCTAssertEqual(page.status, .ready)
        XCTAssertNil(page.confidence, "nothing was guessed")
        XCTAssertNotNil(page.contentHash)
        XCTAssertTrue(page.warnings.isEmpty)
    }

    func testAPageWithNothingOnItSaysSo() {
        let page = DocumentParser.page(documentId: "d1", pageIndex: 0, blocks: [], source: .pdfText, now: 100)
        XCTAssertEqual(page.warnings, [.noTextFound])
        XCTAssertNil(page.contentHash)
        XCTAssertTrue(DocumentParser.isDoubtful(page))
    }

    func testAPoorlyReadPageIsOpenedWithAWarningRatherThanHidden() {
        // A child who can see the original image beside the text often reads a page the machine could not.
        let poor = QualityReport(
            score: 42, wordCount: 30, meanConfidence: 45, lowConfidenceRatio: 0.4,
            dictionaryRatio: 0.5, noiseRatio: 0.1
        )
        let page = DocumentParser.page(
            documentId: "d1", pageIndex: 0,
            blocks: [TextBlock(kind: .paragraph, text: "Le chat dort.")],
            quality: poor, source: .ocrLocal, now: 100
        )
        XCTAssertEqual(page.status, .lowConfidence)
        XCTAssertTrue(page.isAvailable, "the page is not taken away from the child")
        XCTAssertEqual(page.warnings, [.lowConfidence])
        XCTAssertTrue(DocumentParser.isDoubtful(page), "but the parent is asked to look at it")
    }

    func testAWellReadPageIsJustReady() {
        let good = QualityReport(
            score: 93, wordCount: 120, meanConfidence: 95, lowConfidenceRatio: 0.02,
            dictionaryRatio: 0.97, noiseRatio: 0.01
        )
        let page = DocumentParser.page(
            documentId: "d1", pageIndex: 2,
            blocks: [TextBlock(kind: .paragraph, text: "Le renard traverse la clairière.")],
            quality: good, source: .ocrLocal, size: (width: 1200, height: 1600), now: 100
        )
        XCTAssertEqual(page.status, .ready)
        XCTAssertEqual(page.confidence, 93)
        XCTAssertEqual(page.width, 1200)
        XCTAssertTrue(page.warnings.isEmpty)
        XCTAssertFalse(DocumentParser.isDoubtful(page))
    }

    func testTheSameWarningNeverAppearsTwice() {
        XCTAssertEqual(
            DocumentParser.uniqueWarnings([.lowConfidence, .serverFallbackUsed, .lowConfidence]),
            [.lowConfidence, .serverFallbackUsed]
        )
    }

    func testABookIsReadyOnlyWhenEveryPageCanBeOpened() {
        func page(_ status: PageStatus) -> PageContent {
            PageContent(documentId: "d1", pageIndex: 0, status: status, updatedAt: 0)
        }
        XCTAssertEqual(DocumentParser.documentStatus(of: []), .processing)
        XCTAssertEqual(DocumentParser.documentStatus(of: [page(.ready), page(.pending)]), .processing)
        XCTAssertEqual(DocumentParser.documentStatus(of: [page(.ready), page(.ready)]), .ready)
        XCTAssertEqual(DocumentParser.documentStatus(of: [page(.ready), page(.lowConfidence)]), .partial)
        XCTAssertEqual(DocumentParser.documentStatus(of: [page(.ready), page(.failed)]), .partial)
    }

    func testAPageAParentCorrectedLeavesTheListOfPagesToCheck() {
        let read = PageContent(
            documentId: "d1", pageIndex: 2, status: .lowConfidence, textSource: .ocrLocal,
            blocks: [TextBlock(kind: .paragraph, text: "Le cbat dort.")], confidence: 41, contentHash: "old",
            width: 1200, height: 1600, warnings: [.lowConfidence, .serverFallbackUsed], updatedAt: 500
        )
        let fixed = DocumentParser.manualCorrection(
            of: read, blocks: [TextBlock(kind: .paragraph, text: "  Le chat dort. ")], now: 100
        )
        XCTAssertEqual(fixed.status, .ready)
        XCTAssertEqual(fixed.textSource, .manual)
        XCTAssertNil(fixed.confidence, "a parent's text is not a guess")
        XCTAssertEqual(fixed.blocks.map(\.text), ["Le chat dort."])
        XCTAssertEqual(fixed.warnings, [.serverFallbackUsed, .manuallyCorrected])
        XCTAssertFalse(DocumentParser.isDoubtful(fixed))
        XCTAssertEqual(fixed.width, 1200, "the image is still there to check against")
        XCTAssertGreaterThan(fixed.updatedAt, read.updatedAt, "the correction must win over the page it replaces")
        XCTAssertEqual(fixed.contentHash, Hashing.contentHash(of: fixed.blocks))
    }

    func testCorrectingAPageToNothingSaysSo() {
        let read = PageContent(documentId: "d1", pageIndex: 0, status: .lowConfidence, updatedAt: 0)
        let fixed = DocumentParser.manualCorrection(of: read, blocks: [TextBlock(kind: .paragraph, text: " ")], now: 1)
        XCTAssertTrue(fixed.warnings.contains(.noTextFound))
        XCTAssertNil(fixed.contentHash)
    }

    func testAPageSurvivesBeingWrittenAndReadBack() throws {
        let page = PageContent(
            documentId: "d1", pageIndex: 4, status: .lowConfidence, textSource: .ocrAi,
            blocks: [TextBlock(kind: .title, text: "Chapitre un"), TextBlock(kind: .paragraph, text: "Le chat dort.")],
            confidence: 61, contentHash: "abc", width: 1200, height: 1600,
            warnings: [.lowConfidence, .awaitingAi], updatedAt: 1_700_000_000_000
        )
        let encoded = try JSONEncoder().encode(page)
        XCTAssertEqual(try JSONDecoder().decode(PageContent.self, from: encoded), page)

        // And the wire spelling is the server's, not Swift's.
        let json = try XCTUnwrap(String(data: encoded, encoding: .utf8))
        XCTAssertTrue(json.contains("\"ocr-ai\""))
        XCTAssertTrue(json.contains("\"low_confidence\""))
        XCTAssertTrue(json.contains("\"awaiting_ai\""))
    }
}
