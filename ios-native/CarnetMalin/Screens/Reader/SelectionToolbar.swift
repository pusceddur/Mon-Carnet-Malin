import CarnetKit
import SwiftUI

/// What the child can do with the words they just touched.
///
/// It opens on a single word and grows from there — one more word, the sentence, the paragraph — because a child who
/// cannot yet drag a precise selection can still get exactly the piece they meant by pressing « Mot suivant » twice.
struct SelectionToolbar: View {
    @ObservedObject var reader: ReaderViewModel
    let selection: ReaderRange
    /// Opens the help for what is selected.
    var onHelp: (HelpKind) -> Void = { _ in }

    @EnvironmentObject private var model: AppModel
    @State private var isBusy = false

    private let highlightColour = "#FFD97A"

    /// Too long to explain well, and long enough that a model would be asked for a small essay.
    private var isTooLong: Bool {
        (reader.selectedText().map { Tokenizer.countWords($0) } ?? 0) > 120
    }

    private var isHighlighted: Bool {
        reader.highlights.contains {
            $0.blockIndex == selection.blockIndex && $0.start < selection.end && $0.end > selection.start
        }
    }

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                action("speaker.wave.2", FR.Reader.selectionRead) {
                    if let text = reader.selectedText() { reader.speakOnce(text) }
                }
                // Only what the parent switched on. A button that always answers « pas disponible » teaches a
                // child that the button lies.
                if model.helpAvailable(.explainWord) {
                    helpAction(.definition, FR.Reader.selectionDefinition)
                }
                if model.helpAvailable(.explainText) {
                    helpAction(.explain, FR.Reader.selectionExplain)
                }
                if model.helpAvailable(.simplifyText) {
                    helpAction(.simplify, FR.Reader.selectionSimplify)
                }
                action(
                    isHighlighted ? "highlighter" : "highlighter",
                    isHighlighted ? FR.Reader.selectionUnhighlight : FR.Reader.selectionHighlight
                ) {
                    Task {
                        isBusy = true
                        defer { isBusy = false }
                        if isHighlighted {
                            await reader.removeHighlight(at: selection)
                            model.show(FR.Reader.unhighlighted, tone: .success)
                        } else {
                            await reader.highlight(selection, colour: highlightColour)
                            model.show(FR.Reader.highlighted, tone: .success)
                        }
                    }
                }

                Divider().frame(height: 24)

                action("chevron.left", FR.Reader.selectionPreviousWord) {
                    reader.extendSelection(backwards: true)
                }
                action("chevron.right", FR.Reader.selectionNextWord) {
                    reader.extendSelection(backwards: false)
                }
                textAction(FR.Reader.selectionSentence) { reader.extendSelectionToSentence() }
                textAction(FR.Reader.selectionParagraph) { reader.extendSelectionToParagraph() }

                Divider().frame(height: 24)

                action("xmark", FR.Common.close) { reader.selection = nil }
            }

            if isTooLong {
                Text(FR.Reader.selectionTooLong)
                    .font(AppFont.ui(14))
                    .foregroundStyle(Palette.warning)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Palette.card)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
        .shadow(color: .black.opacity(0.1), radius: 8, y: 3)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(FR.Reader.selectionLabel)
        .disabled(isBusy)
    }

    private func action(_ icon: String, _ label: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Image(systemName: icon)
                .font(AppFont.ui(19))
                .frame(width: 46, height: 46)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.ink)
        .accessibilityLabel(label)
    }

    private func helpAction(_ kind: HelpKind, _ label: String) -> some View {
        Button { onHelp(kind) } label: {
            Label(label, systemImage: kind.icon)
                .font(AppFont.ui(15, weight: .medium))
                .padding(.horizontal, 10)
                .frame(height: 46)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.accent)
        .disabled(isTooLong)
    }

    private func textAction(_ label: String, perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            Text(label)
                .font(AppFont.ui(15, weight: .medium))
                .padding(.horizontal, 12)
                .frame(height: 46)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.accent)
    }
}
