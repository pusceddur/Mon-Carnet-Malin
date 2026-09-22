import Foundation

/// How a book is cut up for the progressive summary (§15.4).
/// Ported from `shared/src/ai/chunks.ts`.
///
/// It has to be deterministic and identical to the web app's, down to the byte. The server keeps the summary of every
/// chunk under its hash; when the browser at home and the iPad cut the same book the same way, the second one to ask
/// gets the first one's work for free — and a summary of a whole book is the most expensive thing the help does.
public enum SummaryPlan {
    static let pageSeparator = "\n\n"

    /// Whole pages in order, packed while the chunk stays within `maxChars`. A page longer than that gets chunks of
    /// its own, cut at paragraphs, then sentences, then words. Empty pages are skipped.
    public static func chunks(
        for pages: [AIPageInput], maxChars: Int = AILimits.chunkMaxChars
    ) -> [TextChunk] {
        let limit = max(1, min(maxChars, AILimits.chunkTextMaxChars))
        var drafts: [(pageIndexes: [Int], text: String)] = []
        var pageIndexes: [Int] = []
        var texts: [String] = []
        var length = 0

        func flush() {
            if !texts.isEmpty { drafts.append((pageIndexes, texts.joined(separator: pageSeparator))) }
            pageIndexes = []
            texts = []
            length = 0
        }

        for page in pages {
            let text = page.text.trimmingCharacters(in: .whitespacesAndNewlines)
            let size = text.utf16.count
            guard size > 0 else { continue }

            if size > limit {
                flush()
                for piece in pack(text, units: units(of: text, limit: limit), limit: limit) {
                    drafts.append(([page.pageIndex], piece))
                }
                continue
            }
            if !texts.isEmpty, length + pageSeparator.utf16.count + size > limit { flush() }
            length += (texts.isEmpty ? 0 : pageSeparator.utf16.count) + size
            pageIndexes.append(page.pageIndex)
            texts.append(text)
        }
        flush()

        return drafts.enumerated().map { index, draft in
            TextChunk(
                chunkIndex: index, pageIndexes: draft.pageIndexes, text: draft.text,
                contentHash: Hashing.sha256Hex(draft.text)
            )
        }
    }

    /// The hashes of every chunk, in order, hashed together: what the final stage names the plan by.
    public static func hash(of chunks: [TextChunk]) -> String {
        Hashing.sha256Hex(chunks.map(\.contentHash).joined())
    }

    /// The pieces of an oversize page, none longer than `limit`: paragraphs, else sentences, else runs of words.
    static func units(of text: String, limit: Int) -> [TextRange] {
        let utf16 = Array(text.utf16)
        var units: [TextRange] = []

        for paragraph in Passages.paragraphs(in: text) {
            if paragraph.end - paragraph.start <= limit {
                units.append(paragraph)
                continue
            }
            let inner = String(decoding: utf16[paragraph.start..<paragraph.end], as: UTF16.self)
            for sentence in SentenceSegmenter.sentences(in: inner) {
                let start = paragraph.start + sentence.start
                let end = paragraph.start + sentence.end
                if end - start <= limit {
                    units.append(TextRange(start: start, end: end))
                } else {
                    units.append(contentsOf: Passages.hardSplit(text, start: start, end: end, limit: limit))
                }
            }
        }
        return units
    }

    /// Neighbouring pieces put back together while they fit, keeping the text between them as it was.
    static func pack(_ text: String, units: [TextRange], limit: Int) -> [String] {
        let utf16 = Array(text.utf16)
        var pieces: [String] = []
        var first: TextRange?
        var last: TextRange?

        for unit in units {
            if let open = first, let close = last, unit.end - open.start > limit {
                pieces.append(String(decoding: utf16[open.start..<close.end], as: UTF16.self))
                first = nil
            }
            if first == nil { first = unit }
            last = unit
        }
        if let open = first, let close = last {
            pieces.append(String(decoding: utf16[open.start..<close.end], as: UTF16.self))
        }
        return pieces
    }
}
