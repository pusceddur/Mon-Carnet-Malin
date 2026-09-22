import Compression
import Foundation

/// A minimal reader for zip files, which is what an EPUB is.
///
/// Written by hand rather than taken from a package. An EPUB comes from outside the app — a parent downloads it, a
/// school sends it — so the code that opens it is the part most exposed to a malformed or hostile file. Every length
/// read out of the file is checked against the file's real size before it is used, no entry is inflated past a fixed
/// ceiling, and nothing is ever read from a path the central directory did not declare. A dependency would be less
/// code and far less certainty about exactly that.
public struct ZipArchive {
    /// One entry of the central directory.
    struct Entry {
        let name: String
        let compressionMethod: UInt16
        let compressedSize: Int
        let uncompressedSize: Int
        /// Offset of the local header, which is where the data really begins.
        let localHeaderOffset: Int
    }

    public enum Failure: Error, Equatable {
        /// Not a zip, or damaged past reading.
        case unreadable
        /// An entry claims a size the app will not allocate.
        case entryTooLarge
    }

    private let data: Data
    private let entries: [String: Entry]
    /// The names as the file spells them, found from a lower-cased path.
    private let namesByLowercase: [String: String]

    /// One entry larger than this is refused rather than inflated. A zip bomb is a few kilobytes on disk and all the
    /// memory on the device once opened.
    static let maxEntryBytes = 64 * 1024 * 1024

    public init(data: Data) throws {
        self.data = data
        let entries = try Self.readCentralDirectory(data)
        guard !entries.isEmpty else { throw Failure.unreadable }
        self.entries = Dictionary(entries.map { ($0.name, $0) }, uniquingKeysWith: { first, _ in first })
        self.namesByLowercase = Dictionary(
            entries.map { ($0.name.lowercased(), $0.name) }, uniquingKeysWith: { first, _ in first }
        )
    }

    /// The name as the file spells it, found whatever case the path was written in: EPUBs disagree about
    /// « META-INF » and « meta-inf », and a book must not fail to open over that.
    public func find(_ path: String) -> String? {
        namesByLowercase[path.lowercased()]
    }

    public var names: [String] { Array(namesByLowercase.values) }

    public func contains(_ path: String) -> Bool { find(path) != nil }

    /// The bytes of one entry, inflated.
    public func read(_ name: String) throws -> Data {
        guard let entry = entries[name] else { throw Failure.unreadable }
        guard entry.uncompressedSize <= Self.maxEntryBytes, entry.compressedSize <= Self.maxEntryBytes else {
            throw Failure.entryTooLarge
        }
        let start = try dataStart(of: entry)
        guard let payload = Self.slice(data, start, entry.compressedSize) else { throw Failure.unreadable }

        switch entry.compressionMethod {
        case 0:
            return payload
        case 8:
            guard let inflated = Self.inflate(payload, expecting: entry.uncompressedSize) else {
                throw Failure.unreadable
            }
            return inflated
        default:
            // bzip2, lzma and the rest: legal in a zip, absent from real EPUBs, and not worth the surface.
            throw Failure.unreadable
        }
    }

    // MARK: - Reading the directory

    // Every offset below counts from the first byte of the file. `Data` does not always start at zero — a slice
    // carries its parent's indices — so nothing indexes it directly; it all goes through these three.

    private static func byte(_ data: Data, _ offset: Int) -> UInt8? {
        guard offset >= 0, offset < data.count else { return nil }
        return data[data.startIndex + offset]
    }

    private static func slice(_ data: Data, _ from: Int, _ count: Int) -> Data? {
        guard from >= 0, count >= 0, from + count <= data.count else { return nil }
        let base = data.startIndex + from
        return data.subdata(in: base..<(base + count))
    }

    private static func readUInt16(_ data: Data, _ offset: Int) -> UInt16? {
        guard offset >= 0, offset + 2 <= data.count else { return nil }
        let base = data.startIndex + offset
        return UInt16(data[base]) | (UInt16(data[base + 1]) << 8)
    }

    private static func readUInt32(_ data: Data, _ offset: Int) -> UInt32? {
        guard offset >= 0, offset + 4 <= data.count else { return nil }
        let base = data.startIndex + offset
        var value: UInt32 = 0
        for i in (0..<4).reversed() {
            value = (value << 8) | UInt32(data[base + i])
        }
        return value
    }

