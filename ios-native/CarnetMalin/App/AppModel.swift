import CarnetKit
import Foundation
import SwiftUI

/// What the whole app is doing right now.
@MainActor
final class AppModel: ObservableObject {
    /// The one screen the app is on, at the top level.
    enum Screen: Equatable {
        /// Opening the store, reading the Keychain, asking the server whether the session is still good.
        case starting
        /// No server address yet, or no session.
        case signIn
        /// Signed in, but nobody has said who is reading.
        case chooseChild
        case reading(childId: String)
    }

    @Published private(set) var screen: Screen = .starting
    @Published private(set) var children: [ChildProfile] = []
    @Published private(set) var child: ChildProfile?
    @Published private(set) var status: AuthStatus?
    @Published private(set) var syncStatus: SyncStatus?
    /// What the parent allows. Starts from the defaults and is replaced by the server's as soon as it answers.
    @Published private(set) var settings: ParentSettings = .standard
    /// The help. Exists once the family is known, because every answer it keeps is keyed to the family.
    @Published private(set) var ai: AIService?
    /// The family signed in on this iPad, known offline too: a child adding homework on the bus needs it.
    @Published private(set) var parentId: String?
    /// §29 files another app opened in Carnet Malin, waiting for the adult area to add them.
    @Published private(set) var incomingFiles: [URL] = []
    @Published var banner: Banner?

    /// Something short to tell the family, at the top of the screen.
    struct Banner: Equatable, Identifiable {
        enum Tone { case info, success, warning }
        let id = UUID()
        let text: String
        var tone: Tone = .info
    }

    private(set) var services: Services?
    /// Technical problems seen on this iPad, sent to the family's server. Never the text of a page.
    private(set) var diagnostics: Diagnostics?
    private var syncObserver: UUID?

    /// Everything the app is built out of, once the store is open.
    struct Services {
        let store: LocalStore
        let library: LibraryStore
        let api: APIClient
        let sync: SyncEngine
        let tokens: TokenStore
        let serverURL: URL
    }

    // MARK: - Starting up

    func start() async {
        guard case .starting = screen else { return }
        do {
            let store = try Self.openStore()
            // The address this build carries wins over whatever an older build stored: the family does not choose
            // the server, and a build pointed elsewhere must not keep talking to the previous one.
            let stored = ((try? store.value(forKey: AppKeys.serverURL)) ?? nil).flatMap(ServerAddress.parse)
            guard let url = ServerAddress.builtIn ?? stored else {
                screen = .signIn
                self.pendingStore = store
                return
            }
            await connect(store: store, serverURL: url)
        } catch {
            // The store would not open, which is the one failure the app cannot read around.
            banner = Banner(text: FR.Common.genericError, tone: .warning)
            screen = .signIn
        }
    }

    /// Held while the family is still typing the address of their server.
    private var pendingStore: LocalStore?

