import Foundation

/// A book, a lesson or a set of scanned pages, as the app and the server both know it.
public struct DocumentMeta: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let ownerParentId: String
    /// The children allowed to open it. A document belongs to a family, never to the app.
    public var childIds: [String]
    public var title: String
    public let kind: DocumentKind
    /// Changed only through the dedicated endpoint, never by a sync push: re-reading every page is not something a
    /// background sync should be able to start.
    public var textMode: DocumentTextMode
    public let purpose: DocumentPurpose
    /// §19.3 « J'ai terminé », set and cleared by the child on a homework document.
    @NullCodable public var homeworkDoneAt: Millis?
    /// sha256 of the original files, in order: what tells the app this book is already here.
    ///
    /// Written once the pages have been read: until then it is only the id of a book nobody has seen yet.
    public var sourceHash: String
    public var pageCount: Int
    public var status: DocumentStatus
    public let createdAt: Millis
    public var updatedAt: Millis
    @NullCodable public var deletedAt: Millis?

    public var isDeleted: Bool { deletedAt != nil }
    public var isHomework: Bool { purpose == .homework }
    public var isHomeworkDone: Bool { homeworkDoneAt != nil }

    public init(
        id: String, ownerParentId: String, childIds: [String], title: String, kind: DocumentKind,
        textMode: DocumentTextMode, purpose: DocumentPurpose, homeworkDoneAt: Millis? = nil, sourceHash: String,
        pageCount: Int, status: DocumentStatus, createdAt: Millis, updatedAt: Millis, deletedAt: Millis? = nil
    ) {
        self.id = id
        self.ownerParentId = ownerParentId
        self.childIds = childIds
        self.title = title
        self.kind = kind
        self.textMode = textMode
        self.purpose = purpose
        self.homeworkDoneAt = homeworkDoneAt
        self.sourceHash = sourceHash
        self.pageCount = pageCount
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }
}

/// One page and what the app managed to read on it.
///
/// `status` and `warnings` are kept apart on purpose. The status says whether a child can open the page; the warnings
/// say what a parent should look at. A page can be perfectly readable and still deserve a look — that is the whole
/// point of « À vérifier ».
public struct PageContent: Codable, Equatable, Sendable {
    public let documentId: String
    /// 0-based.
    public let pageIndex: Int
    public var status: PageStatus
    @NullCodable public var textSource: PageTextSource?
    /// The text of the page; `blockIndex` is the position in this array, and annotations are anchored to it.
    public var blocks: [TextBlock]
    /// 0 to 100. Nil when the text was not read but taken (a PDF's own text, a parent's correction).
    @NullCodable public var confidence: Double?
    @NullCodable public var contentHash: String?
    /// Size of the processed page image, for the « Original » view.
    @NullCodable public var width: Double?
    @NullCodable public var height: Double?
    public var warnings: [PageWarning]
    public var updatedAt: Millis

    public init(
        documentId: String, pageIndex: Int, status: PageStatus, textSource: PageTextSource? = nil,
        blocks: [TextBlock] = [], confidence: Double? = nil, contentHash: String? = nil,
        width: Double? = nil, height: Double? = nil, warnings: [PageWarning] = [], updatedAt: Millis
    ) {
        self.documentId = documentId
        self.pageIndex = pageIndex
        self.status = status
        self.textSource = textSource
        self.blocks = blocks
        self.confidence = confidence
        self.contentHash = contentHash
        self.width = width
        self.height = height
        self.warnings = warnings
        self.updatedAt = updatedAt
    }

    /// The text as one string, blocks separated by a blank line.
    public var plainText: String { blocks.map(\.text).joined(separator: "\n\n") }

    /// A page a child can open. « Peu sûr » counts: a page read imperfectly is still better than a closed door, and
    /// the child is told, rather than quietly given something else.
    public var isAvailable: Bool { status == .ready || status == .lowConfidence }
}

/// Where the child left off.
public struct ReadingProgress: Codable, Equatable, Sendable {
    public let childId: String
    public let documentId: String
    public var pageIndex: Int
    public var blockIndex: Int
    public var sentenceIndex: Int
    public var updatedAt: Millis

    public init(
        childId: String, documentId: String, pageIndex: Int, blockIndex: Int, sentenceIndex: Int, updatedAt: Millis
    ) {
        self.childId = childId
        self.documentId = documentId
        self.pageIndex = pageIndex
        self.blockIndex = blockIndex
        self.sentenceIndex = sentenceIndex
        self.updatedAt = updatedAt
    }
}

/// One sitting with a book, summarised for the parent's weekly page.
///
/// It counts pages, minutes and how often help was asked for — never mistakes. A number a child can fail at would
/// turn reading into a test, which is the one thing this app is not.
public struct ReadingSession: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let childId: String
    public let documentId: String
    public let startedAt: Millis
    public var endedAt: Millis
    public var pagesViewed: [Int]
    public var ttsSeconds: Int
    public var wordsLookedUp: Int
    public var aiRequests: Int
    public var updatedAt: Millis

    public init(
        id: String, childId: String, documentId: String, startedAt: Millis, endedAt: Millis,
        pagesViewed: [Int] = [], ttsSeconds: Int = 0, wordsLookedUp: Int = 0, aiRequests: Int = 0, updatedAt: Millis
    ) {
        self.id = id
        self.childId = childId
        self.documentId = documentId
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.pagesViewed = pagesViewed
        self.ttsSeconds = ttsSeconds
        self.wordsLookedUp = wordsLookedUp
        self.aiRequests = aiRequests
        self.updatedAt = updatedAt
    }

    public var minutes: Int { max(0, Int((endedAt - startedAt) / 60_000)) }
}
