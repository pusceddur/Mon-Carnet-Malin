import Foundation

/// Turning one XHTML chapter of an EPUB into the titles and paragraphs the reader shows.
/// Ported from `client/src/documents/EpubReader.ts`.
public enum EpubBlocks {
    private static let titleElements: Set<String> = ["h1", "h2", "h3", "h4", "h5", "h6"]

    private static let blockElements: Set<String> = [
        "html", "body", "p", "li", "blockquote", "dd", "dt", "div", "section", "article", "main", "header", "footer",
        "aside", "figure", "figcaption", "pre", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
        "ul", "ol", "dl", "hr", "address", "center", "details", "summary", "hgroup",
    ]

    /// Elements whose content is not reading text: code, pictures, navigation, form controls.
    ///
    /// `rt` and `rp` are here because they hold pronunciation glosses printed above the line. Read in sequence they
    /// turn a sentence into gibberish, which for a child working hard to decode it is indistinguishable from their
    /// own reading going wrong.
    private static let skippedElements: Set<String> = [
        "head", "script", "style", "nav", "img", "image", "svg", "math", "audio", "video", "object", "iframe",
        "canvas", "picture", "template", "noscript", "rt", "rp", "button", "input", "select", "textarea", "map",
    ]

    /// Footnotes, note markers and printed page numbers, named through `epub:type` or `role`.
    ///
    /// They are left out for the same reason. A footnote marker read aloud in the middle of a sentence — « le chat
    /// dormait 12 sur le mur » — breaks the sentence for exactly the reader this app is for.
    private static let skippedSemantics: Set<String> = [
        "footnote", "footnotes", "endnote", "endnotes", "rearnote", "rearnotes", "noteref", "pagebreak",
        "doc-footnote", "doc-endnote", "doc-endnotes", "doc-noteref", "doc-pagebreak",
    ]

    /// Stands in for a `<br>` while the text of a block is gathered, and becomes a real line break at the end.
    /// A character no book contains, so it cannot be confused with the text itself.
    private static let lineBreakMarker: Character = "\u{2028}"

    private static func isSkipped(_ element: XmlElement) -> Bool {
        if skippedElements.contains(element.name) { return true }
        if element.attributes["hidden"] != nil { return true }
        let semantics = "\(element.attributes["epub:type"] ?? "") \(element.attributes["role"] ?? "")".lowercased()
        return semantics.split(whereSeparator: { $0.isWhitespace }).contains { skippedSemantics.contains(String($0)) }
    }

    /// XML whitespace collapsed, a `<br>` kept as a line break, then the usual display cleaning.
    public static func cleanInlineText(_ raw: String) -> String {
        var collapsed = ""
        collapsed.reserveCapacity(raw.count)
        var pendingSpace = false

        for character in raw {
            if character == lineBreakMarker {
                // A break swallows the spaces on either side of it.
                while collapsed.last == " " { collapsed.removeLast() }
                collapsed.append("\n")
                pendingSpace = false
                continue
            }
            if character == " " || character == "\t" || character == "\r" || character == "\n" || character == "\u{000C}" {
                pendingSpace = !collapsed.isEmpty
                continue
            }
            if pendingSpace, collapsed.last != "\n" { collapsed.append(" ") }
            pendingSpace = false
            collapsed.append(character)
        }
        return TextNormalizer.normalizedForDisplay(collapsed)
    }

    /// The titles and paragraphs of one XHTML document, in reading order.
    public static func extract(from document: XmlElement) -> [TextBlock] {
        var blocks: [TextBlock] = []
        var buffer = ""
        var kind = TextBlock.Kind.paragraph

        func flush() {
            let text = cleanInlineText(buffer)
            buffer = ""
            if !text.isEmpty { blocks.append(TextBlock(kind: kind, text: text)) }
        }

        func walk(_ node: XmlNode) {
            switch node {
            case let .text(value):
                buffer += value
            case let .element(element):
                guard !isSkipped(element) else { return }
                if element.name == "br" {
                    buffer.append(lineBreakMarker)
                    return
                }
                let isTitle = titleElements.contains(element.name)
                guard isTitle || blockElements.contains(element.name) else {
                    // An inline element — « <em> », « <span> », a link — is part of the sentence around it.
                    element.children.forEach(walk)
                    return
                }
                flush()
                let outer = kind
                if isTitle { kind = .title }
                element.children.forEach(walk)
                flush()
                kind = outer
            }
        }

        // A document with no `<body>` is malformed, and read whole rather than refused.
        walk(.element(document.firstDescendant(named: "body") ?? document))
        flush()
        return blocks
    }
}
