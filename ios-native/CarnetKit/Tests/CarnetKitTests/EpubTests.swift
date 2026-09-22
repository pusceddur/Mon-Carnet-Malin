import XCTest
@testable import CarnetKit

/// The forgiving parser. Every test here is a shape of broken markup that real books contain, and that a strict
/// parser would refuse — which for the child waiting to read the book looks exactly like the app being broken.
final class XmlParserTests: XCTestCase {
    private func text(of source: String) -> String {
        XmlParser.parse(source).textContent
    }

    func testAWellFormedDocument() {
        let document = XmlParser.parse("<p class=\"x\">Le chat <em>dort</em>.</p>")
        XCTAssertEqual(document.textContent, "Le chat dort.")
        XCTAssertEqual(document.firstDescendant(named: "p")?.attribute("class"), "x")
    }

    func testPrefixesAreDroppedSoBothSpellingsOfATitleAreFound() {
        let document = XmlParser.parse("<metadata><dc:title>Le renard</dc:title></metadata>")
        XCTAssertEqual(document.firstDescendant(named: "title")?.textContent, "Le renard")
    }

    func testAnAttributeIsFoundWhateverPrefixItCarries() {
        let document = XmlParser.parse("<rootfile opf:full-path=\"OEBPS/x.opf\"/>")
        XCTAssertEqual(document.firstDescendant(named: "rootfile")?.attribute("full-path"), "OEBPS/x.opf")
    }

    func testUnclosedTagsDoNotSwallowTheRestOfTheBook() {
        XCTAssertEqual(text(of: "<p>Un<br>Deux<p>Trois"), "UnDeuxTrois")
    }

    func testAClosingTagNobodyOpenedIsIgnored() {
        XCTAssertEqual(text(of: "<p>Le chat</span> dort.</p>"), "Le chat dort.")
    }

    func testUnquotedAndEmptyAttributes() {
        let document = XmlParser.parse("<img src=photo.jpg hidden alt=\"\">texte")
        let img = document.firstDescendant(named: "img")
        XCTAssertEqual(img?.attribute("src"), "photo.jpg")
        XCTAssertEqual(img?.attribute("alt"), "")
        XCTAssertNotNil(img?.attributes["hidden"])
        // `img` is a void element: what follows is not inside it.
        XCTAssertEqual(document.textContent, "texte")
    }

    func testCommentsDoctypesAndProcessingInstructionsAreSkipped() {
        let source = """
            <?xml version="1.0"?>
            <!DOCTYPE html PUBLIC "-//W3C//DTD" "x.dtd" [ <!ENTITY a "b"> ]>
            <!-- un commentaire avec <p>du balisage</p> dedans -->
            <p>Le texte.</p>
            """
        XCTAssertEqual(text(of: source).trimmingCharacters(in: .whitespacesAndNewlines), "Le texte.")
    }

    func testScriptAndStyleAreNotReadingText() {
        let source = "<p>Avant</p><script>if (a < b) { x(); }</script><style>p { color: red }</style><p>Après</p>"
        XCTAssertEqual(text(of: source), "AvantAprès")
    }

    func testCdataIsKeptLiterally() {
        XCTAssertEqual(text(of: "<p><![CDATA[a < b & c > d]]></p>"), "a < b & c > d")
    }

    func testEntitiesBecomeTheLettersTheyStandFor() {
        XCTAssertEqual(XmlParser.decodeEntities("l&apos;&eacute;l&egrave;ve"), "l'élève")
        XCTAssertEqual(XmlParser.decodeEntities("&#233;t&#xE9;"), "été")
        XCTAssertEqual(XmlParser.decodeEntities("A&nbsp;B"), "A\u{00A0}B")
        XCTAssertEqual(XmlParser.decodeEntities("&amp;&lt;&gt;&quot;"), "&<>\"")
        XCTAssertEqual(XmlParser.decodeEntities("&hellip;&mdash;&oelig;"), "…—œ")
    }

