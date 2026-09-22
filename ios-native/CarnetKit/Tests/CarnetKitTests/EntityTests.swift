import XCTest
@testable import CarnetKit

/// Cases from `shared/test/text/entities.test.ts`.
///
/// This is what stands between a child and an invented fact. If a model writes « en 1798 » while the page says 1789,
/// or names someone the page never mentions, the answer is refused — but only if the figures and names of the page are
/// found exactly. Missing one here means letting an invention through; finding one too many means refusing a good answer.
final class EntityTests: XCTestCase {
    private static let knownWords = WordList(words: [
        "le", "la", "les", "un", "une", "de", "du", "des", "et", "est", "sont", "a", "au", "aux", "en", "dans", "sur",
        "il", "elle", "ils", "nous", "soleil", "terre", "lune", "pierre", "rose", "moyen", "âge", "siècle", "roi",
        "guerre", "chat", "chien", "forêt", "mer", "révolution", "état", "église", "monde", "brille", "peut", "être",
        "ce", "matin", "nouveau", "mes", "amis", "enfants", "mi", "bonjour", "maman", "viens", "dit", "ramasse",
        "parle", "avec", "voit", "habite", "rue", "lit", "approche", "traverse", "tourne", "autour", "regardons",
        "étoile", "grande", "mange", "pays", "aide", "part", "vers", "voyage", "partent", "vont", "unis", "demain",
    ])

    private func entities(_ text: String, context: String = "") -> Entities {
        EntityExtractor.extract(
            from: text,
            isKnownWord: { Self.knownWords.contains(normalized: TextNormalizer.normalizedForMatch($0)) },
            contextText: context
        )
    }

    // MARK: - Numbers and years

    func testFourDigitYearsAreKeptApartFromNumbers() {
        let found = entities("En 1789, le peuple se révolte.")
        XCTAssertEqual(found.years, ["1789"])
        XCTAssertEqual(found.numbers, [])
    }

    func testTheSameNumberWrittenTwoWaysGivesOneValue() {
        XCTAssertEqual(entities("Il a trois chats.").numbers, ["3"])
        XCTAssertEqual(entities("Il a 3 chats.").numbers, entities("Il a trois chats.").numbers)
        XCTAssertEqual(entities("Il a 3 chats et trois chiens.").numbers, ["3"])
    }

    func testTheCenturyWrittenThreeWays() {
        for text in [
            "Au XIXe siècle, les usines se multiplient.",
            "Au 19e siècle, les usines se multiplient.",
            "Au dix-neuvième siècle, les usines se multiplient.",
            "Au XIXème siècle.",
        ] {
            XCTAssertEqual(entities(text).numbers, ["19e"], "« \(text) »")
        }
    }

    func testThousandsGroupsSeparatedBySpaces() {
        XCTAssertEqual(entities("La ville compte 10 000 habitants.").numbers, ["10000"])
        XCTAssertEqual(entities("Environ 1 000 000 de personnes.").numbers, ["1000000"])
        XCTAssertEqual(entities("Environ 2 500 élèves.").numbers, ["2500"])
    }

    func testDecimalsAndScaleWords() {
        XCTAssertEqual(entities("Le sac pèse 3,5 kg.").numbers, ["3.5"])
        XCTAssertEqual(entities("La France compte 67 millions d’habitants.").numbers, ["67000000"])
        XCTAssertEqual(entities("Il y a 2,5 milliards d’années.").numbers, ["2500000000"])
    }

    func testNumbersWrittenInLettersIncludingSeveralWords() {
        XCTAssertEqual(entities("Nous sommes en deux mille vingt-quatre.").numbers, ["2024"])
        XCTAssertEqual(entities("Il y a vingt et un élèves.").numbers, ["21"])
        XCTAssertEqual(entities("Elle a quatre-vingt-dix-sept ans.").numbers, ["97"])
        XCTAssertEqual(entities("Deux cents moutons.").numbers, ["200"])
    }

    func testTheArticlesUnAndUneAreNotNumbers() {
        XCTAssertEqual(entities("Un chat et une souris jouent.").numbers, [])
    }

    func testAYearRangeGivesTwoYears() {
        XCTAssertEqual(entities("La guerre de 1914-1918 fut longue.").years, ["1914", "1918"])
    }

    func testRomanNumeralsAfterANameOrBeforeSiecle() {
        let louis = entities("Le roi Louis XIV aimait danser.")
        XCTAssertEqual(louis.numbers, ["14"])
        XCTAssertEqual(louis.properNouns, ["Louis"])
        XCTAssertEqual(entities("Lis le chapitre IV.").numbers, ["4"])
        XCTAssertEqual(entities("Au Ve siècle, Rome tombe.").numbers, ["5e"])
        XCTAssertEqual(entities("François Ier règne.").numbers, ["1e"])
    }

    func testArticlesAndPronounsAreNotRomanNumerals() {
        // « Ce », « Le », « De », « Mes », « Les » all look like roman numerals and are not.
        XCTAssertEqual(entities("Ce matin, Le chat De nouveau Mes amis Les enfants.").numbers, [])
        XCTAssertEqual(entities("Ce matin, il pleut.").numbers, [])
    }

    func testOrdinalsWrittenWithDigitsOrLetters() {
        XCTAssertEqual(entities("Le 1er mai est férié.").numbers, ["1e"])
        XCTAssertEqual(entities("Pour la première fois.").numbers, ["1e"])
    }

    func testSmallNumbersAndLargeNonYearsStayNumbers() {
        let gaul = entities("En 52 av. J.-C., la Gaule est vaincue.")
        XCTAssertEqual(gaul.numbers, ["52"])
        XCTAssertEqual(gaul.years, [])
        XCTAssertEqual(entities("Il y a 3000 ans.").numbers, ["3000"])
        XCTAssertEqual(entities("Il y a 3000 ans.").years, [])
    }

    // MARK: - Proper nouns

    func testCapitalisedCommonNounsAreNotNames() {
        XCTAssertEqual(entities("Le Soleil est une étoile.").properNouns, [])
        XCTAssertEqual(entities("Soleil et Lune.").properNouns, [])
        XCTAssertEqual(entities("Nous regardons le Soleil et la Lune.").properNouns, [])
        XCTAssertEqual(entities("La Terre tourne autour du Soleil.").properNouns, [])
        XCTAssertEqual(entities("Noël approche.").properNouns, [])
    }

    func testCommonExpressionsOfSeveralWordsAreNotNames() {
        XCTAssertEqual(entities("Au Moyen Âge, les seigneurs vivent dans des châteaux.").properNouns, [])
        XCTAssertEqual(entities("La Révolution française commence.").properNouns, [])
    }

    func testARunOfCapitalisedWordsIsOneName() {
        XCTAssertEqual(entities("Le roi Louis XIV aimait danser.").properNouns, ["Louis"])
    }

    func testAKnownWordCapitalisedMidSentenceIsNotANameWhenItAlsoAppearsInLowerCase() {
        // « Rose » is a first name here, but « rose » in the page beside it makes it the flower.
        let found = entities("Il ramasse une Rose.", context: "une rose dans le jardin")
        XCTAssertEqual(found.properNouns, [])
    }

    func testAnEmptyTextFindsNothing() {
        let found = entities("")
        XCTAssertEqual(found.numbers, [])
        XCTAssertEqual(found.years, [])
        XCTAssertEqual(found.properNouns, [])
    }
}
