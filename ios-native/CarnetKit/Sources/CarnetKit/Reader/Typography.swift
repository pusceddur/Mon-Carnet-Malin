import Foundation

/// A colour as the reader needs it, kept free of UIKit so the model stays testable and portable.
public struct ReaderColor: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double

    public init(_ red: Double, _ green: Double, _ blue: Double) {
        self.red = red
        self.green = green
        self.blue = blue
    }

    /// From « #RRGGBB », which is how the web app writes them.
    public init?(hex: String) {
        var text = hex
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value = Int(text, radix: 16) else { return nil }
        self.init(
            Double((value >> 16) & 0xFF) / 255,
            Double((value >> 8) & 0xFF) / 255,
            Double(value & 0xFF) / 255
        )
    }
}

/// The colours of one reading theme.
///
/// Paper is never pure white: a page at full brightness is harder to read for a child with dyslexia, and cream is the
/// colour most of them settle on. The dark theme is not an inverted white one either — pure white on pure black
/// leaves trails on the eye.
public struct ReaderTheme: Equatable, Sendable {
    public let paper: ReaderColor
    public let ink: ReaderColor
    /// Behind the sentence being read.
    public let sentenceHighlight: ReaderColor
    /// Behind the word being said.
    public let wordHighlight: ReaderColor
    /// Letters written but not said.
    public let silentInk: ReaderColor
    /// The two colours that alternate for syllables and for sound groups.
    public let markA: ReaderColor
    public let markB: ReaderColor
    /// The reading ruler.
    public let guideLine: ReaderColor

    public static let creme = ReaderTheme(
        paper: ReaderColor(hex: "#FBF6EC")!,
        ink: ReaderColor(hex: "#1F2937")!,
        sentenceHighlight: ReaderColor(hex: "#FFF0C2")!,
        wordHighlight: ReaderColor(hex: "#FFD97A")!,
        silentInk: ReaderColor(hex: "#A8A29A")!,
        markA: ReaderColor(hex: "#1D4ED8")!,
        markB: ReaderColor(hex: "#B91C1C")!,
        guideLine: ReaderColor(hex: "#D9CDB5")!
    )

    public static let clair = ReaderTheme(
        paper: ReaderColor(hex: "#FFFFFF")!,
        ink: ReaderColor(hex: "#111827")!,
        sentenceHighlight: ReaderColor(hex: "#FEF3C7")!,
        wordHighlight: ReaderColor(hex: "#FCD34D")!,
        silentInk: ReaderColor(hex: "#9CA3AF")!,
        markA: ReaderColor(hex: "#1D4ED8")!,
        markB: ReaderColor(hex: "#B91C1C")!,
        guideLine: ReaderColor(hex: "#E5E7EB")!
    )

    public static let sombre = ReaderTheme(
        paper: ReaderColor(hex: "#1A1B1E")!,
        // Not pure white: at this contrast the letters leave trails as the eye moves.
        ink: ReaderColor(hex: "#E8E6E1")!,
        sentenceHighlight: ReaderColor(hex: "#3A3520")!,
        wordHighlight: ReaderColor(hex: "#5C5122")!,
        silentInk: ReaderColor(hex: "#6B6862")!,
        markA: ReaderColor(hex: "#93C5FD")!,
        markB: ReaderColor(hex: "#FCA5A5")!,
        guideLine: ReaderColor(hex: "#3A3B40")!
    )

    public static func of(_ theme: ReadingTheme) -> ReaderTheme {
        switch theme {
        case .creme: return .creme
        case .clair: return .clair
        case .sombre: return .sombre
        }
    }

