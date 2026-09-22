import CarnetKit
import SwiftUI

/// Writing in a text box on a worksheet (§19.2), and « Corriger » (§24).
///
/// Typed, dictated with the keyboard's microphone, or written with Scribble — whatever lets the child answer.
///
/// « Corriger » fixes spelling, grammar and punctuation and keeps the child's own words and lines. The corrected text
/// is shown before it replaces anything, with the number of changes, and the child chooses: a correction that
/// silently rewrote their answer would teach them that their writing is something that gets taken away.
struct TextBoxEditor: View {
    let box: TextBoxAnnotation
    let child: ChildProfile
    let document: DocumentMeta?
    let onSave: (TextBoxAnnotation) -> Void
    let onDelete: () -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var fontSize = 0.028
    @State private var correction: CorrectWritingData?
    @State private var isCorrecting = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    TextEditor(text: $text)
                        .font(.system(size: 22))
                        .frame(minHeight: 180)
                        .padding(10)
                        .background(Palette.card)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
                        // The child's own spelling: the keyboard must not « fix » what « Corriger » is there to teach.
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.sentences)
                    if text.isEmpty {
                        Text(FR.TextBox.placeholder).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                    }

                    LabelledSlider(
                        title: FR.TextBox.fontSize, value: $fontSize, range: 0.015...0.06, step: 0.002
                    ) { value in "\(Int((value * 1000).rounded()))" }

                    if model.helpAvailable(.correctWriting) {
                        if isCorrecting {
                            HStack(spacing: 10) {
                                ProgressView().tint(Palette.accent)
                                Text(FR.TextBox.correcting).font(AppFont.ui(16)).foregroundStyle(Palette.muted)
                            }
                        } else if let correction {
                            correctionView(correction)
                        } else {
                            BigButton(
                                title: FR.TextBox.correct, icon: "text.badge.checkmark", kind: .quiet,
                                isEnabled: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ) { Task { await correct() } }
                        }
                    }

                    if let message {
                        Text(message).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                    }

                    BigButton(title: FR.TextBox.delete, icon: "trash", kind: .secondary) {
                        onDelete()
                        dismiss()
                    }
                }
                .padding(Metrics.gutter)
            }
            .background(Palette.paper)
            .navigationTitle(FR.TextBox.add)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(FR.TextBox.done) {
                        var updated = box
                        updated.text = text
                        updated.fontSize = fontSize
                        onSave(updated)
                        dismiss()
                    }
                    .font(AppFont.ui(18, weight: .semibold))
                }
            }
        }
        .onAppear {
            text = box.text
            fontSize = box.fontSize
        }
    }

    private func correctionView(_ data: CorrectWritingData) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if data.changes.isEmpty {
                Label(FR.TextBox.noMistake, systemImage: "star.fill")
                    .font(AppFont.ui(17, weight: .semibold)).foregroundStyle(Palette.success)
            } else {
                Text(FR.TextBox.changes(data.changes.count))
                    .font(AppFont.ui(17, weight: .semibold)).foregroundStyle(Palette.ink)
                Text(data.correctedText)
                    .font(.system(size: 20))
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                // What changed, word for word: the child sees their mistakes as pairs to compare, not as red ink.
                ForEach(Array(data.changes.prefix(12).enumerated()), id: \.offset) { _, change in
                    HStack(spacing: 8) {
                        Text(change.from).strikethrough().foregroundStyle(Palette.muted)
                        Image(systemName: "arrow.right").font(.system(size: 12)).foregroundStyle(Palette.muted)
                        Text(change.to).fontWeight(.semibold).foregroundStyle(Palette.ink)
                    }
                    .font(AppFont.ui(17))
                }
                HStack(spacing: 12) {
                    BigButton(title: FR.TextBox.keepCorrection, icon: "checkmark") {
                        text = data.correctedText
                        correction = nil
                    }
                    BigButton(title: FR.TextBox.keepMine, kind: .secondary) { correction = nil }
                }
            }
        }
    }

    private func correct() async {
        guard let ai = model.ai else { return }
        isCorrecting = true
        message = nil
        defer { isCorrecting = false }

        let result = await ai.request(CorrectWritingRequest(
            childId: child.id,
            documentId: document?.id,
            documentHash: document.flatMap { $0.sourceHash.isEmpty ? nil : $0.sourceHash },
            text: text,
            annotationId: box.id,
            pageIndex: box.pageIndex
        ), for: child)

        switch result {
        case let .ok(data, _):
            correction = data
        default:
            message = result.message
        }
    }
}
