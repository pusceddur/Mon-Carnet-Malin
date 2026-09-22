import CarnetKit
import SwiftUI
import UniformTypeIdentifiers

#if canImport(VisionKit)
import VisionKit
#endif

/// « Mes devoirs » (§19.3): the worksheets a child has to fill in, and the ones already done.
///
/// The child adds them themselves — a photo of the sheet the teacher handed out — without the adult code: homework
/// happens at the kitchen table at six in the evening, and waiting for a parent to type a code is how it does not.
struct HomeworkListView: View {
    let child: ChildProfile
    let go: (ChildRootView.Destination) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var todo: [DocumentMeta] = []
    @State private var done: [DocumentMeta] = []
    @State private var showingAdd = false

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(
                title: FR.Homework.title,
                backTitle: FR.Homework.back,
                onBack: { dismiss() },
                trailing: AnyView(
                    Button { showingAdd = true } label: {
                        Label(FR.Homework.addTitle, systemImage: "plus")
                            .font(AppFont.ui(17, weight: .semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Palette.accent)
                )
            )

            if todo.isEmpty && done.isEmpty {
                EmptyStateView(
                    icon: "doc.text.image", title: FR.Homework.emptyTitle, message: FR.Homework.emptyMessage,
                    actionTitle: FR.Homework.addTitle
                ) { showingAdd = true }
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(FR.Homework.todo).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)
                        if todo.isEmpty {
                            Text(FR.Homework.noneTodo).font(AppFont.ui(17)).foregroundStyle(Palette.success)
                        }
                        ForEach(todo) { document in row(document) }

                        if !done.isEmpty {
                            Text(FR.Homework.done).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)
                                .padding(.top, 12)
                            ForEach(done) { document in row(document) }
                        }
                    }
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.bottom, 40)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .navigationBarBackButtonHidden()
        .task { await reload() }
        .refreshable { await model.syncInBackground(); await reload() }
        .sheet(isPresented: $showingAdd) {
            AddHomeworkView(child: child) { document in
                Task {
                    await reload()
                    go(.homework(documentId: document.id))
                }
            }
        }
    }

    private func row(_ document: DocumentMeta) -> some View {
        Button { go(.homework(documentId: document.id)) } label: {
            HStack(spacing: 14) {
                Image(systemName: document.isHomeworkDone ? "checkmark.seal.fill" : "pencil.and.list.clipboard")
                    .font(AppFont.ui(26))
                    .foregroundStyle(document.isHomeworkDone ? Palette.success : Palette.accent)
                VStack(alignment: .leading, spacing: 4) {
                    Text(document.title.isEmpty ? FR.Library.untitled : document.title)
                        .font(AppFont.ui(19, weight: .semibold))
                        .foregroundStyle(Palette.ink)
                    Text(subtitle(document)).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Palette.muted)
            }
            .padding(16)
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func subtitle(_ document: DocumentMeta) -> String {
        if let finished = document.homeworkDoneAt { return FR.Homework.doneOn(Self.date(finished)) }
        return FR.Homework.addedOn(Self.date(document.createdAt))
    }

    static func date(_ millis: Millis) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.dateStyle = .long
        return formatter.string(from: Date(timeIntervalSince1970: Double(millis) / 1000))
    }

    private func reload() async {
        guard let library = model.services?.library else { return }
        let all = ((try? await library.documents(forChild: child.id)) ?? []).filter(\.isHomework)
        todo = all.filter { !$0.isHomeworkDone }
        done = all.filter(\.isHomeworkDone).sorted { ($0.homeworkDoneAt ?? 0) > ($1.homeworkDoneAt ?? 0) }
    }
}

/// « Ajouter un devoir »: a photo of the sheet, or a file.
struct AddHomeworkView: View {
    let child: ChildProfile
    let onAdded: (DocumentMeta) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var showingScanner = false
    @State private var showingFiles = false
    @State private var progress: (done: Int, total: Int)?
    @State private var message: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let progress {
                        ImportProgressView(done: progress.done, total: progress.total)
                    } else {
                        Text(FR.Homework.addHint).font(AppFont.ui(17)).foregroundStyle(Palette.ink)
                        Text(FR.Homework.nameLabel).font(AppFont.ui(16, weight: .medium)).foregroundStyle(Palette.muted)
                        TextField(FR.Homework.namePlaceholder, text: $name)
                            .font(AppFont.ui(19))
                            .padding(14)
                            .background(Palette.card)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                        #if canImport(VisionKit)
                        if VNDocumentCameraViewController.isSupported {
                            BigButton(title: FR.Homework.takePhoto, icon: "camera") { showingScanner = true }
                        }
                        #endif
                        BigButton(title: FR.Homework.chooseFile, icon: "folder", kind: .secondary) {
                            showingFiles = true
                        }
                    }
                    if let message {
                        Text(message).font(AppFont.ui(16)).foregroundStyle(Palette.warning)
                    }
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 600)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.paper)
            .navigationTitle(FR.Homework.addTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(FR.Common.cancel) { dismiss() }.disabled(progress != nil)
                }
            }
        }
        #if canImport(VisionKit)
        .fullScreenCover(isPresented: $showingScanner) {
            DocumentScannerView { images in
                showingScanner = false
                Task { await add { try await $0.importImages(images, $1, progress: $2) } }
            } onCancel: {
                showingScanner = false
            }
            .ignoresSafeArea()
        }
        #endif
        .fileImporter(isPresented: $showingFiles, allowedContentTypes: [.pdf, .image]) { result in
            guard case let .success(url) = result else { return }
            Task {
                let opened = url.startAccessingSecurityScopedResource()
                defer { if opened { url.stopAccessingSecurityScopedResource() } }
                await add { try await $0.importFile(url, $1, progress: $2) }
            }
        }
    }

    private func add(
        _ work: (DocumentImporter, DocumentImporter.Request, @escaping DocumentImporter.Progress) async throws
            -> DocumentMeta?
    ) async {
        guard let services = model.services, let parentId = model.parentId else {
            message = FR.Common.genericError
            return
        }
        let importer = DocumentImporter(
            library: services.library, store: services.store, settings: model.settings, parentId: parentId,
            diagnostics: model.diagnostics
        )
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = clean.isEmpty
            ? FR.Homework.defaultTitle(HomeworkListView.date(DocumentImporter.now()))
            : clean
        progress = (0, 1)
        message = nil
        do {
            let document = try await work(
                importer, DocumentImporter.Request(title: title, purpose: .homework, childIds: [child.id])
            ) { done, total in progress = (done, total) }
            progress = nil
            await model.syncInBackground()
            dismiss()
            if let document { onAdded(document) }
        } catch {
            progress = nil
            message = DocumentImporter.message(for: error)
        }
    }
}
