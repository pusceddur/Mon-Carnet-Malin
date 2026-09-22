import Foundation

/// A node of a parsed document: either an element or a run of text.
public enum XmlNode: Equatable {
    case text(String)
    case element(XmlElement)

    /// All the text under this node, with nothing between the pieces.
    public var textContent: String {
        switch self {
        case let .text(value): return value
        case let .element(element): return element.children.map(\.textContent).joined()
        }
    }
}

/// One element. Names are local and lower-cased — « dc:title » is `title` — because an EPUB may or may not use a
/// prefix for the very same thing, and a reader that cared would read half the books it is given.
///
/// A reference type, because an element is built as it is read and its children arrive after it does. Not Sendable on
/// purpose: a parsed document is read and turned into blocks on the thread that parsed it, and nothing else ever
/// touches it.
public final class XmlElement {
    public let name: String
    /// Attribute names lower-cased, prefix kept (« epub:type »).
    public let attributes: [String: String]
    public var children: [XmlNode] = []

    public init(name: String, attributes: [String: String] = [:], children: [XmlNode] = []) {
        self.name = name
        self.attributes = attributes
        self.children = children
    }

    public var textContent: String { children.map(\.textContent).joined() }

    /// Attribute by local name, so « full-path » finds « opf:full-path » too.
    public func attribute(_ name: String) -> String? {
        if let direct = attributes[name] { return direct }
        for (key, value) in attributes where XmlParser.localName(key) == name { return value }
        return nil
    }

    /// Every element below this one, in reading order, optionally only those with a given name.
    public func descendants(named name: String? = nil) -> [XmlElement] {
        var found: [XmlElement] = []
        for child in children {
            guard case let .element(element) = child else { continue }
            if name == nil || element.name == name { found.append(element) }
            found.append(contentsOf: element.descendants(named: name))
        }
        return found
    }

    public func firstDescendant(named name: String) -> XmlElement? {
        for child in children {
            guard case let .element(element) = child else { continue }
            if element.name == name { return element }
            if let deeper = element.firstDescendant(named: name) { return deeper }
        }
        return nil
    }
}

extension XmlElement: Equatable {
    public static func == (lhs: XmlElement, rhs: XmlElement) -> Bool {
        lhs === rhs || (lhs.name == rhs.name && lhs.attributes == rhs.attributes && lhs.children == rhs.children)
    }
}

/// A forgiving XML and XHTML parser.
/// Ported from `client/src/documents/EpubReader.ts`.
///
/// `XMLParser` from Foundation would be the obvious choice and is the wrong one here. Real EPUB files, especially the
/// ones a parent already owns, are full of unclosed `<br>`, HTML entities no XML declares, stray `&` and mismatched
/// tags. A strict parser stops at the first of them and the book does not open — which, for a child waiting to read
/// it, is indistinguishable from the app being broken. This one reads past all of that and gets the text out.
public enum XmlParser {
    private static let voidElements: Set<String> = [
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
    ]
    private static let rawTextElements: Set<String> = ["script", "style"]

    /// « dc:title » → « title ».
    public static func localName(_ qualified: String) -> String {
        guard let colon = qualified.firstIndex(of: ":") else { return qualified.lowercased() }
        return String(qualified[qualified.index(after: colon)...]).lowercased()
    }

    // MARK: - Entities

    /// The HTML Latin-1 entity names, in the order of code points 160 to 255.
    private static let latin1Entities = """
        nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute \
        micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring \
        AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml \
        times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil \
        egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash \
        ugrave uacute ucirc uuml yacute thorn yuml
        """.split(separator: " ").map(String.init)

    static let namedEntities: [String: String] = {
        var map: [String: String] = ["amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'"]
        for (index, name) in latin1Entities.enumerated() {
            map[name] = String(UnicodeScalar(160 + UInt32(index))!)
        }
        let others: [(String, UInt32)] = [
            ("OElig", 338), ("oelig", 339), ("Scaron", 352), ("scaron", 353), ("Yuml", 376), ("fnof", 402),
            ("circ", 710), ("tilde", 732), ("ensp", 8194), ("emsp", 8195), ("thinsp", 8201), ("zwnj", 8204),
            ("zwj", 8205), ("lrm", 8206), ("rlm", 8207), ("ndash", 8211), ("mdash", 8212), ("lsquo", 8216),
            ("rsquo", 8217), ("sbquo", 8218), ("ldquo", 8220), ("rdquo", 8221), ("bdquo", 8222), ("dagger", 8224),
            ("Dagger", 8225), ("bull", 8226), ("hellip", 8230), ("permil", 8240), ("prime", 8242), ("Prime", 8243),
            ("lsaquo", 8249), ("rsaquo", 8250), ("euro", 8364), ("trade", 8482), ("minus", 8722),
        ]
        for (name, code) in others {
            if let scalar = UnicodeScalar(code) { map[name] = String(scalar) }
        }
        return map
    }()

