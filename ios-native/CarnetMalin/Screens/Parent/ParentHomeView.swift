import CarnetKit
import SwiftUI

/// The adult area: the readers, the books, the sync, the account.
struct ParentHomeView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    /// A page the machine read badly. Identified by book *and* page: page 4 exists in every book.
    struct DoubtfulPage: Identifiable {
        let document: DocumentMeta
        let page: PageContent

        var id: String { "\(document.id):\(page.pageIndex)" }
    }

    @State private var doubtfulPages: [DoubtfulPage] = []
    @State private var showingImport = false
    /// §29 a document another app opened in Carnet Malin, being added.
    @State private var incoming: Incoming?
    @State private var showingSignOut = false
    @State private var pendingByTable: [SyncTable: Int] = [:]
    @State private var rejections: [SyncRejection] = []

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                readers
                booksSection
                if !doubtfulPages.isEmpty { toCheckSection }
                followUp
                syncSection
                accountSection
            }
            .padding(Metrics.gutter)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(Palette.paper)
        .navigationTitle(FR.Parent.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .sheet(isPresented: $showingImport) {
            ImportView { Task { await reload() } }
        }
        .sheet(item: $incoming) { file in
            ImportView(incoming: file.url) { Task { await reload() } }
        }
        .onAppear(perform: takeIncoming)
        .onChange(of: model.incomingFiles) { _, _ in takeIncoming() }
        .onChange(of: incoming) { _, file in
            // One after the other when several arrived at once.
            if file == nil { DispatchQueue.main.async(execute: takeIncoming) }
        }
        .confirmationDialog(
            FR.SignIn.signOutConfirm, isPresented: $showingSignOut, titleVisibility: .visible
        ) {
            Button(FR.SignIn.signOut, role: .destructive) {
                Task {
                    await model.signOut()
                    dismiss()
                }
            }
            Button(FR.Common.cancel, role: .cancel) {}
        }
    }

    struct Incoming: Identifiable, Equatable {
        let url: URL
        var id: String { url.path }
    }

    private func takeIncoming() {
        guard incoming == nil, !showingImport, let first = model.incomingFiles.first else { return }
        incoming = Incoming(url: first)
    }

    // MARK: - Readers

    private var readers: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FR.Parent.children).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)

            ForEach(model.children) { child in
                NavigationLink {
                    ChildSettingsView(child: child)
                } label: {
                    HStack(spacing: 14) {
                        Text(child.avatar.isEmpty ? "🙂" : child.avatar).font(.system(size: 34))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(child.firstName)
                                .font(AppFont.ui(19, weight: .semibold))
                                .foregroundStyle(Palette.ink)
                            Text(FR.format("{age} ans", ["age": String(child.age)]))
                                .font(AppFont.ui(15))
                                .foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        Image(systemName: "chevron.right").foregroundStyle(Palette.muted)
                    }
                    .padding(14)
                    .background(Palette.card)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(Palette.line, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
            }

            if model.children.isEmpty {
                Text(FR.ChildSelect.emptyMessage).font(AppFont.ui(16)).foregroundStyle(Palette.muted)
            }

            NavigationLink {
                ChildSettingsView(child: nil)
            } label: {
                Label(FR.Parent.addChild, systemImage: "person.badge.plus")
                    .font(AppFont.ui(18, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: Metrics.touchTarget)
                    .background(Palette.accentSoft)
                    .foregroundStyle(Palette.accent)
                    .clipShape(RoundedRectangle(cornerRadius: Metrics.cornerRadius, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Books

    private var booksSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FR.Parent.books).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)
            NavigationLink {
                DocumentsAdminView()
            } label: {
                Label(FR.Documents.title, systemImage: "books.vertical")
                    .font(AppFont.ui(18, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: Metrics.touchTarget)
                    .background(Palette.accentSoft)
                    .foregroundStyle(Palette.accent)
                    .clipShape(RoundedRectangle(cornerRadius: Metrics.cornerRadius, style: .continuous))
            }
            .buttonStyle(.plain)
            BigButton(title: FR.Parent.addBook, icon: "plus") { showingImport = true }
        }
    }

    /// The pages a machine read badly, gathered for the parent to look at.
    ///
    /// Before the child meets them. A page with a mangled sentence is one a struggling reader will blame themselves
    /// for, and two minutes of an adult's attention is all it takes to spare them that.
    private var toCheckSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FR.Parent.toCheck).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)
            Text(FR.Parent.toCheckHint).font(AppFont.ui(15)).foregroundStyle(Palette.muted)

            ForEach(doubtfulPages.prefix(20)) { item in
                NavigationLink {
                    PageEditorView(document: item.document, pageIndex: item.page.pageIndex) {
                        Task { await reload() }
                    }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "eye.trianglebadge.exclamationmark").foregroundStyle(Palette.warning)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.document.title.isEmpty ? FR.Library.untitled : item.document.title)
                                .font(AppFont.ui(17, weight: .medium))
                                .foregroundStyle(Palette.ink)
                            Text(FR.Reader.pageLabel(item.page.pageIndex + 1))
                                .font(AppFont.ui(14))
                                .foregroundStyle(Palette.muted)
                        }
                        Spacer()
                        if let confidence = item.page.confidence {
                            Text(FR.Common.percent(Int(confidence)))
                                .font(AppFont.ui(15))
                                .foregroundStyle(Palette.muted)
                                .monospacedDigit()
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

    // MARK: - Follow-up and options

    private var followUp: some View {
        VStack(alignment: .leading, spacing: 12) {
            link(FR.Activity.title, "chart.bar") { ActivityView() }
            link(FR.Options.title, "slider.horizontal.3") { OptionsView() }
            link(FR.Parent.account, "person.badge.key") { AccountView() }
            link("Glossaire", "character.book.closed") { GlossaryView() }
            // Useful when pages stay « en échec » after an import.
            link("Tester la lecture sur cet appareil", "stethoscope") { SelfTestView() }
        }
    }

    private func link<Destination: View>(
        _ title: String, _ icon: String, @ViewBuilder destination: @escaping () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            HStack {
                Label(title, systemImage: icon).font(AppFont.ui(18, weight: .semibold)).foregroundStyle(Palette.ink)
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(Palette.muted)
            }
            .padding(16)
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Sync

    private var syncSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FR.Parent.sync).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)

            Card {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        Circle().fill(syncColour).frame(width: 10, height: 10)
                        Text(syncLabel).font(AppFont.ui(17)).foregroundStyle(Palette.ink)
                    }
                    if let pending = model.syncStatus?.pending, pending > 0 {
                        Text(FR.format(FR.Parent.syncPending, ["count": String(pending)]))
                            .font(AppFont.ui(15))
                            .foregroundStyle(Palette.muted)
                    }
                    BigButton(title: FR.Parent.syncNow, icon: "arrow.triangle.2.circlepath", kind: .secondary) {
                        Task {
                            await model.syncInBackground()
                            await reloadSyncDetail()
                        }
                    }
                }
            }

            if pendingByTable.values.contains(where: { $0 > 0 }) {
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(FR.SyncDetail.pendingTitle).font(AppFont.ui(17, weight: .semibold))
                        ForEach(SyncTable.pushOrder.filter { (pendingByTable[$0] ?? 0) > 0 }, id: \.self) { table in
                            HStack {
                                Text(FR.SyncDetail.table(table))
                                Spacer()
                                Text("\(pendingByTable[table] ?? 0)").monospacedDigit().foregroundStyle(Palette.muted)
                            }
                            .font(AppFont.ui(16))
                        }
                        if !model.settings.privacy.syncAnnotations, (pendingByTable[.annotations] ?? 0) > 0 {
                            Text(FR.SyncDetail.annotationsDisabled).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                        }
                    }
                }
            }

            if !rejections.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(FR.SyncDetail.rejectedTitle).font(AppFont.ui(17, weight: .semibold))
                        Text(FR.SyncDetail.rejectedHint).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                        ForEach(Array(rejections.prefix(10).enumerated()), id: \.offset) { _, rejection in
                            HStack {
                                Text(FR.SyncDetail.table(rejection.table))
                                Spacer()
                                Text(FR.SyncDetail.reason(rejection.reason)).foregroundStyle(Palette.muted)
                            }
                            .font(AppFont.ui(16))
                        }
                    }
                }
            }
        }
        .task(id: model.syncStatus) { await reloadSyncDetail() }
    }

    private func reloadSyncDetail() async {
        guard let sync = model.services?.sync else { return }
        pendingByTable = await sync.pendingCounts()
        rejections = await sync.lastRejections()
    }

    private var syncColour: Color {
        switch model.syncStatus?.state {
        case .idle: return Palette.success
        case .syncing: return Palette.accent
        case .offline: return Palette.muted
        case .error: return Palette.warning
        case nil: return Palette.muted
        }
    }

    private var syncLabel: String {
        switch model.syncStatus?.state {
        case .syncing: return FR.Common.pleaseWait
        case .offline: return FR.Parent.syncOffline
        case .error: return model.syncStatus?.lastError ?? FR.Common.genericError
        case .idle, nil:
            guard let last = model.syncStatus?.lastSyncAt else { return FR.Parent.syncNever }
            let date = Date(timeIntervalSince1970: Double(last) / 1000)
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "fr_FR")
            formatter.dateStyle = .short
            formatter.timeStyle = .short
            return FR.Parent.syncLast(formatter.string(from: date))
        }
    }

    // MARK: - Account

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(FR.Parent.account).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)
            if let parent = model.status?.parent {
                Card {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(parent.displayName).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
                        Text(parent.email).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                        if let url = model.services?.serverURL {
                            Text(url.absoluteString).font(AppFont.ui(14)).foregroundStyle(Palette.muted)
                        }
                    }
                }
            }
            BigButton(title: FR.SignIn.signOut, icon: "rectangle.portrait.and.arrow.right", kind: .secondary) {
                showingSignOut = true
            }
            .padding(.bottom, 40)
        }
    }

    private func reload() async {
        guard let library = model.services?.library else { return }
        await model.reloadChildren()

        var found: [DoubtfulPage] = []
        for child in model.children {
            for document in (try? await library.documents(forChild: child.id)) ?? [] {
                for page in (try? await library.pages(ofDocument: document.id)) ?? []
                where DocumentParser.isDoubtful(page) {
                    found.append(DoubtfulPage(document: document, page: page))
                }
            }
        }
        // The same book may be shared by two children; the page is still only one page to look at.
        var seen = Set<String>()
        doubtfulPages = found.filter { seen.insert($0.id).inserted }
    }
}
