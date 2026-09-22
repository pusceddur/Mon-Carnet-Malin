import Foundation

/// The photographs of the pages, kept on the iPad.
///
/// Three reasons to keep them. The « Original » view, where a child checks a word the machine misread against the
/// real page; the pencil on a worksheet, which draws on the image itself; and the home computer, which reads the pages
/// the iPad could not and needs the image to do it.
public struct PageImageStore: Sendable {
    let root: URL

    public init(root: URL) {
        self.root = root
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    /// In Application Support rather than Caches: a scanned page exists nowhere else until it has been uploaded, and
    /// the system must not be allowed to clear it to free space.
    public static func standard() -> PageImageStore? {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        else { return nil }
        return PageImageStore(root: support.appendingPathComponent("page-images", isDirectory: true))
    }

    private func folder(_ documentId: String) -> URL {
        // The id comes from this app or from the family's server; it is still never trusted as a path.
        let safe = documentId.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }
        return root.appendingPathComponent(safe.isEmpty ? "_" : safe, isDirectory: true)
    }

    public func url(documentId: String, pageIndex: Int) -> URL {
        folder(documentId).appendingPathComponent("\(max(0, pageIndex)).jpg")
    }

    public func image(documentId: String, pageIndex: Int) -> Data? {
        try? Data(contentsOf: url(documentId: documentId, pageIndex: pageIndex))
    }

    public func has(documentId: String, pageIndex: Int) -> Bool {
        FileManager.default.fileExists(atPath: url(documentId: documentId, pageIndex: pageIndex).path)
    }

    public func save(_ jpeg: Data, documentId: String, pageIndex: Int) throws {
        try FileManager.default.createDirectory(at: folder(documentId), withIntermediateDirectories: true)
        let target = url(documentId: documentId, pageIndex: pageIndex)
        #if os(iOS)
        // Readable once the iPad has been unlocked after starting, so the upload can run in the background.
        try jpeg.write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try jpeg.write(to: target, options: [.atomic])
        #endif
        // Never in an iCloud backup: these are a child's pages, and they already live on the family's own server.
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var marked = target
        try? marked.setResourceValues(values)
    }

    public func removeDocument(_ documentId: String) {
        try? FileManager.default.removeItem(at: folder(documentId))
    }

    /// Every page of every book goes. What a sign-out runs (§20, §28): these are photographs of a child's own
    /// schoolbooks and homework, and they must not be here for whoever signs in next.
    public func removeAll() {
        try? FileManager.default.removeItem(at: root)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
}

/// A page image waiting to go to the server.
public struct PendingImageUpload: Codable, Equatable, Hashable, Sendable {
    public let documentId: String
    public let pageIndex: Int

    public init(documentId: String, pageIndex: Int) {
        self.documentId = documentId
        self.pageIndex = pageIndex
    }
}

/// Page images waiting to go up, kept across launches.
///
/// They wait because the server refuses an image for a book it has not heard of yet: the book goes up with the next
/// sync, and the images follow it. A list rather than a fire-and-forget upload, because an iPad on a school's Wi-Fi
/// loses its connection in the middle of things, and a page that never reaches the home computer is a page that
/// never gets read.
public enum ImageUploadQueue {
    static let key = "images.pendingUploads"

    public static func pending(in store: LocalStore) -> [PendingImageUpload] {
        guard let text = (try? store.value(forKey: key)) ?? nil,
              let list = try? JSONDecoder().decode([PendingImageUpload].self, from: Data(text.utf8))
        else { return [] }
        return list
    }

    public static func add(_ upload: PendingImageUpload, to store: LocalStore) {
        var list = pending(in: store)
        guard !list.contains(upload) else { return }
        list.append(upload)
        write(list, to: store)
    }

    public static func remove(_ upload: PendingImageUpload, from store: LocalStore) {
        write(pending(in: store).filter { $0 != upload }, to: store)
    }

    private static func write(_ list: [PendingImageUpload], to store: LocalStore) {
        guard let data = try? JSONEncoder().encode(list) else { return }
        try? store.setValue(list.isEmpty ? nil : String(decoding: data, as: UTF8.self), forKey: key)
    }

    /// Sends what can be sent. Stops at the first network failure — there is no point hammering a connection that
    /// just dropped — and keeps whatever did not go for next time.
    @discardableResult
    public static func flush(store: LocalStore, images: PageImageStore, api: APIClient) async -> Int {
        var sent = 0
        for upload in pending(in: store) {
            guard let jpeg = images.image(documentId: upload.documentId, pageIndex: upload.pageIndex) else {
                // The image is gone from the device: nothing left to send.
                remove(upload, from: store)
                continue
            }
            do {
                try await api.uploadPageImage(documentId: upload.documentId, pageIndex: upload.pageIndex, jpeg: jpeg)
                remove(upload, from: store)
                sent += 1
            } catch let error as APIError {
                switch error {
                case let .api(status, code, _) where status == 404 && code == "document_not_synced":
                    continue
                case let .api(status, _, _) where status == 400 || status == 413 || status == 415:
                    // The server will never take this one: keeping it would retry it forever.
                    remove(upload, from: store)
                default:
                    return sent
                }
            } catch {
                return sent
            }
        }
        return sent
    }
}

extension APIClient {
    /// `GET /api/documents/:id/pages/:i/image`. Nil when the server has none or cannot be reached; never throws,
    /// because a missing image only means the « Original » view says so.
    public func pageImage(documentId: String, pageIndex: Int) async -> Data? {
        let id = documentId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? documentId
        guard let data = try? await performRaw(
            method: "GET", path: "/api/documents/\(id)/pages/\(pageIndex)/image", body: nil, contentType: nil,
            timeout: 60
        ), !data.isEmpty else { return nil }
        return data
    }

    /// `PUT /api/documents/:id/pages/:i/image`: a JPEG, at most 5 MB, sent as a form. The server then asks the home
    /// computer to read it (§17.5).
    public func uploadPageImage(documentId: String, pageIndex: Int, jpeg: Data) async throws {
        let id = documentId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? documentId
        let boundary = "carnet-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"image\"; filename=\"page-\(pageIndex).jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpeg)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        _ = try await performRaw(
            method: "PUT", path: "/api/documents/\(id)/pages/\(pageIndex)/image", body: body,
            contentType: "multipart/form-data; boundary=\(boundary)", timeout: 120
        )
    }
}