    func testAnEntityTheAppDoesNotKnowIsLeftAlone() {
        // Showing « &truc; » is ugly; deleting a word the child was meant to read is worse.
        XCTAssertEqual(XmlParser.decodeEntities("a &truc; b"), "a &truc; b")
        XCTAssertEqual(XmlParser.decodeEntities("30 &amp; 40"), "30 & 40")
    }

    func testABareAmpersandInASentenceIsNotAnEntity() {
        XCTAssertEqual(XmlParser.decodeEntities("Dupont & fils"), "Dupont & fils")
        XCTAssertEqual(XmlParser.decodeEntities("a & b & c"), "a & b & c")
    }

    func testAnImpossibleCodePointIsDroppedRatherThanShown() {
        XCTAssertEqual(XmlParser.decodeEntities("a&#55296;b"), "ab")
        XCTAssertEqual(XmlParser.decodeEntities("a&#0;b"), "ab")
    }

    func testALessThanSignThatStartsNothingIsText() {
        XCTAssertEqual(text(of: "3 < 5 et 7 > 2"), "3 < 5 et 7 > 2")
    }

    func testAnEmptyDocumentIsNotACrash() {
        XCTAssertEqual(text(of: ""), "")
        XCTAssertEqual(text(of: "<"), "<")
        XCTAssertEqual(text(of: "<<<>>>"), "<<<>>>")
    }
}

final class EpubBlockTests: XCTestCase {
    private func blocks(_ body: String) -> [TextBlock] {
        EpubBlocks.extract(from: XmlParser.parse("<html><body>\(body)</body></html>"))
    }

    func testTitlesAndParagraphs() {
        let result = blocks("<h1>Chapitre un</h1><p>Le chat dort.</p><p>Le chien joue.</p>")
        XCTAssertEqual(result.map(\.kind), [.title, .paragraph, .paragraph])
        XCTAssertEqual(result.map(\.text), ["Chapitre un", "Le chat dort.", "Le chien joue."])
    }

    func testInlineMarkupDoesNotCutASentenceInPieces() {
        // « Le <em>chat</em> dort » is one sentence, not three blocks.
        let result = blocks("<p>Le <em>chat</em> <strong>noir</strong> dort.</p>")
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].text, "Le chat noir dort.")
    }

    func testABreakIsALineBreakAndNotAPileOfSpaces() {
        let result = blocks("<p>Premier vers <br/> deuxième vers</p>")
        XCTAssertEqual(result.map(\.text), ["Premier vers\ndeuxième vers"])
    }

    func testWhitespaceInTheMarkupIsNotWhitespaceInTheText() {
        let result = blocks("<p>\n   Le    chat\n\tdort.\n  </p>")
        XCTAssertEqual(result.map(\.text), ["Le chat dort."])
    }

    func testPicturesScriptsAndNavigationAreNotRead() {
        let result = blocks("""
            <nav><a href="x">Sommaire</a></nav>
            <p>Le texte.</p>
            <script>var x = 1;</script>
            <figure><img src="a.png" alt="un chat"/></figure>
            """)
        XCTAssertEqual(result.map(\.text), ["Le texte."])
    }

    func testFootnoteMarkersAreLeftOutOfTheSentence() {
        // « le chat dormait 12 sur le mur » is what a read-aloud would say otherwise.
        let result = blocks("""
            <p>Le chat dormait<a epub:type="noteref" href="#n1">12</a> sur le mur.</p>
            <aside epub:type="footnote"><p>12. Un chat noir.</p></aside>
            """)
        XCTAssertEqual(result.map(\.text), ["Le chat dormait sur le mur."])
    }

    func testPrintedPageNumbersAreLeftOut() {
        let result = blocks("<p>Une phrase<span epub:type=\"pagebreak\">47</span> qui continue.</p>")
        XCTAssertEqual(result.map(\.text), ["Une phrase qui continue."])
    }

    func testPronunciationGlossesWouldTurnASentenceIntoGibberish() {
        let result = blocks("<p><ruby>東<rt>とう</rt>京<rt>きょう</rt></ruby> est loin.</p>")
        XCTAssertEqual(result.map(\.text), ["東京 est loin."])
    }

    func testHiddenContentIsNotRead() {
        XCTAssertEqual(blocks("<p>Visible.</p><div hidden><p>Caché.</p></div>").map(\.text), ["Visible."])
    }

    func testListItemsAreSeparateBlocks() {
        let result = blocks("<ul><li>Un</li><li>Deux</li></ul>")
        XCTAssertEqual(result.map(\.text), ["Un", "Deux"])
    }

    func testADocumentWithNoBodyIsStillRead() {
        let result = EpubBlocks.extract(from: XmlParser.parse("<p>Sans body.</p>"))
        XCTAssertEqual(result.map(\.text), ["Sans body."])
    }
}

