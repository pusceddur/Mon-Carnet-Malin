import CryptoKit
import Foundation

/// The hashes the app and the server agree on.
///
/// Everything here must give the same hex string as `shared/src/hash/sha256.ts`, byte for byte. A content hash tells
/// the sync that a page has not changed, and tells the cache that a summary already written still fits the page it
/// was written for; a hash that differed between the browser and the iPad would send both of them to do the same work
/// twice, and would strand a child's annotations on a page the app no longer recognises.
public enum Hashing {
    /// Lower-case hex, like the web app's.
    public static func sha256Hex(_ text: String) -> String {
        sha256Hex(Data(text.utf8))
    }

    public static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// sha256 of the normalised text of the blocks, joined by blank lines — contract §5.
    ///
    /// Normalised, so a page re-read by a better OCR that only changed accents or spacing keeps the same hash and the
    /// child keeps their marks, their summary and their place.
    public static func contentHash(of blocks: [TextBlock]) -> String {
        sha256Hex(TextNormalizer.normalizedForMatch(blocks.map(\.text).joined(separator: "\n\n")))
    }

    /// Hash of the original files, in the order they were imported: the hashes of each, concatenated, hashed again.
    /// This is what tells the app a parent is importing a book they already have.
    public static func sourceHash(ofFileHashes hashes: [String]) -> String {
        sha256Hex(hashes.joined())
    }

    /// « 10|intermediaire|simple »: what a cached answer was written for.
    ///
    /// The cache key carries it because the same page explained to an eight-year-old and to a twelve-year-old are two
    /// different answers, and handing one child the other's would be worse than a slow answer.
    public static func profileSignature(_ child: ChildProfile) -> String {
        "\(child.age)|\(child.readingLevel.rawValue)|\(child.explanationDifficulty.rawValue)"
    }
}
