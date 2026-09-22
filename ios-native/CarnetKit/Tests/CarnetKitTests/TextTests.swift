import XCTest
@testable import CarnetKit

/// The same cases as `shared/test/text/normalize-tokenize.test.ts`, so the port can be shown to behave identically to
/// the web app rather than merely similarly. Anything that drifts shows up here before it shows up on a page.
final class NormalizeTests: XCTestCase {
    private func match(_ text: String) -> String { TextNormalizer.normalizedForMatch(text) }
    private func display(_ text: String) -> String { TextNormalizer.normalizedForDisplay(text) }

    func testLowercasesStripsAccentsAndOpensLigatures() {
        XCTAssertEqual(match("Élève ÇA Œuf Ægypte"), "eleve ca oeuf aegypte")
        XCTAssertEqual(match("Cœur"), "coeur")
    }

    func testPunctuationQuotesAndDashesBecomeSingleSpaces() {
        XCTAssertEqual(match("« Bonjour ! » — dit-il, l’air ravi…"), "bonjour dit il l air ravi")
        XCTAssertEqual(match("l'arbre"), match("l’arbre"))
        XCTAssertEqual(match("  a   b\n\nc  "), "a b c")
    }

    func testCompatibilityFormsAreApplied() {
        XCTAssertEqual(match("ﬁn XIXᵉ"), "fin xixe")
        XCTAssertEqual(match("ＡＢＣ"), "abc")
    }

    func testDigitsSurvive() {
        XCTAssertEqual(match("En 1789, 3,5 %"), "en 1789 3 5")
    }

    func testIsIdempotent() {
        let once = match("« L’Élève ! » — ÇA va, 3,5 %…")
        XCTAssertEqual(match(once), once)
    }

    func testCollapsesSpacesButKeepsFrenchNoBreakSpaces() {
        XCTAssertEqual(display("Bonjour   le\tmonde"), "Bonjour le monde")
        XCTAssertEqual(display("Quoi\u{202F}?"), "Quoi\u{202F}?")
        // A run holding a narrow no-break space collapses to that space, not to a plain one.
        XCTAssertEqual(display("Quoi \u{202F} ?"), "Quoi\u{202F}?")
    }

    func testRemovesSoftHyphensZeroWidthSpacesAndControls() {
        XCTAssertEqual(display("pho\u{00AD}to\u{200B}synthèse"), "photosynthèse")
        XCTAssertEqual(display("a\u{0007}b"), "ab")
    }

    func testComposesAndKeepsParagraphs() {
        // Decomposed "e" + combining acute must come back as a single character.
        XCTAssertEqual(display("e\u{0301}te\u{0301}"), "été")
        XCTAssertEqual(display("Un.  \r\n\r\n\r\n  Deux."), "Un.\n\nDeux.")
    }
}

final class TokenizeTests: XCTestCase {
    private func words(_ text: String) -> [String] {
        Tokenizer.tokenizeWords(text).map(\.word)
    }

    /// Every token must point at exactly the text it claims, counted in UTF-16 units like the rest of the app.
    private func assertOffsetsMatch(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let units = Array(text.utf16)
        for token in Tokenizer.tokenizeWords(text) {
            let slice = String(decoding: units[token.start..<token.end], as: UTF16.self)
            XCTAssertEqual(slice, token.word, "offsets of « \(token.word) »", file: file, line: line)
        }
    }

    func testOffsetsPointAtTheWords() {
        let text = "Le chat dort"
        assertOffsetsMatch(text)
        XCTAssertEqual(words(text), ["Le", "chat", "dort"])
    }

    func testOffsetsHoldWithAccentsAndEmoji() {
        // An emoji is two UTF-16 units: a native index would drift here, which is exactly what must not happen.
        assertOffsetsMatch("Léa 🦊 mange à côté")
        assertOffsetsMatch("Qu’est-ce que c’est ?")
    }

    func testElisionsSplitAndKeepTheApostropheOnTheClitic() {
        XCTAssertEqual(words("l’arbre"), ["l’", "arbre"])
        XCTAssertEqual(words("l'arbre"), ["l'", "arbre"])
        XCTAssertEqual(words("Qu’est-ce que c’est ?"), ["Qu’", "est-ce", "que", "c’", "est"])
        XCTAssertEqual(words("jusqu'à l'école"), ["jusqu'", "à", "l'", "école"])
        XCTAssertTrue(Tokenizer.isElisionToken("l’"))
        XCTAssertFalse(Tokenizer.isElisionToken("arbre"))
    }

    func testLexicalApostrophesStayInsideTheWord() {
        XCTAssertEqual(words("aujourd’hui et quelqu’un"), ["aujourd’hui", "et", "quelqu’un"])
    }

