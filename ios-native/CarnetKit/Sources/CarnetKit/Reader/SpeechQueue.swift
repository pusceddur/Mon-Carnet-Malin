import Foundation

/// One sentence the voice will read.
///
/// `text` is what the page shows and what stays highlighted; `spoken` is what the voice actually says when a prepared
/// version exists (§22). They can differ in punctuation and capitals only, which is what lets the app follow along in
/// a text that is written without punctuation while the voice reads it as a sentence.
public struct SpeechItem: Equatable, Sendable {
    public let id: String
    public let text: String
    public let spoken: String?

    public init(id: String, text: String, spoken: String? = nil) {
        self.id = id
        self.text = text
        self.spoken = spoken
    }

    /// What the synthesizer receives.
    public var utterance: String { spoken ?? text }
}

/// Where a sentence sits in the book.
public struct SpeechPosition: Equatable, Sendable {
    public let pageIndex: Int
    public let blockIndex: Int
    public let sentenceIndex: Int

    public init(pageIndex: Int, blockIndex: Int = 0, sentenceIndex: Int = 0) {
        self.pageIndex = pageIndex
        self.blockIndex = blockIndex
        self.sentenceIndex = sentenceIndex
    }

    /// One number that orders positions: page, then block, then sentence.
    var order: Int { pageIndex * 100_000_000 + blockIndex * 10_000 + sentenceIndex }
}

/// A page as the reader holds it: its text, and whether it can be read at all.
public struct PageModel: Equatable, Sendable {
    public let pageIndex: Int
    public let status: PageStatus
    public let blocks: [BlockModel]

    public init(pageIndex: Int, status: PageStatus, blocks: [BlockModel]) {
        self.pageIndex = pageIndex
        self.status = status
        self.blocks = blocks
    }

    /// A page still being read by the machine has nothing to show yet; one read with doubts is shown, with a warning.
    public var isReadable: Bool {
        status == .ready || status == .lowConfidence
    }
}

/// Turning the pages of a book into the queue the voice works through.
/// Ported from the speech part of `client/src/features/reader/model.ts`.
public enum SpeechQueue {
    /// Identifier of a sentence, stable across sessions so reading can resume where it stopped.
    public static func itemId(pageIndex: Int, blockIndex: Int, sentenceIndex: Int) -> String {
        "\(pageIndex):\(blockIndex):\(sentenceIndex)"
    }

    public static func position(fromItemId id: String?) -> SpeechPosition? {
        guard let id else { return nil }
        let parts = id.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3,
              let page = Int(parts[0]), let block = Int(parts[1]), let sentence = Int(parts[2]),
              page >= 0, block >= 0, sentence >= 0 else { return nil }
        return SpeechPosition(pageIndex: page, blockIndex: block, sentenceIndex: sentence)
    }

    /// One item per sentence that holds at least one word, readable pages in order.
    ///
    /// A sentence of pure punctuation would make the voice pause on nothing and the highlight jump to a blank, so it
    /// never becomes an item.
    public static func build(from pages: [PageModel]) -> [SpeechItem] {
        var items: [SpeechItem] = []
        for page in pages.sorted(by: { $0.pageIndex < $1.pageIndex }) where page.isReadable {
            for block in page.blocks {
                for sentence in block.sentences where !sentence.words.isEmpty {
                    items.append(SpeechItem(
                        id: itemId(pageIndex: page.pageIndex, blockIndex: block.blockIndex, sentenceIndex: sentence.index),
                        text: sentence.text,
                        spoken: sentence.spoken
                    ))
                }
            }
        }
        return items
    }

    /// Where to start reading for a given place in the book: that sentence when it exists, otherwise the first one
    /// after it. Asking to read from a page whose sentences are all punctuation must still start somewhere.
    public static func startIndex(in items: [SpeechItem], at position: SpeechPosition) -> Int {
        let target = position.order
        if let found = items.firstIndex(where: { item in
            guard let parsed = self.position(fromItemId: item.id) else { return false }
            return parsed.order >= target
        }) {
            return found
        }
        return max(0, items.count - 1)
    }
}
