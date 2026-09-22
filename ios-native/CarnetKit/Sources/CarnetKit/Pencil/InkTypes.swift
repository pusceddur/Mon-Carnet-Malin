import Foundation

/// One point of a stroke, with how hard the pencil was pressed.
///
/// The JSON names are one letter because a page of handwriting is thousands of these and they travel through the sync
/// on every change. `p` is pressure, 0 to 1.
public struct InkPoint: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var p: Double

    public init(x: Double, y: Double, p: Double = 0.5) {
        self.x = x
        self.y = y
        self.p = p
    }
}

public enum InkTool: String, Codable, CaseIterable, Sendable {
    case pencil, pen, highlighter
}

/// What the eraser does: one whole stroke, the part it touches, or the whole page.
public enum EraserMode: String, Codable, CaseIterable, Sendable {
    case stroke, partial, page
}

public enum Thickness: String, Codable, CaseIterable, Sendable {
    case fine = "fin"
    case medium = "moyen"
    case thick = "epais"
}

/// What a stroke's coordinates are measured against.
///
/// Three spaces, because a mark means three different things. A note written beside a word belongs to that word and
/// has to follow it when the text reflows or is read again; a circle drawn on a scanned page belongs to that place on
/// the paper; an answer written in a box belongs to the box. Storing all three as screen pixels would make every one
/// of them wrong the moment anything moved.
public enum InkSpace: Equatable, Sendable {
    /// Anchored to a word. Points are in em from the top-left corner of the box of the word at `charOffset`.
    ///
    /// `endAnchor` (§15.7) is the word where a stroke that crosses lines ends; positions in between are interpolated
    /// between the two words, so after a reflow the stroke stretches between them instead of landing across
    /// unrelated text.
    case text(
        pageIndex: Int,
        blockIndex: Int,
        charOffset: Int,
        blockTextHash: String,
        /// The anchor word and the few that follow, kept so the anchor can be found again after the text changes.
        contextText: String,
        endAnchor: TextEndAnchor?
    )
    /// On the page image. x and y are fractions of its width and height.
    case original(pageIndex: Int)
    /// In an answer box. x and y are both fractions of the box's **width**, so the ink keeps its shape when the box
    /// grows taller as the child writes.
    case answer(exerciseId: String, questionId: String)

    public var pageIndex: Int? {
        switch self {
        case let .text(pageIndex, _, _, _, _, _): return pageIndex
        case let .original(pageIndex): return pageIndex
        case .answer: return nil
        }
    }

    public var kind: String {
        switch self {
        case .text: return "text"
        case .original: return "original"
        case .answer: return "answer"
        }
    }
}

public struct TextEndAnchor: Codable, Equatable, Sendable {
    public var blockIndex: Int
    public var charOffset: Int

    public init(blockIndex: Int, charOffset: Int) {
        self.blockIndex = blockIndex
        self.charOffset = charOffset
    }
}

extension InkSpace: Codable {
    private enum CodingKeys: String, CodingKey {
        case kind, pageIndex, blockIndex, charOffset, blockTextHash, contextText, endAnchor, exerciseId, questionId
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .kind) {
        case "text":
            self = .text(
                pageIndex: try container.decode(Int.self, forKey: .pageIndex),
                blockIndex: try container.decode(Int.self, forKey: .blockIndex),
                charOffset: try container.decode(Int.self, forKey: .charOffset),
                blockTextHash: try container.decode(String.self, forKey: .blockTextHash),
                contextText: try container.decode(String.self, forKey: .contextText),
                endAnchor: try container.decodeIfPresent(TextEndAnchor.self, forKey: .endAnchor)
            )
        case "original":
            self = .original(pageIndex: try container.decode(Int.self, forKey: .pageIndex))
        case "answer":
            self = .answer(
                exerciseId: try container.decode(String.self, forKey: .exerciseId),
                questionId: try container.decode(String.self, forKey: .questionId)
            )
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .kind, in: container, debugDescription: "unknown ink space « \(other) »"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        switch self {
        case let .text(pageIndex, blockIndex, charOffset, blockTextHash, contextText, endAnchor):
            try container.encode(pageIndex, forKey: .pageIndex)
            try container.encode(blockIndex, forKey: .blockIndex)
            try container.encode(charOffset, forKey: .charOffset)
            try container.encode(blockTextHash, forKey: .blockTextHash)
            try container.encode(contextText, forKey: .contextText)
            // Always written, `null` included: the web app expects the key to be there.
            try container.encode(endAnchor, forKey: .endAnchor)
        case let .original(pageIndex):
            try container.encode(pageIndex, forKey: .pageIndex)
        case let .answer(exerciseId, questionId):
            try container.encode(exerciseId, forKey: .exerciseId)
            try container.encode(questionId, forKey: .questionId)
        }
    }
}