    func testInnerHyphensAreKeptAndOuterOnesAreNot() {
        XCTAssertEqual(words("un arc-en-ciel"), ["un", "arc-en-ciel"])
        XCTAssertEqual(words("Viendra-t-il ?"), ["Viendra-t-il"])
        XCTAssertEqual(words("- Oui - non -"), ["Oui", "non"])
    }

    func testDigitsDecimalsAndOrdinals() {
        XCTAssertEqual(
            words("En 1789, 3,5 kg et 2.5 m au XIXe siècle et le 1er mai"),
            ["En", "1789", "3,5", "kg", "et", "2.5", "m", "au", "XIXe", "siècle", "et", "le", "1er", "mai"]
        )
        XCTAssertEqual(words("Fin."), ["Fin"])
    }

    func testAccentsCombiningMarksAndLigatures() {
        XCTAssertEqual(words("Œdipe mange un œuf à côté"), ["Œdipe", "mange", "un", "œuf", "à", "côté"])
        XCTAssertEqual(words("e\u{0301}te\u{0301}"), ["e\u{0301}te\u{0301}"])
    }
}

final class SpokenTextTests: XCTestCase {
    func testAcceptsAPreparationThatOnlyChangesPunctuationAndCapitals() {
        let display = "le chat dort il ronfle"
        let prepared = "Le chat dort. Il ronfle !"
        let alignment = SpokenText.align(display: display, prepared: prepared)
        XCTAssertNotNil(alignment)
        XCTAssertEqual(alignment?.shown.count, 5)
        XCTAssertEqual(alignment?.said.map(\.word), ["Le", "chat", "dort", "Il", "ronfle"])
        XCTAssertTrue(SpokenText.isValid(display: display, prepared: prepared))
    }

    func testRefusesAPreparationThatChangesTheWords() {
        XCTAssertNil(SpokenText.align(display: "le chat dort", prepared: "Le chien dort."))
        XCTAssertNil(SpokenText.align(display: "le chat dort", prepared: "Le chat dort vraiment."))
        XCTAssertNil(SpokenText.align(display: "", prepared: ""))
    }

    func testTheApostropheShapeDoesNotMatter() {
        XCTAssertTrue(SpokenText.isValid(display: "l'arbre est grand", prepared: "L’arbre est grand."))
    }

    func testRefusesAPreparationThatIsTooLong() {
        let long = String(repeating: "mot ", count: 2500)
        XCTAssertNil(SpokenText.align(display: "mot", prepared: long))
    }
}

final class LineJoinerTests: XCTestCase {
    func testJoinsAWordCutAtTheEndOfALine() {
        XCTAssertEqual(LineJoiner.join(lines: ["pho-", "tosynthèse"]), "photosynthèse")
        XCTAssertEqual(LineJoiner.join(lines: ["Le chat", "dort."]), "Le chat dort.")
    }

    func testKeepsTheHyphenOfARealCompound() {
        XCTAssertEqual(LineJoiner.join(lines: ["arc-en-", "ciel"]), "arc-en-ciel")
        // A capital on the second half means two names, not one cut word.
        XCTAssertEqual(LineJoiner.join(lines: ["Jean-", "Pierre"]), "Jean-Pierre")
    }

    func testAWordListKeepsCompoundsWhoseHalvesAreBothWords() {
        let french: Set<String> = ["grand", "mère", "pho", "tosynthèse"]
        let known: (String) -> Bool = { french.contains($0) }
        XCTAssertEqual(LineJoiner.join(lines: ["grand-", "mère"], isKnownWord: known), "grand-mère")
        // Both halves are words here too, but so is the joined form, so the cut wins.
        XCTAssertEqual(
            LineJoiner.join(lines: ["pho-", "tosynthèse"], isKnownWord: { $0 == "photosynthèse" || known($0) }),
            "photosynthèse"
        )
    }

    func testSoftHyphenIsNeverARealOne() {
        XCTAssertEqual(LineJoiner.join(lines: ["pho\u{00AD}", "tosynthèse"]), "photosynthèse")
    }

    func testEmptyLinesAndRunsOfSpacesAreTidiedAway() {
        XCTAssertEqual(LineJoiner.join(lines: ["  Le   chat  ", "", "   dort. "]), "Le chat dort.")
        XCTAssertEqual(LineJoiner.join(lines: []), "")
    }

    func testATrailingDashAloneIsPunctuation() {
        XCTAssertEqual(LineJoiner.join(lines: ["Il dit -", "Bonjour"]), "Il dit - Bonjour")
    }
}
