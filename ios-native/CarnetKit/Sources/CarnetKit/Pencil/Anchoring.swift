import Foundation

/// Tying a stroke to the text it was drawn on, and untying it again to draw it.
/// Ported from `client/src/pencil/anchoring.ts` (contract §15.7).
///
/// This is the piece that makes a pencil useful in a reflowing reader. A child underlines a word at one font size,
/// changes the size, comes back on another device, has the page read again by a better engine — and the underline is
/// still under that word. Storing screen coordinates would put it across three others.
public enum Anchoring {
    /// Coordinates are rounded before being stored. A stroke is hundreds of points and they travel on every sync;
    /// four decimals of an em is far finer than anything the eye can see, and far smaller to send.
    static let emDecimals = 4
    static let fractionDecimals = 5
    static let pressureDecimals = 3
    /// How many words are kept around the anchor to find it again.
    static let contextWords = 6
    static let contextMaxChars = 120

    static func round(_ value: Double, _ decimals: Int) -> Double {
        let factor = pow(10.0, Double(decimals))
        return (value * factor).rounded() / factor
    }

    // MARK: - Block text

    /// The hash of a block's text: sha256 of its normalised form, the same value the reader marks its blocks with.
    ///
    /// Normalised, so that a page read again with different spacing or capitals still matches and nothing has to be
    /// searched for. Memoised because re-anchoring runs once per annotation of a page, over the same few blocks.
    public static func blockTextHash(_ text: String) -> String {
        hashes.value(for: text) { Hashing.sha256Hex(TextNormalizer.normalizedForMatch(text)) }
    }

    private static let hashes = SmallCache<String, String>(limit: 400)
    private static let tokens = SmallCache<String, [NormalizedToken]>(limit: 400)

    /// A word of a block, in the form used to compare, with where it sits in the raw text.
    struct NormalizedToken: Equatable, Sendable {
        let normalized: String
        let start: Int
        let end: Int
    }

    static func normalizedTokens(_ text: String) -> [NormalizedToken] {
        tokens.value(for: text) {
            var out: [NormalizedToken] = []
            for token in Tokenizer.tokenizeWords(text) {
                // Normalising can split one token into several — « arc-en-ciel » becomes three — and each piece has
                // to be comparable on its own while still pointing at the whole word.
                for piece in TextNormalizer.normalizedForMatch(token.word).split(separator: " ") where !piece.isEmpty {
                    out.append(NormalizedToken(normalized: String(piece), start: token.start, end: token.end))
                }
            }
            return out
        }
    }

    /// The words kept with an annotation so its place can be found again: the anchor word and the few that follow.
    ///
    /// A few words rather than one, because one word appears many times on a page and the app would have no way to
    /// tell which « le » the child meant. A few rather than many, because the more text is kept the more likely it
    /// is that some of it changed.
    public static func buildContextText(_ text: String, charOffset: Int) -> String {
        let units = Array(text.utf16)
        let tokens = Tokenizer.tokenizeWords(text)
        guard let index = tokens.firstIndex(where: { $0.end > charOffset }) else {
            let start = min(max(charOffset, 0), units.count)
            return String(decoding: units[start..<min(start + 40, units.count)], as: UTF16.self)
        }

        let first = tokens[index]
        let start = min(first.start, max(charOffset, 0))
        var end = first.end
        var next = index + 1
        while next < min(tokens.count, index + contextWords) {
            if tokens[next].end - start > contextMaxChars { break }
            end = tokens[next].end
            next += 1
        }
        guard start >= 0, end <= units.count, start < end else { return "" }
        return String(decoding: units[start..<end], as: UTF16.self)
    }

    // MARK: - Anchoring a stroke to the text

    public struct AnchoredStroke: Equatable, Sendable {
        public var space: InkSpace
        /// In em, relative to the anchor word.
        public var points: [InkPoint]
        /// In em of the anchor word's own size, so a stroke keeps its weight when the text is enlarged.
        public var width: Double
    }

    /// Where point `i` of a stroke sits between its two anchors: 0 on the first, 1 on the last.
    static func strokeT(_ index: Int, _ count: Int) -> Double {
        count <= 1 ? 0 : Double(index) / Double(count - 1)
    }

