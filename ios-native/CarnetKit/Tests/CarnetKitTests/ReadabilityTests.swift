import XCTest
@testable import CarnetKit

/// Cases from `shared/test/text/readability.test.ts`.
///
/// Counting spoken syllables is a heuristic, not an exact science, so the web app measures itself against words
/// annotated by hand and allows one syllable of error on a few of them. The port is held to the same bar: the same
/// words, the same tolerance. Drifting below it means a rule was lost in translation.
final class ReadabilityTests: XCTestCase {
    /// Inner e are heard (« sa-me-di »), glides are not split (« lion » 1, « science » 1).
    private static let annotated: [(String, Int)] = [
        ("chat", 1), ("maison", 2), ("école", 2), ("photosynthèse", 4), ("enfant", 2), ("oiseau", 2), ("écureuil", 3),
        ("feuille", 1), ("travail", 2), ("soleil", 2), ("fille", 1), ("aujourd’hui", 3), ("extraordinaire", 5),
        ("poésie", 3), ("géographie", 4), ("créer", 2), ("théâtre", 2), ("pays", 2), ("hier", 1), ("piano", 2),
        ("ville", 1), ("jardin", 2), ("mangent", 1), ("grand-mère", 2), ("vingt-et-un", 3), ("œuf", 1), ("cœur", 1),
        ("Noël", 2), ("naïf", 2), ("ouvrier", 3), ("trois", 1), ("prière", 2), ("lumière", 2), ("février", 3),
        ("crier", 2), ("client", 2), ("bien", 1), ("chien", 1), ("attention", 3), ("nation", 2), ("lion", 1),
        ("violon", 2), ("nuage", 1), ("oui", 1), ("huit", 1), ("nuit", 1), ("bruit", 1), ("cruel", 2), ("voyage", 2),
        ("crayon", 2), ("payer", 2), ("yeux", 1), ("famille", 2), ("papillon", 3), ("travailler", 3), ("idée", 2),
        ("année", 2), ("rue", 1), ("statue", 2), ("avenue", 3), ("château", 2), ("banque", 1), ("langue", 1),
        ("quatre", 1), ("question", 2), ("guitare", 2), ("aiguille", 2), ("table", 1), ("tables", 1), ("les", 1),
        ("étudient", 3), ("mangeaient", 2), ("voient", 1), ("souvent", 2), ("moment", 2), ("vent", 1), ("parents", 2),
        ("lentement", 3), ("alcool", 2), ("zoo", 1), ("chaos", 2), ("réel", 2), ("idées", 2), ("créée", 2),
        ("poète", 2), ("aéroport", 4), ("extérieur", 3), ("électricité", 5), ("mathématiques", 4), ("hippopotame", 4),
        ("crocodile", 3), ("éléphant", 3), ("dinosaure", 3), ("température", 4), ("ordinateur", 4), ("bibliothèque", 4),
        ("mercredi", 3), ("samedi", 3), ("maintenant", 3), ("boulangerie", 4), ("professeur", 3), ("escargot", 3),
        ("fourmi", 2), ("hirondelle", 3), ("grenouille", 2), ("forêt", 2), ("montagne", 2), ("rivière", 2),
        ("océan", 3), ("réalité", 4), ("musée", 2), ("journée", 2), ("cheveux", 2), ("genou", 2), ("heureux", 2),
        ("malheureusement", 5), ("doucement", 3), ("histoire", 2), ("géant", 2), ("européen", 4), ("science", 1),
        ("patient", 2), ("radio", 2), ("société", 3), ("pied", 1), ("premier", 2), ("dernier", 2), ("escalier", 3),
        ("tablier", 3), ("sanglier", 3), ("monsieur", 2), ("femme", 1), ("second", 2), ("oignon", 2), ("finissent", 2),
        ("aiment", 1), ("dorment", 1), ("accident", 3), ("arc-en-ciel", 3), ("quatre-vingt-dix", 4), ("l’arbre", 1),
        ("qu’il", 1), ("jusqu’à", 2), ("Égypte", 2), ("cygne", 1), ("style", 1), ("rythme", 1), ("abbaye", 3),
        ("paysage", 3),
    ]

    func testTheAnnotatedListIsLargeEnoughToMeanSomething() {
        XCTAssertGreaterThanOrEqual(Self.annotated.count, 100)
    }

    func testStaysWithinOneSyllableOnNearlyEveryAnnotatedWordAndIsMostlyExact() {
        var exact = 0
        var close = 0
        var worst: [String] = []

        for (word, expected) in Self.annotated {
            let got = Readability.countSyllables(word)
            if got == expected { exact += 1 }
            if abs(got - expected) <= 1 {
                close += 1
            } else {
                worst.append("\(word): expected \(expected), got \(got)")
            }
        }

        let total = Double(Self.annotated.count)
        XCTAssertGreaterThanOrEqual(
            Double(close) / total, 0.9,
            "off by more than one syllable on: \(worst.joined(separator: ", "))"
        )
        XCTAssertGreaterThanOrEqual(Double(exact) / total, 0.75, "most words should be exact, not merely close")
    }

    func testEdgeCases() {
        XCTAssertEqual(Readability.countSyllables(""), 0)
        XCTAssertEqual(Readability.countSyllables("..."), 0)
        XCTAssertEqual(Readability.countSyllables("y"), 1)
        XCTAssertEqual(Readability.countSyllables("ÉCOLE"), 2)
        XCTAssertEqual(Readability.countSyllables("« école »"), 2)
        XCTAssertEqual(Readability.countSyllables("1914"), 3)
        XCTAssertEqual(Readability.countSyllables("7"), 1)
    }

    func testCountsWordsAndSentencesIgnoringElidedClitics() {
        let report = Readability.report(for: "Le chat dort. L’arbre pousse vite aujourd’hui !")
        XCTAssertEqual(report.words, 7)
        XCTAssertEqual(report.sentences, 2)
        XCTAssertEqual(report.averageWordsPerSentence, 3.5)
        XCTAssertEqual(report.longestSentenceWords, 4)
        XCTAssertEqual(report.longWordRatio, 0)
    }

    func testLongWordRatioAndExemptWords() {
        let text = "La photosynthèse transforme la lumière."
        XCTAssertEqual(Readability.report(for: text).longWordRatio, 0.2)
        // A word the book already used must not make the explanation look hard.
        XCTAssertEqual(Readability.report(for: text, exemptWords: ["Photosynthèse"]).longWordRatio, 0)
        XCTAssertEqual(
            Readability.report(for: "Les températures augmentent.", exemptWords: ["température", "temperatures"]).longWordRatio,
            0
        )
    }

    func testAnEmptyTextReportsNothingRatherThanDividingByZero() {
        let report = Readability.report(for: "")
        XCTAssertEqual(report.words, 0)
        XCTAssertEqual(report.sentences, 0)
        XCTAssertEqual(report.kandelMoles, 0)
    }
}