final class EpubPaginationTests: XCTestCase {
    private func paragraph(_ characters: Int) -> TextBlock {
        // Real sentences, because the splitter cuts at sentence ends.
        var text = ""
        var index = 0
        while text.utf16.count < characters {
            text += "Le chat numéro \(index) dort sur le mur de pierre du vieux jardin. "
            index += 1
        }
        return TextBlock(kind: .paragraph, text: String(text.prefix(characters)))
    }

    func testAShortBookIsOnePage() throws {
        let pages = try EpubPagination.paginate(chapters: [[
            TextBlock(kind: .title, text: "Chapitre un"),
            TextBlock(kind: .paragraph, text: "Le chat dort."),
        ]])
        XCTAssertEqual(pages.count, 1)
        XCTAssertEqual(pages[0].count, 2)
    }

    func testPagesStayNearTheirTargetSize() throws {
        let chapter = (0..<12).map { _ in paragraph(400) }
        let pages = try EpubPagination.paginate(chapters: [chapter])
        XCTAssertGreaterThan(pages.count, 1)
        for page in pages {
            let size = page.reduce(0) { $0 + $1.text.utf16.count }
            XCTAssertLessThanOrEqual(size, EpubPagination.pageMaxChars)
        }
    }

    func testAPageNeverEndsOnATitle() throws {
        // A heading alone at the foot of a page, with what it introduces overleaf, loses a struggling reader.
        var chapters: [[TextBlock]] = []
        for index in 0..<6 {
            chapters.append([TextBlock(kind: .title, text: "Chapitre \(index)"), paragraph(1700)])
        }
        let pages = try EpubPagination.paginate(chapters: chapters)
        for page in pages {
            XCTAssertNotEqual(page.last?.kind, .title, "a title must travel with the text under it")
        }
    }

    func testANewChapterWithATitleStartsAPage() throws {
        let pages = try EpubPagination.paginate(chapters: [
            [TextBlock(kind: .paragraph, text: "Fin du premier chapitre.")],
            [TextBlock(kind: .title, text: "Chapitre deux"), TextBlock(kind: .paragraph, text: "Suite.")],
        ])
        XCTAssertEqual(pages.count, 2)
        XCTAssertEqual(pages[1].first?.kind, .title)
    }

    func testTheCutNeverFallsInsideAParagraph() throws {
        let chapter = (0..<8).map { _ in paragraph(500) }
        let texts = chapter.map(\.text)
        let pages = try EpubPagination.paginate(chapters: [chapter])
        for page in pages {
            for block in page {
                XCTAssertTrue(texts.contains(block.text), "a page began in the middle of a paragraph")
            }
        }
    }

    func testAnEnormousParagraphIsCutAtSentenceEnds() {
        let pieces = EpubPagination.splitLongText(paragraph(9000).text)
        XCTAssertGreaterThan(pieces.count, 1)
        for piece in pieces {
            XCTAssertLessThanOrEqual(piece.utf16.count, EpubPagination.pageMaxChars)
            XCTAssertFalse(piece.isEmpty)
        }
        // Nothing of the text is lost on the way.
        let rejoined = pieces.joined(separator: " ")
        XCTAssertTrue(rejoined.contains("Le chat numéro 0"))
        XCTAssertTrue(rejoined.contains("Le chat numéro 1"))
    }

