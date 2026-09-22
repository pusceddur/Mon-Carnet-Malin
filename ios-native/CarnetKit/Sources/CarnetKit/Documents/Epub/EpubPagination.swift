import Foundation

/// Cutting a book that has no pages into pages.
/// Ported from `client/src/documents/EpubReader.ts`.
///
/// An EPUB reflows: it has chapters, not pages. The app needs pages because everything else is anchored to them — the
/// child's place in the book, their marks, a summary of « pages 4 à 6 », the parent's view of what was read. So the
/// text is cut into pages of a steady size, and the cut only ever falls **between** two blocks, never inside a
/// paragraph: a page that began mid-sentence would be unreadable for the reader this app is for.
public enum EpubPagination {
    /// The size a page aims for, in characters.
    public static let pageTargetChars = 1800
    /// A page never grows past this by taking one more block.
    public static let pageMaxChars = 2500
    /// A wall of very short blocks — a poem, a table — is still a page's worth of scrolling.
    public static let pageMaxBlocks = 120
    public static let maxPages = 500

    /// Splits a paragraph longer than `max` into pieces of about `target` characters, cutting at the end of a
    /// sentence. A paragraph that long is rare and usually a chapter with no markup at all.
    public static func splitLongText(
        _ text: String, target: Int = pageTargetChars, max maxChars: Int = pageMaxChars
    ) -> [String] {
        let units = Array(text.utf16)
        guard units.count > maxChars else { return [text] }

        // Sentences first; a single sentence longer than a page is cut at a space, never inside a word.
        var pieces: [(start: Int, end: Int)] = []
        for span in SentenceSegmenter.sentences(in: text) {
            if span.end - span.start > maxChars {
                pieces.append(contentsOf: wordRanges(units, span.start, span.end, target))
            } else {
                pieces.append((span.start, span.end))
            }
        }

        var out: [String] = []
        var chunk: (start: Int, end: Int)?
        for piece in pieces {
            if let current = chunk, piece.end - current.start <= target {
                chunk = (current.start, piece.end)
                continue
            }
            if let current = chunk { out.append(slice(units, current)) }
            chunk = piece
        }
        if let current = chunk { out.append(slice(units, current)) }
        return out.filter { !$0.isEmpty }
    }

    private static func slice(_ units: [UInt16], _ range: (start: Int, end: Int)) -> String {
        let start = Swift.max(0, range.start)
        let end = Swift.min(units.count, range.end)
        guard start < end else { return "" }
        return String(decoding: units[start..<end], as: UTF16.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Cuts a very long stretch at spaces, into pieces of at most `limit` UTF-16 units.
    private static func wordRanges(_ units: [UInt16], _ start: Int, _ end: Int, _ limit: Int) -> [(start: Int, end: Int)] {
        var ranges: [(start: Int, end: Int)] = []
        var from = start

        func isSpace(_ index: Int) -> Bool {
            guard index >= 0, index < units.count, let scalar = Unicode.Scalar(units[index]) else { return false }
            return scalar.properties.isWhitespace
        }

        while from < end {
            while from < end && isSpace(from) { from += 1 }
            guard from < end else { break }
            if end - from <= limit {
                ranges.append((from, end))
                break
            }

            // The last space at or before the limit.
            var cut = Swift.min(from + limit, end)
            while cut > from && !isSpace(cut) { cut -= 1 }
            if cut <= from {
                // A single run with no space in it at all: cut by length, but never between the two halves of one
                // character — a broken surrogate pair would render as a replacement box in the middle of a word.
                cut = Swift.min(from + limit, end)
                if cut < units.count, (0xDC00...0xDFFF).contains(units[cut]) { cut -= 1 }
            }
            guard cut > from else { break }
            ranges.append((from, cut))
            from = cut
        }
        return ranges
    }

    /// Groups chapters into pages of about `pageTargetChars`.
    ///
    /// A chapter that starts with a title starts a new page, and a page never ends on a title: a heading alone at the
    /// bottom of a page, with what it introduces overleaf, is exactly the kind of small break in continuity that
    /// costs a struggling reader the thread.
    public static func paginate(
        chapters: [[TextBlock]], maxPages limit: Int = maxPages
    ) throws -> [[TextBlock]] {
        var pages: [[TextBlock]] = []
        var current: [TextBlock] = []
        var size = 0

        func length(_ block: TextBlock) -> Int { block.text.utf16.count }

        // A book past the ceiling is refused rather than cut short. Importing half a book and showing it as whole
        // would leave a child reaching the end of chapter nine and finding nothing there.
        func closePage(keepTitleWithNext: Bool) throws {
            var carried: [TextBlock] = []
            if keepTitleWithNext {
                while current.count > 1, current[current.count - 1].kind == .title {
                    carried.insert(current.removeLast(), at: 0)
                }
            }
            if !current.isEmpty {
                pages.append(current)
                if pages.count > limit { throw EpubError.tooManyPages }
            }
            current = carried
            size = carried.reduce(0) { $0 + length($1) }
        }

        /// Whether the page should end before taking this block.
        func breaksBefore(_ blockLength: Int) -> Bool {
            // A page holding only titles so far has nothing on it yet.
            guard current.contains(where: { $0.kind == .paragraph }) else { return false }
            if current.count >= pageMaxBlocks { return true }
            let total = size + blockLength
            if total > pageMaxChars { return true }
            if total <= pageTargetChars { return false }
            // Past the target either way: keep whichever size lands closer to it.
            return abs(total - pageTargetChars) >= abs(size - pageTargetChars)
        }

        for chapter in chapters {
            let blocks = chapter.flatMap { block in
                splitLongText(block.text).map { TextBlock(kind: block.kind, text: $0, spoken: nil) }
            }
            guard !blocks.isEmpty else { continue }
            if blocks.contains(where: { $0.kind == .title }) { try closePage(keepTitleWithNext: false) }
            for block in blocks {
                if !current.isEmpty, breaksBefore(length(block)) { try closePage(keepTitleWithNext: true) }
                current.append(block)
                size += length(block)
            }
        }
        try closePage(keepTitleWithNext: false)
        return pages
    }
}
