#if canImport(PDFKit)
import CoreGraphics
import Foundation
import PDFKit

/// Reading a PDF with the system's own engine.
///
/// A PDF is either a document that carries its text or a stack of photographs with nothing in it. The two look
/// identical to a parent, so the app decides per page rather than per file: a scanned chapter bound together with a
/// typed exercise sheet is one file, and both halves have to come out readable.
public enum PDFReader {
    public enum Failure: Error, Equatable {
        case unreadable
        /// The file is locked with a password the app does not have.
        case locked
    }

    /// Opens a PDF and says, page by page, what will have to be done with it.
    public struct Document {
        let pdf: PDFDocument

        public var pageCount: Int { pdf.pageCount }

        /// The title the file itself claims, when it is not the useless default a converter left behind.
        public var title: String? {
            guard let title = (pdf.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty
            else { return nil }
            // Converters leave « untitled », « Document1 » and the original path behind; a parent recognises none of
            // them, and the file name is a better guess than any of them.
            let lowered = title.lowercased()
            let useless = ["untitled", "sans titre", "document", "microsoft word", "print", "impression"]
            guard !useless.contains(where: { lowered.hasPrefix($0) }), !title.contains("/"), !title.contains("\\") else {
                return nil
            }
            return title
        }

        /// The lines of a page with where they sit, in a space whose origin is the top left corner.
        public func lines(onPage index: Int) -> [LayoutLine] {
            guard let page = pdf.page(at: index) else { return [] }
            return PDFReader.lines(of: page)
        }

        /// True when the page carries enough of its own text to be read without photographing it.
        public func hasText(onPage index: Int) -> Bool {
            DocumentParser.hasUsablePdfText(lines(onPage: index))
        }

        /// The page itself, for drawing it as an image when it carries no text of its own.
        public func page(at index: Int) -> PDFPage? {
            pdf.page(at: index)
        }

        public func size(ofPage index: Int) -> CGSize? {
            pdf.page(at: index).map { $0.bounds(for: .mediaBox).size }
        }
    }

    public static func open(_ url: URL) throws -> Document {
        guard let pdf = PDFDocument(url: url) else { throw Failure.unreadable }
        return try checked(pdf)
    }

    public static func open(data: Data) throws -> Document {
        guard let pdf = PDFDocument(data: data) else { throw Failure.unreadable }
        return try checked(pdf)
    }

    private static func checked(_ pdf: PDFDocument) throws -> Document {
        // A locked file is named as locked. « Erreur » would leave the parent with nothing to do but try again.
        if pdf.isEncrypted && pdf.isLocked { throw Failure.locked }
        guard pdf.pageCount > 0 else { throw Failure.unreadable }
        return Document(pdf: pdf)
    }

    // MARK: - Lines

    /// Groups the characters of a page into lines.
    ///
    /// PDFKit hands over a page's text as one run with no notion of a line, and the block builder further on needs to
    /// know where each line sits — a title is a title because of where it is on the page and how tall it is, not
    /// because of anything in the text. So each character's box is asked for and the ones sharing a baseline are put
    /// back together.
    static func lines(of page: PDFPage) -> [LayoutLine] {
        let count = page.numberOfCharacters
        guard count > 0, let text = page.string, !text.isEmpty else { return [] }

        let pageBounds = page.bounds(for: .mediaBox)
        let characters = Array(text)
        guard characters.count == count else {
            // The two disagree — a page with ligatures or an unusual encoding. Rather than risk pairing the wrong
            // box with the wrong letter, the page is handed over as one block and the layout is simply not used.
            return [LayoutLine(text: text, top: 0, height: 12, left: 0)]
        }

        struct Run {
            var characters: [Character] = []
            var minX = Double.greatestFiniteMagnitude
            var maxY = -Double.greatestFiniteMagnitude
            var minY = Double.greatestFiniteMagnitude
            var maxHeight = 0.0
        }

        var runs: [Run] = []
        var current = Run()
        var previousCenter: Double?

        for index in 0..<count {
            let character = characters[index]
            let box = page.characterBounds(at: index)
            let isNewline = character == "\n" || character == "\r" || character == "\u{2028}"
            let center = box.midY
            let height = max(box.height, 1)

            // A new line when the text says so, or when the baseline moved by more than half a line's height. The
            // second test is what catches a PDF that stores a whole paragraph without a single line break.
            let jumped = previousCenter.map { abs($0 - center) > height * 0.5 } ?? false
            if (isNewline || jumped), !current.characters.isEmpty {
                runs.append(current)
                current = Run()
                previousCenter = nil
            }
            if isNewline { continue }

            current.characters.append(character)
            current.minX = min(current.minX, box.minX)
            current.minY = min(current.minY, box.minY)
            current.maxY = max(current.maxY, box.maxY)
            current.maxHeight = max(current.maxHeight, height)
            previousCenter = center
        }
        if !current.characters.isEmpty { runs.append(current) }

        return runs.compactMap { run in
            let text = String(run.characters).trimmingCharacters(in: .whitespaces)
            guard !text.isEmpty else { return nil }
            return LayoutLine(
                // PDF counts from the bottom of the page and everything else in the app counts from the top.
                text: text,
                top: pageBounds.maxY - run.maxY,
                height: run.maxY - run.minY > 0 ? run.maxY - run.minY : run.maxHeight,
                left: run.minX - pageBounds.minX,
                fontSize: run.maxHeight
            )
        }
    }

    /// The pages of a PDF that carry their own text, ready to store. Pages that do not are left out: they have to be
    /// photographed and read, which is a different path and a slower one.
    public static func textPages(
        of document: Document, documentId: String, now: Millis
    ) -> [Int: PageContent] {
        var pages: [Int: PageContent] = [:]
        for index in 0..<document.pageCount {
            let lines = document.lines(onPage: index)
            guard DocumentParser.hasUsablePdfText(lines) else { continue }
            pages[index] = DocumentParser.page(
                documentId: documentId,
                pageIndex: index,
                blocks: DocumentParser.blocks(fromLayoutLines: lines),
                source: .pdfText,
                now: now
            )
        }
        return pages
    }
}
#endif