    /// Opens the local database, falling back to memory rather than refusing to start.
    ///
    /// A child whose iPad has a full disk, or a file the app cannot write, should still be able to open the app and
    /// see what is going on — not meet a screen that will not move.
    private static func openStore() throws -> LocalStore {
        let folder = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
        )
        let file = folder.appendingPathComponent("carnet-malin.sqlite")
        do {
            return try SQLiteStore(url: file)
        } catch {
            return InMemoryStore()
        }
    }

    func connect(store: LocalStore? = nil, serverURL: URL) async {
        let store = store ?? pendingStore ?? InMemoryStore()
        pendingStore = nil
        try? store.setValue(serverURL.absoluteString, forKey: AppKeys.serverURL)

        let tokens: TokenStore
        #if canImport(Security)
        tokens = KeychainTokenStore()
        #else
        tokens = InMemoryTokenStore()
        #endif

        let api = APIClient(baseURL: serverURL, tokens: tokens)
        diagnostics = Diagnostics(userAgent: DeviceInfo.userAgent, device: DeviceInfo.flags) { reports in
            await api.sendDiagnostics(reports)
        }
        let sync = SyncEngine(store: store, transport: APISyncTransport(api: api))
        let services = Services(
            store: store, library: LibraryStore(store: store), api: api, sync: sync,
            tokens: tokens, serverURL: serverURL
        )
        self.services = services

        syncObserver = await sync.observe { [weak self] status in
            Task { @MainActor in self?.syncStatus = status }
        }
        await refreshSession()
    }

    /// Asks the server whether the session is still open — and carries on with what is on the iPad if it cannot.
    func refreshSession() async {
        guard let services else { return }
        do {
            let status = try await services.api.status()
            self.status = status
            if status.authenticated {
                await afterSignIn()
            } else {
                screen = .signIn
            }
        } catch let error as APIError where error.isAccountDeleted {
            // §30: the account was deleted, here or from another device. This iPad still holds the books and a token
            // that looks fine; it empties itself rather than offering a sign-in screen next to a library that no
            // longer exists anywhere.
            forgetEverything()
            show(FR.SignIn.accountDeleted, tone: .warning)
        } catch let error as APIError where !error.isAuthenticationFailure {
            // No network. The session token is still there and the books are on the iPad: the child reads anyway.
            if await services.api.hasSession {
                await afterSignIn()
            } else {
                screen = .signIn
            }
        } catch {
            screen = .signIn
        }
    }

    private func afterSignIn() async {
        guard let services else { return }
        await forgetPreviousFamily()
        await reloadChildren()
        await startHelp()

        let remembered = try? await services.library.value(forKey: AppKeys.lastChildId)
        if let remembered, let found = children.first(where: { $0.id == remembered }) {
            child = found
            screen = .reading(childId: found.id)
        } else if children.count == 1, let only = children.first {
            // One reader in the family: there is nothing to choose.
            child = only
            screen = .reading(childId: only.id)
        } else {
            child = nil
            screen = .chooseChild
        }
        await syncInBackground()
    }

    /// §28: a second family signing in on this iPad never finds the first one's books.
    ///
    /// The check belongs on every sign-in and not only in `signOut`, because a family can be replaced without any
    /// sign-out happening at all — an app killed halfway through one, a session the server ended, an iPad handed
    /// over with somebody still signed in. What is compared is the parent the device last belonged to against the
    /// one who just arrived.
    private func forgetPreviousFamily() async {
        guard let services, let current = status?.parent?.id else { return }
        let previous = (try? await services.library.value(forKey: AppKeys.parentId)) ?? nil
        guard let previous, !previous.isEmpty, previous != current else { return }

        // Not the session: the token belongs to the family that has just signed in, and the app is about to use it.
        LocalWipe.family(store: services.store)
        await services.sync.forgetSyncState()
        incomingFiles = []
        children = []
        child = nil
        syncStatus = nil
        try? await services.library.setValue(current, forKey: AppKeys.parentId)
        show(FR.SignIn.previousFamilyCleared)
    }

    /// Sets up the help for this family and reads what the parent allows.
    ///
    /// The settings are kept on the device as well, so a child offline still sees exactly the buttons the parent
    /// chose — not a set of buttons that all answer « pas de connexion ».
    private func startHelp() async {
        guard let services else { return }
        // `await` cannot sit on the right of `??` (it is an autoclosure), hence the two steps.
        var parentId = status?.parent?.id
        if parentId == nil { parentId = (try? await services.library.value(forKey: AppKeys.parentId)) ?? nil }
        self.parentId = parentId
        if let parentId {
            try? await services.library.setValue(parentId, forKey: AppKeys.parentId)
            ai = AIService(transport: services.api, cache: AICache.standard(), parentId: parentId)
        }

        if let stored = try? await services.library.value(forKey: AppKeys.parentSettings),
           let decoded = try? JSONDecoder().decode(ParentSettings.self, from: Data(stored.utf8)) {
            settings = decoded
        }
        await refreshSettings()
    }

    func refreshSettings() async {
        guard let services, let fresh = try? await services.api.settings() else { return }
        settings = fresh
        if let data = try? JSONEncoder().encode(fresh) {
            try? await services.library.setValue(String(decoding: data, as: UTF8.self), forKey: AppKeys.parentSettings)
        }
    }

    /// Replaces the settings after the parent changed them.
    func update(_ settings: ParentSettings) {
        self.settings = settings
    }

    /// Whether the help can be offered for this: switched on by the parent, and the family signed in.
    func helpAvailable(_ operation: AIOperation) -> Bool {
        ai != nil && settings.allows(operation)
    }

    func reloadChildren() async {
        guard let services else { return }
        children = (try? await services.library.children()) ?? []
        if let current = child?.id {
            child = children.first { $0.id == current }
            if child == nil { screen = .chooseChild }
        }
    }

    // MARK: - Who is reading

    func choose(_ child: ChildProfile) {
        self.child = child
        screen = .reading(childId: child.id)
        Task { try? await services?.library.setValue(child.id, forKey: AppKeys.lastChildId) }
    }

    func switchChild() {
        child = nil
        screen = .chooseChild
        Task { try? await services?.library.setValue(nil, forKey: AppKeys.lastChildId) }
    }

    /// Keeps the one child the rest of the app is working with up to date after a settings change.
    func update(_ child: ChildProfile) {
        if self.child?.id == child.id { self.child = child }
        if let index = children.firstIndex(where: { $0.id == child.id }) { children[index] = child }
    }

    /// The server's answer after a change to the account (§20 code asked or not).
    func update(status: AuthStatus) {
        self.status = status
    }

    // MARK: - Signing in and out

    /// The family's first account on a new server, or one joining with an invitation code. Signs in like `signIn`.
    func createAccount(_ form: AccountForm) async throws {
        guard let services else { throw APIError.offline }
        let status = try await services.api.createAccount(form)
        self.status = status
        try? await services.api.setDeviceName("iPad · application")
        await afterSignIn()
    }

    func signIn(email: String, password: String) async throws {
        guard let services else { throw APIError.offline }
        let status = try await services.api.logIn(email: email, password: password)
        self.status = status
        // So the parent recognises this iPad in « Appareils connectés » and can sign it out if it is ever lost.
        try? await services.api.setDeviceName("iPad · application")
        await afterSignIn()
    }

    /// Signs the family out and, unless they ask otherwise, takes their books off this iPad with them (§20, §28).
    ///
    /// Forgetting the device is the default, as it is on the web, and it is the honest one: an iPad is lent, sold
    /// and shared, and a child's homework is not something to leave on it out of convenience. The family that wants
    /// their books to stay — their own iPad, a sign-out only to swap accounts for a minute — says so in the dialog.
    ///
    /// Whatever is still waiting goes up first when there is a connection. A mark made on the bus this morning
    /// would otherwise be the one thing the sync never carried, and it is about to be erased.
    func signOut(forgettingThisDevice forget: Bool = true) async {
        guard let services else { return }
        if forget { await syncInBackground() }
        try? await services.api.logOut()

        if forget {
            LocalWipe.family(store: services.store, tokens: services.tokens)
            await services.sync.forgetSyncState()
            incomingFiles = []
            children = []
            syncStatus = nil
        } else {
            // The books stay, the help's answers never do: they are the cheapest thing to ask for again and the
            // most personal to leave lying about (§28).
            AICache.standard()?.removeAll()
            try? await services.library.setValue(nil, forKey: AppKeys.parentSettings)
        }

        ai = nil
        parentId = nil
        settings = .standard
        child = nil
        status = nil
        screen = .signIn
    }

    /// §30 « Supprimer le compte »: the family leaves the server for good, and this iPad with them.
    ///
    /// The password is checked by the server, which then removes everything it holds. Whatever it answers, what is
    /// on this device goes: a deletion that left the books on the iPad would not be one.
    func deleteAccount(password: String) async throws {
        guard let services else { throw APIError.offline }
        try await services.api.deleteAccount(password: password)
        forgetEverything()
    }

    /// Takes the family off this iPad and goes back to the sign-in screen. Used by §30 and by a 410.
    private func forgetEverything() {
        guard let services else { return }
        LocalWipe.family(store: services.store, tokens: services.tokens)
        Task { await services.sync.forgetSyncState() }
        incomingFiles = []
        children = []
        ai = nil
        parentId = nil
        settings = .standard
        child = nil
        status = nil
        syncStatus = nil
        screen = .signIn
    }

    // MARK: - Sync

    func syncInBackground() async {
        guard let services else { return }
        let status = await services.sync.syncNow()
        syncStatus = status
        // The books are on the server now; their page images can follow. Done after the sync, never before: the
        // server refuses an image for a book it has not heard of.
        if status.state != .offline, let images = PageImageStore.standard() {
            await ImageUploadQueue.flush(store: services.store, images: images, api: services.api)
        }
        await reloadChildren()
    }

    func addIncoming(_ url: URL) {
        incomingFiles.append(url)
    }

    func removeIncoming(_ url: URL) {
        incomingFiles.removeAll { $0 == url }
    }

    func show(_ text: String, tone: Banner.Tone = .info) {
        banner = Banner(text: text, tone: tone)
    }

    func show(error: Error) {
        banner = Banner(text: FR.Errors.message(for: error), tone: .warning)
    }
}
