import Compression
import Foundation

/// Builds zip files for the tests, because the reader has to be tried against real bytes rather than a mock.
///
/// It writes both shapes a real EPUB uses: stored entries (mimetype must be stored, by the spec) and deflated ones.
enum ZipWriter {
    struct Entry {
        let name: String
        let data: Data
        let deflated: Bool

        init(_ name: String, _ text: String, deflated: Bool = true) {
            self.name = name
            self.data = Data(text.utf8)
            self.deflated = deflated
        }

        init(_ name: String, data: Data, deflated: Bool = true) {
            self.name = name
            self.data = data
            self.deflated = deflated
        }
    }

    private static func uint16(_ value: Int) -> Data {
        let v = UInt16(truncatingIfNeeded: value)
        return Data([UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF)])
    }

    private static func uint32(_ value: Int) -> Data {
        let v = UInt32(truncatingIfNeeded: value)
        return Data([
            UInt8(v & 0xFF), UInt8((v >> 8) & 0xFF), UInt8((v >> 16) & 0xFF), UInt8((v >> 24) & 0xFF),
        ])
    }

    /// Raw deflate, the other half of what the reader does.
    static func deflate(_ data: Data) -> Data? {
        guard !data.isEmpty else { return Data() }
        let capacity = data.count + 1024
        return data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Data? in
            guard let source = raw.bindMemory(to: UInt8.self).baseAddress else { return nil }
            let destination = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
            defer { destination.deallocate() }
            let written = compression_encode_buffer(
                destination, capacity, source, data.count, nil, COMPRESSION_ZLIB
            )
            guard written > 0 else { return nil }
            return Data(bytes: destination, count: written)
        }
    }

    static func archive(_ entries: [Entry], comment: String = "") -> Data {
        var out = Data()
        var directory = Data()
        var offsets: [Int] = []

        for entry in entries {
            let payload = entry.deflated ? (deflate(entry.data) ?? entry.data) : entry.data
            let method = entry.deflated && payload != entry.data ? 8 : 0
            let name = Data(entry.name.utf8)
            offsets.append(out.count)

            out.append(Data([0x50, 0x4B, 0x03, 0x04]))
            out.append(uint16(20))              // version needed
            out.append(uint16(0))               // flags
            out.append(uint16(method))
            out.append(uint16(0))               // time
            out.append(uint16(0))               // date
            out.append(uint32(0))               // crc32, which the reader does not check
            out.append(uint32(payload.count))
            out.append(uint32(entry.data.count))
            out.append(uint16(name.count))
            out.append(uint16(0))               // extra length
            out.append(name)
            out.append(payload)

            directory.append(Data([0x50, 0x4B, 0x01, 0x02]))
            directory.append(uint16(20))        // version made by
            directory.append(uint16(20))        // version needed
            directory.append(uint16(0))
            directory.append(uint16(method))
            directory.append(uint16(0))
            directory.append(uint16(0))
            directory.append(uint32(0))
            directory.append(uint32(payload.count))
            directory.append(uint32(entry.data.count))
            directory.append(uint16(name.count))
            directory.append(uint16(0))         // extra
            directory.append(uint16(0))         // comment
            directory.append(uint16(0))         // disk
            directory.append(uint16(0))         // internal attributes
            directory.append(uint32(0))         // external attributes
            directory.append(uint32(offsets[offsets.count - 1]))
            directory.append(name)
        }

        let directoryOffset = out.count
        out.append(directory)
        let commentBytes = Data(comment.utf8)
        out.append(Data([0x50, 0x4B, 0x05, 0x06]))
        out.append(uint16(0))
        out.append(uint16(0))
        out.append(uint16(entries.count))
        out.append(uint16(entries.count))
        out.append(uint32(directory.count))
        out.append(uint32(directoryOffset))
        out.append(uint16(commentBytes.count))
        out.append(commentBytes)
        return out
    }

    /// A small, valid EPUB.
    static func epub(
        title: String = "Le renard et l’hiver",
        author: String = "Camille Dubois",
        chapters: [String],
        extra: [Entry] = []
    ) -> Data {
        let container = """
            <?xml version="1.0"?>
            <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
              <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
            </container>
            """
        let manifest = chapters.indices.map {
            "<item id=\"c\($0)\" href=\"chap\($0).xhtml\" media-type=\"application/xhtml+xml\"/>"
        }.joined(separator: "\n    ")
        let spine = chapters.indices.map { "<itemref idref=\"c\($0)\"/>" }.joined(separator: "\n    ")
        let opf = """
            <?xml version="1.0" encoding="utf-8"?>
            <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
              <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>\(title)</dc:title>
                <dc:creator>\(author)</dc:creator>
              </metadata>
              <manifest>
                \(manifest)
              </manifest>
              <spine>
                \(spine)
              </spine>
            </package>
            """

        var entries: [Entry] = [
            Entry("mimetype", "application/epub+zip", deflated: false),
            Entry("META-INF/container.xml", container),
            Entry("OEBPS/content.opf", opf),
        ]
        for (index, body) in chapters.enumerated() {
            entries.append(Entry("OEBPS/chap\(index).xhtml", """
                <?xml version="1.0" encoding="utf-8"?>
                <html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>
                \(body)
                </body></html>
                """))
        }
        return archive(entries + extra)
    }
}
