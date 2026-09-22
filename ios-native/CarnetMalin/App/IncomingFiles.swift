import Foundation

/// §29 « Ouvrir dans Carnet Malin »: a PDF, an EPUB or a photo handed over by Mail, Safari, Fichiers or iCloud Drive.
///
/// iOS can hand a file over at any moment, including while the app is starting or before anyone has signed in. The file
/// is copied somewhere the app owns and waits there until the adult area imports it, so none is lost in between.
enum IncomingFiles {
    /// Nothing sensible arrives in numbers: a parent opens one book at a time. This only guards against a loop.
    static let maxWaiting = 20
    /// The web app's limit (LIMITS.documentFileMaxBytes).
    static let maxBytes = 30 * 1024 * 1024

    enum Failure: Error {
        case notAFile, tooLarge, unreadable
    }

    private static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("incoming", isDirectory: true)
    }

    /// Copies the file into the app's own space and removes the copy iOS left in the Inbox.
    static func keep(_ url: URL) throws -> URL {
        guard url.isFileURL else { throw Failure.notAFile }
        // A file from iCloud Drive or another app's container has to be claimed before it can be read.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size <= maxBytes else {
            discardInboxCopy(url)
            throw Failure.tooLarge
        }
        let manager = FileManager.default
        let target = folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
            .appendingPathComponent(url.lastPathComponent)
        do {
            try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try manager.copyItem(at: url, to: target)
        } catch {
            throw Failure.unreadable
        }
        discardInboxCopy(url)
        return target
    }

    /// Removes a kept copy once the book is stored, or the parent decided not to add it.
    static func discard(_ url: URL) {
        let path = url.standardizedFileURL.path
        // Only inside our own folder: never a file the parent keeps somewhere else.
        guard path.hasPrefix(folder.standardizedFileURL.path + "/") else { return }
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }

    /// Only the Inbox iOS fills, never a file opened in place from somewhere else.
    private static func discardInboxCopy(_ url: URL) {
        let inbox = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
            .map { $0.appendingPathComponent("Inbox").standardizedFileURL.path }
        let path = url.standardizedFileURL.path
        guard inbox.contains(where: { path.hasPrefix($0 + "/") }) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

extension AppModel {
    /// A file another app opened in Carnet Malin. It waits in `incomingFiles` for the adult area.
    func receive(_ url: URL) {
        guard url.isFileURL else { return }
        guard incomingFiles.count < IncomingFiles.maxWaiting else { return }
        do {
            let kept = try IncomingFiles.keep(url)
            addIncoming(kept)
            show(FR.Incoming.arrived)
        } catch IncomingFiles.Failure.tooLarge {
            show(FR.Incoming.tooLarge, tone: .warning)
        } catch {
            show(FR.Incoming.unreadable, tone: .warning)
        }
    }

    /// The file was imported, or the parent chose not to: it goes.
    func finishIncoming(_ url: URL) {
        removeIncoming(url)
        IncomingFiles.discard(url)
    }
}
