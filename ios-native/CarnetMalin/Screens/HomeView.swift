import CarnetKit
import SwiftUI

/// The child's home screen: five big choices and nothing else.
///
/// Deliberately short. Every extra thing on this screen is one more thing to read before the reading starts, and for
/// the child this app is for, reading the menu is already work.
struct HomeView: View {
    let child: ChildProfile
    let go: (ChildRootView.Destination) -> Void

    @EnvironmentObject private var model: AppModel
    @State private var lastRead: (document: DocumentMeta, progress: ReadingProgress)?
    @State private var bookCount = 0
    @State private var noteCount = 0
    @State private var exerciseCount = 0
    @State private var homeworkTodo = 0
    @State private var isOnline = true

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 260, maximum: 400), spacing: Metrics.cardSpacing)]
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header

                LazyVGrid(columns: columns, spacing: Metrics.cardSpacing) {
                    HomeTile(
                        title: FR.Home.continueReading,
                        subtitle: continueSubtitle,
                        icon: "bookmark.fill",
                        tint: Palette.warm.opacity(0.35),
                        isEnabled: lastRead != nil
                    ) {
                        guard let lastRead else { return }
                        go(.reader(documentId: lastRead.document.id, pageIndex: lastRead.progress.pageIndex))
                    }

                    HomeTile(
                        title: FR.Home.books,
                        subtitle: bookCount == 0 ? FR.Library.emptyTitle : FR.Library.pageCount(bookCount),
                        icon: "books.vertical.fill"
                    ) { go(.library) }

                    HomeTile(
                        title: FR.Homework.title,
                        subtitle: homeworkTodo == 0 ? FR.Homework.tileNone : FR.Homework.tileTodo(homeworkTodo),
                        icon: "pencil.and.list.clipboard",
                        tint: homeworkTodo > 0 ? Palette.warm.opacity(0.35) : Palette.accentSoft
                    ) { go(.homeworkList) }

                    HomeTile(
                        title: FR.Home.exercises,
                        subtitle: exerciseCount == 0 ? nil : FR.Exercises.title,
                        icon: "brain.head.profile"
                    ) { go(.exercises(documentId: nil)) }

                    if model.helpAvailable(.freeQuestion) {
                        HomeTile(
                            title: FR.Home.question,
                            subtitle: model.syncStatus?.state == .offline ? FR.Home.questionOffline : nil,
                            icon: "bubble.left.and.text.bubble.right",
                            tint: Palette.accentSoft
                        ) { go(.freeQuestion) }
                    }

                    HomeTile(
                        title: FR.Home.notes,
                        subtitle: noteCount == 0 ? nil : FR.Notes.drawings(noteCount),
                        icon: "highlighter"
                    ) { go(.notes) }
                }
                .padding(.horizontal, Metrics.gutter)
            }
            .frame(maxWidth: 1000)
            .frame(maxWidth: .infinity)
            .padding(.bottom, 40)
        }
        .task { await reload() }
        .refreshable { await model.syncInBackground(); await reload() }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(child.nickname.isEmpty ? FR.Home.greetingNoName : FR.Home.greeting(child.nickname))
                    .font(AppFont.title(34))
                    .foregroundStyle(Palette.ink)
                if let syncStatus = model.syncStatus, syncStatus.pending > 0 {
                    Text(FR.format(FR.Parent.syncPending, ["count": String(syncStatus.pending)]))
                        .font(AppFont.ui(15))
                        .foregroundStyle(Palette.muted)
                }
            }
            Spacer()
            HStack(spacing: 4) {
                Button { model.switchChild() } label: {
                    Label(FR.Home.switchChild, systemImage: "person.2")
                        .labelStyle(.iconOnly)
                        .font(AppFont.ui(22))
                        .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.muted)
                .accessibilityLabel(FR.Home.switchChild)

                Button { go(.parent) } label: {
                    Label(FR.Home.parentAccess, systemImage: "gearshape")
                        .labelStyle(.iconOnly)
                        .font(AppFont.ui(22))
                        .frame(width: Metrics.touchTarget, height: Metrics.touchTarget)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.muted)
                .accessibilityLabel(FR.Home.parentAccess)
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.top, 20)
    }

    private var continueSubtitle: String {
        guard let lastRead else { return FR.Home.continueNone }
        let title = lastRead.document.title.isEmpty ? FR.Library.untitled : lastRead.document.title
        return "\(title) · \(FR.Home.continuePage(lastRead.progress.pageIndex + 1))"
    }

    private func reload() async {
        guard let library = model.services?.library else { return }
        lastRead = try? await library.lastRead(childId: child.id)
        let documents = (try? await library.documents(forChild: child.id)) ?? []
        // Books and homework are counted apart: a worksheet is not a book, and « 3 livres » that are three
        // worksheets would be a confusing thing to read.
        bookCount = documents.filter { !$0.isHomework }.count
        homeworkTodo = documents.filter { $0.isHomework && !$0.isHomeworkDone }.count
        noteCount = (try? await library.annotations(childId: child.id).count) ?? 0
        exerciseCount = (try? await library.exercises(childId: child.id).count) ?? 0
        isOnline = model.syncStatus?.state != .offline
    }
}
