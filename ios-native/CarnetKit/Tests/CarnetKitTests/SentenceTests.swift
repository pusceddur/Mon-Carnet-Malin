import XCTest
@testable import CarnetKit

/// Cases taken from `shared/test/text/segment.test.ts`. The reader highlights one sentence at a time and the voice
/// pauses between them, so a wrong cut is heard as well as seen: « M. Dupont » read as two sentences stops mid-name.
final class SentenceTests: XCTestCase {
    private func sentences(_ text: String) -> [String] {
        let units = Array(text.utf16)
        return SentenceSegmenter.sentences(in: text).map {
            String(decoding: units[$0.start..<$0.end], as: UTF16.self)
        }
    }

    func testSplitsSimpleSentencesAndTrimsSpaces() {
        XCTAssertEqual(
            sentences("  Le chat dort. Le chien joue !  Et toi ?  "),
            ["Le chat dort.", "Le chien joue !", "Et toi ?"]
        )
    }

    func testSpansCoverTheSentenceWithoutOuterSpaces() {
        let text = " Le. Chien "
        XCTAssertEqual(
            SentenceSegmenter.sentences(in: text),
            [SentenceSpan(start: 1, end: 4), SentenceSpan(start: 5, end: 10)]
        )
    }

    func testATextWithoutFinalPunctuationStaysOneSentence() {
        XCTAssertEqual(sentences("Il était une fois un roi"), ["Il était une fois un roi"])
        XCTAssertEqual(SentenceSegmenter.sentences(in: "   "), [])
        XCTAssertEqual(SentenceSegmenter.sentences(in: ""), [])
    }

    func testDoesNotSplitAfterTitlesAndAbbreviations() {
        XCTAssertEqual(
            sentences("M. Dupont et Mme Durand arrivent. Mlle Martin aussi."),
            ["M. Dupont et Mme Durand arrivent.", "Mlle Martin aussi."]
        )
        XCTAssertEqual(
            sentences("Voir p. 12 et pp. 14-15. Lis le chap. 3 et la fig. 2."),
            ["Voir p. 12 et pp. 14-15.", "Lis le chap. 3 et la fig. 2."]
        )
    }

    func testTreatsEtceteraAsAnEndOnlyBeforeACapital() {
        XCTAssertEqual(
            sentences("Des pommes, des poires, etc. Puis nous partons."),
            ["Des pommes, des poires, etc.", "Puis nous partons."]
        )
        XCTAssertEqual(
            sentences("Des pommes, des poires, etc. et des noix."),
            ["Des pommes, des poires, etc. et des noix."]
        )
    }

    func testDoesNotSplitInsideDecimalNumbers() {
        XCTAssertEqual(
            sentences("Il mesure 3.5 m. Elle pèse 2,5 kg. Voilà."),
            ["Il mesure 3.5 m.", "Elle pèse 2,5 kg.", "Voilà."]
        )
    }

    func testKeepsInitialsWithTheName() {
        XCTAssertEqual(
            sentences("Le livre de J. K. Martin est long. Il plaît."),
            ["Le livre de J. K. Martin est long.", "Il plaît."]
        )
        XCTAssertEqual(sentences("J.K. Martin écrit. Elle lit."), ["J.K. Martin écrit.", "Elle lit."])
    }

    func testEllipsisAndCombinedPunctuation() {
        XCTAssertEqual(
            sentences("Il attendit… Personne ne vint. Quoi ?! Vraiment ?"),
            ["Il attendit…", "Personne ne vint.", "Quoi ?!", "Vraiment ?"]
        )
        XCTAssertEqual(sentences("Oh ! dit-il. Bon."), ["Oh ! dit-il.", "Bon."])
    }

    func testFrenchQuotes() {
        XCTAssertEqual(sentences("« Viens ! » dit-elle. Il vint."), ["« Viens ! » dit-elle.", "Il vint."])
        XCTAssertEqual(
            sentences("Il cria : « Attention ! » Tout le monde recula."),
            ["Il cria : « Attention ! »", "Tout le monde recula."]
        )
        XCTAssertEqual(sentences("Elle dit : « Oui ! » Puis elle rit."), ["Elle dit : « Oui ! »", "Puis elle rit."])
    }

    func testDialoguesWithDashes() {
        XCTAssertEqual(
            sentences("— Bonjour, dit Paul. — Bonsoir, répondit Marie."),
            ["— Bonjour, dit Paul.", "— Bonsoir, répondit Marie."]
        )
        XCTAssertEqual(sentences("— Tu viens\n— Oui"), ["— Tu viens", "— Oui"])
        XCTAssertEqual(sentences("- Tu viens ?\n- Oui !"), ["- Tu viens ?", "- Oui !"])
    }

    func testABlankLineStartsASentenceButASimpleBreakDoesNot() {
        XCTAssertEqual(sentences("Le Soleil\n\nLe Soleil est une étoile"), ["Le Soleil", "Le Soleil est une étoile"])
    }
}

final class WordListTests: XCTestCase {
    func testNormalisesOnceWhenTheListIsBuilt() {
        let list = WordList(words: ["Élève", "École", "école", "  ", "chat"])
        XCTAssertTrue(list.contains(normalized: "eleve"))
        XCTAssertTrue(list.contains(normalized: "ecole"))
        XCTAssertTrue(list.contains(normalized: "chat"))
        XCTAssertFalse(list.contains(normalized: "chien"))
        // « École » and « école » are the same entry, and the blank one was dropped.
        XCTAssertEqual(list.count, 3)
    }
}

final class StopwordTests: XCTestCase {
    func testKnowsTheFrenchFunctionWords() {
        XCTAssertTrue(Stopwords.isStopword("le"))
        XCTAssertTrue(Stopwords.isStopword("etait"))
        XCTAssertTrue(Stopwords.isStopword("parce"))
        XCTAssertFalse(Stopwords.isStopword("volcan"))
    }

    func testBringsTheFormsOfAVerbTogether() {
        let stems = ["mangeait", "manger", "mangent"].map(Stopwords.lightStem)
        XCTAssertEqual(Set(stems).count, 1, "the forms of one verb must share a stem")
    }

    func testNeverCutsAWordDownToNothing() {
        // Short words keep their shape: cutting further would merge words that have nothing in common.
        XCTAssertEqual(Stopwords.lightStem("les"), "les")
        XCTAssertEqual(Stopwords.lightStem("eau"), "eau")
        for word in ["volcans", "maisons", "rapidement", "grandissement"] {
            XCTAssertGreaterThanOrEqual(Stopwords.lightStem(word).count, 3)
        }
    }
}
