import Foundation

/// How one stretch of letters should be drawn when the reading aids are on.
///
/// §26 « Couleurs de lecture »: the text itself never changes, only the way it is painted. A child who cannot tell
/// where a syllable ends sees them alternate; one who reads the silent letters aloud sees them greyed out.
public struct AidStyle: Equatable, Sendable {
    /// Written but not said: drawn faded.
    public var isSilent = false
    /// Part of a group of letters making one sound.
    public var isSoundGroup = false
    /// Alternate colour for the sound group, so two groups side by side stay apart.
    public var isAlternateSoundGroup = false
    /// A letter that does not make its usual sound: marked underneath.
    public var isChanged = false
    /// Which syllable of the word, alternating so the cut is visible.
    public var syllableParity: Int?

    public var isPlain: Bool {
        !isSilent && !isSoundGroup && !isChanged && syllableParity == nil
    }
}

/// A run of characters that share the same style, in UTF-16 offsets of the block text.
public struct AidRun: Equatable, Sendable {
    public let start: Int
    public let end: Int
    public let style: AidStyle
}

/// Where a liaison is drawn: the arc joining two words across the space between them.
public struct LiaisonMark: Equatable, Sendable {
    /// Offset of the space the arc sits under.
    public let offset: Int
}

/// The reading aids of one block, ready to draw.
public struct BlockAids: Equatable, Sendable {
    public let runs: [AidRun]
    public let liaisons: [LiaisonMark]

    public static let none = BlockAids(runs: [], liaisons: [])
    public var isEmpty: Bool { runs.isEmpty && liaisons.isEmpty }
}

/// Building the reading aids of a block from the French coding engine.
///
/// The engine marks every character; drawing one attributed span per character would be wasteful and would break
/// letter shaping, so characters that share a style are joined into runs. Each aid can be turned on alone, because a
/// child who needs the syllables rarely needs all five at once — five marks on the same word is no longer a help.
public enum ReadingAidsModel {
    /// Whether anything at all is switched on.
    public static func isOn(_ aids: ReadingAids) -> Bool {
        aids.syllables || aids.silentLetters || aids.sounds || aids.changedLetters || aids.liaisons
    }

    /// Works out the aids of a block. Returns nothing at all when none are switched on, so the reader can skip the
    /// whole attributed-text path and draw plain text.
    public static func build(text: String, aids: ReadingAids) -> BlockAids {
        guard isOn(aids) else { return .none }
        let coding = FrenchCoding.code(text)
        guard !coding.flags.isEmpty else { return .none }

        var runs: [AidRun] = []
        var currentStyle: AidStyle?
        var currentStart = 0

        func close(at index: Int) {
            guard let style = currentStyle, index > currentStart, !style.isPlain else {
                currentStyle = nil
                return
            }
            runs.append(AidRun(start: currentStart, end: index, style: style))
            currentStyle = nil
        }

        for index in coding.flags.indices {
            let style = self.style(at: index, coding: coding, aids: aids)
            if style != currentStyle {
                close(at: index)
                currentStyle = style
                currentStart = index
            }
        }
        close(at: coding.flags.count)

        let liaisons = aids.liaisons ? coding.liaisons.map(LiaisonMark.init(offset:)) : []
        return BlockAids(runs: runs, liaisons: liaisons)
    }

    private static func style(at index: Int, coding: TextCoding, aids: ReadingAids) -> AidStyle {
        let flags = coding.flags[index]
        let syllable = coding.syllable[index]
        var style = AidStyle()

        // Outside a word there is nothing to mark.
        guard syllable >= 0 else { return style }

        if aids.silentLetters && (flags & FrenchCoding.silent) != 0 { style.isSilent = true }
        if aids.sounds && (flags & FrenchCoding.sound) != 0 {
            style.isSoundGroup = true
            style.isAlternateSoundGroup = (flags & FrenchCoding.soundAlternate) != 0
        }
        if aids.changedLetters && (flags & FrenchCoding.changed) != 0 { style.isChanged = true }
        if aids.syllables {
            // Only the parity matters: the point is that two neighbours differ, not which colour is which.
            style.syllableParity = Int(syllable) % 2
        }
        return style
    }

    /// The aids of a whole block model, cached by the caller if it draws the same block again and again.
    public static func build(for block: BlockModel, aids: ReadingAids) -> BlockAids {
        build(text: block.text, aids: aids)
    }
}