    private struct Frame {
        let x: Double
        let y: Double
        let scale: Double
    }

    private static func frame(_ a: WordBox, _ b: WordBox?, _ t: Double) -> Frame {
        guard let b, t != 0 else { return Frame(x: a.left, y: a.top, scale: a.fontSize) }
        return Frame(
            x: a.left + (b.left - a.left) * t,
            y: a.top + (b.top - a.top) * t,
            scale: a.fontSize + (b.fontSize - a.fontSize) * t
        )
    }

    /// Anchors a stroke drawn in screen points to the text underneath it.
    ///
    /// A stroke that stays on one line is held by the word nearest its middle. A stroke that runs from one line to
    /// the next — a bracket down a margin, a line joining two ideas — is held by **two** words, one at each end, and
    /// every point in between is measured against an origin interpolated between them. So when the text reflows the
    /// stroke stretches between the same two words instead of lying across whatever happens to be there; and when
    /// nothing has moved, the interpolation is exact and the stroke is drawn where it was made.
    public static func anchorToText(
        points: [InkPoint], width: Double, layout: TextLayout, source: BlockTextSource
    ) -> AnchoredStroke? {
        guard let box = Geometry.boundingBox(points), let first = points.first, let last = points.last else {
            return nil
        }
        guard let startWord = layout.nearestWord(to: Pt(first)),
              let endWord = layout.nearestWord(to: Pt(last))
        else { return nil }

        let multiLine = points.count >= 2 && !TextLayout.sameLine(startWord, endWord)
        guard let anchor = multiLine ? startWord : layout.nearestWord(to: box.center) else { return nil }
        guard let hash = source.hash(anchor.blockIndex) else { return nil }

        let end = multiLine ? endWord : nil
        let text = source.text(anchor.blockIndex)

        return AnchoredStroke(
            space: .text(
                pageIndex: layout.pageIndex,
                blockIndex: anchor.blockIndex,
                charOffset: anchor.charOffset,
                blockTextHash: hash,
                contextText: text.map { buildContextText($0, charOffset: anchor.charOffset) } ?? "",
                endAnchor: end.map { TextEndAnchor(blockIndex: $0.blockIndex, charOffset: $0.charOffset) }
            ),
            points: points.enumerated().map { index, point in
                let f = frame(anchor, end, strokeT(index, points.count))
                return InkPoint(
                    x: round((point.x - f.x) / f.scale, emDecimals),
                    y: round((point.y - f.y) / f.scale, emDecimals),
                    p: round(point.p, pressureDecimals)
                )
            },
            width: round(width / anchor.fontSize, emDecimals)
        )
    }

    /// What a stored stroke is held by.
    public struct TextAnchorRef: Equatable, Sendable {
        public var blockIndex: Int
        public var charOffset: Int
        public var endAnchor: TextEndAnchor?

        public init(blockIndex: Int, charOffset: Int, endAnchor: TextEndAnchor? = nil) {
            self.blockIndex = blockIndex
            self.charOffset = charOffset
            self.endAnchor = endAnchor
        }
    }

    /// Turns a stored stroke back into screen points. Nil when its word is not on screen at all.
    public static func resolveTextStroke(
        anchor: TextAnchorRef, points: [InkPoint], width: Double, layout: TextLayout
    ) -> (points: [InkPoint], width: Double)? {
        guard let a = layout.wordBox(blockIndex: anchor.blockIndex, charOffset: anchor.charOffset) else { return nil }
        // The far word is off screen — a stroke crossing a page break. It falls back to hanging from its first
        // anchor, which is wrong by a little, rather than vanishing, which is wrong by everything.
        let b = anchor.endAnchor.map {
            layout.wordBox(blockIndex: $0.blockIndex, charOffset: $0.charOffset) ?? a
        }

        return (
            points: points.enumerated().map { index, point in
                let f = frame(a, b, strokeT(index, points.count))
                return InkPoint(x: f.x + point.x * f.scale, y: f.y + point.y * f.scale, p: point.p)
            },
            width: width * a.fontSize
        )
    }

    // MARK: - The page image, and an answer box

