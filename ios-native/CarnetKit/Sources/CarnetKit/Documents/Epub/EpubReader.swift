import Foundation

/// Why an EPUB could not be opened.
///
/// Four cases rather than one, because the app has to tell the parent something they can act on. « Ce livre est
/// protégé » sends them back to the shop that sold it; « ce fichier est trop gros » tells them to split it. A single
/// « erreur » would leave them with nothing to do but try the same thing again.
public enum EpubError: Error, Equatable {
    /// DRM. The text cannot be read, and the app will not pretend otherwise.
    case protected
    /// Not an EPUB, or damaged past reading.
    case unreadable
    case tooLarge
    case tooManyPages
}

/// A book, read.
public struct EpubBook: Equatable, Sendable {
    public let title: String?
    public let author: String?
    /// One entry per page, each a list of blocks.
    public let pages: [[TextBlock]]

    public init(title: String?, author: String?, pages: [[TextBlock]]) {
        self.title = title
        self.author = author
        self.pages = pages
    }
}

/// Reading an EPUB: zip → container.xml → OPF → XHTML → blocks → pages.
/// Ported from `client/src/documents/EpubReader.ts`.
public enum EpubReader {
    public static let maxBytes = 150 * 1024 * 1024

    /// Encryption algorithms that only obfuscate embedded fonts. Not DRM: the text is untouched and the book opens.
    private static let fontObfuscation: Set<String> = [
        "http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#rc",
    ]
    /// The presence of any of these means the book is locked, whatever else the file says.
    private static let drmFiles = ["meta-inf/rights.xml", "meta-inf/license.lcpl", "meta-inf/sinf.xml"]

    private static let contentTypes: Set<String> = [
        "application/xhtml+xml", "text/html", "application/xml", "text/xml",
    ]

    // MARK: - Text

    /// Bytes to text, believing the byte-order mark first, then the XML declaration, then UTF-8.
    public static func decodeText(_ data: Data) -> String {
        let bytes = [UInt8](data.prefix(3))
        if bytes.count >= 2 {
            // The mark itself is dropped: left in, it becomes an invisible character at the head of the first
            // sentence, which would sit inside the first word the reader highlights.
            let body = data.dropFirst(2)
            if bytes[0] == 0xFE, bytes[1] == 0xFF {
                return String(data: body, encoding: .utf16BigEndian) ?? String(decoding: data, as: UTF8.self)
            }
            if bytes[0] == 0xFF, bytes[1] == 0xFE {
                return String(data: body, encoding: .utf16LittleEndian) ?? String(decoding: data, as: UTF8.self)
            }
            if bytes.count >= 3, bytes[0] == 0xEF, bytes[1] == 0xBB, bytes[2] == 0xBF {
                return String(decoding: data.dropFirst(3), as: UTF8.self)
            }
        }

        if let declared = declaredEncoding(of: data), let encoding = encoding(named: declared),
           encoding != .utf8, let text = String(data: data, encoding: encoding) {
            return text
        }
        // Lenient on purpose: a stray bad byte becomes a replacement character instead of closing the book.
        return String(decoding: data, as: UTF8.self)
    }

    /// The `encoding="…"` of an XML declaration, if there is one in the first couple of hundred bytes.
    private static func declaredEncoding(of data: Data) -> String? {
        let head = String(decoding: data.prefix(200), as: UTF8.self)
        guard let xml = head.range(of: "<?xml"), head[head.startIndex..<xml.lowerBound].allSatisfy(\.isWhitespace),
              let key = head.range(of: "encoding", range: xml.upperBound..<head.endIndex)
        else { return nil }

        var rest = head[key.upperBound...].drop(while: { $0.isWhitespace })
        guard rest.first == "=" else { return nil }
        rest = rest.dropFirst().drop(while: { $0.isWhitespace })
        guard let quote = rest.first, quote == "\"" || quote == "'" else { return nil }
        rest = rest.dropFirst()
        guard let close = rest.firstIndex(of: quote) else { return nil }
        let name = String(rest[rest.startIndex..<close])
        return name.isEmpty ? nil : name
    }