    func testAShortTextIsHandedBackUntouched() {
        XCTAssertEqual(EpubPagination.splitLongText("Le chat dort."), ["Le chat dort."])
    }

    func testARunWithNoSpacesIsStillCutAndNeverInsideACharacter() {
        let wall = String(repeating: "é", count: 6000)
        let pieces = EpubPagination.splitLongText(wall)
        XCTAssertGreaterThan(pieces.count, 1)
        for piece in pieces {
            XCTAssertFalse(piece.contains("\u{FFFD}"), "a character was cut in half")
        }
        XCTAssertEqual(pieces.joined().count, wall.count)
    }

    func testABookPastTheCeilingIsRefusedRatherThanCutShort() {
        // Importing half a book and showing it as whole would leave a child at the end of chapter nine
        // finding nothing there.
        let chapters = (0..<10).map { _ in [paragraph(2400)] }
        XCTAssertThrowsError(try EpubPagination.paginate(chapters: chapters, maxPages: 3)) { error in
            XCTAssertEqual(error as? EpubError, .tooManyPages)
        }
    }

    func testAnEmptyChapterAddsNoPage() throws {
        XCTAssertTrue(try EpubPagination.paginate(chapters: [[], []]).isEmpty)
    }
}

final class ZipArchiveTests: XCTestCase {
    func testAStoredAndADeflatedEntryBothComeBack() throws {
        let long = String(repeating: "Le chat dort sur le mur. ", count: 200)
        let archive = try ZipArchive(data: ZipWriter.archive([
            ZipWriter.Entry("mimetype", "application/epub+zip", deflated: false),
            ZipWriter.Entry("OEBPS/texte.xhtml", long),
        ]))
        XCTAssertEqual(String(decoding: try archive.read("mimetype"), as: UTF8.self), "application/epub+zip")
        XCTAssertEqual(String(decoding: try archive.read("OEBPS/texte.xhtml"), as: UTF8.self), long)
    }

    func testNamesAreFoundWhateverCaseTheyWereWrittenIn() throws {
        let archive = try ZipArchive(data: ZipWriter.archive([ZipWriter.Entry("META-INF/container.xml", "<x/>")]))
        XCTAssertEqual(archive.find("meta-inf/container.xml"), "META-INF/container.xml")
        XCTAssertNil(archive.find("META-INF/encryption.xml"))
    }

    func testAZipCommentDoesNotHideTheDirectory() throws {
        let archive = try ZipArchive(data: ZipWriter.archive(
            [ZipWriter.Entry("a.txt", "bonjour")], comment: String(repeating: "x", count: 500)
        ))
        XCTAssertEqual(String(decoding: try archive.read("a.txt"), as: UTF8.self), "bonjour")
    }

    func testAccentedNamesSurvive() throws {
        let archive = try ZipArchive(data: ZipWriter.archive([ZipWriter.Entry("OEBPS/chapître é.xhtml", "x")]))
        XCTAssertEqual(archive.find("OEBPS/chapître é.xhtml"), "OEBPS/chapître é.xhtml")
    }

    func testAPathClimbingOutOfTheArchiveIsRefused() throws {
        // These paths come from a file the app was handed; none of them may be reached.
        let archive = try ZipArchive(data: ZipWriter.archive([
            ZipWriter.Entry("ok.txt", "bonjour"),
            ZipWriter.Entry("../../etc/passwd", "root"),
            ZipWriter.Entry("/absolu.txt", "non"),
        ]))
        XCTAssertNil(archive.find("../../etc/passwd"))
        XCTAssertNil(archive.find("/absolu.txt"))
        XCTAssertEqual(archive.names, ["ok.txt"])
    }

    func testSomethingThatIsNotAZipIsRefusedRatherThanGuessedAt() {
        XCTAssertThrowsError(try ZipArchive(data: Data("pas du tout un zip".utf8)))
        XCTAssertThrowsError(try ZipArchive(data: Data()))
    }

