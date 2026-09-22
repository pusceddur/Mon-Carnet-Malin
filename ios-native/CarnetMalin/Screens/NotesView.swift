import CarnetKit
import SwiftUI

/// « Mes notes »: everything the child marked, gathered in one place.
///
/// It exists so that marking a book is worth doing. A highlight buried on page 40 of a book read three weeks ago is
/// a highlight nobody will ever find again; here the child can see what they picked out and go straight back to it.
struct NotesView: View {
    let child: ChildProfile
    let go: (ChildRootView.Destination) -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var books: [NotesModel.Book] = []
    @State private var isLoading = true

    var body: some View {
        VStack(spacing: 0) {
            ScreenHeader(title: FR.Notes.title, backTitle: FR.Notes.back) { dismiss() }

            if isLoading {
                LoadingView(message: FR.Common.loading)
            } else if books.isEmpty {
                EmptyStateView(
                    icon: "highlighter",
                    title: FR.Notes.emptyTitle,
                    message: FR.Notes.emptyMessage,
                    actionTitle: FR.Library.title
                ) { go(.library) }
                .frame(maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: Metrics.cardSpacing) {
                        ForEach(books) { book in
                            bookCard(book)
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
    }

    private func bookCard(_ book: NotesModel.Book) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(book.title.isEmpty ? FR.Library.untitled : book.title)
                        .font(AppFont.ui(21, weight: .bold))
                        .foregroundStyle(Palette.ink)
                    Spacer()
                    Button(FR.Notes.openBook) {
                        go(.reader(documentId: book.documentId, pageIndex: book.firstPageIndex ?? 0))
                    }
                    .font(AppFont.ui(16, weight: .medium))
                    .foregroundStyle(Palette.accent)
                    .accessibilityLabel(
                        book.firstPageIndex.map { FR.Notes.openAtPage($0 + 1) } ?? FR.Notes.openBook
                    )
                }

                if book.inkCount > 0 {
                    Label(FR.Notes.drawings(book.inkCount), systemImage: "pencil.tip")
                        .font(AppFont.ui(15))
                        .foregroundStyle(Palette.muted)
                }

                if !book.highlights.isEmpty {
                    sectionTitle(FR.Notes.highlights)
                    ForEach(book.highlights) { highlight in
                        highlightRow(highlight, documentId: book.documentId)
                    }
                }

                if !book.answers.isEmpty {
                    sectionTitle(FR.Notes.answers)
                    ForEach(book.answers) { answer in
                        answerRow(answer, documentId: book.documentId)
                    }
                }

                if !book.detached.isEmpty {
                    // Never deleted, and said plainly: the child's work is still there, it just has no place on the
                    // page any more.
                    VStack(alignment: .leading, spacing: 6) {
                        Label(FR.Notes.detached, systemImage: "exclamationmark.triangle")
                            .font(AppFont.ui(15, weight: .medium))
                            .foregroundStyle(Palette.warning)
                        Text(FR.Notes.detachedHint)
                            .font(AppFont.ui(14))
                            .foregroundStyle(Palette.muted)
                        ForEach(book.detached) { note in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(note.kind == .ink && note.text.isEmpty ? FR.Notes.detachedDrawing : note.text)
                                    .font(AppFont.ui(16))
                                    .foregroundStyle(Palette.ink)
                                    .lineLimit(3)
                                Text(FR.Notes.page(note.pageIndex + 1))
                                    .font(AppFont.ui(13))
                                    .foregroundStyle(Palette.muted)
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.paper)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                    }
                }
            }
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(AppFont.ui(16, weight: .semibold))
            .foregroundStyle(Palette.muted)
    }

    private func highlightRow(_ highlight: NotesModel.Highlight, documentId: String) -> some View {
        Button {
            go(.reader(documentId: documentId, pageIndex: highlight.pageIndex))
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(highlight.text)
                    .font(AppFont.ui(18))
                    .foregroundStyle(Palette.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)
                Text(FR.Notes.page(highlight.pageIndex + 1))
                    .font(AppFont.ui(14))
                    .foregroundStyle(Palette.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background((ReaderColor(hex: highlight.color).map { Color($0) } ?? Palette.warm).opacity(0.3))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(highlight.text), \(FR.Notes.page(highlight.pageIndex + 1))")
    }

    private func answerRow(_ answer: NotesModel.AnswerNote, documentId: String) -> some View {
        Button {
            go(.exercises(documentId: documentId))
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                if !answer.prompt.isEmpty {
                    Text(answer.prompt)
                        .font(AppFont.ui(15, weight: .medium))
                        .foregroundStyle(Palette.muted)
                        .multilineTextAlignment(.leading)
                }
                if let text = answer.text {
                    Text(text)
                        .font(AppFont.ui(18))
                        .foregroundStyle(Palette.ink)
                        .multilineTextAlignment(.leading)
                        .lineLimit(4)
                } else if answer.drawn {
                    Label(FR.Notes.drawnAnswer, systemImage: "scribble")
                        .font(AppFont.ui(16))
                        .foregroundStyle(Palette.ink)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Palette.accentSoft)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityHint(FR.Notes.openQuiz)
    }

    private func reload() async {
        guard let library = model.services?.library else { return }
        defer { isLoading = false }

        let annotations = (try? await library.annotations(childId: child.id)) ?? []
        let exercises = (try? await library.exercises(childId: child.id)) ?? []
        let answers = (try? await library.answers(childId: child.id)) ?? []

        var documentIds = Set(annotations.compactMap(\.documentId))
        documentIds.formUnion(exercises.map(\.documentId))
        var documents: [DocumentMeta] = []
        for id in documentIds {
            if let document = try? await library.document(id) { documents.append(document) }
        }

        var pages: [PageContent] = []
        for needed in NotesModel.pagesNeeded(for: annotations) {
            if let page = try? await library.page(documentId: needed.documentId, pageIndex: needed.pageIndex) {
                pages.append(page)
            }
        }

        books = NotesModel.build(
            documents: documents, pages: pages, annotations: annotations, exercises: exercises, answers: answers
        )
    }
}
