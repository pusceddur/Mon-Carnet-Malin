import Foundation

/// §22 « Préparer la lecture »: a block can carry a version prepared for the voice. Ported from
/// `shared/src/text/spoken.ts`.
///
/// The prepared text must hold exactly the words of the displayed one, in the same order: only punctuation, spaces and
/// capitals may differ. That rule is what lets the app follow the reading word by word while the voice speaks a text
/// that is punctuated differently, and it is checked rather than trusted, because the preparation comes from a model.
public struct SpokenAlignment: Equatable, Sendable {
    /// Words of the displayed text.
    public let shown: [WordToken]
    /// The same words in the prepared text: same count, same order.
    public let said: [WordToken]
}

public enum SpokenText {
    /// Longest prepared text of one block: the displayed text plus room for the punctuation that was added.
    public static let blockMaxCharacters = 8000

    /// Words compare on their sound, not on their look: case and the shape of the apostrophe do not matter.
    private static func wordKey(_ word: String) -> String {
        let apostrophes: Set<Unicode.Scalar> = ["\u{2019}", "\u{02BC}", "\u{2018}", "`", "\u{00B4}"]
        var out = String.UnicodeScalarView()
        for scalar in word.precomposedStringWithCanonicalMapping.lowercased().unicodeScalars {
            out.append(apostrophes.contains(scalar) ? "'" : scalar)
        }
        return String(out)
    }

    /// Pairs the words of the displayed text with those of the prepared one, or nil when they differ, which means the
    /// preparation cannot be used and the block is read as it is written.
    public static func align(display: String, prepared: String) -> SpokenAlignment? {
        guard prepared.utf16.count <= blockMaxCharacters else { return nil }
        let shown = Tokenizer.tokenizeWords(display)
        let said = Tokenizer.tokenizeWords(prepared)
        guard !shown.isEmpty, shown.count == said.count else { return nil }
        for index in shown.indices where wordKey(shown[index].word) != wordKey(said[index].word) {
            return nil
        }
        return SpokenAlignment(shown: shown, said: said)
    }

    /// True when the prepared text keeps every word of the displayed one.
    public static func isValid(display: String, prepared: String) -> Bool {
        align(display: display, prepared: prepared) != nil
    }
}
