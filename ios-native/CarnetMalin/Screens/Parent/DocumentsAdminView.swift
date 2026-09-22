import CarnetKit
import SwiftUI

/// « Livres et documents »: every book of the family, whoever it is for.
struct DocumentsAdminView: View {
    @EnvironmentObject private var model: AppModel

    struct Row: Identifiable {
        let document: DocumentMeta
        let ready: Int
        let toCheck: Int
        var id: String { document.id }
    }

    @State private var rows: [Row] = []
    @State private var isLoading = true
    @State private var showingImport = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(FR.Documents.intro).font(AppFont.ui(16)).foregroundStyle(Palette.muted)
                BigButton(title: FR.Parent.addBook, icon: "plus") { showingImport = true }

                if isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(40)
                } else if rows.isEmpty {
                    EmptyStateView(icon: "books.vertical", title: FR.Documents.emptyTitle, message: FR.Documents.emptyMessage)
                        .frame(maxWidth: .infinity)
                } else {
                    ForEach(rows) { row in
                        NavigationLink {
                            DocumentDetailView(documentId: row.document.id) { Task { await reload() } }
                        } label: {
                            rowView(row)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.paper)
        .navigationTitle(FR.Documents.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .refreshable { await model.syncInBackground(); await reload() }
        .sheet(isPresented: $showingImport) {
            ImportView { Task { await reload() } }
        }
    }

    private func rowView(_ row: Row) -> some View {
        let names = model.children.filter { row.document.childIds.contains($0.id) }.map(\.nickname)
        return HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.document.title.isEmpty ? FR.Library.untitled : row.document.title)
                    .font(AppFont.ui(19, weight: .semibold))
                    .foregroundStyle(Palette.ink)
                    .lineLimit(2)
                Text(names.isEmpty ? FR.Documents.noChild : names.joined(separator: ", "))
                    .font(AppFont.ui(15))
                    .foregroundStyle(Palette.muted)
                Text(FR.Documents.summary(ready: row.ready, toCheck: row.toCheck, total: row.document.pageCount))
                    .font(AppFont.ui(14))
                    .foregroundStyle(row.toCheck > 0 ? Palette.warning : Palette.muted)
                if row.document.isHomework && !row.document.isHomeworkDone {
                    Text(FR.Documents.homeworkTodo).font(AppFont.ui(14, weight: .medium)).foregroundStyle(Palette.accent)
                }
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(Palette.muted)
        }
        .padding(14)
        .background(Palette.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
    }

    private func reload() async {
        guard let library = model.services?.library else { return }
        defer { isLoading = false }
        var built: [Row] = []
        for document in (try? await library.allDocuments()) ?? [] {
            let pages = (try? await library.pages(ofDocument: document.id)) ?? []
            built.append(Row(
                document: document,
                ready: pages.filter { $0.status == .ready }.count,
                toCheck: pages.filter(DocumentParser.isDoubtful).count
            ))
        }
        rows = built
    }
}

/// One book, for the parent: who it is for, what kind of text it is, and each of its pages.
struct DocumentDetailView: View {
    let documentId: String
    var onChange: () -> Void = {}

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var document: DocumentMeta?
    @State private var pages: [PageContent] = []
    @State private var title = ""
    @State private var onlyDoubtful = false
    @State private var message: String?
    @State private var isWorking = false
    @State private var confirmingDelete = false

    private var shownPages: [PageContent] {
        onlyDoubtful ? pages.filter(DocumentParser.isDoubtful) : pages
    }

