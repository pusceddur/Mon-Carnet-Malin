import Foundation

/// Finding a child's marks again after the text under them changed (§15.7).
///
/// A page gets re-read: a better OCR, a parent's correction, the same book imported again. The words move. Every
/// underline, every note in a margin, every highlight is tied to a place in the old text, and without this they
/// would all land on the wrong words or disappear.
///
/// It matters more than it sounds. A child's marks on a book are their work — what they found hard, what they wanted
/// to remember, where they stopped. Losing them because a parent fixed a typo would teach them not to mark anything.
public enum Reanchor {
    /// Below this, two stretches of text are not the same sentence lightly edited but a different one.
    static let minimumSimilarity = 0.8

    /// What can be re-anchored, whichever kind of annotation it came from.
    public struct Source: Equatable, Sendable {
        public var blockIndex: Int
        /// Where it starts in the block's text.
        public var start: Int
        /// The words to look for.
        public var needleText: String
        public var blockTextHash: String
        /// For a highlight, where it ends. Nil for a stroke, whose span is its context.
        public var end: Int?

        var isInk: Bool { end == nil }

        public init(blockIndex: Int, start: Int, needleText: String, blockTextHash: String, end: Int? = nil) {
            self.blockIndex = blockIndex
            self.start = start
            self.needleText = needleText
            self.blockTextHash = blockTextHash
            self.end = end
        }

        /// The place of a stroke anchored to text.
        public static func ink(_ space: InkSpace) -> Source? {
            guard case let .text(_, blockIndex, charOffset, hash, contextText, _) = space else { return nil }
            return Source(
                blockIndex: blockIndex, start: charOffset, needleText: contextText, blockTextHash: hash
            )
        }

        public static func highlight(_ highlight: TextHighlight) -> Source {
            Source(
                blockIndex: highlight.blockIndex,
                start: highlight.start,
                needleText: highlight.text,
                blockTextHash: highlight.blockTextHash,
                end: highlight.end
            )
        }
    }

    public enum Result: Equatable, Sendable {
        case found(blockIndex: Int, start: Int, end: Int)
        /// The text it was on is gone. The mark is kept and listed in « Mes notes », never deleted: the app does not
        /// throw away a child's work because it could not work out where it belonged.
        case orphan
    }

    /// Blocks in order of nearness: the one it was in, then the next, then the one before, and outwards.
    ///
    /// Text usually moves a little, not to the far end of the page, and searching outwards means the nearest match
    /// wins — which is almost always the right one when a word appears more than once.
    static func blockOrder(count: Int, origin: Int) -> [Int] {
        guard count > 0 else { return [] }
        let start = min(max(origin, 0), count - 1)
        var order = [start]
        var distance = 1
        while order.count < count {
            if start + distance < count { order.append(start + distance) }
            if start - distance >= 0 { order.append(start - distance) }
            distance += 1
        }
        return order
    }

    private static func exactMatches(_ tokens: [Anchoring.NormalizedToken], _ needle: [String]) -> [Int] {
        guard !needle.isEmpty, tokens.count >= needle.count else { return [] }
        var found: [Int] = []
        for index in 0...(tokens.count - needle.count) {
            var matches = true
            for offset in needle.indices where tokens[index + offset].normalized != needle[offset] {
                matches = false
                break
            }
            if matches { found.append(index) }
        }
        return found
    }

    private static func matches(_ tokens: [Anchoring.NormalizedToken], _ needle: [String], at start: Int) -> Bool {
        guard let index = tokens.firstIndex(where: { $0.start == start }), index + needle.count <= tokens.count
        else { return false }
        return needle.indices.allSatisfy { tokens[index + $0].normalized == needle[$0] }
    }

    /// How much two sets of words have in common, from 0 to 1.
    static func similarity(_ a: Set<String>, _ b: Set<String>) -> Double {
        let shared = a.intersection(b).count
        let total = a.count + b.count - shared
        return total == 0 ? 0 : Double(shared) / Double(total)
    }

    /// The nearest stretch of words that is close enough to be the same one, a word longer or shorter included.
    ///
    /// This is what survives an ordinary correction: a typo fixed, an accent added, a word dropped. The exact search
    /// above would have already found it otherwise, so by the time this runs the text really has changed.
    private static func bestFuzzy(
        _ tokens: [Anchoring.NormalizedToken], _ needle: [String], near origin: Int
    ) -> (index: Int, count: Int)? {
        guard !needle.isEmpty, !tokens.isEmpty else { return nil }
        let wanted = Set(needle)
        var best: (index: Int, count: Int, score: Double, distance: Int)?

        for length in [needle.count - 1, needle.count, needle.count + 1] where length >= 1 {
            let size = min(length, tokens.count)
            guard size >= 1, tokens.count >= size else { continue }
            for index in 0...(tokens.count - size) {
                let window = Set(tokens[index..<(index + size)].map(\.normalized))
                let score = similarity(window, wanted)
                guard score >= minimumSimilarity else { continue }
                let distance = abs(tokens[index].start - origin)
                if best == nil || score > best!.score || (score == best!.score && distance < best!.distance) {
                    best = (index, size, score, distance)
                }
            }
        }
        return best.map { (index: $0.index, count: $0.count) }
    }

