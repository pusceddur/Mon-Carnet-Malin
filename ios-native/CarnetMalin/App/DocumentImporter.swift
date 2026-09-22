import CarnetKit
import CoreGraphics
import Foundation

#if canImport(UIKit)
import UIKit
#endif

/// Turning photographs and files into a book, one way for everyone.
///
/// The parent's « Ajouter un livre » and the child's « Ajouter un devoir » go through here, so there is one import
/// and not two slowly drifting apart: the same reading on the iPad, the same images kept, the same queue to the home
/// computer.
@MainActor
struct DocumentImporter {
    let library: LibraryStore
    let store: LocalStore
    let settings: ParentSettings
    let parentId: String
    /// Where technical failures go. Only error names and stages: never the text of a page, never a file name.
    var diagnostics: Diagnostics?

    struct Request {
        var title: String
        var purpose: DocumentPurpose
        var childIds: [String]
    }

    enum Failure: Error, Equatable {
        case unreadable
        case locked
        case epub(EpubError)
    }

    /// Called as pages are read: how many are done, out of how many.
    /// Told how far the import has got. Escaping wherever it is taken, because `build` hands it on to the closure
    /// that reads the pages: a closure that captures a non-escaping parameter cannot itself be passed along.
    typealias Progress = @MainActor (Int, Int) -> Void

    // MARK: - Entry points

    func importImages(_ images: [CGImage], _ request: Request, progress: @escaping Progress) async -> DocumentMeta? {
        guard !images.isEmpty else { return nil }
        return await build(kind: .images, request, pageCount: images.count, progress: progress) { documentId, report in
            var pages: [PageContent] = []
            for (index, image) in images.enumerated() {
                report(index)
                pages.append(await readScannedPage(image, documentId: documentId, pageIndex: index))
            }
            return pages
        }
    }

