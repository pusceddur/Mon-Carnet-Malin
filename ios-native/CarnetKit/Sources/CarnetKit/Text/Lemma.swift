import Foundation

/// What a word might be, once put back into its dictionary form.
/// Ported from `shared/src/text/lemma.ts`.
///
/// A child taps « mangeaient » and the dictionary holds « manger »; taps « yeux » and it holds « œil ». Nothing here
/// decides what the word *is*: it produces candidates, most likely first, and whoever looks them up keeps the first one
/// that exists. That is why the candidates are split by how much they can be trusted.
public struct LemmaTiers: Equatable, Sendable {
    /// The word itself, lower-cased and without its elision. Always right, when the dictionary knows it.
    public let exact: [String]
    /// Forms listed by hand: « font » gives « faire », « yeux » gives « œil ».
    public let irregular: [String]
    /// What the suffix rules suggest. Guesses, and some are not words at all.
    public let heuristic: [String]
}

public enum Lemma {
    /// A stem shorter than this is not worth cutting to.
    private static let minimumStem = 1
    /// A candidate shorter than this would match almost anything.
    private static let minimumCandidate = 2

    /// Every irregular form and the lemmas it may belong to, built once.
    private static let irregularForms: [String: [String]] = {
        var map: [String: [String]] = [:]
        func add(_ form: String, _ lemma: String) {
            if map[form] == nil {
                map[form] = [lemma]
            } else if !map[form]!.contains(lemma) {
                map[form]!.append(lemma)
            }
        }

        for family in LemmaData.verbFamilies {
            for prefix in family.prefixes {
                let lemma = prefix + family.lemma
                for form in family.forms.split(separator: " ").map(String.init) {
                    add(prefix + form, lemma)
                    // Books print « connaitre » as often as « connaître » since the spelling reform.
                    if form.contains("î") {
                        add(prefix + form.replacingOccurrences(of: "î", with: "i"), lemma)
                    }
                }
            }
        }
        for (form, lemma) in LemmaData.irregularWords { add(form, lemma) }
        return map
    }()

    private static func irregularLemmas(of form: String) -> [String] {
        irregularForms[form] ?? []
    }

    private static func appendUnique(_ list: inout [String], _ value: String) {
        if !value.isEmpty && !list.contains(value) { list.append(value) }
    }

    /// Takes off an elided clitic: « l’arbre » becomes « arbre », « jusqu’à » becomes « à ».
    private static func withoutElision(_ word: String) -> String {
        for clitic in LemmaData.elisions {
            for apostrophe in ["'", "\u{2019}", "\u{02BC}"] {
                let prefix = clitic + apostrophe
                if word.hasPrefix(prefix) {
                    let rest = String(word.dropFirst(prefix.count))
                    // Only when a word really follows: « aujourd’hui » must stay whole.
                    if let first = rest.first, first.isLetter { return rest }
                }
            }
        }
        return word
    }

    private static func trimmedToLetters(_ word: String) -> String {
        var out = word
        while let first = out.first, !first.isLetter && !first.isNumber { out.removeFirst() }
        while let last = out.last, !last.isLetter && !last.isNumber { out.removeLast() }
        return out
    }

    /// Candidates split by how much they can be trusted.
    public static func tiers(for word: String) -> LemmaTiers {
        let composed = word.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let lower = trimmedToLetters(composed)

        var exact: [String] = []
        appendUnique(&exact, composed)
        appendUnique(&exact, lower)
        let bare = withoutElision(lower)
        appendUnique(&exact, bare)
        let unified = String(bare.unicodeScalars.map {
            $0 == "\u{2019}" || $0 == "\u{02BC}" ? Character("'") : Character($0)
        })
        appendUnique(&exact, unified)

        var irregular: [String] = []
        for form in exact {
            for lemma in irregularLemmas(of: form) { appendUnique(&irregular, lemma) }
        }

        // « est », « ont », « a »… are auxiliaries and nothing else: guessing further would only add noise.
        if !irregular.isEmpty && irregular.allSatisfy(LemmaData.auxiliaries.contains) {
            return LemmaTiers(exact: exact, irregular: irregular, heuristic: [])
        }

        let base = unified
        var bases = [base]
        if base.count > 3, base.hasSuffix("s") || base.hasSuffix("x") { bases.append(String(base.dropLast())) }

        struct Match {
            let length: Int
            let order: Int
            let candidates: [String]
        }
        var matches: [Match] = []

        for (baseIndex, candidateBase) in bases.enumerated() {
            for (ruleIndex, rule) in LemmaData.suffixRules.enumerated() {
                let (ending, replacements) = rule
                guard candidateBase.hasSuffix(ending), candidateBase.count - ending.count >= minimumStem else { continue }
                let stem = String(candidateBase.dropLast(ending.count))
                matches.append(Match(
                    // A rule applied to the singular counts slightly less than the same rule on the word as written.
                    length: ending.count - baseIndex,
                    order: baseIndex * 1000 + ruleIndex,
                    candidates: replacements.map { stem + $0 }
                ))
            }
            for lemma in irregularLemmas(of: candidateBase) { appendUnique(&irregular, lemma) }
        }

        matches.sort { $0.length != $1.length ? $0.length > $1.length : $0.order < $1.order }
        var heuristic: [String] = []
        for match in matches {
            for candidate in match.candidates where candidate != base && candidate.count >= minimumCandidate {
                appendUnique(&heuristic, candidate)
            }
        }
        return LemmaTiers(
            exact: exact,
            irregular: irregular,
            heuristic: heuristic.filter { !exact.contains($0) && !irregular.contains($0) }
        )
    }

    /// Candidates most likely first; the first one is the word itself, lower-cased.
    public static func candidates(for word: String) -> [String] {
        let tiers = tiers(for: word)
        var out: [String] = []
        for candidate in tiers.exact + tiers.irregular + tiers.heuristic { appendUnique(&out, candidate) }
        return out
    }
}
