import CarnetKit
import SwiftUI

@main
struct CarnetMalinApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .task { await model.start() }
                // « Ouvrir dans Carnet Malin » from Mail, Safari, Fichiers or iCloud Drive.
                .onOpenURL { model.receive($0) }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background {
                        // Reports still waiting go now: the app may not come back.
                        Task { await model.diagnostics?.flush() }
                    }
                    // Coming back to the app is the moment to catch up with the other devices: a page a parent
                    // corrected on the computer should already be right when the child opens the book.
                    guard phase == .active else { return }
                    Task { await model.syncInBackground() }
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack(alignment: .top) {
            Palette.paper.ignoresSafeArea()

            switch model.screen {
            case .starting:
                LoadingView(message: FR.Common.loading)
            case .signIn:
                SignInView()
            case .chooseChild:
                ChildSelectView()
            case let .reading(childId):
                if let child = model.children.first(where: { $0.id == childId }) {
                    ChildRootView(child: child)
                } else {
                    LoadingView(message: FR.Common.loading)
                }
            }

            if let banner = model.banner {
                BannerView(banner: banner) { model.banner = nil }
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task(id: banner.id) {
                        // Long enough to read twice, which is not the same as long enough to read once.
                        try? await Task.sleep(nanoseconds: 6_000_000_000)
                        if model.banner?.id == banner.id { model.banner = nil }
                    }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: model.banner)
        .tint(Palette.accent)
        // French throughout, whatever the iPad is set to: the app has one language and the child reads that one.
        .environment(\.locale, Locale(identifier: "fr_FR"))
    }
}

struct LoadingView: View {
    let message: String

    var body: some View {
        VStack(spacing: 18) {
            ProgressView().controlSize(.large).tint(Palette.accent)
            Text(message).font(AppFont.ui(20)).foregroundStyle(Palette.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Everything below « who is reading »: the home, and the screens it leads to.
struct ChildRootView: View {
    let child: ChildProfile
    @EnvironmentObject private var model: AppModel
    @State private var path: [Destination] = []
    /// Reads answers aloud outside the reader, with the child's own voice settings.
    @StateObject private var speaker = Speaker()

    /// Where the child can go from the home screen.
    enum Destination: Hashable {
        case library
        case reader(documentId: String, pageIndex: Int)
        /// The book on a page, with a passage marked for a moment (an exercise's source, an answer's).
        case readerQuote(documentId: String, pageIndex: Int, quote: String)
        case exercises(documentId: String?)
        case notes
        case freeQuestion
        case homeworkList
        case homework(documentId: String)
        case parent
    }

    var body: some View {
        NavigationStack(path: $path) {
            HomeView(child: child) { path.append($0) }
                .navigationDestination(for: Destination.self) { destination in
                    switch destination {
                    case .library:
                        LibraryView(child: child) { path.append($0) }
                    case let .reader(documentId, pageIndex):
                        ReaderView(child: child, documentId: documentId, startPage: pageIndex) {
                            path.append($0)
                        }
                    case let .readerQuote(documentId, pageIndex, quote):
                        ReaderView(child: child, documentId: documentId, startPage: pageIndex, quote: quote) {
                            path.append($0)
                        }
                    case let .exercises(documentId):
                        ExerciseListView(child: child, documentId: documentId) { path.append($0) }
                    case .notes:
                        NotesView(child: child) { path.append($0) }
                    case .freeQuestion:
                        FreeQuestionView(child: child, speak: { speaker.speakOnce($0) }, stopSpeaking: { speaker.stop() })
                    case .homeworkList:
                        HomeworkListView(child: child) { path.append($0) }
                    case let .homework(documentId):
                        #if canImport(UIKit)
                        HomeworkView(child: child, documentId: documentId) { path.append($0) }
                        #else
                        EmptyView()
                        #endif
                    case .parent:
                        ParentGateView()
                    }
                }
        }
        // A document opened from another app goes to the adult area, the only place books are added.
        .onChange(of: model.incomingFiles.count) { _, count in
            if count > 0, !path.contains(.parent) { path.append(.parent) }
        }
        .onAppear {
            if !model.incomingFiles.isEmpty, !path.contains(.parent) { path.append(.parent) }
        }
        .task(id: child.tts) {
            let voice = try? await model.services?.library.value(forKey: AppKeys.voiceIdentifier)
            speaker.configure(for: child, voiceIdentifier: voice ?? nil)
        }
    }
}
