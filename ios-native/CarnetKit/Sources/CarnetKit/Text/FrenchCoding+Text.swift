import Foundation

/// The text level of §26: finding the words, deciding whether a final -ent is a verb ending, placing the liaisons, and
/// turning a coding back into something readable. Ported from the second half of `shared/src/text/frenchCoding.ts`.
extension FrenchCoding {
    /// A word of the text, with its place in UTF-16 units and the scalars it is made of.
    private struct Token {
        let start: Int
        let end: Int
        let lower: String
        /// One Character per scalar, so the rules index the word exactly as the web app does.
        let letters: [Character]
    }

    private static func isLetterOrMark(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .nonspacingMark, .spacingMark, .enclosingMark:
            return true
        default:
            return false
        }
    }

    private static func tokenize(_ text: String) -> [Token] {
        var tokens: [Token] = []
        var run: [Unicode.Scalar] = []
        var runStart = 0
        var offset = 0

        func flush() {
            defer { run.removeAll(keepingCapacity: true) }
            guard !run.isEmpty else { return }
            var view = String.UnicodeScalarView()
            view.append(contentsOf: run)
            let value = String(view)
            let lower = value.lowercased()
            // A word whose lower case is not the same length cannot be indexed letter by letter; it stays plain.
            guard lower.unicodeScalars.count == value.unicodeScalars.count else { return }
            tokens.append(Token(
                start: runStart,
                end: offset,
                lower: lower,
                letters: lower.unicodeScalars.map { Character($0) }
            ))
        }

        for scalar in text.unicodeScalars {
            if isLetterOrMark(scalar) {
                if run.isEmpty { runStart = offset }
                run.append(scalar)
            } else {
                flush()
            }
            offset += UTF16.width(scalar)
        }
        flush()
        return tokens
    }

    private static func isSentenceBreak(_ separator: String) -> Bool {
        separator.contains { ".;:!?«»()[]—–\"".contains($0) }
    }

    /// Text between two tokens, read back from the source.
    private static func between(_ utf16: [UInt16], _ from: Int, _ to: Int) -> String {
        guard from <= to, to <= utf16.count else { return "" }
        return String(decoding: utf16[from..<to], as: UTF16.self)
    }

    /// « ils mangent », « les enfants jouent », « les amis qui arrivent »: a final -ent that is a silent verb ending.
    private static func isVerb3pl(_ utf16: [UInt16], _ tokens: [Token], _ k: Int) -> Bool {
        var j = k - 1
        var steps = 0
        while j >= 0 && steps < 4 {
            if isSentenceBreak(between(utf16, tokens[j].end, tokens[j + 1].start)) { return false }
            let word = tokens[j].lower
            if FrenchLexicons.subjects.contains(word) { return true }
            if FrenchLexicons.clitics.contains(word) {
                j -= 1
                steps += 1
                continue
            }
            if word == "qui" { return true }

            // A plural noun, possibly with adjectives, after a plural determiner.
            var p = j
            var hops = 0
            while p >= 0 && hops < 3 && (tokens[p].lower.hasSuffix("s") || tokens[p].lower.hasSuffix("x")) {
                guard p - 1 >= 0 else { break }
                let previous = tokens[p - 1]
                if isSentenceBreak(between(utf16, previous.end, tokens[p].start)) { break }
                if FrenchLexicons.pluralDeterminers.contains(previous.lower) { return true }
                p -= 1
                hops += 1
            }
            return false
        }
        return false
    }

    /// True when the word begins with a vowel sound, which is what a liaison needs. An h aspiré does not.
    private static func startsWithVowelSound(_ word: String) -> Bool {
        let letters = Array(word)
        guard let first = letters.first else { return false }
        if first == "y" {
            return word == "yeux" || !(letters.count > 1 && isVowel(letters[1]))
        }
        if first == "h" {
            var bare = word
            if bare.hasSuffix("s") || bare.hasSuffix("x") { bare.removeLast() }
            return !FrenchLexicons.hAspire.contains(word) && !FrenchLexicons.hAspire.contains(bare)
        }
        return isVowel(first)
    }

    private static func isLiaison(_ utf16: [UInt16], _ tokens: [Token], _ k: Int) -> Bool {
        let a = tokens[k]
        let b = tokens[k + 1]
        // Exactly one plain space: a line break or punctuation stops the liaison.
        guard between(utf16, a.end, b.start) == " " else { return false }
        let second = b.lower
        guard startsWithVowelSound(second) else { return false }
        let first = a.lower

        if first == "est" {
            // « c’est un… » makes one, « il est un… » does not: only the elided c’ carries it here.
            guard k - 1 >= 0 else { return false }
            let previous = tokens[k - 1]
            let apostrophe = between(utf16, previous.end, a.start)
            return previous.lower == "c" && (apostrophe == "'" || apostrophe == "’")
                && second != "et" && second != "ou"
        }
        if FrenchLexicons.liaisonAlways.contains(first) { return true }
        if first == "tout" { return second != "et" && second != "ou" }
        if FrenchLexicons.liaisonWords.contains(first) { return !FrenchLexicons.noLiaisonNext.contains(second) }
        if FrenchLexicons.liaisonAdjectives.contains(first) {
            return !FrenchLexicons.noLiaisonNext.contains(second) && !FrenchLexicons.notAfterAdjective.contains(second)
        }
        return false
    }

    /// Codes one block of French text. Never throws: a word the rules cannot read simply stays without marks.
    public static func code(_ text: String) -> TextCoding {
        let utf16 = Array(text.utf16)
        let n = utf16.count
        var syllable = [Int16](repeating: -1, count: n)
        var flags = [UInt8](repeating: 0, count: n)
        var liaisons: [Int] = []
        let tokens = tokenize(text)

        for (k, token) in tokens.enumerated() {
            // « l’arbre »: the clitic keeps no silent end, the word after the apostrophe carries the sound.
            let followsApostrophe = between(utf16, token.end, min(token.end + 1, n))
            let elided = (followsApostrophe == "'" || followsApostrophe == "’")
                && k + 1 < tokens.count && tokens[k + 1].start == token.end + 1
            let verb3pl = token.lower.hasSuffix("ent") && isVerb3pl(utf16, tokens, k)
            let coded = analyze(word: token.letters, verb3pl: verb3pl, elided: elided)

            // Each letter is one UTF-16 unit for French text in composed form; anything else is skipped rather than
            // written at the wrong place.
            guard coded.flags.count == token.end - token.start else { continue }
            for index in 0..<coded.flags.count {
                let position = token.start + index
                let group = coded.group[index]
                syllable[position] = Int16(coded.syllable[index])
                flags[position] = coded.flags[index] | (group >= 0 && group % 2 == 1 ? soundAlternate : 0)
            }
            if k + 1 < tokens.count && isLiaison(utf16, tokens, k) { liaisons.append(token.end) }
        }
        return TextCoding(syllable: syllable, flags: flags, liaisons: liaisons)
    }

    /// Readable form of a coding, for the tests and for looking at what the rules decided:
    /// `|` between syllables, `{}` silent letters, `[]` one sound, `<>` a changed sound, `‿` a liaison.
    public static func format(_ text: String, _ coding: TextCoding) -> String {
        let utf16 = Array(text.utf16)
        let liaisons = Set(coding.liaisons)
        let openers = ["[", "<", "{"]
        let closers = ["]", ">", "}"]
        var state = ["", "", ""]
        var out = ""

        func closeFrom(_ level: Int) {
            var k = 2
            while k >= level {
                if !state[k].isEmpty { out += closers[k] }
                state[k] = ""
                k -= 1
            }
        }

        for i in 0..<utf16.count {
            let f = coding.flags[i]
            let inWord = coding.syllable[i] >= 0
            let sameWord = inWord && i > 0 && coding.syllable[i - 1] >= 0
            let desired: [String] = inWord
                ? [
                    (f & sound) != 0 ? ((f & soundAlternate) != 0 ? "b" : "a") : "",
                    (f & changed) != 0 ? "c" : "",
                    (f & silent) != 0 ? "s" : "",
                  ]
                : ["", "", ""]

            var level = 0
            if sameWord {
                while level < 3 && desired[level] == state[level] { level += 1 }
            }
            closeFrom(level)
            if sameWord && coding.syllable[i] != coding.syllable[i - 1] { out += "|" }
            for k in level..<3 {
                if !desired[k].isEmpty { out += openers[k] }
                state[k] = desired[k]
            }
            out += liaisons.contains(i) ? "‿" : String(decoding: [utf16[i]], as: UTF16.self)
        }
        closeFrom(0)
        return out
    }
}