    /// Finds « End of central directory » at the tail of the file and walks the entries it points at.
    private static func readCentralDirectory(_ data: Data) throws -> [Entry] {
        // The record sits at the very end unless the zip carries a comment, which is at most 65535 bytes long.
        let searchFrom = max(0, data.count - (22 + 0xFFFF))
        var end = -1
        var offset = data.count - 22
        while offset >= searchFrom {
            if byte(data, offset) == 0x50, readUInt32(data, offset) == 0x0605_4B50 {
                end = offset
                break
            }
            offset -= 1
        }
        guard end >= 0,
              let size = readUInt32(data, end + 12).map(Int.init),
              let start = readUInt32(data, end + 16).map(Int.init),
              start >= 0, size >= 0, start + size <= data.count
        else { throw Failure.unreadable }

        var entries: [Entry] = []
        var cursor = start
        let limit = start + size
        // The record also states how many entries there are. That number is ignored: it is 0xFFFF on a zip64 file and
        // simply wrong on a few writers, while the bytes themselves are not. The walk stops when they run out.
        while cursor + 46 <= limit {
            guard readUInt32(data, cursor) == 0x0201_4B50 else { break }
            guard let method = readUInt16(data, cursor + 10),
                  let compressed = readUInt32(data, cursor + 20).map(Int.init),
                  let uncompressed = readUInt32(data, cursor + 24).map(Int.init),
                  let nameLength = readUInt16(data, cursor + 28).map(Int.init),
                  let extraLength = readUInt16(data, cursor + 30).map(Int.init),
                  let commentLength = readUInt16(data, cursor + 32).map(Int.init),
                  let localOffset = readUInt32(data, cursor + 42).map(Int.init)
            else { break }

            let nameStart = cursor + 46
            guard nameStart + nameLength <= limit, localOffset >= 0, localOffset < data.count,
                  let nameBytes = slice(data, nameStart, nameLength)
            else { break }
            // Names are UTF-8 in any EPUB worth the name; anything else is read leniently rather than refused.
            let name = String(decoding: nameBytes, as: UTF8.self)

            // A path climbing out of the archive is refused outright, whatever it points at.
            if !name.isEmpty, !name.hasSuffix("/"), !name.contains(".."), !name.hasPrefix("/") {
                entries.append(Entry(
                    name: name,
                    compressionMethod: method,
                    compressedSize: compressed,
                    uncompressedSize: uncompressed,
                    localHeaderOffset: localOffset
                ))
            }
            cursor = nameStart + nameLength + extraLength + commentLength
        }
        return entries
    }

    /// Where an entry's bytes start, read from its own local header rather than from the directory: the two disagree
    /// often enough, and the local one is the one the data follows.
    private func dataStart(of entry: Entry) throws -> Int {
        let header = entry.localHeaderOffset
        guard header + 30 <= data.count, Self.readUInt32(data, header) == 0x0403_4B50,
              let nameLength = Self.readUInt16(data, header + 26).map(Int.init),
              let extraLength = Self.readUInt16(data, header + 28).map(Int.init)
        else { throw Failure.unreadable }
        let start = header + 30 + nameLength + extraLength
        guard start <= data.count else { throw Failure.unreadable }
        return start
    }

    // MARK: - Inflate

    /// Raw deflate, through the system's own decompressor.
    static func inflate(_ payload: Data, expecting uncompressedSize: Int) -> Data? {
        guard !payload.isEmpty else { return uncompressedSize == 0 ? Data() : nil }
        // The declared size is a hint, not a promise: the buffer allows for a file that lies a little, and stops well
        // short of what a zip bomb would ask for.
        let capacity = min(max(uncompressedSize, payload.count * 4, 4096) + 64, Self.maxEntryBytes)

        return payload.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Data? in
            guard let source = raw.bindMemory(to: UInt8.self).baseAddress else { return nil }
            let destination = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
            defer { destination.deallocate() }

            let written = compression_decode_buffer(
                destination, capacity, source, payload.count, nil, COMPRESSION_ZLIB
            )
            // Zero means either an empty result or a failure; the two are told apart by what was expected.
            guard written > 0 || uncompressedSize == 0 else { return nil }
            return Data(bytes: destination, count: written)
        }
    }
}