    /// Turns `&eacute;` and `&#233;` into « é ». An entity the app does not know is left exactly as it was: showing
    /// « &truc; » in the text is ugly, but silently deleting a word would be worse.
    public static func decodeEntities(_ text: String) -> String {
        guard text.contains("&") else { return text }
        var out = ""
        out.reserveCapacity(text.count)
        var rest = Substring(text)

        while let start = rest.firstIndex(of: "&") {
            out += rest[rest.startIndex..<start]
            let afterAmp = rest.index(after: start)
            // An entity is short; a stray « & » in the middle of a sentence must not start a hunt to the end of a book.
            let limit = rest.index(afterAmp, offsetBy: 34, limitedBy: rest.endIndex) ?? rest.endIndex
            guard let semicolon = rest[afterAmp..<limit].firstIndex(of: ";") else {
                out.append("&")
                rest = rest[afterAmp...]
                continue
            }

            let body = String(rest[afterAmp..<semicolon])
            if let replacement = replacement(forEntityBody: body) {
                out += replacement
            } else {
                out += "&\(body);"
            }
            rest = rest[rest.index(after: semicolon)...]
        }
        out += rest
        return out
    }

    private static func replacement(forEntityBody body: String) -> String? {
        if body.hasPrefix("#") {
            let digits = String(body.dropFirst())
            let code: UInt32?
            if digits.first == "x" || digits.first == "X" {
                let hex = digits.dropFirst()
                code = hex.count >= 1 && hex.count <= 6 ? UInt32(hex, radix: 16) : nil
            } else {
                code = digits.count >= 1 && digits.count <= 7 ? UInt32(digits, radix: 10) : nil
            }
            // Not a number at all: leave « &#truc; » alone rather than eat it.
            guard let code else { return nil }
            // A surrogate or an out-of-range code point is dropped: it cannot be written, and keeping the raw
            // « &#55296; » in a child's reading text helps nobody.
            guard code > 0, code <= 0x10FFFF, !(0xD800...0xDFFF).contains(code),
                  let scalar = UnicodeScalar(code) else { return "" }
            return String(scalar)
        }
        guard body.count >= 2, body.count <= 32, let first = body.first, first.isLetter,
              body.allSatisfy({ $0.isLetter || $0.isNumber })
        else { return nil }
        return namedEntities[body]
    }

    // MARK: - Tags

    private struct StartTag {
        let name: String
        let attributes: [String: String]
        let isSelfClosing: Bool
        /// Index just past the « > ».
        let end: Int
    }

    private static func isNameCharacter(_ character: Character) -> Bool {
        !character.isWhitespace && character != "/" && character != ">" && character != "="
    }

    /// Reads `<name attr="v" …>` starting at the « < ». Nil when this is not a tag after all.
    private static func readStartTag(_ source: [Character], _ start: Int) -> StartTag? {
        var i = start + 1
        guard i < source.count, source[i].isLetter || source[i] == "_" else { return nil }

        let nameStart = i
        while i < source.count && isNameCharacter(source[i]) { i += 1 }
        let name = String(source[nameStart..<i])
        var attributes: [String: String] = [:]

        while true {
            while i < source.count && source[i].isWhitespace { i += 1 }
            guard i < source.count else { return nil }
            if source[i] == ">" { return StartTag(name: name, attributes: attributes, isSelfClosing: false, end: i + 1) }
            if source[i] == "/" {
                i += 1
                if i < source.count && source[i] == ">" {
                    return StartTag(name: name, attributes: attributes, isSelfClosing: true, end: i + 1)
                }
                continue
            }

            let attributeStart = i
            while i < source.count && isNameCharacter(source[i]) { i += 1 }
            if i == attributeStart {
                // A stray « = » with no name in front of it: step over it rather than give up on the tag.
                i += 1
                continue
            }
            let attributeName = String(source[attributeStart..<i]).lowercased()

            var value = ""
            var j = i
            while j < source.count && source[j].isWhitespace { j += 1 }
            if j < source.count, source[j] == "=" {
                j += 1
                while j < source.count && source[j].isWhitespace { j += 1 }
                let quote = j < source.count ? source[j] : " "
                if quote == "\"" || quote == "'" {
                    guard let close = index(of: quote, in: source, from: j + 1) else { return nil }
                    value = String(source[(j + 1)..<close])
                    i = close + 1
                } else {
                    let valueStart = j
                    while j < source.count && !source[j].isWhitespace && source[j] != ">" { j += 1 }
                    value = String(source[valueStart..<j])
                    i = j
                }
            }
            attributes[attributeName] = decodeEntities(value)
        }
    }

