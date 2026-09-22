import Foundation

/// Finds a quote (`SourceRef.quote`) in the blocks of a page, to show the child the passage an exercise or an answer
/// comes from. Ported from `findQuote` in `client/src/features/reader/model.ts`.
///
/// Compared word by word in normalized form, so punctuation, case, accents and spacing may differ. A long quote also
/// matches by its first and last words: the machine that read the page may have got a word wrong in the middle.
public enum QuoteFinder {
    static let edgeTokens = 5

    private struct Token {
        let normalized: String
        let start: Int
        let end: Int
    }

    /// The first place the quote is found on the page, or nil.
    public static func find(_ quote: String, in page: PageContent) -> ReaderRange? {
        find(quote, pageIndex: page.pageIndex, blocks: page.blocks.map(\.text))
    }

    public static func find(_ quote: String, pageIndex: Int, blocks: [String]) -> ReaderRange? {
        let needle = tokens(quote).map(\.normalized)
        guard !needle.isEmpty else { return nil }
        let tokenized = blocks.map(tokens)

        for (blockIndex, words) in tokenized.enumerated() {
            let at = sequence(needle, in: words)
            if at >= 0 {
                return ReaderRange(
                    pageIndex: pageIndex, blockIndex: blockIndex,
                    start: words[at].start, end: words[at + needle.count - 1].end
                )
            }
        }

        guard needle.count >= edgeTokens * 2 else { return nil }
        let head = Array(needle.prefix(edgeTokens))
        let tail = Array(needle.suffix(edgeTokens))
        for (blockIndex, words) in tokenized.enumerated() {
            let first = sequence(head, in: words)
            guard first >= 0 else { continue }
            let last = sequence(tail, in: words, from: first + edgeTokens)
            // Not so far apart that it is two unrelated sentences that happen to share their edges.
            if last >= 0, last - first <= needle.count * 2 {
                return ReaderRange(
                    pageIndex: pageIndex, blockIndex: blockIndex,
                    start: words[first].start, end: words[last + edgeTokens - 1].end
                )
            }
        }
        return nil
    }

    private static func tokens(_ text: String) -> [Token] {
        Tokenizer.tokenizeWords(text).compactMap { token in
            let normalized = TextNormalizer.normalizedForMatch(token.word)
            return normalized.isEmpty ? nil : Token(normalized: normalized, start: token.start, end: token.end)
        }
    }

    private static func sequence(_ needle: [String], in haystack: [Token], from: Int = 0) -> Int {
        guard !needle.isEmpty, from >= 0 else { return -1 }
        var index = from
        while index + needle.count <= haystack.count {
            if needle.indices.allSatisfy({ haystack[index + $0].normalized == needle[$0] }) { return index }
            index += 1
        }
        return -1
    }
}