    func testTruncatedBytesDoNotCrashTheReader() throws {
        let whole = ZipWriter.archive([ZipWriter.Entry("a.txt", "bonjour tout le monde")])
        // Every prefix of a valid file: none of them may do anything but fail cleanly.
        for length in stride(from: 0, to: whole.count, by: 7) {
            _ = try? ZipArchive(data: whole.prefix(length))
        }
        // And a directory pointing past the end of the file.
        var damaged = whole
        damaged[damaged.count - 6] = 0xFF
        damaged[damaged.count - 5] = 0xFF
        XCTAssertThrowsError(try ZipArchive(data: damaged))
    }
}

final class EpubReaderTests: XCTestCase {
    private let chapters = [
        "<h1>Le départ</h1><p>Le renard traverse la clairière pendant la nuit tranquille.</p>",
        "<h1>La rivière</h1><p>La rivière descend vers le village endormi sans aucun bruit.</p>",
    ]

    func testAWholeBookIsRead() throws {
        let book = try EpubReader.read(ZipWriter.epub(chapters: chapters))
        XCTAssertEqual(book.title, "Le renard et l’hiver")
        XCTAssertEqual(book.author, "Camille Dubois")
        XCTAssertEqual(book.pages.count, 2, "each chapter opens a page because it starts with a title")
        XCTAssertEqual(book.pages[0].map(\.kind), [.title, .paragraph])
        XCTAssertEqual(book.pages[0][0].text, "Le départ")
        XCTAssertTrue(book.pages[1][1].text.contains("village endormi"))
    }

    func testTheSpineDecidesTheOrderNotTheArchive() throws {
        // The files sit in the zip in one order and are read in another; the reading order is the spine's.
        let opf = """
            <?xml version="1.0" encoding="utf-8"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Ordre</dc:title></metadata>
              <manifest>
                <item id="b" href="second.xhtml" media-type="application/xhtml+xml"/>
                <item id="a" href="premier.xhtml" media-type="application/xhtml+xml"/>
                <item id="couv" href="couverture.xhtml" media-type="application/xhtml+xml"/>
              </manifest>
              <spine>
                <itemref idref="couv" linear="no"/>
                <itemref idref="a"/>
                <itemref idref="b"/>
              </spine>
            </package>
            """
        let container = """
            <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
              <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
            </container>
            """
        func page(_ text: String) -> String {
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>\(text)</p></body></html>"
        }
        let data = ZipWriter.archive([
            ZipWriter.Entry("META-INF/container.xml", container),
            ZipWriter.Entry("OEBPS/second.xhtml", page("Deuxième.")),
            ZipWriter.Entry("OEBPS/premier.xhtml", page("Premier.")),
            ZipWriter.Entry("OEBPS/couverture.xhtml", page("Couverture.")),
            ZipWriter.Entry("OEBPS/content.opf", opf),
        ])

        let book = try EpubReader.read(data)
        let texts = book.pages.flatMap { $0.map(\.text) }
        XCTAssertEqual(texts, ["Premier.", "Deuxième."])
        XCTAssertFalse(texts.contains("Couverture."), "« linear=no » is not part of the read-through")
    }

    func testAProtectedBookIsNamedAsProtectedNotAsBroken() {
        // The parent can act on « ce livre est protégé »; « erreur » leaves them nothing to do.
        let locked = ZipWriter.epub(chapters: chapters, extra: [ZipWriter.Entry("META-INF/rights.xml", "<rights/>")])
        XCTAssertThrowsError(try EpubReader.read(locked)) { XCTAssertEqual($0 as? EpubError, .protected) }

        let encryption = """
            <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
              <EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/></EncryptedData>
            </encryption>
            """
        let encrypted = ZipWriter.epub(chapters: chapters, extra: [ZipWriter.Entry("META-INF/encryption.xml", encryption)])
        XCTAssertThrowsError(try EpubReader.read(encrypted)) { XCTAssertEqual($0 as? EpubError, .protected) }
    }

