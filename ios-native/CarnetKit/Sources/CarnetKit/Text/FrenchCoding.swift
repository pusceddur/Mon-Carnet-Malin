import Foundation

/// §26 « Couleurs de lecture »: the reading aids worked out from the text alone, on the device, in microseconds.
/// Ported from `shared/src/text/frenchCoding.ts`.
///
/// Written syllables as they are taught at school, silent letters, groups of letters making one sound, letters that do
/// not make their usual sound (c → s, g → j, s → z, t → s, x → gz) and liaisons. The text is never changed: every
/// character only receives marks.
public struct TextCoding: Sendable {
    /// Syllable number of each character inside its word (0, 1, 2…), -1 outside words.
    public let syllable: [Int16]
    /// The `CODING_*` bits of each character.
    public let flags: [UInt8]
    /// Offsets of the spaces where a liaison is made (« les‿amis »).
    public let liaisons: [Int]

    public static let empty = TextCoding(syllable: [], flags: [], liaisons: [])
}

public enum FrenchCoding {
    /// Letter written but not pronounced (shown in grey).
    public static let silent: UInt8 = 1
    /// Letter of a group that makes one sound.
    public static let sound: UInt8 = 2
    /// Every other sound group of a word, so that two groups side by side stay distinct.
    public static let soundAlternate: UInt8 = 4
    /// Letter that does not make its usual sound.
    public static let changed: UInt8 = 8

    // MARK: - Letters

    /// Shared with the text level, which also has to know a vowel when it sees one.
    static let vowels = Set("aeiouyàâäéèêëîïôöùûüœæ")
    /// The letters that soften a c or a g.
    private static let softeners = Set("eiyéèêëîï")
    private static let stops: Set<String> = ["b", "c", "d", "f", "g", "k", "p", "t", "v", "ch", "ph", "th", "gu"]
    private static let liquids: Set<String> = ["l", "r"]

    static func isVowel(_ c: Character?) -> Bool {
        guard let c else { return false }
        return vowels.contains(c)
    }

    // MARK: - The shape of a word

    /// V a vowel sound, C a consonant, G a glide (i, u before a vowel), E the silent final e that starts a written
    /// syllable of its own, T a silent end that does not.
    private enum UnitKind { case vowel, consonant, glide, silentE, silentTail }
    private struct Unit { let start: Int; let end: Int; let kind: UnitKind }

    struct WordCoding {
        var syllable: [Int]
        var flags: [UInt8]
        var group: [Int]
    }

    // MARK: - Irregular words

    private static let lexicon: [String: WordCoding] = {
        var map: [String: WordCoding] = [:]
        for notation in FrenchLexicons.lexiconNotation {
            let parsed = parseNotation(notation)
            map[parsed.word] = parsed.coding
        }
        return map
    }()

    /// Reads the notation of `format` back into a coding.
    private static func parseNotation(_ notation: String) -> (word: String, coding: WordCoding) {
        var word = ""
        var syllable: [Int] = []
        var flags: [UInt8] = []
        var group: [Int] = []
        var currentSyllable = 0
        var isSilent = false
        var isChanged = false
        var soundGroup = -1
        var groups = 0

        for character in notation {
            switch character {
            case "|": currentSyllable += 1
            case "{": isSilent = true
            case "}": isSilent = false
            case "<": isChanged = true
            case ">": isChanged = false
            case "[":
                soundGroup = groups
                groups += 1
            case "]": soundGroup = -1
            default:
                word.append(character)
                syllable.append(currentSyllable)
                flags.append((isSilent ? silent : 0) | (isChanged ? changed : 0) | (soundGroup >= 0 ? sound : 0))
                group.append(soundGroup)
            }
        }
        return (word, WordCoding(syllable: syllable, flags: flags, group: group))
    }

    // MARK: - Silent ends

    /// A vowel before `position`; the u of qu / gu does not count as one.
    private static func hasVowelBefore(_ w: [Character], _ position: Int) -> Bool {
        for index in 0..<position where isVowel(w[index]) {
            if w[index] == "u" && index > 0 && (w[index - 1] == "q" || w[index - 1] == "g") { continue }
            return true
        }
        return false
    }