    /// Keeps the punctuation the child had inside their highlight when the new text has it in the same place.
    private static func withSurroundings(
        text: String, blockText: String, start: Int, end: Int
    ) -> (start: Int, end: Int) {
        let units = Array(text.utf16)
        let blockUnits = Array(blockText.utf16)
        let tokens = Tokenizer.tokenizeWords(text)
        guard let first = tokens.first, let last = tokens.last else { return (start, end) }

        let lead = String(decoding: units[0..<min(first.start, units.count)], as: UTF16.self)
        let trail = String(decoding: units[min(last.end, units.count)...], as: UTF16.self)

        func slice(_ from: Int, _ to: Int) -> String? {
            guard from >= 0, to <= blockUnits.count, from <= to else { return nil }
            return String(decoding: blockUnits[from..<to], as: UTF16.self)
        }

        let newStart = !lead.isEmpty && slice(start - lead.utf16.count, start) == lead
            ? start - lead.utf16.count
            : start
        let newEnd = !trail.isEmpty && slice(end, end + trail.utf16.count) == trail
            ? end + trail.utf16.count
            : end
        return (newStart, newEnd)
    }

    /// Finds where a mark belongs in a page's current text.
    ///
    /// Four steps, cheapest and surest first: the block's hash is unchanged and the words are still where they were;
    /// the same words found exactly, in that block or the nearest one; nearly the same words; nothing.
    public static func find(_ anchor: Source, in page: PageContent) -> Result {
        let blocks = page.blocks
        guard !blocks.isEmpty else { return .orphan }

        let needle = Anchoring.normalizedTokens(anchor.needleText).map(\.normalized)

        if anchor.blockIndex >= 0, anchor.blockIndex < blocks.count {
            let sameBlock = blocks[anchor.blockIndex]
            if Anchoring.blockTextHash(sameBlock.text) == anchor.blockTextHash {
                // The hash is taken on normalised text, so spacing or capitals may have moved the raw offsets even
                // though nothing a reader would notice has changed. The words are checked, not assumed.
                let units = Array(sameBlock.text.utf16)
                let stillThere: Bool
                if anchor.isInk {
                    stillThere = needle.isEmpty
                        || matches(Anchoring.normalizedTokens(sameBlock.text), needle, at: anchor.start)
                } else if let end = anchor.end, anchor.start >= 0, end <= units.count, anchor.start <= end {
                    stillThere = String(decoding: units[anchor.start..<end], as: UTF16.self) == anchor.needleText
                } else {
                    stillThere = false
                }
                if stillThere {
                    let end = anchor.end ?? min(units.count, anchor.start + anchor.needleText.utf16.count)
                    return .found(blockIndex: anchor.blockIndex, start: anchor.start, end: end)
                }
            }
        }

        guard !needle.isEmpty else { return .orphan }
        let order = blockOrder(count: blocks.count, origin: anchor.blockIndex)

        func result(_ blockIndex: Int, _ tokens: [Anchoring.NormalizedToken], _ index: Int, _ count: Int) -> Result {
            let start = tokens[index].start
            let end = tokens[index + count - 1].end
            guard !anchor.isInk else { return .found(blockIndex: blockIndex, start: start, end: end) }
            let span = withSurroundings(
                text: anchor.needleText, blockText: blocks[blockIndex].text, start: start, end: end
            )
            return .found(blockIndex: blockIndex, start: span.start, end: span.end)
        }

        for blockIndex in order {
            let tokens = Anchoring.normalizedTokens(blocks[blockIndex].text)
            let matches = exactMatches(tokens, needle)
            guard !matches.isEmpty else { continue }
            // The same words can appear twice on a page; the one nearest where the mark was is the one meant.
            let best = matches.min { abs(tokens[$0].start - anchor.start) < abs(tokens[$1].start - anchor.start) }
                ?? matches[0]
            return result(blockIndex, tokens, best, needle.count)
        }

        for blockIndex in order {
            let tokens = Anchoring.normalizedTokens(blocks[blockIndex].text)
            if let fuzzy = bestFuzzy(tokens, needle, near: anchor.start) {
                return result(blockIndex, tokens, fuzzy.index, fuzzy.count)
            }
        }
        return .orphan
    }

    /// True when a mark's text is gone from a page that does have text.
    ///
    /// A page with no text at all is « not known yet », not « lost »: a book still being read would otherwise
    /// declare every mark on it an orphan while the pages were still arriving.
    public static func isOrphan(_ annotation: Annotation, on page: PageContent?) -> Bool {
        guard annotation.isTextAnchored, let page, !page.blocks.isEmpty else { return false }
        switch annotation {
        case let .highlight(highlight):
            return find(.highlight(highlight), in: page) == .orphan
        case let .ink(ink):
            guard let source = Source.ink(ink.space) else { return false }
            return find(source, in: page) == .orphan
        case .textBox:
            return false
        }
    }