    func testObfuscatedFontsAreNotDrmAndTheBookStillOpens() throws {
        let encryption = """
            <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
              <EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData>
            </encryption>
            """
        let book = try EpubReader.read(ZipWriter.epub(
            chapters: chapters, extra: [ZipWriter.Entry("META-INF/encryption.xml", encryption)]
        ))
        XCTAssertEqual(book.pages.count, 2, "only the fonts were scrambled; the text was always readable")
    }

    func testABookWithNoContainerIsStillOpenedFromItsPackageFile() throws {
        let opf = """
            <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sans container</dc:title></metadata>
              <manifest><item id="a" href="texte.xhtml" media-type="application/xhtml+xml"/></manifest>
              <spine><itemref idref="a"/></spine>
            </package>
            """
        let book = try EpubReader.read(ZipWriter.archive([
            ZipWriter.Entry("livre.opf", opf),
            ZipWriter.Entry("texte.xhtml", "<html><body><p>Le texte.</p></body></html>"),
        ]))
        XCTAssertEqual(book.title, "Sans container")
        XCTAssertEqual(book.pages.flatMap { $0.map(\.text) }, ["Le texte."])
    }

    func testAnEmptyBookIsRefused() {
        XCTAssertThrowsError(try EpubReader.read(ZipWriter.epub(chapters: ["<p>   </p>"]))) {
            XCTAssertEqual($0 as? EpubError, .unreadable)
        }
        XCTAssertThrowsError(try EpubReader.read(Data("rien".utf8))) {
            XCTAssertEqual($0 as? EpubError, .unreadable)
        }
    }

    func testHrefsAreResolvedAgainstTheirFolderAndCannotClimbOut() {
        XCTAssertEqual(EpubReader.resolveHref(baseDir: "OEBPS", href: "chap1.xhtml"), "OEBPS/chap1.xhtml")
        XCTAssertEqual(EpubReader.resolveHref(baseDir: "OEBPS/text", href: "../images/a.png"), "OEBPS/images/a.png")
        XCTAssertEqual(EpubReader.resolveHref(baseDir: "OEBPS", href: "/racine.xhtml"), "racine.xhtml")
        XCTAssertEqual(EpubReader.resolveHref(baseDir: "OEBPS", href: "chap1.xhtml#section2"), "OEBPS/chap1.xhtml")
        XCTAssertEqual(EpubReader.resolveHref(baseDir: "OEBPS", href: "un%20chapitre.xhtml"), "OEBPS/un chapitre.xhtml")
        // These come from the file being opened, so they must land inside it whatever they ask for.
        XCTAssertEqual(EpubReader.resolveHref(baseDir: "OEBPS", href: "../../../../etc/passwd"), "etc/passwd")
    }

    func testTextIsDecodedByWhatTheFileSaysItIs() {
        XCTAssertEqual(EpubReader.decodeText(Data("Les élèves".utf8)), "Les élèves")

        var utf16 = Data([0xFE, 0xFF])
        for unit in "Été".utf16 { utf16.append(contentsOf: [UInt8(unit >> 8), UInt8(unit & 0xFF)]) }
        XCTAssertEqual(EpubReader.decodeText(utf16), "Été")

        let declared = "<?xml version=\"1.0\" encoding=\"iso-8859-1\"?><p>café</p>"
        let latin1 = declared.data(using: .isoLatin1)!
        XCTAssertEqual(EpubReader.decodeText(latin1), declared)
    }

    func testTheReadPagesAreReadyToStore() throws {
        let book = try EpubReader.read(ZipWriter.epub(chapters: chapters))
        let pages = EpubReader.pages(of: book, documentId: "doc-1", now: 1_700_000_000_000)
        XCTAssertEqual(pages.count, 2)
        XCTAssertEqual(pages.map(\.pageIndex), [0, 1])
        for page in pages {
            XCTAssertEqual(page.status, .ready)
            XCTAssertEqual(page.textSource, .epubText)
            XCTAssertNil(page.confidence, "nothing was guessed, so there is no confidence to report")
            XCTAssertNotNil(page.contentHash)
            XCTAssertTrue(page.warnings.isEmpty)
        }
    }
}
