import CarnetKit
import SwiftUI

#if canImport(UIKit)
import UIKit

/// One block of a page, drawn.
///
/// It is a `UITextView` behind a SwiftUI wrapper rather than a `Text`, and that is not a shortcut. The reader needs
/// three things SwiftUI's text cannot give: the exact rectangle of every word, so a stroke can be anchored to it and
/// a highlighter can know what it crossed; a character offset from a point, so a tap lands on a word rather than
/// near one; and per-character attributes for §26 that do not disturb the layout. All three come from TextKit.
struct ReaderBlockView: UIViewRepresentable {
    let block: BlockModel
    let aids: BlockAids
    let highlights: [TextHighlight]
    let typography: ReaderTypography
    let selection: ReaderRange?
    /// The sentence being read aloud, and the word inside it.
    let spokenSentence: Range<Int>?
    let spokenWord: NSRange?
    /// Where each word ended up, handed back so the pencil can anchor to it.
    let onLayout: ([WordBox]) -> Void
    let onTapWord: (Int) -> Void

    func makeUIView(context: Context) -> ReaderTextUIView {
        let view = ReaderTextUIView()
        view.onTapWord = onTapWord
        view.onLayout = onLayout
        return view
    }

    func updateUIView(_ view: ReaderTextUIView, context: Context) {
        view.blockIndex = block.blockIndex
        view.onTapWord = onTapWord
        view.onLayout = onLayout
        view.apply(
            attributed: Self.attributedText(
                block: block, aids: aids, highlights: highlights, typography: typography,
                selection: selection, spokenSentence: spokenSentence, spokenWord: spokenWord
            ),
            words: block.words
        )
    }

    /// Builds the text with everything that colours it: §26, the highlights the child made, their selection, and the
    /// sentence and word the voice is on.
    ///
    /// The order matters. Backgrounds are laid first and the reading aids last, so a syllable colour is never hidden
    /// under a highlight — the aid is what the child is decoding with, and the highlight is only a note to themselves.
    static func attributedText(
        block: BlockModel,
        aids: BlockAids,
        highlights: [TextHighlight],
        typography: ReaderTypography,
        selection: ReaderRange?,
        spokenSentence: Range<Int>?,
        spokenWord: NSRange?
    ) -> NSAttributedString {
        let text = NSMutableAttributedString(string: block.text)
        let whole = NSRange(location: 0, length: text.length)

        let isTitle = block.kind == .title
        let size = isTitle ? typography.titlePointSize : typography.pointSize
        let font = uiFont(named: typography.fontName, size: size, bold: isTitle)

        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = typography.lineHeight
        paragraph.maximumLineHeight = typography.lineHeight
        paragraph.paragraphSpacing = typography.lineHeight * 0.4
        // Never justified: even word spacing is easier to track than even margins, and a ragged right edge gives the
        // eye a different shape on every line to come back to.
        paragraph.alignment = .natural
        paragraph.lineBreakMode = .byWordWrapping

        text.addAttributes([
            .font: font,
            .foregroundColor: uiColor(typography.theme.ink),
            .paragraphStyle: paragraph,
            .kern: typography.letterSpacing,
        ], range: whole)

        // Word spacing, as extra kerning on the spaces themselves.
        if typography.wordSpacing > 0 {
            let units = Array(block.text.utf16)
            for index in units.indices where units[index] == 0x20 {
                text.addAttribute(
                    .kern, value: typography.letterSpacing + typography.wordSpacing,
                    range: NSRange(location: index, length: 1)
                )
            }
        }

        for highlight in highlights {
            let range = clamp(NSRange(location: highlight.start, length: highlight.end - highlight.start), whole)
            guard range.length > 0 else { continue }
            let colour = ReaderColor(hex: highlight.color).map { uiColor($0) } ?? uiColor(typography.theme.wordHighlight)
            text.addAttribute(.backgroundColor, value: colour.withAlphaComponent(0.55), range: range)
        }

        if typography.showsSentenceHighlight, let spokenSentence {
            let range = clamp(
                NSRange(location: spokenSentence.lowerBound, length: spokenSentence.count), whole
            )
            if range.length > 0 {
                text.addAttribute(.backgroundColor, value: uiColor(typography.theme.sentenceHighlight), range: range)
            }
        }

        if let spokenWord {
            let range = clamp(spokenWord, whole)
            if range.length > 0 {
                text.addAttribute(.backgroundColor, value: uiColor(typography.theme.wordHighlight), range: range)
            }
        }

        if let selection, selection.blockIndex == block.blockIndex {
            let range = clamp(NSRange(location: selection.start, length: selection.end - selection.start), whole)
            if range.length > 0 {
                text.addAttribute(
                    .backgroundColor, value: uiColor(typography.theme.markA).withAlphaComponent(0.22), range: range
                )
            }
        }

        // §26 last, so the decoding help stays visible over everything else.
        for run in aids.runs {
            let range = clamp(NSRange(location: run.start, length: run.end - run.start), whole)
            guard range.length > 0 else { continue }
            let style = run.style

            if style.isSilent {
                text.addAttribute(.foregroundColor, value: uiColor(typography.theme.silentInk), range: range)
            } else if let parity = style.syllableParity {
                let colour = parity == 0 ? typography.theme.markA : typography.theme.markB
                text.addAttribute(.foregroundColor, value: uiColor(colour), range: range)
            }

            if style.isSoundGroup {
                let base = style.isAlternateSoundGroup ? typography.theme.markB : typography.theme.markA
                text.addAttribute(
                    .backgroundColor, value: uiColor(base).withAlphaComponent(0.14), range: range
                )
            }

            if style.isChanged {
                // Dotted, not solid: a solid underline reads as a link or as an error, and this is neither.
                text.addAttribute(
                    .underlineStyle,
                    value: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDot.rawValue,
                    range: range
                )
                text.addAttribute(.underlineColor, value: uiColor(typography.theme.markB), range: range)
            }
        }

        return text
    }