/// A stroke of the pencil.
public struct InkAnnotation: Equatable, Sendable, Identifiable {
    public var id: String
    public var childId: String
    /// Nil only for an answer written on an exercise that belongs to no document.
    public var documentId: String?
    public var tool: InkTool
    /// « #rrggbb ».
    public var color: String
    /// In the units of its own space: em for text, a fraction of the page width for a scan.
    public var width: Double
    public var opacity: Double
    public var space: InkSpace
    public var points: [InkPoint]
    public var createdAt: Millis
    public var updatedAt: Millis
    public var deletedAt: Millis?

    public init(
        id: String, childId: String, documentId: String?, tool: InkTool, color: String, width: Double,
        opacity: Double, space: InkSpace, points: [InkPoint], createdAt: Millis, updatedAt: Millis,
        deletedAt: Millis? = nil
    ) {
        self.id = id
        self.childId = childId
        self.documentId = documentId
        self.tool = tool
        self.color = color
        self.width = width
        self.opacity = opacity
        self.space = space
        self.points = points
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }
}

/// A stretch of text the child coloured in.
///
/// Stored as a range of characters rather than as ink, so it survives the text being read again, follows the words
/// when they reflow, and can be listed in « Mes notes » as the words themselves.
public struct TextHighlight: Equatable, Sendable, Identifiable {
    public var id: String
    public var childId: String
    public var documentId: String
    public var color: String
    public var pageIndex: Int
    public var blockIndex: Int
    /// Character offsets inside the block, `[start, end)`, in UTF-16 units like everything else in the app.
    public var start: Int
    public var end: Int
    public var blockTextHash: String
    /// The words themselves, kept so the highlight can be found again after the page is re-read.
    public var text: String
    public var createdAt: Millis
    public var updatedAt: Millis
    public var deletedAt: Millis?

    public init(
        id: String, childId: String, documentId: String, color: String, pageIndex: Int, blockIndex: Int,
        start: Int, end: Int, blockTextHash: String, text: String, createdAt: Millis, updatedAt: Millis,
        deletedAt: Millis? = nil
    ) {
        self.id = id
        self.childId = childId
        self.documentId = documentId
        self.color = color
        self.pageIndex = pageIndex
        self.blockIndex = blockIndex
        self.start = start
        self.end = end
        self.blockTextHash = blockTextHash
        self.text = text
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }
}

/// §19.2 « Zone de texte »: typed, dictated or written with Scribble onto the original page.
///
/// It exists because a child who cannot write legibly on a worksheet can still answer it. `x`, `y` and `width` are
/// fractions of the page image, so the box stays where it was put whatever the screen.
public struct TextBoxAnnotation: Codable, Equatable, Sendable, Identifiable {
    public var id: String
    public var childId: String
    public var documentId: String
    public var pageIndex: Int
    public var x: Double
    public var y: Double
    public var width: Double
    /// A fraction of the page width, so the writing scales with the page.
    public var fontSize: Double
    public var color: String
    public var text: String
    public var createdAt: Millis
    public var updatedAt: Millis
    @NullCodable public var deletedAt: Millis?

    public init(
        id: String, childId: String, documentId: String, pageIndex: Int, x: Double, y: Double, width: Double,
        fontSize: Double, color: String, text: String, createdAt: Millis, updatedAt: Millis, deletedAt: Millis? = nil
    ) {
        self.id = id
        self.childId = childId
        self.documentId = documentId
        self.pageIndex = pageIndex
        self.x = x
        self.y = y
        self.width = width
        self.fontSize = fontSize
        self.color = color
        self.text = text
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = deletedAt
    }
}

/// Everything a child can leave on a page. One table, one `type` on the wire.
public enum Annotation: Equatable, Sendable, Identifiable {
    case ink(InkAnnotation)
    case highlight(TextHighlight)
    case textBox(TextBoxAnnotation)

    public var id: String {
        switch self {
        case let .ink(value): return value.id
        case let .highlight(value): return value.id
        case let .textBox(value): return value.id
        }
    }

    public var type: String {
        switch self {
        case .ink: return "ink"
        case .highlight: return "highlight"
        case .textBox: return "textbox"
        }
    }

    public var childId: String {
        switch self {
        case let .ink(value): return value.childId
        case let .highlight(value): return value.childId
        case let .textBox(value): return value.childId
        }
    }

    public var documentId: String? {
        switch self {
        case let .ink(value): return value.documentId
        case let .highlight(value): return value.documentId
        case let .textBox(value): return value.documentId
        }
    }