    /// Where the silent final consonants of `w[0..<end]` begin.
    private static func silentFinalConsonant(_ w: [Character], _ end: Int) -> Int {
        guard end >= 2 else { return end }
        let stem = String(w[0..<end])
        let last = w[end - 1]
        let before = w[end - 2]
        // A consonant is quiet after a vowel or after n, m, r; after another consonant it is usually heard.
        let quiet = isVowel(before) || before == "n" || before == "m" || before == "r"

        switch last {
        case "t":
            if stem.hasSuffix("gt") { return end - 2 }
            return !FrenchLexicons.soundedT.contains(stem) && quiet ? end - 1 : end
        case "d":
            return !FrenchLexicons.soundedD.contains(stem) && quiet ? end - 1 : end
        case "p":
            return !FrenchLexicons.soundedP.contains(stem) && quiet ? end - 1 : end
        case "g":
            return !FrenchLexicons.soundedG.contains(stem) && !stem.hasSuffix("ing") && quiet ? end - 1 : end
        case "r":
            return stem.hasSuffix("er") && end > 2 && !FrenchLexicons.soundedER.contains(stem) ? end - 1 : end
        case "c":
            return FrenchLexicons.silentC.contains(stem) ? end - 1 : end
        case "l":
            return FrenchLexicons.silentL.contains(stem) ? end - 1 : end
        case "f":
            return FrenchLexicons.silentF.contains(stem) ? end - 1 : end
        case "b":
            return FrenchLexicons.silentB.contains(stem) ? end - 1 : end
        case "h":
            return end - 1
        default:
            return end
        }
    }

    /// Where the silent end of a word starts: ils mang|ent, table|s, enfan|ts, pomm|e.
    private static func silentTailStart(_ w: [Character], verb3pl: Bool) -> Int {
        let n = w.count
        let whole = String(w)
        if n > 5 && whole.hasSuffix("aient") { return n - 3 }
        if n > 3 && verb3pl && whole.hasSuffix("ent") { return n - 3 }

        var end = n
        let last = w[n - 1]
        let silentPlural = (last == "s" && !FrenchLexicons.soundedS.contains(whole))
            || (last == "x" && !FrenchLexicons.soundedX.contains(whole))
            || (last == "z" && !FrenchLexicons.soundedZ.contains(whole))
        if silentPlural { end -= 1 }
        if end >= 2 && w[end - 1] == "e" && hasVowelBefore(w, end - 1) { return end - 1 }
        return silentFinalConsonant(w, end)
    }

    private static func matches(_ w: [Character], at index: Int, _ pattern: String) -> Bool {
        let letters = Array(pattern)
        guard index + letters.count <= w.count else { return false }
        for offset in letters.indices where w[index + offset] != letters[offset] { return false }
        return true
    }

    private static func at(_ w: [Character], _ index: Int) -> Character? {
        index >= 0 && index < w.count ? w[index] : nil
    }

    /// The n or m after the vowel at `index` makes a nasal sound (an, on, in…): at the end of the word, or before a
    /// consonant but not before the same letter doubled; an m only before b or p, or at the end of what is heard.
    private static func isNasal(_ w: [Character], _ index: Int, _ letter: Character, _ end: Int) -> Bool {
        let after = index + 2
        guard after < w.count else { return true }
        let next = w[after]
        if isVowel(next) { return false }
        if letter == "n" { return next != "n" }
        return next == "b" || next == "p" || after >= end
    }

    // MARK: - One word

