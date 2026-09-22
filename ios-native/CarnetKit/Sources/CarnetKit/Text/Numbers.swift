import Foundation

/// Reading a French number, however it is written. Ported from `shared/src/text/numbers.ts`.
///
/// « 1 000 », « 1.000 », « mille » and « M » are the same number; « 3,5 » and « 3.5 » too. The app has to know that to
/// check that a model did not change a figure of the book, and to read a page aloud without saying « un virgule cinq »
/// where the page says « 1,5 ».
public enum FrenchNumbers {
    private static let units: [String: Int] = [
        "zéro": 0, "zero": 0, "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5, "six": 6, "sept": 7,
        "huit": 8, "neuf": 9, "dix": 10, "onze": 11, "douze": 12, "treize": 13, "quatorze": 14, "quinze": 15, "seize": 16,
    ]
    private static let tens: [String: Int] = [
        "vingt": 20, "vingts": 20, "trente": 30, "quarante": 40, "cinquante": 50, "soixante": 60,
        // Belgian and Swiss forms: the app is read in several countries.
        "septante": 70, "octante": 80, "huitante": 80, "nonante": 90,
    ]
    private static let hundreds: Set<String> = ["cent", "cents"]
    private static let scales: [String: Int] = [
        "mille": 1_000, "mil": 1_000, "million": 1_000_000, "millions": 1_000_000,
        "milliard": 1_000_000_000, "milliards": 1_000_000_000,
    ]

    /// Every word that can appear inside a number written in letters.
    public static let numberWords: Set<String> = {
        var set = Set(units.keys)
        set.formUnion(tens.keys)
        set.formUnion(hundreds)
        set.formUnion(scales.keys)
        return set
    }()

