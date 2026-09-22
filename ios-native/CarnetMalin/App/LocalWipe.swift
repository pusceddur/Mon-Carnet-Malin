import CarnetKit
import Foundation

/// Taking a family off this iPad (§20, §28).
///
/// The rule is short and has no exceptions: when a family leaves the device, nothing of theirs stays on it. Not a
/// book, not a page photographed at the kitchen table, not an answer the help gave, not a homework sheet exported
/// this morning. The next family to sign in on the same iPad — a cousin, a second child with their own account, the
/// buyer of a second-hand tablet — must find it as empty as a fresh install.
///
/// It is one function rather than a line in `signOut` because three places need exactly the same thing: signing out,
/// signing in as a different family, and, later, deleting the account. Three copies of this would drift, and the one
/// that drifted would leave a child's homework behind.
enum LocalWipe {
    /// The values that belong to the iPad and not to anybody: they survive.
    ///
    /// The server address so the family does not retype it; the voice because another iPad has other voices
    /// downloaded; whether a finger draws because it describes this device's owner having a Pencil or not; and the
    /// identifier the server lists in « Appareils connectés », which names the device, never the family.
    static let deviceValues: Set<String> = [
        AppKeys.serverURL,
        AppKeys.voiceIdentifier,
        AppKeys.fingerDraws,
        StoreKeys.deviceId,
    ]

    /// Everything of the family that is on this iPad.
    ///
    /// - Parameters:
    ///   - store: the local database — books, pages, marks, answers, and what was still waiting to be sent.
    ///   - tokens: the session, when the family is leaving for good. Left alone when another family has just signed
    ///     in, because that token is theirs and the app is about to use it.
    ///
    /// Nothing here throws. A wipe that stopped at the first stubborn file would leave the rest behind, which is the
    /// one outcome that must not happen; each piece is removed on its own terms and the sign-out goes through.
    static func family(store: LocalStore, tokens: TokenStore? = nil) {
        try? store.removeEverything(keepingValues: deviceValues)
        PageImageStore.standard()?.removeAll()
        AICache.standard()?.removeAll()
        IncomingFiles.discardAll()
        Exports.discardAll()
        tokens?.write(nil)
    }
}

/// The files the app hands to other apps — a homework sheet as a PDF for the teacher, by mail or AirDrop.
///
/// They live in one folder of their own inside the temporary directory rather than loose in it, for a single
/// reason: a folder can be emptied. iOS clears the temporary directory when it feels like it, which is not a
/// promise, and « Mes devoirs de mardi.pdf » is a child's handwriting with their name on the cover.
enum Exports {
    static var folder: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
    }

    /// A file to write an export to, with the folder ready.
    static func url(named name: String) -> URL {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent(name)
    }

    static func discardAll() {
        try? FileManager.default.removeItem(at: folder)
    }
}