    func importFile(_ url: URL, _ request: Request, progress: @escaping Progress) async throws -> DocumentMeta? {
        let name = url.lastPathComponent
        var request = request
        if request.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            request.title = DocumentParser.title(fromFileName: name)
        }
        switch DocumentParser.fileKind(type: "", name: name) {
        case .epub:
            return try await importEpub(url, request, progress: progress)
        case .pdf:
            return try await importPdf(url, request, progress: progress)
        case .image:
            #if canImport(UIKit)
            guard let data = try? Data(contentsOf: url), let image = UIImage(data: data)?.cgImage else {
                await diagnostics?.report(.preprocess, message: "image decode failed", stage: "decode_image")
                throw Failure.unreadable
            }
            return await importImages([image], request, progress: progress)
            #else
            throw Failure.unreadable
            #endif
        case nil:
            throw Failure.unreadable
        }
    }

    private func importEpub(_ url: URL, _ request: Request, progress: @escaping Progress) async throws -> DocumentMeta? {
        let book: EpubBook
        do {
            book = try EpubReader.read(contentsOf: url)
        } catch let error as EpubError {
            // A protected or too long book is the file, not a problem of the app.
            if error == .unreadable { await diagnostics?.report(.processingFailed, error, stage: "epub_open") }
            throw Failure.epub(error)
        }
        var named = request
        if let title = book.title, !title.isEmpty, request.title == DocumentParser.title(fromFileName: url.lastPathComponent) {
            named.title = title
        }
        return await build(kind: .epub, named, pageCount: book.pages.count, progress: progress) { documentId, report in
            let now = Self.now()
            let pages = EpubReader.pages(of: book, documentId: documentId, now: now)
            for index in pages.indices { report(index) }
            return pages
        }
    }

    private func importPdf(_ url: URL, _ request: Request, progress: @escaping Progress) async throws -> DocumentMeta? {
        #if canImport(PDFKit) && canImport(UIKit)
        let pdf: PDFReader.Document
        do {
            pdf = try PDFReader.open(url)
        } catch PDFReader.Failure.locked {
            throw Failure.locked
        } catch {
            await diagnostics?.report(.pdf, error, stage: "pdf_open")
            throw Failure.unreadable
        }
        var named = request
        if let title = pdf.title, request.title == DocumentParser.title(fromFileName: url.lastPathComponent) {
            named.title = title
        }
        return await build(kind: .pdf, named, pageCount: pdf.pageCount, progress: progress) { documentId, report in
            var pages: [PageContent] = []
            for index in 0..<pdf.pageCount {
                report(index)
                let lines = pdf.lines(onPage: index)
                if DocumentParser.hasUsablePdfText(lines) {
                    // The PDF carries its own text: nothing is guessed, so nothing can be guessed wrong.
                    pages.append(DocumentParser.page(
                        documentId: documentId, pageIndex: index,
                        blocks: DocumentParser.blocks(fromLayoutLines: lines), source: .pdfText, now: Self.now()
                    ))
                } else if let page = pdf.page(at: index), let image = PageImaging.render(page) {
                    // A scan inside a PDF: drawn as an image and read like a photographed page.
                    pages.append(await readScannedPage(image, documentId: documentId, pageIndex: index))
                } else {
                    pages.append(DocumentParser.page(
                        documentId: documentId, pageIndex: index, blocks: [], source: .ocrLocal, now: Self.now()
                    ))
                }
            }
            return pages
        }
        #else
        throw Failure.unreadable
        #endif
    }

    // MARK: - One photographed page

    /// Kept as an image, read on the iPad, and queued for the home computer.
    ///
    /// Read here first, so the child can open the page straight away even with no connection. Sent to the home
    /// computer as well when the parent allows images to leave the iPad: its reading is usually better, and when it
    /// arrives it replaces this one — with the child's marks moved onto the new text.
    private func readScannedPage(_ image: CGImage, documentId: String, pageIndex: Int) async -> PageContent {
        let now = Self.now()
        #if canImport(UIKit)
        if let jpeg = PageImaging.jpeg(from: image), let images = PageImageStore.standard() {
            try? images.save(jpeg, documentId: documentId, pageIndex: pageIndex)
            if settings.privacy.uploadPageImages {
                ImageUploadQueue.add(PendingImageUpload(documentId: documentId, pageIndex: pageIndex), to: store)
            }
        }
        #endif

        #if canImport(Vision)
        var page: PageContent
        do {
            page = try await VisionOcr.page(
                image, documentId: documentId, pageIndex: pageIndex, wordList: WordList.empty, now: now
            )
        } catch {
            await diagnostics?.report(
                .ocrEngine, error, stage: "local_ocr",
                context: ["pageIndex": .number(Double(pageIndex)), "width": .number(Double(image.width)),
                          "height": .number(Double(image.height))]
            )
            return DocumentParser.page(documentId: documentId, pageIndex: pageIndex, blocks: [], source: .ocrLocal, now: now)
        }
        if page.status == .lowConfidence, settings.privacy.uploadPageImages, settings.ocr.aiTranscription {
            page.warnings = DocumentParser.uniqueWarnings(page.warnings + [.awaitingAi])
        }
        return page
        #else
        return DocumentParser.page(documentId: documentId, pageIndex: pageIndex, blocks: [], source: .ocrLocal, now: now)
        #endif
    }

    // MARK: - The book

    /// Makes the book, fills its pages as they are read, then sets its status from what came out.
    private func build(
        kind: DocumentKind,
        _ request: Request,
        pageCount: Int,
        progress: @escaping Progress,
        readPages: (String, (Int) -> Void) async -> [PageContent]
    ) async -> DocumentMeta? {
        let documentId = UUID().uuidString
        let now = Self.now()
        let title = request.title.trimmingCharacters(in: .whitespacesAndNewlines)

        var document = DocumentMeta(
            id: documentId,
            ownerParentId: parentId,
            childIds: request.childIds,
            title: String((title.isEmpty ? FR.Library.untitled : title).prefix(200)),
            kind: kind,
            textMode: .faithful,
            purpose: request.purpose,
            // Replaced once the pages are read; until then the book is simply new.
            sourceHash: Hashing.sha256Hex(documentId),
            pageCount: pageCount,
            status: .processing,
            createdAt: now,
            updatedAt: now
        )
        try? await library.save(document)
        progress(0, pageCount)

        let pages = await readPages(documentId) { done in progress(done + 1, pageCount) }
        for page in pages { try? await library.save(page) }

        document.pageCount = max(pages.count, pageCount)
        document.status = DocumentParser.documentStatus(of: pages)
        document.sourceHash = Hashing.sourceHash(ofFileHashes: pages.compactMap(\.contentHash))
        document.updatedAt = max(Self.now(), document.updatedAt + 1)
        try? await library.save(document)
        return document
    }

    static func now() -> Millis { Millis(Date().timeIntervalSince1970 * 1000) }

    /// Why a file would not open, in words a parent can act on.
    static func message(for error: Error) -> String {
        switch error as? Failure {
        case .locked: return "Ce PDF est protégé par un mot de passe."
        case let .epub(epubError):
            switch epubError {
            case .protected: return "Ce livre est protégé : son texte ne peut pas être lu par l’application."
            case .tooLarge: return "Ce fichier est trop gros pour l’iPad."
            case .tooManyPages: return "Ce livre est trop long. Essayez de l’importer par chapitres."
            case .unreadable: return "Ce fichier n’a pas pu être ouvert."
            }
        case .unreadable, nil: return "Ce fichier n’a pas pu être ouvert."
        }
    }
}