    /// Marks of one word, already lower-cased and split into one Character per scalar.
    static func analyze(word w: [Character], verb3pl: Bool, elided: Bool) -> WordCoding {
        let n = w.count
        let whole = String(w)

        if let known = lexicon[whole] { return known }
        // Plural of an irregular word: villes, femmes.
        if n > 2, whole.hasSuffix("s") || whole.hasSuffix("x"), let stem = lexicon[String(w.dropLast())] {
            let lastSyllable = stem.syllable.last ?? 0
            return WordCoding(
                syllable: stem.syllable + [lastSyllable],
                flags: stem.flags + [silent],
                group: stem.group + [-1]
            )
        }

        var flags = [UInt8](repeating: 0, count: n)
        var group = [Int](repeating: -1, count: n)
        var units: [Unit] = []
        var groups = 0

        func mark(_ index: Int, _ bit: UInt8) {
            guard index >= 0 && index < n else { return }
            flags[index] |= bit
        }
        func markSound(from: Int, to: Int) {
            for index in from..<min(to, n) {
                flags[index] |= sound
                group[index] = groups
            }
            groups += 1
        }
        func addUnit(_ start: Int, _ length: Int, _ kind: UnitKind) {
            units.append(Unit(start: start, end: start + length, kind: kind))
        }

        let end = elided ? n : silentTailStart(w, verb3pl: verb3pl)
        for index in end..<n { mark(index, silent) }

        var i = 0
        while i < end {
            let c = w[i]
            let next = at(w, i + 1)

            // vowel + ill, or a final -il: paille, abeille, feuille, grenouille; travail, soleil, fauteuil.
            if let glide = ["ueill", "ouill", "euill", "aill", "eill"]
                .first(where: { matches(w, at: i, $0) && isVowel(at(w, i + $0.count)) }) {
                let length = glide.count
                markSound(from: i, to: i + length)
                addUnit(i, length - 1, .vowel)
                addUnit(i + length - 1, 1, .consonant)
                i += length
                continue
            }
            if let finalIl = ["ueil", "ouil", "euil", "ail", "eil"].first(where: {
                matches(w, at: i, $0) && i + $0.count == end && !w[end...].contains("e")
            }) {
                let length = finalIl.count
                markSound(from: i, to: i + length)
                addUnit(i, length, .vowel)
                i += length
                continue
            }
            if matches(w, at: i, "eau") {
                markSound(from: i, to: i + 3)
                addUnit(i, 3, .vowel)
                i += 3
                continue
            }
            if let nasal = ["ain", "aim", "ein", "eim", "oin"].first(where: {
                matches(w, at: i, $0) && isNasal(w, i + 1, Array($0)[2], end)
            }) {
                markSound(from: i, to: i + 3)
                addUnit(i, 3, .vowel)
                i += nasal.count
                continue
            }
            if matches(w, at: i, "oeu") || matches(w, at: i, "œu") {
                let length = c == "œ" ? 2 : 3
                markSound(from: i, to: i + length)
                addUnit(i, length, .vowel)
                i += length
                continue
            }
            if "aeiouy".contains(c), let following = next, following == "n" || following == "m" {
                // ennui, emmener: the doubled letter at the start is still nasal.
                let startsDoubled = i == 0 && c == "e" && at(w, 2) == following
                let isException = (following == "m" && c == "u" && FrenchLexicons.umNotNasal.contains(whole) && i == n - 2)
                    || (following == "n" && c == "e" && FrenchLexicons.enNotNasal.contains(whole) && i == n - 2)
                if !isException && (startsDoubled || isNasal(w, i, following, end)) {
                    markSound(from: i, to: i + 2)
                    addUnit(i, 2, .vowel)
                    i += 2
                    continue
                }
            }
            if ["ou", "oû", "où", "oi", "oî", "ai", "aî", "ei", "au", "eu", "eû"].contains(where: { matches(w, at: i, $0) }) {
                markSound(from: i, to: i + 2)
                addUnit(i, 2, .vowel)
                i += 2
                continue
            }
            if c == "c" && next == "h" {
                markSound(from: i, to: i + 2)
                // chrome, chlore and the learnt words: the ch is heard as k.
                if at(w, i + 2) == "r" || at(w, i + 2) == "l" || FrenchLexicons.chAsK.contains(whole) {
                    mark(i, changed)
                    mark(i + 1, changed)
                }
                addUnit(i, 2, .consonant)
                i += 2
                continue
            }
            if (c == "p" || c == "t" || c == "s") && next == "h" {
                markSound(from: i, to: i + 2)
                addUnit(i, 2, .consonant)
                i += 2
                continue
            }
            if c == "g" && next == "n" {
                markSound(from: i, to: i + 2)
                addUnit(i, 2, .consonant)
                i += 2
                continue
            }
            if (c == "q" && next == "u") || (c == "g" && next == "u" && softeners.contains(at(w, i + 2) ?? "#")) {
                markSound(from: i, to: i + 2)
                addUnit(i, 2, .consonant)
                i += 2
                continue
            }
            if c == "s" && next == "c" && softeners.contains(at(w, i + 2) ?? "#") {
                // piscine: one sound, but the written syllables are cut between the s and the c (pis|ci|ne).
                markSound(from: i, to: i + 2)
                addUnit(i, 1, .consonant)
                addUnit(i + 1, 1, .consonant)
                i += 2
                continue
            }
            if c == "i" && matches(w, at: i, "ill") && i > 0 && !FrenchLexicons.illAsL.contains(whole) {
                let previous = w[i - 1]
                let afterConsonant = !isVowel(previous)
                    || (previous == "u" && (at(w, i - 2) == "q" || at(w, i - 2) == "g"))
                if afterConsonant {
                    markSound(from: i, to: i + 3)
                    addUnit(i, 1, .vowel)
                    addUnit(i + 1, 1, .consonant)
                    addUnit(i + 2, 1, .consonant)
                    i += 3
                    continue
                }
            }
            if c == "h" {
                mark(i, silent)
                addUnit(i, 1, .consonant)
                i += 1
                continue
            }
            if isVowel(c) {
                if c == "y" && ((i == 0 && isVowel(next)) || (i > 0 && isVowel(at(w, i - 1)) && isVowel(next))) {
                    // voyage: the y works as two letters, the second of which opens the next syllable.
                    addUnit(i, 1, .consonant)
                } else if (c == "i" && isVowel(next)
                           && !(i >= 2 && liquids.contains(String(w[i - 1])) && stops.contains(String(w[i - 2]))))
                            || (c == "u" && next == "i") {
                    addUnit(i, 1, .glide)
                } else {
                    addUnit(i, 1, .vowel)
                }
                i += 1
                continue
            }

            // A single consonant, which may not make its usual sound.
            var length = 1
            if (c == "c" || c == "g") && softeners.contains(next ?? "#") {
                mark(i, changed)
                // mangeons, pigeon: the e is there only to soften the g.
                if c == "g" && next == "e" && "aouâôû".contains(at(w, i + 2) ?? "#") && i + 2 < end {
                    mark(i + 1, silent)
                    length = 2
                }
            } else if c == "s" && i > 0 && isVowel(at(w, i - 1)) && isVowel(next) {
                mark(i, changed)
            } else if c == "t" && at(w, i - 1) != "s" && at(w, i - 1) != "x"
                        && (["tion", "tial", "tiel", "tieux", "tieuse", "tience", "tiaire"].contains(where: { matches(w, at: i, $0) })
                            || ((String(w[i...]) == "tie" || String(w[i...]) == "ties") && isVowel(at(w, i - 1)))) {
                mark(i, changed)
            } else if c == "x" && ((i == 1 && w[0] == "e" && isVowel(next)) || matches(w, at: i + 1, "ième")) {
                mark(i, changed)
            }
            addUnit(i, length, .consonant)
            i += length
        }

        // The silent end is a written syllable of its own after a consonant (pom|me, man|gent), otherwise it belongs to
        // the last one (joie).
        if end < n {
            let lastKind = units.last?.kind
            let kind: UnitKind = (w[end] == "e" && lastKind == .consonant) ? .silentE : .silentTail
            units.append(Unit(start: end, end: n, kind: kind))
        }

        return WordCoding(syllable: syllabify(w, units: units, length: n), flags: flags, group: group)
    }

