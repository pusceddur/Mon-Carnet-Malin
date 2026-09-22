import CarnetKit
import Foundation

/// §22 « Préparer la lecture » from the reader: the page on screen goes to the home computer, which punctuates it for
/// the voice. The prepared text comes back with the synchronization, asked every 10 s for 3 minutes.
///
/// Only the page on screen is asked for: a child may ask for one or two pages, the whole book is the parent's call.
@MainActor
final class ReadingPreparation: ObservableObject {
    enum Status: Equatable {
        case idle, sending, waiting, ready
    }

    static let pollInterval: Duration = .seconds(10)
    static let waitLimit: TimeInterval = 3 * 60

    @Published private(set) var sending = false
    /// The page we wait for, and since when.
    @Published private(set) var waiting: (pageIndex: Int, since: Date)?

    /// Holds the model weakly: a closed book stops asking at the next tick.
    private var poll: Task<Void, Never>?

    func status(pageIndex: Int, prepared: Bool) -> Status {
        if sending { return .sending }
        if prepared { return .ready }
        if let waiting, waiting.pageIndex == pageIndex { return .waiting }
        return .idle
    }

    /// Sends the page. `sync` runs a synchronization and gives the reader its new pages; `notify` shows a message.
    func prepare(
        api: APIClient, documentId: String, pageIndex: Int,
        sync: @escaping @MainActor () async -> Void,
        isPrepared: @escaping @MainActor () -> Bool,
        notify: @escaping @MainActor (String, AppModel.Banner.Tone) -> Void
    ) {
        guard !sending else { return }
        sending = true
        Task {
            defer { sending = false }
            do {
                let answer = try await api.prepareReading(documentId: documentId, pageIndexes: [pageIndex])
                if answer.unavailable != nil {
                    notify(FR.TTS.Prepare.unavailable, .info)
                    return
                }
                notify(answer.queued > 0 ? FR.TTS.Prepare.queued : FR.TTS.Prepare.already, .info)
                wait(for: pageIndex, sync: sync, isPrepared: isPrepared, notify: notify)
            } catch APIError.offline {
                notify(FR.TTS.Prepare.offline, .warning)
            } catch {
                notify(FR.TTS.Prepare.failed, .warning)
            }
        }
    }

    private func wait(
        for pageIndex: Int,
        sync: @escaping @MainActor () async -> Void,
        isPrepared: @escaping @MainActor () -> Bool,
        notify: @escaping @MainActor (String, AppModel.Banner.Tone) -> Void
    ) {
        poll?.cancel()
        let since = Date()
        waiting = (pageIndex, since)
        poll = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.pollInterval)
                guard !Task.isCancelled, let self else { return }
                await sync()
                if isPrepared() {
                    self.waiting = nil
                    notify(FR.TTS.Prepare.ready, .success)
                    return
                }
                if Date().timeIntervalSince(since) >= Self.waitLimit {
                    self.waiting = nil
                    notify(FR.TTS.Prepare.later, .info)
                    return
                }
            }
        }
    }

    /// The book is closed: nothing more to wait for here. The page is still prepared on the server and arrives with
    /// the next sync.
    func stop() {
        poll?.cancel()
        poll = nil
        waiting = nil
    }
}
