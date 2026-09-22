import Foundation

/// One line as the page layout gives it: its text and where it sits. Comes from the PDF text layer or from the OCR.
public struct LayoutLine: Equatable, Sendable {
    public let text: String
    public let top: Double
    public let height: Double
    public let left: Double
    /// Known for a PDF, unknown for a scanned page.
    public let fontSize: Double?

    public init(text: String, top: Double, height: Double, left: Double, fontSize: Double? = nil) {
        self.text = text
        self.top = top
        self.height = height
        self.left = left
        self.fontSize = fontSize
    }
}

/// Turning the lines of a page back into paragraphs and titles.
/// Ported from `shared/src/text/blocks.ts`.
///
/// A page read by a machine arrives as a pile of lines with coordinates; the child needs paragraphs. A new block starts
/// on a large vertical gap, a jump to another column, a change of font, or an indented first line after a finished one.
/// A title is recognised by a larger font, taller lines, capitals, or a short line standing on its own.
public enum BlockBuilder {
    private struct Line {
        let text: String
        let top: Double
        let height: Double
        let left: Double
        let fontSize: Double?
        let words: Int
        /// Letters and digits only: what tells a real line of text from a page number.
        let letters: Int
    }

    /// The step from one line to the next, when most paragraphs are only one or two lines long, is better read from the
    /// lower quartile than from the median: the median would be a paragraph gap.
    private static func lowerQuartile(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        return sorted[(sorted.count - 1) / 4]
    }

    private static func median(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        let mid = sorted.count / 2
        return sorted.count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    }

    /// Median weighted by how many letters a line carries, so that long body lines outweigh short titles.
    private static func weightedMedian(_ entries: [(value: Double, weight: Int)]) -> Double {
        let sorted = entries.filter { $0.weight > 0 }.sorted { $0.value < $1.value }
        let total = sorted.reduce(0) { $0 + $1.weight }
        var accumulated = 0
        for entry in sorted {
            accumulated += entry.weight
            if accumulated * 2 >= total { return entry.value }
        }
        return 0
    }

    private static func endsSentence(_ text: String) -> Bool {
        guard let last = text.last else { return false }
        return ".!?…:;»\"\u{201D})".contains(last)
    }

    private static func isUppercaseLine(_ text: String) -> Bool {
        let letters = text.filter(\.isLetter)
        guard letters.count >= 3 else { return false }
        let value = String(letters)
        return value == value.uppercased() && value != value.lowercased()
    }

    private static func startsLikeATitle(_ text: String) -> Bool {
        guard let first = text.first else { return false }
        return first.isUppercase || first.isNumber || first == "«" || first == "\""
    }

    /// Groups the lines, which must already be in reading order, into paragraphs and titles.
    public static func blocks(from lines: [LayoutLine]) -> [TextBlock] {
        let items: [Line] = lines.compactMap { line in
            let text = line.text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            guard !text.isEmpty else { return nil }
            return Line(
                text: text,
                top: line.top,
                height: line.height,
                left: line.left,
                fontSize: line.fontSize,
                words: text.split(separator: " ").count,
                letters: text.filter { $0.isLetter || $0.isNumber }.count
            )
        }
        guard !items.isEmpty else { return [] }

        let lineHeight = median(items.map(\.height)) == 0 ? 1 : median(items.map(\.height))
        let bodyFont = weightedMedian(items.compactMap { line in
            line.fontSize.map { (value: $0, weight: line.letters) }
        })
        let measuredBodyHeight = weightedMedian(items.map { (value: $0.height, weight: $0.letters) })
        let bodyHeight = measuredBodyHeight == 0 ? lineHeight : measuredBodyHeight

        var steps: [Double] = []
        for index in 1..<items.count {
            let step = items[index].top - items[index - 1].top
            // A step much shorter than a line is a fragment of the same visual line, not a new one.
            if step > lineHeight * 0.6 && step < lineHeight * 3 { steps.append(step) }
        }
        let measuredStep = lowerQuartile(steps)
        let lineStep = measuredStep == 0 ? lineHeight * 1.2 : measuredStep
        let bodyLeft = median(items.map(\.left))
        let typicalLetters = Double(items.map(\.letters).max() ?? 0)

        struct Group {
            var lines: [Line]
            var gapBefore: Bool
            var gapAfter: Bool
        }

        var groups: [Group] = []
        var current: [Line] = [items[0]]
        var gapBefore = true

        for index in 1..<items.count {
            let previous = items[index - 1]
            let line = items[index]
            let step = line.top - previous.top
            // A negative step means the text jumped back up: another column.
            let verticalGap = step > lineStep * 1.3 || step < -lineHeight
            let fontChange = bodyFont > 0 && previous.fontSize != nil && line.fontSize != nil
                && abs(line.fontSize! - previous.fontSize!) / bodyFont > 0.15
            let heightChange = bodyFont == 0 && abs(line.height - previous.height) / bodyHeight > 0.25
            let indented = line.left - previous.left > lineHeight * 0.6
                && previous.left - bodyLeft < lineHeight * 0.6
                && (endsSentence(previous.text) || Double(previous.letters) < typicalLetters * 0.75)

            if verticalGap || fontChange || heightChange || indented {
                let breaks = verticalGap || fontChange || heightChange
                groups.append(Group(lines: current, gapBefore: gapBefore, gapAfter: breaks))
                gapBefore = breaks
                current = [line]
            } else {
                current.append(line)
            }
        }
        groups.append(Group(lines: current, gapBefore: gapBefore, gapAfter: true))

        return groups.map { group in
            let text = LineJoiner.join(lines: group.lines.map(\.text))
            let first = group.lines[0]
            let words = text.split(separator: " ").count
            let fonts = group.lines.compactMap(\.fontSize)
            let biggerFont = bodyFont > 0 && !fonts.isEmpty && (fonts.min() ?? 0) >= bodyFont * 1.2
            let tallerLines = bodyFont == 0 && (group.lines.map(\.height).min() ?? 0) >= bodyHeight * 1.3
            let endsLikeASentence = text.last.map { ".,;:".contains($0) } ?? false
            let shortTitleShape = words <= 12 && !endsLikeASentence && startsLikeATitle(text)
            let isolatedShortLine = group.lines.count == 1 && group.gapBefore && group.gapAfter
                && shortTitleShape && Double(first.letters) < typicalLetters * 0.6
            let endsWithPunctuation = text.last.map { ".;,".contains($0) } ?? false

            let isTitle = group.lines.count <= 3 && words <= 20
                && (((biggerFont || tallerLines) && !endsWithPunctuation)
                    || (isUppercaseLine(text) && words <= 12)
                    || isolatedShortLine)
            return TextBlock(kind: isTitle ? .title : .paragraph, text: text)
        }
    }

    /// The blocks of a page as one plain text, paragraphs separated by a blank line.
    public static func plainText(_ blocks: [TextBlock]) -> String {
        blocks.map(\.text).joined(separator: "\n\n")
    }
}
