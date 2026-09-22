import Foundation

/// What kind of file a parent handed the app.
public enum ImportFileKind: String, Sendable {
    case pdf, image, epub
}

/// Turning what was read off a page — a PDF's own text, OCR lines — into the blocks the reader shows, and working out
/// what an imported file is.
/// Ported from `client/src/documents/DocumentParser.ts`.
public enum DocumentParser {
    /// A PDF page is read as text rather than photographed and OCR'd when it holds at least this many letters
    /// (contract §11.2).
    ///
    /// The threshold exists because a scanned PDF often carries a few stray characters — a page number, a watermark,
    /// a line of a failed OCR done by someone else. Trusting those would give the child three words instead of a page.
    public static let minPdfTextLetters = 40

    public static func countLetters(_ text: String) -> Int {
        text.unicodeScalars.reduce(0) { $0 + (isLetter($1) ? 1 : 0) }
    }

    private static func isLetter(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter:
            return true
        default:
            return false
        }
    }

    /// True when the PDF's own text is worth using, so the page is not photographed and read again for nothing.
    public static func hasUsablePdfText(_ lines: [LayoutLine]) -> Bool {
        var letters = 0
        for line in lines {
            letters += countLetters(line.text)
            if letters >= minPdfTextLetters { return true }
        }
        return false
    }

    /// Cleans the text of each block and drops the ones left empty.
    public static func cleanBlocks(_ blocks: [TextBlock]) -> [TextBlock] {
        blocks
            .map { TextBlock(kind: $0.kind, text: TextNormalizer.normalizedForDisplay($0.text), spoken: $0.spoken) }
            .filter { !$0.text.isEmpty }
    }

    /// Lines with positions become titles and paragraphs.
    public static func blocks(fromLayoutLines lines: [LayoutLine]) -> [TextBlock] {
        let cleaned = lines
            .map {
                LayoutLine(
                    text: TextNormalizer.normalizedForDisplay($0.text),
                    top: $0.top, height: $0.height, left: $0.left, fontSize: $0.fontSize
                )
            }
            .filter { !$0.text.isEmpty }
        return cleanBlocks(BlockBuilder.blocks(from: cleaned))
    }

    public static func blocks(fromOcrLines lines: [OcrLine]) -> [TextBlock] {
        blocks(fromLayoutLines: lines.map(\.layoutLine))
    }

    /// A page the app has not read yet. It exists from the first moment of the import so the parent sees the whole
    /// book appear at once and can watch it fill, rather than pages materialising out of nowhere one by one.
    public static func pendingPage(documentId: String, pageIndex: Int, now: Millis) -> PageContent {
        PageContent(documentId: documentId, pageIndex: pageIndex, status: .pending, updatedAt: now)
    }

    /// Warnings that put a page in the parent's « À vérifier » list.
    public static let doubtfulWarnings: Set<PageWarning> = [.lowConfidence, .noTextFound, .suspiciousInstructions]

    /// A page the parent should look at before the child meets it.
    public static func isDoubtful(_ page: PageContent) -> Bool {
        page.status == .lowConfidence
            || page.status == .failed
            || page.warnings.contains(where: doubtfulWarnings.contains)
    }

    // MARK: - Files

    private static let imageExtensions: Set<String> = [
        "jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "avif", "tif", "tiff",
    ]

    public static let epubMIME = "application/epub+zip"

    /// What an imported file is, from its type and failing that its name.
    ///
    /// The file picker on iPad often hands over an empty type — for a file coming from another app, from iCloud, or
    /// from a share sheet — so the extension has to be able to decide on its own.
    public static func fileKind(type: String, name: String) -> ImportFileKind? {
        let type = type.lowercased()
        let ext = (name as NSString).pathExtension.lowercased()
        if type == "application/pdf" || ext == "pdf" { return .pdf }
        if type == epubMIME || ext == "epub" { return .epub }
        if type.hasPrefix("image/") || imageExtensions.contains(ext) { return .image }
        return nil
    }

    /// Photos taken on an iPhone arrive as HEIC, which has to be converted before anything can read it.
    public static func isHeic(type: String, name: String) -> Bool {
        let type = type.lowercased()
        let ext = (name as NSString).pathExtension.lowercased()
        return type.hasPrefix("image/heic") || type.hasPrefix("image/heif") || ext == "heic" || ext == "heif"
    }

    /// « Ma leçon.pdf » → « Ma leçon ».
    ///
    /// A title a parent recognises at a glance, because the file name is all the app knows at import time and a list
    /// of « scan_2024_03_11_final(2) » helps nobody find last week's lesson.
    public static func title(fromFileName name: String) -> String {
        var title = name
        // Only a real extension, not the end of a name like « Chapitre 3.1 ».
        let ext = (name as NSString).pathExtension
        if !ext.isEmpty, ext.count <= 5 {
            title = (name as NSString).deletingPathExtension
        }
        return title
            .replacingOccurrences(of: "_", with: " ")
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
    }

    // MARK: - Pages built from what was read

    /// A page read from a PDF's own text or from an EPUB: nothing was guessed, so there is no confidence to report.
    public static func page(
        documentId: String, pageIndex: Int, blocks: [TextBlock], source: PageTextSource, now: Millis
    ) -> PageContent {
        let cleaned = cleanBlocks(blocks)
        return PageContent(
            documentId: documentId,
            pageIndex: pageIndex,
            status: cleaned.isEmpty ? .lowConfidence : .ready,
            textSource: source,
            blocks: cleaned,
            contentHash: cleaned.isEmpty ? nil : Hashing.contentHash(of: cleaned),
            warnings: cleaned.isEmpty ? [.noTextFound] : [],
            updatedAt: now
        )
    }

    /// A page read by OCR, where the score decides what the child and the parent are told.
    ///
    /// Below `lowConfidenceScore` the page is not hidden — it is opened with a warning. A child who can see the
    /// original image next to the text can often read a page the machine could not, and taking it away would help
    /// nobody.
    public static let lowConfidenceScore = 70.0

    public static func page(
        documentId: String,
        pageIndex: Int,
        blocks: [TextBlock],
        quality: QualityReport,
        source: PageTextSource,
        size: (width: Double, height: Double)? = nil,
        extraWarnings: [PageWarning] = [],
        now: Millis
    ) -> PageContent {
        let cleaned = cleanBlocks(blocks)
        var warnings = extraWarnings
        if cleaned.isEmpty {
            warnings.append(.noTextFound)
        } else if quality.score < lowConfidenceScore {
            warnings.append(.lowConfidence)
        }
        let doubtful = cleaned.isEmpty || quality.score < lowConfidenceScore
        return PageContent(
            documentId: documentId,
            pageIndex: pageIndex,
            status: doubtful ? .lowConfidence : .ready,
            textSource: source,
            blocks: cleaned,
            confidence: quality.score,
            contentHash: cleaned.isEmpty ? nil : Hashing.contentHash(of: cleaned),
            width: size?.width,
            height: size?.height,
            warnings: uniqueWarnings(warnings),
            updatedAt: now
        )
    }

    /// Keeps the first of each, so a page re-read twice does not end up with the same warning three times.
    public static func uniqueWarnings(_ warnings: [PageWarning]) -> [PageWarning] {
        var seen: Set<PageWarning> = []
        return warnings.filter { seen.insert($0).inserted }
    }

    /// A page after a parent typed its text by hand. Ported from `ProcessingQueue.savePageCorrection`.
    ///
    /// The text becomes the parent's (`manual`), is trusted as fully as a PDF's own text, and the page leaves
    /// « À vérifier ». The image and its size are kept: the child can still check the original.
    public static func manualCorrection(of previous: PageContent, blocks: [TextBlock], now: Millis) -> PageContent {
        let cleaned = cleanBlocks(blocks)
        var warnings = previous.warnings.filter {
            $0 != .lowConfidence && $0 != .noTextFound && $0 != .manuallyCorrected
        }
        warnings.append(.manuallyCorrected)
        if cleaned.isEmpty { warnings.append(.noTextFound) }

        return PageContent(
            documentId: previous.documentId,
            pageIndex: previous.pageIndex,
            status: .ready,
            textSource: .manual,
            blocks: cleaned,
            confidence: nil,
            contentHash: cleaned.isEmpty ? nil : Hashing.contentHash(of: cleaned),
            width: previous.width,
            height: previous.height,
            warnings: warnings,
            // Strictly later than the page it replaces, so the correction wins wherever it lands.
            updatedAt: max(now, previous.updatedAt + 1)
        )
    }

    /// What a document's status is, read from its pages: a book is « prêt » only when every page can be opened.
    public static func documentStatus(of pages: [PageContent]) -> DocumentStatus {
        guard !pages.isEmpty else { return .processing }
        if pages.contains(where: { $0.status == .pending || $0.status == .processing }) { return .processing }
        return pages.allSatisfy { $0.status == .ready } ? .ready : .partial
    }
}