    private static func clamp(_ range: NSRange, _ bounds: NSRange) -> NSRange {
        let location = max(0, min(range.location, bounds.length))
        let length = max(0, min(range.length, bounds.length - location))
        return NSRange(location: location, length: length)
    }

    private static func uiColor(_ colour: ReaderColor) -> UIColor {
        UIColor(red: colour.red, green: colour.green, blue: colour.blue, alpha: 1)
    }

    private static func uiFont(named name: String?, size: CGFloat, bold: Bool) -> UIFont {
        if let name, let font = UIFont(name: name, size: size) {
            guard bold else { return font }
            let descriptor = font.fontDescriptor.withSymbolicTraits(.traitBold) ?? font.fontDescriptor
            return UIFont(descriptor: descriptor, size: size)
        }
        // A missing font file is not a failure the child should meet: the system font is perfectly readable.
        return UIFont.systemFont(ofSize: size, weight: bold ? .bold : .regular)
    }
}

/// The text view underneath, which knows where every word is.
final class ReaderTextUIView: UIView {
    private let textView = UITextView()
    private var words: [WordModel] = []

    var blockIndex = 0
    var onTapWord: ((Int) -> Void)?
    var onLayout: (([WordBox]) -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        textView.isEditable = false
        textView.isSelectable = false
        textView.isScrollEnabled = false
        textView.backgroundColor = .clear
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        // The child taps a word; the system's own selection would put handles and a menu in the way of that.
        textView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(textView)
        NSLayoutConstraint.activate([
            textView.leadingAnchor.constraint(equalTo: leadingAnchor),
            textView.trailingAnchor.constraint(equalTo: trailingAnchor),
            textView.topAnchor.constraint(equalTo: topAnchor),
            textView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap))
        addGestureRecognizer(tap)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func apply(attributed: NSAttributedString, words: [WordModel]) {
        if textView.attributedText != attributed { textView.attributedText = attributed }
        self.words = words
        setNeedsLayout()
    }

    override var intrinsicContentSize: CGSize {
        let width = bounds.width > 0 ? bounds.width : UIView.noIntrinsicMetric
        guard width > 0 else { return CGSize(width: UIView.noIntrinsicMetric, height: UIView.noIntrinsicMetric) }
        let size = textView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: UIView.noIntrinsicMetric, height: ceil(size.height))
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        invalidateIntrinsicContentSize()
        reportWordBoxes()
    }

    /// Measures every word and hands the boxes up, which is what the pencil anchors to.
    private func reportWordBoxes() {
        guard let onLayout, !words.isEmpty, bounds.width > 0 else { return }
        let layoutManager = textView.layoutManager
        let container = textView.textContainer
        let fontSize = (textView.font?.pointSize).map(Double.init) ?? 16

        var boxes: [WordBox] = []
        for word in words {
            let glyphRange = layoutManager.glyphRange(
                forCharacterRange: NSRange(location: word.offset, length: word.end - word.offset),
                actualCharacterRange: nil
            )
            var rect = CGRect.null
            layoutManager.enumerateEnclosingRects(
                forGlyphRange: glyphRange, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0),
                in: container
            ) { fragment, _ in
                rect = rect.isNull ? fragment : rect.union(fragment)
            }
            guard !rect.isNull, rect.width > 0 else { continue }
            boxes.append(WordBox(
                blockIndex: blockIndex,
                charOffset: word.offset,
                length: word.end - word.offset,
                fontSize: fontSize,
                rect: Rect(
                    left: rect.minX + textView.frame.minX,
                    top: rect.minY + textView.frame.minY,
                    width: rect.width,
                    height: rect.height
                )
            ))
        }
        onLayout(boxes)
    }

    @objc private func handleTap(_ recognizer: UITapGestureRecognizer) {
        let point = recognizer.location(in: textView)
        let index = textView.layoutManager.characterIndex(
            for: point, in: textView.textContainer, fractionOfDistanceBetweenInsertionPoints: nil
        )
        guard index >= 0, index < textView.attributedText.length else { return }
        onTapWord?(index)
    }
}
#endif
