import CarnetKit
import SwiftUI

extension Color {
    init(_ colour: ReaderColor) {
        self.init(red: colour.red, green: colour.green, blue: colour.blue)
    }
}

/// How the app looks outside the reader: the home, the library, the adult area.
///
/// The reader has its own colours, chosen by the child, and nothing here overrides them. What is here is the frame
/// around the reading: quiet, warm, and out of the way.
enum Palette {
    static let paper = Color(ReaderTheme.creme.paper)
    static let ink = Color(ReaderTheme.creme.ink)
    static let card = Color(red: 1, green: 0.99, blue: 0.96)
    static let accent = Color(red: 0.11, green: 0.31, blue: 0.85)
    static let accentSoft = Color(red: 0.89, green: 0.93, blue: 1)
    static let warm = Color(red: 0.99, green: 0.85, blue: 0.48)
    static let warning = Color(red: 0.72, green: 0.11, blue: 0.11)
    static let muted = Color(red: 0.42, green: 0.40, blue: 0.37)
    static let line = Color(red: 0.85, green: 0.81, blue: 0.71)
    static let success = Color(red: 0.11, green: 0.48, blue: 0.27)
}

/// Sizes that hold across the app.
///
/// The touch targets are deliberately large. This app is used by children who are tired by the end of a school day,
/// sometimes on a table that wobbles, sometimes with a pencil in the other hand; a button that has to be aimed at is
/// a button that interrupts the reading.
enum Metrics {
    static let touchTarget: CGFloat = 56
    static let cornerRadius: CGFloat = 18
    static let gutter: CGFloat = 20
    static let cardSpacing: CGFloat = 16
}

/// The fonts the app ships for reading.
///
/// If a family's build does not include a font file, the system font is used instead — which is a real fallback and
/// not a failure: the system font on an iPad is perfectly readable, and a missing file must never leave a child
/// looking at nothing.
enum AppFont {
    static func reading(_ typography: ReaderTypography, size: CGFloat? = nil) -> Font {
        let points = size ?? typography.pointSize
        guard let name = typography.fontName, isAvailable(name) else {
            return .system(size: points, weight: .regular, design: .rounded)
        }
        return .custom(name, size: points)
    }

    /// The app's own chrome, which does not follow the child's reading font: the buttons stay where the eye learnt
    /// to find them even when the reading text changes shape.
    static func ui(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    static func title(_ size: CGFloat = 30) -> Font { ui(size, weight: .bold) }

    private static func isAvailable(_ name: String) -> Bool {
        #if canImport(UIKit)
        return UIFont(name: name, size: 12) != nil
        #else
        return false
        #endif
    }
}

/// The colours of the reader, as SwiftUI sees them.
struct ReaderPalette {
    let theme: ReaderTheme

    var paper: Color { Color(theme.paper) }
    var ink: Color { Color(theme.ink) }
    var sentenceHighlight: Color { Color(theme.sentenceHighlight) }
    var wordHighlight: Color { Color(theme.wordHighlight) }
    var silentInk: Color { Color(theme.silentInk) }
    var markA: Color { Color(theme.markA) }
    var markB: Color { Color(theme.markB) }
    var guideLine: Color { Color(theme.guideLine) }

    /// Behind a group of letters that make one sound. Kept very light: it has to be visible without turning the page
    /// into a colouring book, which would undo the help it is there to give.
    var soundGroup: Color { markA.opacity(0.12) }
    var alternateSoundGroup: Color { markB.opacity(0.12) }
}