    /// The far end of a stroke that crosses lines, found again in the new text.
    private static func endAnchor(
        of space: InkSpace, oldPage: PageContent?, newPage: PageContent
    ) -> TextEndAnchor? {
        guard case let .text(_, _, _, _, _, endAnchor) = space, let end = endAnchor else { return nil }

        // With the old text to hand, the far word is searched for exactly like the near one.
        if let oldPage, oldPage.blocks.indices.contains(end.blockIndex) {
            let oldBlock = oldPage.blocks[end.blockIndex]
            let source = Source(
                blockIndex: end.blockIndex,
                start: end.charOffset,
                needleText: Anchoring.buildContextText(oldBlock.text, charOffset: end.charOffset),
                blockTextHash: Anchoring.blockTextHash(oldBlock.text)
            )
            switch find(source, in: newPage) {
            case .orphan: return nil
            case let .found(blockIndex, start, _): return TextEndAnchor(blockIndex: blockIndex, charOffset: start)
            }
        }

        // Without it, the far word is kept only if a word still starts exactly there.
        guard newPage.blocks.indices.contains(end.blockIndex) else { return nil }
        let text = newPage.blocks[end.blockIndex].text
        return Tokenizer.tokenizeWords(text).contains { $0.start == end.charOffset } ? end : nil
    }

    /// A copy of an annotation moved onto the new text. The same one when nothing changed, nil when it is an orphan.
    ///
    /// `oldPage` is the text the mark was made on. It is not required, but with it the far end of a stroke that
    /// crosses lines can be found properly rather than guessed at.
    public static func move(
        _ annotation: Annotation, from oldPage: PageContent?, to newPage: PageContent
    ) -> Annotation? {
        guard annotation.isTextAnchored else { return annotation }

        switch annotation {
        case var .highlight(highlight):
            guard case let .found(blockIndex, start, end) = find(.highlight(highlight), in: newPage),
                  newPage.blocks.indices.contains(blockIndex)
            else { return nil }
            let block = newPage.blocks[blockIndex]
            let hash = Anchoring.blockTextHash(block.text)
            let units = Array(block.text.utf16)
            guard start >= 0, end <= units.count, start <= end else { return nil }
            let text = String(decoding: units[start..<end], as: UTF16.self)

            if blockIndex == highlight.blockIndex, start == highlight.start, end == highlight.end,
               hash == highlight.blockTextHash, text == highlight.text {
                return annotation
            }
            highlight.blockIndex = blockIndex
            highlight.start = start
            highlight.end = end
            highlight.blockTextHash = hash
            highlight.text = text
            return .highlight(highlight)

        case var .ink(ink):
            guard let source = Source.ink(ink.space),
                  case let .text(pageIndex, _, _, _, _, _) = ink.space,
                  case let .found(blockIndex, start, _) = find(source, in: newPage),
                  newPage.blocks.indices.contains(blockIndex)
            else { return nil }
            let block = newPage.blocks[blockIndex]
            let hash = Anchoring.blockTextHash(block.text)

            if blockIndex == source.blockIndex, start == source.start, hash == source.blockTextHash {
                return annotation
            }
            // Worked out from the old space, before it is replaced.
            let movedEnd = endAnchor(of: ink.space, oldPage: oldPage, newPage: newPage)
            ink.space = .text(
                pageIndex: pageIndex,
                blockIndex: blockIndex,
                charOffset: start,
                blockTextHash: hash,
                contextText: Anchoring.buildContextText(block.text, charOffset: start),
                endAnchor: movedEnd
            )
            return .ink(ink)

        case .textBox:
            return annotation
        }
    }

    /// Where to draw a stroke on a page right now, without changing anything that is stored.
    ///
    /// Used when the text was changed on another device and the change has arrived but the marks have not been moved
    /// yet: the child sees them in the right place immediately, and the stored form is corrected in its own time.
    public static func currentAnchor(
        of space: InkSpace, on page: PageContent?
    ) -> Anchoring.TextAnchorRef? {
        guard case let .text(_, blockIndex, charOffset, _, _, endAnchor) = space else { return nil }
        guard let page, !page.blocks.isEmpty else {
            return Anchoring.TextAnchorRef(blockIndex: blockIndex, charOffset: charOffset, endAnchor: endAnchor)
        }
        guard let source = Source.ink(space), case let .found(newBlock, newStart, _) = find(source, in: page) else {
            return nil
        }
        guard let end = endAnchor, newBlock != blockIndex || newStart != charOffset else {
            return Anchoring.TextAnchorRef(blockIndex: newBlock, charOffset: newStart, endAnchor: endAnchor)
        }

        // The near anchor moved, so the far one is moved by the same amount. An approximation, and a much better one
        // than leaving it where it was, which would stretch the stroke across the page.
        let blockDelta = newBlock - blockIndex
        let sameBlock = end.blockIndex == blockIndex
        return Anchoring.TextAnchorRef(
            blockIndex: newBlock,
            charOffset: newStart,
            endAnchor: TextEndAnchor(
                blockIndex: max(0, end.blockIndex + blockDelta),
                charOffset: sameBlock ? max(0, end.charOffset + (newStart - charOffset)) : end.charOffset
            )
        )
    }
}
