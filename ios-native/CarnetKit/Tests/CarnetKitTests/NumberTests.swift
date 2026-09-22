import XCTest
@testable import CarnetKit

/// Every case of `shared/test/text/numbers.test.ts`. Two writings of the same number must give the same answer, which
/// is what lets the app notice that a model turned « 1789 » into « 1798 » while quoting a page.
final class NumberTests: XCTestCase {
    private func check(_ pairs: [(String, String)], file: StaticString = #filePath, line: UInt = #line) {
        for (input, expected) in pairs {
            XCTAssertEqual(FrenchNumbers.normalize(input), expected, "« \(input) »", file: file, line: line)
        }
    }

    func testPlainDigits() {
        check([("0", "0"), ("7", "7"), ("007", "7"), ("1789", "1789"), ("-5", "-5"), ("\u{2212}12", "-12"), ("+3", "3")])
    }

    func testThousandsSeparators() {
        check([
            ("1 000", "1000"), ("10 000", "10000"), ("1 000 000", "1000000"), ("2 500", "2500"),
            ("1.000", "1000"), ("12.345.678", "12345678"),
        ])
    }

    func testDecimals() {
        check([
            ("3,5", "3.5"), ("0,75", "0.75"), ("3,50", "3.5"), ("12,0", "12"), ("1 234,56", "1234.56"), ("2.5", "2.5"),
        ])
    }

    func testDigitsFollowedByAScaleWord() {
        check([
            ("2,5 millions", "2500000"), ("67 millions", "67000000"), ("3 milliards", "3000000000"),
            ("1,25 million", "1250000"), ("4 mille", "4000"),
        ])
    }

    func testNumbersWrittenInLetters() {
        check([
            ("zéro", "0"), ("un", "1"), ("une", "1"), ("trois", "3"), ("Trois", "3"), ("dix-sept", "17"),
            ("vingt", "20"), ("vingt et un", "21"), ("vingt-et-un", "21"), ("trente-deux", "32"),
            ("soixante-dix", "70"), ("soixante et onze", "71"), ("soixante-dix-neuf", "79"),
            ("quatre-vingts", "80"), ("quatre-vingt-un", "81"), ("quatre-vingt-dix", "90"),
            ("quatre-vingt-dix-sept", "97"), ("cent", "100"), ("cent un", "101"), ("deux cents", "200"),
            ("deux cent trente", "230"), ("neuf cent quatre-vingt-dix-neuf", "999"), ("mille", "1000"),
            ("mil neuf cent quatorze", "1914"), ("deux mille vingt-quatre", "2024"), ("dix mille", "10000"),
            ("cent mille", "100000"), ("un million", "1000000"), ("trois millions deux cent mille", "3200000"),
            ("deux milliards", "2000000000"),
            // Belgian and Swiss forms.
            ("septante", "70"), ("nonante-neuf", "99"),
        ])
    }

    func testRomanNumerals() {
        check([
            ("XIXe", "19e"), ("XIX", "19"), ("XIXème", "19e"), ("XIXè", "19e"), ("XXIe", "21e"), ("IVe", "4e"),
            ("Ier", "1e"), ("Ire", "1e"), ("MCMXIV", "1914"), ("XIVe", "14e"),
        ])
    }

    func testOrdinals() {
        check([
            ("19e", "19e"), ("19ème", "19e"), ("19eme", "19e"), ("19è", "19e"), ("1er", "1e"), ("1re", "1e"),
            ("1ère", "1e"), ("2nd", "2e"), ("2nde", "2e"), ("XIXᵉ", "19e"), ("dix-neuvième", "19e"),
            ("premier", "1e"), ("première", "1e"), ("deuxième", "2e"), ("quatrième", "4e"), ("cinquième", "5e"),
            ("neuvième", "9e"), ("onzième", "11e"), ("vingtième", "20e"), ("vingt et unième", "21e"),
            ("centième", "100e"), ("millième", "1000e"),
        ])
    }

    func testTwoWritingsOfTheSameNumberAgree() {
        XCTAssertEqual(FrenchNumbers.normalize("XIXe"), FrenchNumbers.normalize("19e"))
        XCTAssertEqual(FrenchNumbers.normalize("trois"), FrenchNumbers.normalize("3"))
        XCTAssertEqual(FrenchNumbers.normalize("mille neuf cent quatorze"), FrenchNumbers.normalize("1914"))
        XCTAssertEqual(FrenchNumbers.normalize("1 000 000"), FrenchNumbers.normalize("un million"))
    }

    func testRejectsWhatIsNotANumber() {
        let rejected = [
            "", "chat", "deux trois", "vingt vingt", "mille mille", "cent zéro", "xix", "IIII", "VV", "12h30", "3G",
            "unième", "et", "-", "1,5e",
            // A lone letter is a word far more often than a number: « Ce », « Le », « M. Dupont ».
            "Ce", "Le",
        ]
        for input in rejected {
            XCTAssertNil(FrenchNumbers.normalize(input), "« \(input) » must not be read as a number")
        }
    }
}
