import XCTest
@testable import CarnetKit

/// §26 « Couleurs de lecture ». The cases come straight from `shared/test/text/frenchCoding.test.ts`: the port has to
/// mark the same letters as the web app, not merely something plausible. A single wrong syllable is visible to a child.
///
/// Notation: `|` between written syllables, `{}` silent, `[]` one sound, `<>` a letter that does not make its usual
/// sound, `‿` a liaison.
final class FrenchCodingTests: XCTestCase {
    private func code(_ text: String) -> String {
        FrenchCoding.format(text, FrenchCoding.code(text))
    }

    func testKeepsCapitalsPunctuationElisionsAndCompounds() {
        XCTAssertEqual(code("Léa"), "Lé|a")
        XCTAssertEqual(code("l'école"), "l'é|co|l{e}")
        XCTAssertEqual(code("aujourd'hui"), "[au]|j[ou]rd'{h}ui")
        XCTAssertEqual(code("dit-elle."), "di{t}-el|l{e}.")
    }

    func testKnowsTheSilentEntOfVerbsFromTheSentence() {
        XCTAssertEqual(code("Ils mangent."), "Il{s} m[an]|<g>{ent}.")
        XCTAssertEqual(
            code("Les enfants jouent dans le jardin."),
            "Le{s}‿[en]|f[an]{ts} j[ou]{ent} d[an]{s} le jar|d[in]."
        )
        // « souvent » is not a verb: its -ent is silent for another reason, and must not be cut the same way.
        XCTAssertEqual(code("Le vent souffle souvent."), "Le v[en]{t} s[ou]f|fl{e} s[ou]|v[en]{t}.")
        XCTAssertEqual(code("Ils étaient contents."), "Il{s}‿é|t[ai]{ent} c[on]|t[en]{ts}.")
    }

    func testLinksLiaisonsButNeverAfterEtNorBeforeAnAspiratedH() {
        XCTAssertEqual(code("les amis"), "le{s}‿a|mi{s}")
        XCTAssertEqual(code("C'est un petit oiseau."), "C'e{st}‿[un] pe|ti{t}‿[oi]|<s>[eau].")
        XCTAssertEqual(code("nous avons"), "n[ou]{s}‿a|v[on]{s}")
        XCTAssertEqual(code("les héros"), "le{s} {h}é|ro{s}")
        XCTAssertEqual(code("les hommes"), "le{s}‿{h}om|m{es}")
        XCTAssertEqual(code("et il"), "e{t} il")
        XCTAssertEqual(code("grand ou petit"), "gr[an]{d} [ou] pe|ti{t}")
    }

    func testCodesAWholeParagraph() {
        XCTAssertEqual(
            code("Léa a pris une boîte en carton. « Nous allons le soigner », dit-elle."),
            "Lé|a a pri{s} u|n{e} b[oî]|t{e} [en] car|t[on]. « N[ou]{s}‿al|l[on]{s} le s[oi]|[gn]e{r} », di{t}-el|l{e}."
        )
        XCTAssertEqual(
            code("Aujourd'hui, nous étudions les volcans. Les scientifiques observent les éruptions."),
            "[Au]|j[ou]rd'{h}ui, n[ou]{s}‿é|tu|di[on]{s} le{s} vol|c[an]{s}. "
                + "Le{s} [sc]i[en]|ti|fi|[qu]{es} ob|ser|v{ent} le{s}‿é|rup|<t>i[on]{s}."
        )
    }

    func testLeavesDigitsAndOtherCharactersWithoutMarks() {
        XCTAssertEqual(code("page 12 !"), "pa|<g>{e} 12 !")
        XCTAssertEqual(code("12"), "12")
        XCTAssertEqual(code(""), "")
    }

    func testCodesALongPageQuickly() {
        let paragraph = "Un matin d'hiver, les enfants ont trouvé un petit oiseau dans le jardin. "
        let page = String(repeating: paragraph, count: 60)
        let started = Date()
        let coding = FrenchCoding.code(page)
        let elapsed = Date().timeIntervalSince(started)

        XCTAssertEqual(coding.flags.count, page.utf16.count)
        XCTAssertFalse(coding.liaisons.isEmpty)
        // The web app does this in microseconds; a whole second would mean a rule is looping.
        XCTAssertLessThan(elapsed, 1.0, "coding a page must stay well under a second")
    }

    /// The arrays must line up with the text itself, since the reader draws the marks by position.
    func testTheCodingCoversExactlyTheText() {
        let text = "Les enfants jouent."
        let coding = FrenchCoding.code(text)
        XCTAssertEqual(coding.syllable.count, text.utf16.count)
        XCTAssertEqual(coding.flags.count, text.utf16.count)
        // Spaces and the full stop are outside any word.
        let units = Array(text.utf16)
        for (index, unit) in units.enumerated() where unit == UInt16(32) || unit == UInt16(46) {
            XCTAssertEqual(coding.syllable[index], -1, "character \(index) is outside a word")
        }
    }

    func testWordsTheRulesCannotReadStayPlain() {
        // A word in another alphabet keeps its letters and simply receives no marks worth showing.
        let coding = FrenchCoding.code("Привет")
        XCTAssertEqual(coding.flags.count, "Привет".utf16.count)
    }
}