    /// Written syllables: V|CV, VC|CV, and V|CCV when the two consonants cannot be separated (bl, tr…). A glide belongs
    /// to the vowel that follows it.
    private static func syllabify(_ w: [Character], units: [Unit], length n: Int) -> [Int] {
        var syllable = [Int](repeating: 0, count: n)
        var nuclei: [Int] = []
        for (index, unit) in units.enumerated() where unit.kind == .vowel || unit.kind == .silentE {
            nuclei.append(index)
        }

        var starts: [Int] = []
        var k = 0
        while k + 1 < nuclei.count {
            let a = nuclei[k]
            let b = nuclei[k + 1]
            var j = b
            while j - 1 > a && units[j - 1].kind == .glide { j -= 1 }
            let consonants = j - (a + 1)
            let split: Int
            if consonants <= 0 {
                split = j
            } else if consonants == 1 {
                split = a + 1
            } else {
                let first = units[j - 2]
                let second = units[j - 1]
                // The written text of the two consonants; anything that is not a plain letter is ignored.
                let t1 = String(w[first.start..<first.end]).filter { $0.isLetter && $0.isASCII || $0 == "ç" }
                let t2 = String(w[second.start..<second.end])
                split = liquids.contains(t2) && stops.contains(t1) ? j - 2 : j - 1
            }
            starts.append(split)
            k += 1
        }

        var s = 0
        for (index, unit) in units.enumerated() {
            while s < starts.count && starts[s] <= index { s += 1 }
            for position in unit.start..<min(unit.end, n) { syllable[position] = s }
        }
        return syllable
    }
}
