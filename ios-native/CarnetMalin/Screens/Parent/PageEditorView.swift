import CarnetKit
import SwiftUI

/// Correcting the text of a page by hand, with the photograph of the page beside it.
///
/// This is where « À vérifier » leads. Two minutes of an adult's attention here spares a child a page with a
/// mangled sentence — one they would otherwise blame themselves for not being able to read.
///
/// The child's marks on the page are moved onto the new text before it is saved, so fixing a typo never costs them
/// an underline.
struct PageEditorView: View {
    let document: DocumentMeta
    let pageIndex: Int
    var onSaved: () -> Void = {}

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// One block being edited. The key only keeps SwiftUI's rows apart while blocks are added and removed.
    struct EditableBlock: Identifiable, Equatable {
        let id = UUID()
        var kind: TextBlock.Kind
        var text: String
    }

    @State private var page: PageContent?
    @State private var blocks: [EditableBlock] = []
    @State private var original: [EditableBlock] = []
    @State private var isSaving = false
    @State private var showsImage = true
    @State private var message: String?

    private var hasChanges: Bool {
        blocks.map { [$0.kind.rawValue, $0.text] } != original.map { [$0.kind.rawValue, $0.text] }
    }

    var body: some View {
        VStack(spacing: 0) {
            if showsImage {
                #if canImport(UIKit)
                OriginalPageView(documentId: document.id, pageIndex: pageIndex)
                    .frame(maxHeight: 360)
                Divider()
                #endif
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let page, let confidence = page.confidence {
                        Text(FR.format("Lu par la machine ({value})", ["value": FR.Common.percent(Int(confidence))]))
                            .font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                    }

                    ForEach($blocks) { $block in
                        blockEditor($block)
                    }

                    HStack {
                        Button {
                            blocks.append(EditableBlock(kind: .paragraph, text: ""))
                        } label: {
                            Label("Ajouter un paragraphe", systemImage: "plus")
                        }
                        Spacer()
                    }
                    .font(AppFont.ui(17, weight: .medium))
                    .foregroundStyle(Palette.accent)

                    if let message {
                        Text(message).font(AppFont.ui(16)).foregroundStyle(Palette.warning)
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
        }
        .background(Palette.paper)
        .navigationTitle(FR.Reader.pageLabel(pageIndex + 1))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showsImage.toggle() } label: {
                    Image(systemName: showsImage ? "photo.fill" : "photo")
                }
                .accessibilityLabel(FR.Reader.menuShowOriginal)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(isSaving ? FR.Common.pleaseWait : FR.Common.save) {
                    Task { await save() }
                }
                .font(AppFont.ui(18, weight: .semibold))
                .disabled(isSaving || !hasChanges)
            }
        }
        .task { await load() }
    }

    private func blockEditor(_ block: Binding<EditableBlock>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Picker("", selection: block.kind) {
                    Text("Titre").tag(TextBlock.Kind.title)
                    Text("Paragraphe").tag(TextBlock.Kind.paragraph)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 240)
                Spacer()
                Button(role: .destructive) {
                    blocks.removeAll { $0.id == block.wrappedValue.id }
                } label: {
                    Image(systemName: "trash")
                }
                .accessibilityLabel(FR.Common.delete)
            }
            TextEditor(text: block.text)
                .font(block.wrappedValue.kind == .title ? AppFont.ui(20, weight: .bold) : AppFont.ui(18))
                .frame(minHeight: block.wrappedValue.kind == .title ? 50 : 110)
                .padding(8)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
                // A parent correcting a child's text wants their own spelling, not the keyboard's guesses.
                .autocorrectionDisabled()
        }
    }

    private func load() async {
        guard let library = model.services?.library else { return }
        page = try? await library.page(documentId: document.id, pageIndex: pageIndex)
        let editable = (page?.blocks ?? []).map { EditableBlock(kind: $0.kind, text: $0.text) }
        blocks = editable.isEmpty ? [EditableBlock(kind: .paragraph, text: "")] : editable
        original = blocks
    }

    private func save() async {
        guard let library = model.services?.library, let page, !isSaving else { return }
        isSaving = true
        defer { isSaving = false }

        let now = Millis(Date().timeIntervalSince1970 * 1000)
        let corrected = DocumentParser.manualCorrection(
            of: page, blocks: blocks.map { TextBlock(kind: $0.kind, text: $0.text) }, now: now
        )
        do {
            // The marks first, while the old text is still the stored one: they are found in it, then moved.
            try await library.reanchorAnnotations(documentId: document.id, pageIndex: pageIndex, to: corrected)
            try await library.save(corrected)

            var updated = document
            let pages = try await library.pages(ofDocument: document.id)
            updated.status = DocumentParser.documentStatus(of: pages)
            updated.updatedAt = max(now, document.updatedAt + 1)
            try await library.save(updated)

            onSaved()
            await model.syncInBackground()
            dismiss()
        } catch {
            message = FR.Common.genericError
        }
    }
}