    /// Where the page image sits inside the surface: its own proportions kept, centred across, aligned to the top.
    public struct PageFrame: Equatable, Sendable {
        public var left: Double
        public var top: Double
        public var width: Double
        public var height: Double

        public init(left: Double, top: Double, width: Double, height: Double) {
            self.left = left
            self.top = top
            self.width = width
            self.height = height
        }
    }

    public static func fitPageFrame(
        surfaceWidth: Double, surfaceHeight: Double, imageSize: (width: Double, height: Double)?
    ) -> PageFrame {
        guard let imageSize, imageSize.width > 0, imageSize.height > 0, surfaceWidth > 0, surfaceHeight > 0 else {
            return PageFrame(left: 0, top: 0, width: surfaceWidth, height: surfaceHeight)
        }
        let scale = min(surfaceWidth / imageSize.width, surfaceHeight / imageSize.height)
        let width = imageSize.width * scale
        return PageFrame(
            left: (surfaceWidth - width) / 2, top: 0, width: width, height: imageSize.height * scale
        )
    }

    public static func toOriginalSpace(
        points: [InkPoint], width: Double, frame: PageFrame
    ) -> (points: [InkPoint], width: Double)? {
        guard frame.width > 0, frame.height > 0 else { return nil }
        return (
            points: points.map {
                InkPoint(
                    x: round(($0.x - frame.left) / frame.width, fractionDecimals),
                    y: round(($0.y - frame.top) / frame.height, fractionDecimals),
                    p: round($0.p, pressureDecimals)
                )
            },
            width: round(width / frame.width, fractionDecimals + 1)
        )
    }

    public static func fromOriginalSpace(
        points: [InkPoint], width: Double, frame: PageFrame
    ) -> (points: [InkPoint], width: Double) {
        (
            points: points.map {
                InkPoint(x: frame.left + $0.x * frame.width, y: frame.top + $0.y * frame.height, p: $0.p)
            },
            width: width * frame.width
        )
    }

    /// Both coordinates are fractions of the box's **width**, not one of each.
    ///
    /// An answer box grows taller as the child writes in it. Measuring the vertical against the height would squash
    /// what they had already written every time the box grew, under their hand.
    public static func toAnswerSpace(
        points: [InkPoint], width: Double, boxWidth: Double
    ) -> (points: [InkPoint], width: Double)? {
        guard boxWidth > 0 else { return nil }
        return (
            points: points.map {
                InkPoint(
                    x: round($0.x / boxWidth, fractionDecimals),
                    y: round($0.y / boxWidth, fractionDecimals),
                    p: round($0.p, pressureDecimals)
                )
            },
            width: round(width / boxWidth, fractionDecimals + 1)
        )
    }

    public static func fromAnswerSpace(
        points: [InkPoint], width: Double, boxWidth: Double
    ) -> (points: [InkPoint], width: Double) {
        (
            points: points.map { InkPoint(x: $0.x * boxWidth, y: $0.y * boxWidth, p: $0.p) },
            width: width * boxWidth
        )
    }
}

/// A small map that forgets its oldest entry when it is full.
///
/// Used for block hashes and tokens, which are asked for again and again for the same few strings while a page is
/// re-anchored. It is a class with a lock rather than an actor because it sits inside plain synchronous geometry
/// code that has no business being asynchronous.
final class SmallCache<Key: Hashable, Value>: @unchecked Sendable {
    private let limit: Int
    private let lock = NSLock()
    private var storage: [Key: Value] = [:]
    private var order: [Key] = []

    init(limit: Int) {
        self.limit = max(1, limit)
    }

    func value(for key: Key, _ make: () -> Value) -> Value {
        lock.lock()
        if let existing = storage[key] {
            lock.unlock()
            return existing
        }
        lock.unlock()

        // Computed outside the lock: it is pure, and holding a lock across a hash of a whole block would make every
        // other thread wait for it.
        let value = make()

        lock.lock()
        defer { lock.unlock() }
        if storage[key] == nil {
            if order.count >= limit, let oldest = order.first {
                order.removeFirst()
                storage.removeValue(forKey: oldest)
            }
            storage[key] = value
            order.append(key)
        }
        return storage[key] ?? value
    }
}
