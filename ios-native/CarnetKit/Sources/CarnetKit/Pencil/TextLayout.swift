import Foundation

/// Where one word of a page ended up on screen.
///
/// `charOffset` is the word's place in the text of its block, in UTF-16 units — the same unit the whole app counts
/// in. That is what ties a mark drawn here to the same word on another device, where the font, the size and the
/// column width are all different.
public struct WordBox: Equatable, Sendable {
    public var blockIndex: Int
    public var charOffset: Int
    /// Length of the word in the block's text, in UTF-16 units.
    public var length: Int
    /// The size the word is drawn at, which is what the em coordinates of a stroke are measured in.
    public var fontSize: Double
    public var rect: Rect

    public init(blockIndex: Int, charOffset: Int, length: Int, fontSize: Double, rect: Rect) {
        self.blockIndex = blockIndex
        self.charOffset = charOffset
        self.length = length
        self.fontSize = fontSize
        self.rect = rect
    }

    public var left: Double { rect.left }
    public var top: Double { rect.top }
    public var width: Double { rect.width }
    public var height: Double { rect.height }
    public var endOffset: Int { charOffset + length }
}

/// One block of a page as it was laid out.
public struct BlockLayout: Equatable, Sendable {
    public var blockIndex: Int
    /// Hash of the text this block was laid out from, when the view knows it.
    public var textHash: String?
    /// The text the view actually drew, used when the stored page is not to hand.
    public var text: String?
    public var fontSize: Double
    /// Sorted by `charOffset`.
    public var words: [WordBox]

    public init(blockIndex: Int, textHash: String? = nil, text: String? = nil, fontSize: Double, words: [WordBox] = []) {
        self.blockIndex = blockIndex
        self.textHash = textHash
        self.text = text
        self.fontSize = fontSize
        self.words = words
    }
}

/// A whole page as it was laid out, which is what the pencil draws on top of.
public struct TextLayout: Equatable, Sendable {
    public var pageIndex: Int
    /// In reading order.
    public var words: [WordBox]
    public var blocks: [Int: BlockLayout]

    public init(pageIndex: Int, blocks: [BlockLayout], words: [WordBox]) {
        self.pageIndex = pageIndex
        self.words = words
        var map: [Int: BlockLayout] = [:]
        for var block in blocks {
            block.words = words.filter { $0.blockIndex == block.blockIndex }.sorted { $0.charOffset < $1.charOffset }
            map[block.blockIndex] = block
        }
        self.blocks = map
    }

    /// The word box nearest a point, zero distance inside one. The first in reading order wins a tie, so the same
    /// gesture always picks the same word.
    public func nearestWord(to point: Pt) -> WordBox? {
        var best: WordBox?
        var bestDistance = Double.infinity
        for word in words {
            let d = Geometry.distanceToRect(point, word.rect)
            if d < bestDistance {
                best = word
                bestDistance = d
                if d == 0 { break }
            }
        }
        return best
    }

    /// The word starting exactly at `charOffset`; failing that the last one before it, failing that the first of the
    /// block. A mark whose word is gone lands beside its neighbour rather than nowhere.
    public func wordBox(blockIndex: Int, charOffset: Int) -> WordBox? {
        guard let block = blocks[blockIndex], !block.words.isEmpty else { return nil }
        var before: WordBox?
        for word in block.words {
            if word.charOffset == charOffset { return word }
            if word.charOffset < charOffset { before = word }
        }
        return before ?? block.words.first
    }

    /// True when two words sit on the same line of text.
    static func sameLine(_ a: WordBox, _ b: WordBox) -> Bool {
        abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 0.5 * max(a.height, b.height)
    }

    /// The middle band of a word, used by the highlighter.
    ///
    /// Insets on every side on purpose: a stroke that only clips the top or the bottom edge of a word belongs to the
    /// line above or below it, and colouring in both lines when the child meant one is worse than colouring neither.
    static func core(of word: WordBox) -> Rect {
        let insetX = min(word.width * 0.2, word.fontSize * 0.25)
        return Rect(
            left: word.left + insetX,
            top: word.top + word.height * 0.3,
            width: max(word.width - 2 * insetX, 1),
            height: max(word.height * 0.4, 1)
        )
    }

