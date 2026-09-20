import Capacitor
import Foundation
import UniformTypeIdentifiers

/// Files another app hands to Carnet Malin. The app declares in its Info.plist the kinds of document it can open
/// (PDF, EPUB, images), so it appears in « Ouvrir dans… » from Mail, Safari, Fichiers and iCloud Drive.
///
/// iOS opens the app with the address of a file, and the web view may not read it directly: this plugin reads the bytes
/// and hands them over, then deletes the copy iOS left in the Inbox so that the same book is not imported twice.
///
/// The address itself arrives through the official `App` plugin (`appUrlOpen`); this one only opens what it points at.
@objc(FileImportPlugin)
public class FileImportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FileImportPlugin"
    public let jsName = "FileImport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise)
    ]

    /// Largest file accepted, matching the limit of the web app (LIMITS.documentFileMaxBytes).
    private static let maxBytes = 30 * 1024 * 1024

    @objc func read(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.isFileURL else {
            call.reject("url of a file is required", "invalid_url")
            return
        }
        // A file coming from iCloud Drive or another app's container needs to be claimed before it can be read.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        do {
            let size = (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            if size > FileImportPlugin.maxBytes {
                call.reject("The file is too large", "too_large")
                return
            }
            let data = try Data(contentsOf: url, options: [.mappedIfSafe])
            call.resolve([
                "base64": data.base64EncodedString(),
                "name": url.lastPathComponent,
                "mediaType": FileImportPlugin.mediaType(of: url),
                "size": data.count
            ])
        } catch {
            call.reject("The file could not be read", "unreadable", error)
        }
    }

    /// Removes the copy iOS put in the app's Inbox once the web app has stored the document.
    @objc func discard(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.isFileURL else {
            call.reject("url of a file is required", "invalid_url")
            return
        }
        // Only inside our own container, and only the Inbox iOS fills: never a file the parent keeps somewhere else.
        let inbox = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)
            .map { $0.appendingPathComponent("Inbox").standardizedFileURL.path }
        let path = url.standardizedFileURL.path
        guard inbox.contains(where: { path.hasPrefix($0 + "/") }) else {
            call.resolve(["removed": false])
            return
        }
        try? FileManager.default.removeItem(at: url)
        call.resolve(["removed": true])
    }

    private static func mediaType(of url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }
}