    var body: some View {
        ScrollView {
            if let document {
                VStack(alignment: .leading, spacing: 22) {
                    general(document)
                    textMode(document)
                    homeComputer(document)
                    if let message {
                        Text(message).font(AppFont.ui(16)).foregroundStyle(Palette.accent)
                    }
                    pagesSection(document)
                    BigButton(title: FR.Documents.delete, icon: "trash", kind: .secondary) { confirmingDelete = true }
                        .padding(.bottom, 40)
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            } else {
                ProgressView().padding(60)
            }
        }
        .background(Palette.paper)
        .navigationTitle(document?.title ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .disabled(isWorking)
        .confirmationDialog(
            FR.Documents.confirmDelete(document?.title ?? ""), isPresented: $confirmingDelete, titleVisibility: .visible
        ) {
            Button(FR.Documents.delete, role: .destructive) { Task { await delete() } }
            Button(FR.Common.cancel, role: .cancel) {}
        } message: {
            Text(FR.Documents.confirmMessage)
        }
    }

    // MARK: - Title and readers

    private func general(_ document: DocumentMeta) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FR.Documents.titleLabel).font(AppFont.ui(17, weight: .medium)).foregroundStyle(Palette.ink)
            TextField(FR.Library.untitled, text: $title)
                .textFieldStyle(.plain)
                .font(AppFont.ui(19))
                .padding(12)
                .background(Palette.card)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .onSubmit { Task { await saveTitle() } }

            Text(FR.Documents.readers).font(AppFont.ui(17, weight: .medium)).foregroundStyle(Palette.ink)
            ForEach(model.children) { child in
                Toggle(isOn: Binding(
                    get: { document.childIds.contains(child.id) },
                    set: { isOn in Task { await setReader(child.id, isOn) } }
                )) {
                    Text("\(child.avatar) \(child.nickname)").font(AppFont.ui(17))
                }
                .tint(Palette.accent)
            }
        }
    }

    private func saveTitle() async {
        guard var updated = document, let library = model.services?.library else { return }
        let clean = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean != updated.title else { return }
        // A rename is free: it travels with the next sync, no adult code needed.
        updated.title = String(clean.prefix(200))
        updated.updatedAt = max(now(), updated.updatedAt + 1)
        try? await library.save(updated)
        document = updated
        onChange()
    }

    private func setReader(_ childId: String, _ isOn: Bool) async {
        guard var updated = document, let library = model.services?.library else { return }
        var ids = Set(updated.childIds)
        if isOn { ids.insert(childId) } else { ids.remove(childId) }
        // Kept in the family's order, so the list does not reshuffle itself under the parent's finger.
        updated.childIds = model.children.map(\.id).filter(ids.contains)
        updated.updatedAt = max(now(), updated.updatedAt + 1)
        // Travels with the sync, which accepts it while the adult area is open.
        try? await library.save(updated)
        document = updated
        onChange()
        await model.syncInBackground()
    }

    // MARK: - Kind of text (§17.10)

    private func textMode(_ document: DocumentMeta) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(FR.Documents.textModeLabel).font(AppFont.ui(17, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.Documents.textModeLabel, selection: Binding(
                get: { document.textMode },
                set: { mode in Task { await setTextMode(mode) } }
            )) {
                Text(FR.Documents.textModeFaithful).tag(DocumentTextMode.faithful)
                Text(FR.Documents.textModePunctuated).tag(DocumentTextMode.punctuated)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text(document.textMode == .faithful ? FR.Documents.textModeFaithfulHint : FR.Documents.textModePunctuatedHint)
                .font(AppFont.ui(15))
                .foregroundStyle(Palette.muted)
        }
    }

    private func setTextMode(_ mode: DocumentTextMode) async {
        guard let services = model.services, let current = document, current.textMode != mode else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let (saved, queued) = try await services.api.setTextMode(documentId: current.id, mode)
            try? await services.library.storeFromServer(saved)
            document = saved
            message = queued > 0 ? FR.Documents.relaunchAiDone(queued) : FR.Documents.textModeSaved
            onChange()
        } catch {
            message = Self.message(for: error)
        }
    }

    // MARK: - The home computer

    private func homeComputer(_ document: DocumentMeta) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            BigButton(title: FR.Documents.prepare, icon: "waveform", kind: .quiet) {
                Task { await prepare() }
            }
            Text(FR.Documents.prepareHint).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
            BigButton(title: FR.Documents.relaunchAi, icon: "arrow.clockwise", kind: .secondary) {
                Task { await relaunch(nil) }
            }
        }
    }

    private func prepare() async {
        guard let services = model.services, let document else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let answer = try await services.api.prepareReading(documentId: document.id)
            if let reason = answer.unavailable {
                message = FR.Documents.prepareUnavailable(reason)
            } else {
                message = answer.queued > 0 ? FR.Documents.prepareDone(answer.queued) : FR.Documents.prepareNone
            }
        } catch {
            message = Self.message(for: error)
        }
    }

    private func relaunch(_ pageIndexes: [Int]?) async {
        guard let services = model.services, let document else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            let queued = try await services.api.relaunchTranscription(
                documentId: document.id, pageIndexes: pageIndexes, reread: pageIndexes != nil
            )
            message = queued > 0 ? FR.Documents.relaunchAiDone(queued) : FR.Documents.relaunchAiNone
        } catch {
            message = Self.message(for: error)
        }
    }

    // MARK: - Pages

    private func pagesSection(_ document: DocumentMeta) -> some View {
        let doubtful = pages.filter(DocumentParser.isDoubtful).count
        return VStack(alignment: .leading, spacing: 10) {
            Text(FR.Documents.pagesTitle).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)
            Picker("", selection: $onlyDoubtful) {
                Text(FR.Documents.filterAll).tag(false)
                Text(FR.Documents.filterDoubtful(doubtful)).tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if shownPages.isEmpty && onlyDoubtful {
                Text(FR.Documents.emptyDoubtful).font(AppFont.ui(16)).foregroundStyle(Palette.muted)
            }

            ForEach(shownPages, id: \.pageIndex) { page in
                NavigationLink {
                    PageEditorView(document: document, pageIndex: page.pageIndex) { Task { await reload() } }
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(FR.Reader.pageLabel(page.pageIndex + 1))
                                .font(AppFont.ui(17, weight: .semibold)).foregroundStyle(Palette.ink)
                            Text(statusLine(page)).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        if let confidence = page.confidence {
                            Text(FR.Common.percent(Int(confidence)))
                                .font(AppFont.ui(14)).foregroundStyle(Palette.muted).monospacedDigit()
                        }
                        if DocumentParser.isDoubtful(page) {
                            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Palette.warning)
                        }
                        Image(systemName: "chevron.right").foregroundStyle(Palette.muted)
                    }
                    .padding(12)
                    .background(Palette.card)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func statusLine(_ page: PageContent) -> String {
        var parts = [page.warnings.contains(.awaitingAi) && !page.isAvailable
            ? FR.Documents.awaitingAi : FR.Documents.status(page.status)]
        if let source = page.textSource { parts.append(FR.Documents.source(source)) }
        return parts.joined(separator: " · ")
    }

    // MARK: - Loading and deleting

    private func reload() async {
        guard let library = model.services?.library else { return }
        document = try? await library.document(documentId)
        title = document?.title ?? ""
        pages = (try? await library.pages(ofDocument: documentId)) ?? []
    }

    private func delete() async {
        guard let services = model.services, var gone = document else { return }
        isWorking = true
        defer { isWorking = false }
        do {
            try await services.api.deleteDocument(id: gone.id)
            gone.deletedAt = now()
            gone.updatedAt = max(now(), gone.updatedAt + 1)
            try? await services.library.storeFromServer(gone)
            PageImageStore.standard()?.removeDocument(gone.id)
            model.show(FR.Documents.deleted, tone: .success)
            onChange()
            dismiss()
        } catch {
            message = Self.message(for: error)
        }
    }

    private func now() -> Millis { Millis(Date().timeIntervalSince1970 * 1000) }

    private static func message(for error: Error) -> String {
        if case let APIError.api(_, code, _) = error, code == "parent_locked" { return FR.Documents.parentLocked }
        if case APIError.offline = error { return FR.Documents.needsConnection }
        return FR.Errors.message(for: error)
    }
}