    private static func encoding(named name: String) -> String.Encoding? {
        let cfName = name as CFString
        let cfEncoding = CFStringConvertIANACharSetNameToEncoding(cfName)
        guard cfEncoding != kCFStringEncodingInvalidId else { return nil }
        return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cfEncoding))
    }

    // MARK: - Paths

    /// The zip path a manifest `href` points at, relative to the folder holding the OPF.
    ///
    /// The `..` segments are resolved here and the result can never climb above the root, which matters because these
    /// paths come from the file being opened: a book asking for `../../../etc/passwd` gets the root instead.
    public static func resolveHref(baseDir: String, href: String) -> String {
        var path = href
        if let hash = path.firstIndex(of: "#") { path = String(path[path.startIndex..<hash]) }
        if let query = path.firstIndex(of: "?") { path = String(path[path.startIndex..<query]) }
        path = path.removingPercentEncoding ?? path

        let parts = (path.hasPrefix("/") ? [] : baseDir.split(separator: "/").map(String.init))
            + path.split(separator: "/").map(String.init)
        var out: [String] = []
        for part in parts {
            if part.isEmpty || part == "." { continue }
            if part == ".." {
                if !out.isEmpty { out.removeLast() }
            } else {
                out.append(part)
            }
        }
        return out.joined(separator: "/")
    }

    private static func directory(of path: String) -> String {
        guard let slash = path.lastIndex(of: "/") else { return "" }
        return String(path[path.startIndex..<slash])
    }

    // MARK: - The package

    private struct PackageInfo {
        let title: String?
        let author: String?
        let contentPaths: [String]
    }

    private static func metadataText(_ opf: XmlElement, _ name: String) -> String? {
        let metadata = opf.firstDescendant(named: "metadata") ?? opf
        for element in metadata.descendants(named: name) {
            let text = EpubBlocks.cleanInlineText(element.textContent)
            if !text.isEmpty { return text }
        }
        return nil
    }

    private static func readPackage(_ zip: ZipArchive, opfPath: String, opfBytes: Data) -> PackageInfo {
        let opf = XmlParser.parse(decodeText(opfBytes))
        let baseDir = directory(of: opfPath)

        var manifest: [String: (path: String, mediaType: String)] = [:]
        for item in opf.descendants(named: "item") {
            guard let id = item.attribute("id"), let href = item.attribute("href") else { continue }
            manifest[id] = (
                path: resolveHref(baseDir: baseDir, href: href),
                mediaType: (item.attribute("media-type") ?? "").lowercased()
            )
        }

        // The spine is the reading order, which is not the order the files sit in the archive.
        var contentPaths: [String] = []
        for itemref in opf.descendants(named: "itemref") {
            // « linear=no » marks what is not part of the read-through: covers, colophons, advertising.
            if (itemref.attribute("linear") ?? "").trimmingCharacters(in: .whitespaces).lowercased() == "no" {
                continue
            }
            guard let idref = itemref.attribute("idref"), let item = manifest[idref] else { continue }
            let isContent = item.mediaType.isEmpty
                ? item.path.lowercased().hasSuffix(".html") || item.path.lowercased().hasSuffix(".xhtml")
                    || item.path.lowercased().hasSuffix(".htm")
                : contentTypes.contains(item.mediaType)
            guard isContent, let name = zip.find(item.path), !contentPaths.contains(name) else { continue }
            contentPaths.append(name)
        }

        let title = metadataText(opf, "title").map {
            String($0.replacingOccurrences(of: "\n", with: " ").prefix(200))
        }
        return PackageInfo(title: title, author: metadataText(opf, "creator"), contentPaths: contentPaths)
    }

    /// Refuses a book the app cannot honestly open.
    ///
    /// A DRM'd book is not read half-way and shown as a broken one: the parent is told it is protected, which is
    /// true, actionable, and not something the app can or should work around.
    private static func checkProtection(_ zip: ZipArchive, encryptionXml: Data?) throws {
        if drmFiles.contains(where: { zip.contains($0) }) { throw EpubError.protected }
        guard let encryptionXml else { return }

        for data in XmlParser.parse(decodeText(encryptionXml)).descendants(named: "encrypteddata") {
            let method = data.firstDescendant(named: "encryptionmethod")
            let algorithm = (method?.attribute("algorithm") ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard fontObfuscation.contains(algorithm) else { throw EpubError.protected }
        }
    }

    // MARK: - Reading

    /// Reads an EPUB held in memory.
    public static func read(_ data: Data) throws -> EpubBook {
        guard data.count <= maxBytes else { throw EpubError.tooLarge }

        let zip: ZipArchive
        do {
            zip = try ZipArchive(data: data)
        } catch ZipArchive.Failure.entryTooLarge {
            throw EpubError.tooLarge
        } catch {
            throw EpubError.unreadable
        }

        let encryptionName = zip.find("META-INF/encryption.xml")
        try checkProtection(zip, encryptionXml: encryptionName.flatMap { try? zip.read($0) })

        var opfName: String?
        if let containerName = zip.find("META-INF/container.xml"), let container = try? zip.read(containerName) {
            for rootfile in XmlParser.parse(decodeText(container)).descendants(named: "rootfile") {
                guard let fullPath = rootfile.attribute("full-path") else { continue }
                if let found = zip.find(resolveHref(baseDir: "", href: fullPath)) {
                    opfName = found
                    break
                }
            }
        }
        // No container, or one pointing nowhere: look for the package file itself. Books like that exist.
        if opfName == nil {
            opfName = zip.names.sorted().first { $0.lowercased().hasSuffix(".opf") }
        }
        guard let opfName, let opfBytes = try? zip.read(opfName) else { throw EpubError.unreadable }

        let info = readPackage(zip, opfPath: opfName, opfBytes: opfBytes)
        guard !info.contentPaths.isEmpty else { throw EpubError.unreadable }

        var chapters: [[TextBlock]] = []
        for path in info.contentPaths {
            guard let bytes = try? zip.read(path) else { continue }
            chapters.append(EpubBlocks.extract(from: XmlParser.parse(decodeText(bytes))))
        }

        let pages = try EpubPagination.paginate(chapters: chapters)
        guard !pages.isEmpty else { throw EpubError.unreadable }
        return EpubBook(title: info.title, author: info.author, pages: pages)
    }

    /// Reads an EPUB from disk, checking its size before it is loaded into memory.
    public static func read(contentsOf url: URL) throws -> EpubBook {
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= maxBytes else { throw EpubError.tooLarge }
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { throw EpubError.unreadable }
        return try read(data)
    }

    /// The pages of a read book, as the app stores them.
    public static func pages(of book: EpubBook, documentId: String, now: Millis) -> [PageContent] {
        book.pages.enumerated().map { index, blocks in
            DocumentParser.page(
                documentId: documentId, pageIndex: index, blocks: blocks, source: .epubText, now: now
            )
        }
    }
}