    private static let ordinalSuffix = "(?:e|es|er|ers|re|res|ère|ères|ème|èmes|eme|emes|è|nd|nde|nds|ndes)"
    private static let romanValues: [Character: Int] = ["I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000]

    private static let digitsPattern = try! NSRegularExpression(
        pattern: "^([+\\-\u{2212}]?)(\\d{1,3}(?:[ .]\\d{3})+|\\d+)(?:[,.](\\d+))?(?:(\(ordinalSuffix)))?"
            + "(?: (mille|millions?|milliards?))?$",
        options: []
    )
    private static let romanPattern = try! NSRegularExpression(
        pattern: "^(?=[IVXLCDM])(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})(\(ordinalSuffix))?$",
        options: []
    )
    private static let ordinalWordPattern = try! NSRegularExpression(pattern: "^(.+?)i[èe]mes?$", options: [])
    private static let firstPattern = try! NSRegularExpression(pattern: "^premi(?:er|ère|ers|ères)$", options: [])

    private static func group(_ match: NSTextCheckingResult, _ index: Int, in text: String) -> String? {
        let range = match.range(at: index)
        guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else { return nil }
        return String(text[swiftRange])
    }

    private static func firstMatch(_ expression: NSRegularExpression, _ text: String) -> NSTextCheckingResult? {
        expression.firstMatch(in: text, options: [], range: NSRange(location: 0, length: text.utf16.count))
    }

    // MARK: - Numbers written in letters

    /// A value and where reading stopped.
    private typealias Parsed = (value: Int, next: Int)

    private static func unit(_ words: [String], _ index: Int, min: Int, max: Int) -> Int? {
        guard index < words.count, let value = units[words[index]], value >= min, value <= max else { return nil }
        return value
    }

    /// 1 to 19 after « soixante » or « quatre-vingt », where the teens keep going; 1 to 9 after the other tens.
    private static func parseTail(_ words: [String], _ index: Int, allowTeens: Bool) -> Parsed? {
        if allowTeens {
            if index < words.count && words[index] == "dix" {
                if let u = unit(words, index + 1, min: 7, max: 9) { return (10 + u, index + 2) }
                return (10, index + 1)
            }
            if let teen = unit(words, index, min: 11, max: 16) { return (teen, index + 1) }
        }
        if let u = unit(words, index, min: 1, max: 9) { return (u, index + 1) }
        return nil
    }

    private static func parseBelow100(_ words: [String], _ index: Int) -> Parsed? {
        guard index < words.count else { return nil }
        let word = words[index]
        let following = index + 1 < words.count ? words[index + 1] : ""

        if word == "quatre" && (following == "vingt" || following == "vingts") {
            let tail = following == "vingt" ? parseTail(words, index + 2, allowTeens: true) : nil
            if let tail { return (80 + tail.value, tail.next) }
            return (80, index + 2)
        }
        if let ten = tens[word] {
            // « soixante-dix » keeps counting into the teens; « trente-dix » does not exist.
            if let tail = parseTail(words, index + 1, allowTeens: ten == 60) { return (ten + tail.value, tail.next) }
            return (ten, index + 1)
        }
        if word == "dix", let u = unit(words, index + 1, min: 7, max: 9) { return (10 + u, index + 2) }
        if let value = units[word] { return (value, index + 1) }
        return nil
    }

    private static func parseBelow1000(_ words: [String], _ index: Int) -> Parsed? {
        var hundredsValue = 0
        var j = index

        if j < words.count && hundreds.contains(words[j]) {
            hundredsValue = 100
            j += 1
        } else if let u = unit(words, j, min: 2, max: 9),
                  j + 1 < words.count, hundreds.contains(words[j + 1]) {
            hundredsValue = u * 100
            j += 2
        }

        if hundredsValue > 0, j < words.count, words[j] == "zéro" || words[j] == "zero" {
            return (hundredsValue, j)
        }
        if let rest = parseBelow100(words, j) {
            if hundredsValue > 0 && rest.value == 0 { return (hundredsValue, j) }
            return (hundredsValue + rest.value, rest.next)
        }
        return hundredsValue > 0 ? (hundredsValue, j) : nil
    }

    /// Value of a whole list of number words, or nil when the list is not exactly one number.
    private static func parseCardinal(_ words: [String]) -> Int? {
        guard !words.isEmpty else { return nil }
        if words.count == 1 && (words[0] == "zéro" || words[0] == "zero") { return 0 }

        var total = 0
        var lastScale = Int.max
        var i = 0
        while i < words.count {
            let group = parseBelow1000(words, i)
            if let group, group.value == 0 { return nil }
            let next = group?.next ?? i
            let scale = next < words.count ? scales[words[next]] : nil

            if let scale {
                // « mille millions » is not a number: the scales must go down.
                if scale >= lastScale { return nil }
                if group == nil && scale != 1_000 { return nil }
                total += (group?.value ?? 1) * scale
                lastScale = scale
                i = next + 1
                continue
            }
            guard let group, next == words.count else { return nil }
            return total + group.value
        }
        return total
    }

    private static func splitNumberWords(_ text: String) -> [String] {
        text.lowercased()
            .split(whereSeparator: { $0.isWhitespace || $0 == "-" || $0 == "\u{2010}" || $0 == "\u{2011}" })
            .map(String.init)
            .filter { !$0.isEmpty && $0 != "et" }
    }

    /// Stems whose ordinal is not simply the cardinal plus « ième ».
    private static let ordinalStems: [String: String] = ["cinqu": "cinq", "neuv": "neuf", "un": "un"]

    private static func ordinalWordToCardinal(_ word: String) -> String? {
        guard let match = firstMatch(ordinalWordPattern, word), let stem = group(match, 1, in: word) else { return nil }
        if let mapped = ordinalStems[stem] { return mapped }
        if numberWords.contains(stem) { return stem }
        if numberWords.contains(stem + "e") { return stem + "e" }
        return nil
    }

    private static func parseWords(_ text: String) -> String? {
        let words = splitNumberWords(text)
        guard !words.isEmpty else { return nil }
        if words.count == 1, firstMatch(firstPattern, words[0]) != nil { return "1e" }

        if let base = ordinalWordToCardinal(words[words.count - 1]) {
            // « unième » alone is not a number; « vingt-et-unième » is.
            if base == "un" && words.count == 1 { return nil }
            let cardinal = Array(words.dropLast()) + [base]
            guard let value = parseCardinal(cardinal), value > 0 else { return nil }
            return "\(value)e"
        }
        guard words.allSatisfy(numberWords.contains) else { return nil }
        guard let value = parseCardinal(words) else { return nil }
        return String(value)
    }

    // MARK: - Roman numerals

    private static func romanValue(_ roman: String) -> Int {
        let letters = Array(roman)
        var total = 0
        for index in letters.indices {
            let value = romanValues[letters[index]] ?? 0
            let next = index + 1 < letters.count ? (romanValues[letters[index + 1]] ?? 0) : 0
            total += value < next ? -value : value
        }
        return total
    }

    // MARK: - Numbers written in digits

    private static func strippedLeadingZeros(_ digits: String) -> String {
        var out = digits
        while out.count > 1 && out.hasPrefix("0") { out.removeFirst() }
        return out
    }

    /// `int.frac` multiplied by ten to the `zeros`, as a canonical decimal string.
    private static func scaleDecimal(_ intPart: String, _ fracPart: String, zeros: Int) -> String {
        var fraction = fracPart
        while fraction.hasSuffix("0") { fraction.removeLast() }
        if zeros == 0 {
            return fraction.isEmpty ? strippedLeadingZeros(intPart) : "\(strippedLeadingZeros(intPart)).\(fraction)"
        }
        let shifted = fraction.padding(toLength: max(zeros, fraction.count), withPad: "0", startingAt: 0)
        let moved = String(shifted.prefix(zeros))
        var rest = String(shifted.dropFirst(zeros))
        while rest.hasSuffix("0") { rest.removeLast() }
        let digits = strippedLeadingZeros(intPart + moved)
        return rest.isEmpty ? digits : "\(digits).\(rest)"
    }

    private static func parseDigits(_ text: String) -> String? {
        guard let match = firstMatch(digitsPattern, text) else { return nil }
        let sign = group(match, 1, in: text) ?? ""
        let intRaw = group(match, 2, in: text) ?? ""
        let fracRaw = group(match, 3, in: text)
        let ordinal = group(match, 4, in: text)
        let scaleWord = group(match, 5, in: text)

        let intPart = intRaw.filter { $0 != " " && $0 != "." }
        // « 3,5e » and « -2e » are not ordinals of anything.
        if ordinal != nil && (fracRaw != nil || scaleWord != nil || !sign.isEmpty) { return nil }

        let zeros: Int
        if let scaleWord {
            zeros = scaleWord.hasPrefix("milliard") ? 9 : (scaleWord.hasPrefix("million") ? 6 : 3)
        } else {
            zeros = 0
        }
        let value = scaleDecimal(intPart, fracRaw ?? "", zeros: zeros)
        if ordinal != nil { return value == "0" ? nil : "\(value)e" }
        let isNegative = !sign.isEmpty && sign != "+" && value.contains(where: { "123456789".contains($0) })
        return isNegative ? "-\(value)" : value
    }

    /// Canonical form of a French number, or nil when the token is not one.
    ///
    /// « 1 000 » and « 1.000 » give "1000"; « 3,5 » gives "3.5"; « vingt-et-un » gives "21";
    /// « 2,5 millions » gives "2500000"; « XIXe », « 19ème » and « dix-neuvième » all give "19e".
    /// A lone C, D, L or M is left alone: far more often a letter, a title (« M. ») or a word than a number.
    public static func normalize(_ token: String) -> String? {
        var text = token.precomposedStringWithCompatibilityMapping
        text = String(text.unicodeScalars.map {
            $0 == "\u{00A0}" || $0 == "\u{202F}" || $0 == "\u{2007}" ? Character(" ") : Character($0)
        })
        text = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
            .trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }

        if let first = text.first, first.isNumber || first == "+" || first == "-" || first == "\u{2212}" {
            return parseDigits(text)
        }
        if let words = parseWords(text) { return words }

        if let match = firstMatch(romanPattern, text) {
            let suffix = group(match, 5, in: text) ?? ""
            let numeral = String(text.dropLast(suffix.count))
            if numeral.count == 1, "CDLM".contains(numeral) { return nil }
            let value = romanValue(numeral)
            return suffix.isEmpty ? String(value) : "\(value)e"
        }
        return nil
    }
}