    public var updatedAt: Millis {
        switch self {
        case let .ink(value): return value.updatedAt
        case let .highlight(value): return value.updatedAt
        case let .textBox(value): return value.updatedAt
        }
    }

    public var deletedAt: Millis? {
        switch self {
        case let .ink(value): return value.deletedAt
        case let .highlight(value): return value.deletedAt
        case let .textBox(value): return value.deletedAt
        }
    }

    public var isDeleted: Bool { deletedAt != nil }

    /// Which page it sits on, or nil for an answer, which belongs to an exercise rather than to a page.
    public var pageIndex: Int? {
        switch self {
        case let .ink(value): return value.space.pageIndex
        case let .highlight(value): return value.pageIndex
        case let .textBox(value): return value.pageIndex
        }
    }

    /// True when it is tied to words, and so has to be found again when the text changes.
    public var isTextAnchored: Bool {
        switch self {
        case let .ink(value): if case .text = value.space { return true } else { return false }
        case .highlight: return true
        case .textBox: return false
        }
    }
}

// MARK: - The wire format
//
// Each of the three is one flat object carrying a `type`, exactly as the server stores it and the web app writes it.
// Swift would encode these enums its own way; it must not, or a child's marks would arrive unreadable on the iPad.

extension InkAnnotation: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, type, childId, documentId, tool, color, width, opacity, space, points
        case createdAt, updatedAt, deletedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        childId = try container.decode(String.self, forKey: .childId)
        documentId = try container.decodeIfPresent(String.self, forKey: .documentId)
        tool = try container.decode(InkTool.self, forKey: .tool)
        color = try container.decode(String.self, forKey: .color)
        width = try container.decode(Double.self, forKey: .width)
        opacity = try container.decode(Double.self, forKey: .opacity)
        space = try container.decode(InkSpace.self, forKey: .space)
        points = try container.decode([InkPoint].self, forKey: .points)
        createdAt = try container.decode(Millis.self, forKey: .createdAt)
        updatedAt = try container.decode(Millis.self, forKey: .updatedAt)
        deletedAt = try container.decodeIfPresent(Millis.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode("ink", forKey: .type)
        try container.encode(childId, forKey: .childId)
        try container.encode(documentId, forKey: .documentId)
        try container.encode(tool, forKey: .tool)
        try container.encode(color, forKey: .color)
        try container.encode(width, forKey: .width)
        try container.encode(opacity, forKey: .opacity)
        try container.encode(space, forKey: .space)
        try container.encode(points, forKey: .points)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(deletedAt, forKey: .deletedAt)
    }
}

extension TextHighlight: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, type, childId, documentId, color, pageIndex, blockIndex, start, end, blockTextHash, text
        case createdAt, updatedAt, deletedAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        childId = try container.decode(String.self, forKey: .childId)
        documentId = try container.decode(String.self, forKey: .documentId)
        color = try container.decode(String.self, forKey: .color)
        pageIndex = try container.decode(Int.self, forKey: .pageIndex)
        blockIndex = try container.decode(Int.self, forKey: .blockIndex)
        start = try container.decode(Int.self, forKey: .start)
        end = try container.decode(Int.self, forKey: .end)
        blockTextHash = try container.decode(String.self, forKey: .blockTextHash)
        text = try container.decode(String.self, forKey: .text)
        createdAt = try container.decode(Millis.self, forKey: .createdAt)
        updatedAt = try container.decode(Millis.self, forKey: .updatedAt)
        deletedAt = try container.decodeIfPresent(Millis.self, forKey: .deletedAt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode("highlight", forKey: .type)
        try container.encode(childId, forKey: .childId)
        try container.encode(documentId, forKey: .documentId)
        try container.encode(color, forKey: .color)
        try container.encode(pageIndex, forKey: .pageIndex)
        try container.encode(blockIndex, forKey: .blockIndex)
        try container.encode(start, forKey: .start)
        try container.encode(end, forKey: .end)
        try container.encode(blockTextHash, forKey: .blockTextHash)
        try container.encode(text, forKey: .text)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(deletedAt, forKey: .deletedAt)
    }
}

extension Annotation: Codable {
    private enum CodingKeys: String, CodingKey {
        case type
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .type) {
        case "ink": self = .ink(try InkAnnotation(from: decoder))
        case "highlight": self = .highlight(try TextHighlight(from: decoder))
        case "textbox": self = .textBox(try TextBoxAnnotation(from: decoder))
        case let other:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "unknown annotation « \(other) »"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case let .ink(value): try value.encode(to: encoder)
        case let .highlight(value): try value.encode(to: encoder)
        case let .textBox(value):
            try value.encode(to: encoder)
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode("textbox", forKey: .type)
        }
    }
}