    private static func index(of character: Character, in source: [Character], from: Int) -> Int? {
        var i = from
        while i < source.count {
            if source[i] == character { return i }
            i += 1
        }
        return nil
    }

    private static func index(of marker: [Character], in source: [Character], from: Int) -> Int? {
        guard !marker.isEmpty, source.count >= marker.count else { return nil }
        var i = max(0, from)
        while i + marker.count <= source.count {
            if Array(source[i..<(i + marker.count)]) == marker { return i }
            i += 1
        }
        return nil
    }

    private static func matches(_ source: [Character], _ at: Int, _ prefix: [Character]) -> Bool {
        guard at >= 0, at + prefix.count <= source.count else { return false }
        return Array(source[at..<(at + prefix.count)]) == prefix
    }

    /// Steps past `<!DOCTYPE …>`, including an internal subset in brackets.
    private static func skipDeclaration(_ source: [Character], _ start: Int) -> Int {
        var depth = 0
        var i = start + 2
        while i < source.count {
            switch source[i] {
            case "[": depth += 1
            case "]": depth = max(0, depth - 1)
            case ">" where depth == 0: return i + 1
            default: break
            }
            i += 1
        }
        return source.count
    }

    // MARK: - The document

    /// Parses a document. It never fails: whatever it could not make sense of comes back as text.
    public static func parse(_ text: String) -> XmlElement {
        let source = Array(text)
        let root = XmlElement(name: "#document")
        var stack: [XmlElement] = [root]

        func pushText(_ piece: ArraySlice<Character>) {
            guard !piece.isEmpty else { return }
            stack[stack.count - 1].children.append(.text(decodeEntities(String(piece))))
        }

        var i = 0
        while i < source.count {
            guard let lt = index(of: "<", in: source, from: i) else {
                pushText(source[i...])
                break
            }
            pushText(source[i..<lt])

            if matches(source, lt, ["<", "!", "-", "-"]) {
                i = index(of: ["-", "-", ">"], in: source, from: lt + 4).map { $0 + 3 } ?? source.count
            } else if matches(source, lt, Array("<![CDATA[")) {
                let end = index(of: ["]", "]", ">"], in: source, from: lt + 9)
                stack[stack.count - 1].children.append(.text(String(source[(lt + 9)..<(end ?? source.count)])))
                i = end.map { $0 + 3 } ?? source.count
            } else if matches(source, lt, ["<", "?"]) {
                i = index(of: ">", in: source, from: lt + 2).map { $0 + 1 } ?? source.count
            } else if matches(source, lt, ["<", "!"]) {
                i = skipDeclaration(source, lt)
            } else if matches(source, lt, ["<", "/"]) {
                let end = index(of: ">", in: source, from: lt + 2)
                let raw = String(source[(lt + 2)..<(end ?? source.count)]).trimmingCharacters(in: .whitespacesAndNewlines)
                let name = localName(raw)
                // A closing tag no one opened is ignored; one that closes several at once closes them all. Neither is
                // valid XML, and both are common in books people actually own.
                if let depth = stack.indices.reversed().first(where: { $0 > 0 && stack[$0].name == name }) {
                    stack.removeSubrange(depth...)
                }
                i = end.map { $0 + 1 } ?? source.count
            } else if let tag = readStartTag(source, lt) {
                let element = XmlElement(name: localName(tag.name), attributes: tag.attributes)
                stack[stack.count - 1].children.append(.element(element))
                i = tag.end
                if tag.isSelfClosing || voidElements.contains(element.name) { continue }
                if rawTextElements.contains(element.name) {
                    // Everything up to the matching close is code, not reading text.
                    i = closeOfRawText(source, from: i, name: element.name)
                    continue
                }
                stack.append(element)
            } else {
                // A « < » that starts nothing: it is part of the text.
                pushText(source[lt..<(lt + 1)])
                i = lt + 1
            }
        }
        return root
    }

    /// Finds `</script>` or `</style>`, whatever case it is written in.
    private static func closeOfRawText(_ source: [Character], from: Int, name: String) -> Int {
        let needle = "</\(name)"
        let length = needle.count
        var i = from
        while i + length <= source.count {
            if String(source[i..<(i + length)]).lowercased() == needle {
                var j = i + length
                while j < source.count && source[j].isWhitespace { j += 1 }
                if j < source.count && source[j] == ">" { return j + 1 }
            }
            i += 1
        }
        return source.count
    }
}
