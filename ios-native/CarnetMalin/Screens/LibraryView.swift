import CarnetKit
import SwiftUI

/// « Mes livres ».
struct LibraryView: View {
    let child: ChildProfile
    let go: (ChildRootView.Destination) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var books: [BookRow] = []
    @State private var isLoading = true

    /// A book with what the child needs to decide whether to open it.
    struct BookRow: Identifiable, Equatable {
        let document: DocumentMeta
        let readyPages: Int
        let lastPage: Int?

        var id: String { document.id }
        var isReady: Bool { readyPages >= document.pageCount && document.pageCount > 0 }
    }

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 260, maximum: 380), spacing: Metrics.cardSpacing)]
    }

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: FR.Library.title, backTitle: FR.Library.back) { dismiss() }

            if isLoading {
                LoadingView(message: FR.Common.loading)
            } else if books.isEmpty {
                EmptyStateView(
                    icon: "books.vertical",
                    title: FR.Library.emptyTitle,
                    message: FR.Library.emptyMessage,
                    actionTitle: FR.Home.parentAccess
                ) { go(.parent) }
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: columns, spacing: Metrics.cardSpacing) {
                        ForEach(books) { row in
                            bookCard(row)
                        }
                    }
                    .padding(.horizontal, Metrics.gutter)
                    .padding(.bottom, 40)
                    .frame(maxWidth: 1000)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .navigationBarBackButtonHidden()
        .task { await reload() }
        .refreshable { await model.syncInBackground(); await reload() }
    }

    private func bookCard(_ row: BookRow) -> some View {
        Button {
            go(.reader(documentId: row.document.id, pageIndex: row.lastPage ?? 0))
        } label: {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: icon(for: row.document))
                        .font(AppFont.ui(28))
                        .foregroundStyle(Palette.accent)
                    if row.document.isHomework {
                        Text(FR.Library.homework)
                            .font(AppFont.ui(13, weight: .semibold))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Palette.warm.opacity(0.5))
                            .clipShape(Capsule())
                            .foregroundStyle(Palette.ink)
                    }
                    Spacer()
                    if row.document.isHomeworkDone {
                        Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.success)
                    }
                }

                Text(row.document.title.isEmpty ? FR.Library.untitled : row.document.title)
                    .font(AppFont.ui(21, weight: .bold))
                    .foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)

                Spacer(minLength: 4)

                // What is worth knowing before opening it: how far along, or that it is still being read.
                if !row.isReady {
                    Label(
                        FR.Library.readyPages(ready: row.readyPages, total: row.document.pageCount),
                        systemImage: "hourglass"
                    )
                    .font(AppFont.ui(15))
                    .foregroundStyle(Palette.muted)
                } else if let lastPage = row.lastPage {
                    Label(FR.Library.lastPage(lastPage + 1), systemImage: "bookmark")
                        .font(AppFont.ui(15))
                        .foregroundStyle(Palette.accent)
                } else {
                    Text(FR.Library.notStarted)
                        .font(AppFont.ui(15))
                        .foregroundStyle(Palette.muted)
                }

                Text(FR.Library.pageCount(row.document.pageCount))
                    .font(AppFont.ui(14))
                    .foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity, minHeight: 190, alignment: .topLeading)
            .padding(18)
            .background(Palette.card)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(Palette.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func icon(for document: DocumentMeta) -> String {
        switch document.kind {
        case .pdf: return "doc.richtext"
        case .images: return "photo.stack"
        case .epub: return "book"
        }
    }

    private func reload() async {
        guard let library = model.services?.library else { return }
        defer { isLoading = false }

        // Worksheets live in « Mes devoirs », not among the books.
        let documents = ((try? await library.documents(forChild: child.id)) ?? []).filter { !$0.isHomework }
        var rows: [BookRow] = []
        for document in documents {
            let pages = (try? await library.pages(ofDocument: document.id)) ?? []
            let progress = try? await library.progress(childId: child.id, documentId: document.id)
            rows.append(BookRow(
                document: document,
                readyPages: pages.filter(\.isAvailable).count,
                lastPage: progress?.pageIndex
            ))
        }
        books = rows
    }
}
