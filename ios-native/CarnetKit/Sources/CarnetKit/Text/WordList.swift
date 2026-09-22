import Foundation

/// A set of French words, held in the form `TextNormalizer.normalizedForMatch` produces.
/// Ported from `shared/src/text/wordlist.ts`.
///
/// The reading pipeline asks it whether something it read is a real word, which is how a doubtful page is told from a
/// good one. Lookups happen once per word of a page, so the words are normalised when the list is built, never after.
public struct WordList: Sendable {
    private let words: Set<String>

    public var count: Int { words.count }

    /// Builds the list, normalising every word once. Empty entries are dropped.
    public init<S: Sequence>(words source: S) where S.Element == String {
        var set = Set<String>()
        for word in source {
            let normalized = TextNormalizer.normalizedForMatch(word)
            if !normalized.isEmpty { set.insert(normalized) }
        }
        self.words = set
    }

    /// Expects a word that is already normalised: normalising here would hide the cost in the middle of a page.
    public func contains(normalized word: String) -> Bool {
        words.contains(word)
    }

    public static let empty = WordList(words: [] as [String])
}

/// French function words and very frequent verbs, plus a light stem.
/// Ported from `shared/src/text/stopwords.ts`.
///
/// Used where a text has to be weighed rather than read: picking the paragraphs that answer a question, scoring how
/// hard a page is. Words carrying no meaning of their own would drown the ones that do.
public enum Stopwords {
    private static let list = """
        a ai aie aient aies ait as au aucun aucune aupres auquel aura aurai auraient aurais aurait aux avaient avais avait avant avec avez aviez
        avions avoir avons ayant c ca car ce ceci cela celle celles celui cependant ces cet cette ceux chaque chez ci combien comme comment d
        dans de depuis des desquels dont du duquel elle elles en encore entre es est et etaient etais etait etant ete etes etre eu eux fait
        faire fais faisait font fut furent ici il ils j je jusqu jusque l la laquelle le lequel les lesquels leur leurs lors lorsqu lorsque lui m
        ma mais me meme memes mes moi moins mon n ne ni non nos notre nous on ont ou ou par parce pas peu peut peuvent plus pour pourquoi
        puis puisqu puisque qu quand que quel quelle quelles quels qui quoi s sa sans se sera serai seraient serait ses si sien soi soit sommes
        son sont sous suis sur t ta te tes toi ton tous tout toute toutes tres tu un une unes uns vers voici voila vont vos votre vous y deja
        aussi alors ainsi donc or bien tres trop peu apres pendant contre selon parmi chacun chacune autre autres quelque quelques tel telle
        tels telles celui-ci cela oui
        """

    /// The words, in normalised form.
    public static let french: Set<String> = {
        var set = Set<String>()
        for word in list.split(whereSeparator: { $0.isWhitespace }) {
            let normalized = TextNormalizer.normalizedForMatch(String(word))
            // A normalised entry that split into two (« celui-ci ») is not a single word any more.
            if !normalized.isEmpty && !normalized.contains(" ") { set.insert(normalized) }
        }
        return set
    }()

    /// Expects a word in normalised form.
    public static func isStopword(_ normalized: String) -> Bool {
        french.contains(normalized)
    }

    /// Longest first, so that « issements » is taken off before « ement » can be.
    private static let stemSuffixes = [
        "issements", "issement", "issantes", "issante", "issants", "issant", "eraient", "assions", "ations", "ation",
        "ements", "ement", "euses", "euse", "aient", "erait", "erons", "eront", "ions", "iez", "ait", "ais", "ant",
        "ent", "ons", "ees", "ee", "es", "ez", "er", "ir", "re", "e", "s", "x",
    ]

    /// A light, predictable stem of a normalised word: « mangeait », « manger », « mangent » all become « mang ».
    /// It is not linguistics, it is a way of noticing that two words are the same one; a stem shorter than four
    /// letters would start merging words that have nothing to do with each other, so the cuts stop there.
    public static func lightStem(_ normalized: String) -> String {
        var word = normalized
        if word.count > 4, word.hasSuffix("s") || word.hasSuffix("x") { word.removeLast() }
        for suffix in stemSuffixes where word.count - suffix.count >= 4 && word.hasSuffix(suffix) {
            word.removeLast(suffix.count)
            break
        }
        if word.count > 4 && word.hasSuffix("e") { word.removeLast() }
        return word
    }
}