    /// §31 The same theme, in the set of colours the family chose.
    ///
    /// Only the marks change. The paper stays the paper: a child who picked cream picked cream, and a palette is
    /// about telling the marks apart, not about repainting the page — except under `contraste`, where the point is
    /// precisely to push the page and the ink apart.
    public static func of(_ theme: ReadingTheme, _ palette: ReadingPalette) -> ReaderTheme {
        let base = of(theme)
        switch palette {
        case .standard:
            return base
        case .separees:
            // Blue against vermillion, and a bluish green for the liaison arc: three hues that stay apart for every
            // kind of colour blindness, and in greyscale too (Okabe–Ito).
            let dark = theme == .sombre
            return ReaderTheme(
                paper: base.paper,
                ink: base.ink,
                sentenceHighlight: base.sentenceHighlight,
                wordHighlight: base.wordHighlight,
                silentInk: base.silentInk,
                markA: ReaderColor(hex: dark ? "#7FBFF2" : "#0060A8")!,
                markB: ReaderColor(hex: dark ? "#FF9E5E" : "#C24400")!,
                guideLine: base.guideLine
            )
        case .contraste:
            let dark = theme == .sombre
            return ReaderTheme(
                paper: ReaderColor(hex: dark ? "#000000" : "#FFFFFF")!,
                ink: ReaderColor(hex: dark ? "#FFFFFF" : "#000000")!,
                sentenceHighlight: ReaderColor(hex: dark ? "#574E22" : "#FFE680")!,
                wordHighlight: ReaderColor(hex: dark ? "#6B5820" : "#FFC94D")!,
                silentInk: ReaderColor(hex: dark ? "#8A857E" : "#6E6A63")!,
                markA: ReaderColor(hex: dark ? "#9CC8FF" : "#00308F")!,
                markB: ReaderColor(hex: dark ? "#FFB48C" : "#8C1400")!,
                guideLine: ReaderColor(hex: dark ? "#6A6A6A" : "#9A9A9A")!
            )
        }
    }
}

/// How the text is laid out for one child.
///
/// Everything here is a preference rather than a design choice, because what helps one child hinders another: wide
/// letter spacing helps some and slows others, and the only way to know is to let the parent try.
public struct ReaderTypography: Equatable, Sendable {
    /// Name of the font family to load, or nil for the system one.
    public let fontName: String?
    public let pointSize: Double
    /// Distance between baselines, in points.
    public let lineHeight: Double
    /// Extra space between letters, in points.
    public let letterSpacing: Double
    /// Extra space between words, in points.
    public let wordSpacing: Double
    /// Width of the column of text, in points. A line too long makes the eye lose its place coming back.
    public let columnWidth: Double
    public let theme: ReaderTheme
    public let showsSentenceHighlight: Bool
    public let showsReadingGuide: Bool

    /// The families the app ships, all chosen because they are easier to tell apart letter by letter.
    /// `systeme` means the system font, which is what a child used to it may prefer.
    public static func fontName(for font: ReadingFont) -> String? {
        switch font {
        case .lexend: return "Lexend"
        case .andika: return "Andika"
        case .atkinson: return "AtkinsonHyperlegible-Regular"
        case .opendyslexic: return "OpenDyslexic-Regular"
        case .systeme: return nil
        }
    }

    /// Builds the layout from a child's preferences. The em-based values of the profile become points here, because
    /// that is what a text view needs, and they scale with the chosen size as they should.
    public static func of(_ reading: ReadingPreferences) -> ReaderTypography {
        let size = clamp(reading.fontSizePx, 16, 44)
        return ReaderTypography(
            fontName: fontName(for: reading.font),
            pointSize: size,
            lineHeight: size * clamp(reading.lineHeight, 1.2, 2.6),
            letterSpacing: size * clamp(reading.letterSpacingEm, 0, 0.3),
            wordSpacing: size * clamp(reading.wordSpacingEm, 0, 0.8),
            columnWidth: size * clamp(reading.columnWidthEm, 18, 48),
            theme: ReaderTheme.of(reading.theme, reading.palette),
            showsSentenceHighlight: reading.sentenceHighlight,
            showsReadingGuide: reading.readingGuide
        )
    }

    /// A value the parent could not have set, arriving from an older version or a corrupted profile, must not make the
    /// text unreadable: it is brought back into range rather than trusted.
    private static func clamp(_ value: Double, _ low: Double, _ high: Double) -> Double {
        guard value.isFinite else { return low }
        return min(max(value, low), high)
    }

    /// Size of a title, which is the body size grown a little rather than a size of its own: a child who enlarged the
    /// text expects the titles to follow.
    public var titlePointSize: Double { pointSize * 1.35 }
}