    /// The words a highlighter stroke really went through.
    public func wordsCrossed(by stroke: [Pt]) -> [WordBox] {
        guard let box = Geometry.boundingBox(stroke) else { return [] }
        return words.filter { word in
            guard word.left <= box.maxX, word.rect.right >= box.minX,
                  word.top <= box.maxY, word.rect.bottom >= box.minY
            else { return false }
            return Geometry.polylineToRectDistance(stroke, Self.core(of: word)) == 0
        }
    }
}

/// Where the text of a block comes from: the stored page first, what was drawn as a fallback.
public struct BlockTextSource: Sendable {
    private let pageBlocks: [TextBlock]
    private let layoutBlocks: [Int: BlockLayout]

    public init(layout: TextLayout, page: PageContent?) {
        self.pageBlocks = page?.blocks ?? []
        self.layoutBlocks = layout.blocks
    }

    public func text(_ blockIndex: Int) -> String? {
        if blockIndex >= 0, blockIndex < pageBlocks.count { return pageBlocks[blockIndex].text }
        return layoutBlocks[blockIndex]?.text
    }

    public func hash(_ blockIndex: Int) -> String? {
        if blockIndex >= 0, blockIndex < pageBlocks.count {
            return Anchoring.blockTextHash(pageBlocks[blockIndex].text)
        }
        guard let block = layoutBlocks[blockIndex] else { return nil }
        if let hash = block.textHash { return hash }
        return block.text.map(Anchoring.blockTextHash)
    }
}

/// A stretch of a block the child coloured in.
public struct HighlightRange: Equatable, Sendable {
    public var pageIndex: Int
    public var blockIndex: Int
    public var start: Int
    public var end: Int
    public var text: String
    public var blockTextHash: String
}

public enum Highlighting {
    /// One range per block, running from the first word crossed to the last — the ones in between included.
    ///
    /// A child sweeping across a line does not touch every word of it evenly, and a highlight full of gaps is not
    /// what they meant to make.
    public static func ranges(
        from words: [WordBox], pageIndex: Int, source: BlockTextSource
    ) -> [HighlightRange] {
        var byBlock: [Int: (start: Int, end: Int)] = [:]
        for word in words {
            if let current = byBlock[word.blockIndex] {
                byBlock[word.blockIndex] = (min(current.start, word.charOffset), max(current.end, word.endOffset))
            } else {
                byBlock[word.blockIndex] = (word.charOffset, word.endOffset)
            }
        }

        var ranges: [HighlightRange] = []
        for blockIndex in byBlock.keys.sorted() {
            guard let span = byBlock[blockIndex],
                  let text = source.text(blockIndex),
                  let hash = source.hash(blockIndex),
                  span.end > span.start
            else { continue }
            let units = Array(text.utf16)
            guard span.start >= 0, span.end <= units.count else { continue }
            ranges.append(HighlightRange(
                pageIndex: pageIndex,
                blockIndex: blockIndex,
                start: span.start,
                end: span.end,
                text: String(decoding: units[span.start..<span.end], as: UTF16.self),
                blockTextHash: hash
            ))
        }
        return ranges
    }

    /// The eraser over a highlight. Nil when it was not touched; otherwise what is left of it, which may be nothing.
    ///
    /// In `stroke` mode the whole highlight goes, in `partial` mode only the words the eraser passed over — so a
    /// child who coloured one word too many takes back that word and keeps the rest.
    public static func erase(
        highlight: (blockIndex: Int, start: Int, end: Int),
        layout: TextLayout,
        eraserPath: [Pt],
        radius: Double,
        mode: EraserMode
    ) -> [(start: Int, end: Int)]? {
        let words = (layout.blocks[highlight.blockIndex]?.words ?? [])
            .filter { $0.charOffset >= highlight.start && $0.charOffset < highlight.end }
        let touched = words.map { Geometry.polylineToRectDistance(eraserPath, $0.rect) <= radius }
        guard touched.contains(true) else { return nil }
        guard mode == .partial else { return [] }

        var ranges: [(start: Int, end: Int)] = []
        var run: [WordBox] = []

        func flush() {
            defer { run = [] }
            guard let first = run.first, let last = run.last else { return }
            // The ends of the highlight are kept as they were: they may have included punctuation that is not
            // part of any word, and the child chose where they were.
            let start = first == words.first ? highlight.start : first.charOffset
            let end = last == words.last ? highlight.end : last.endOffset
            ranges.append((start, end))
        }

        for (index, word) in words.enumerated() {
            if touched[index] { flush() } else { run.append(word) }
        }
        flush()
        return ranges
    }
}
