import Foundation

/// A handwritten answer as pixels: what gets drawn into the image sent to be read.
public struct InkRaster: Equatable, Sendable {
    public struct Stroke: Equatable, Sendable {
        public let points: [Pt]
        public let lineWidth: Double
    }

    public let width: Int
    public let height: Int
    public let strokes: [Stroke]
}

/// Answers written by hand in an exercise. Ported from `client/src/features/exercises/lib/handwriting.ts`.
///
/// The ink stays the child's: it is kept as strokes in the answer box and listed in « Mes notes ». Turning it into
/// text is optional, needs the parent's permission, and ends with the child confirming what was read — a machine's
/// guess at a seven-year-old's handwriting is not something to put words in their mouth with.
public enum Handwriting {
    /// Width the answer space is drawn at before cropping, in pixels.
    static let boxWidth = 1000.0
    static let padding = 24.0
    public static let maxSide = 1600.0
    /// The server's ceiling for the image, which travels as base64 inside a JSON body.
    public static let maxImageBytes = 1024 * 1024

    /// The live ink drawn in the answer box of one question.
    public static func isAnswerInk(_ annotation: Annotation, exerciseId: String, questionId: String) -> Bool {
        guard case let .ink(ink) = annotation, ink.deletedAt == nil,
              case let .answer(inkExercise, inkQuestion) = ink.space
        else { return false }
        return inkExercise == exerciseId && inkQuestion == questionId
    }

    /// Where the strokes go in the image: cropped to the ink with a margin, scaled down so the longest side fits.
    ///
    /// Highlighter strokes are left out when there is other ink: a child who underlined their own answer did not
    /// mean the underline to be read as a letter.
    public static func plan(_ annotations: [InkAnnotation], maxSide: Double = maxSide) -> InkRaster? {
        let writing = annotations.filter { $0.tool != .highlighter }
        let source = (writing.isEmpty ? annotations : writing).filter { !$0.points.isEmpty }
        guard !source.isEmpty else { return nil }

        let strokes = source.map { ink in
            InkRaster.Stroke(
                points: ink.points.map { Pt(x: $0.x * boxWidth, y: $0.y * boxWidth) },
                lineWidth: min(40, max(2, ink.width * boxWidth))
            )
        }

        var minX = Double.infinity, minY = Double.infinity
        var maxX = -Double.infinity, maxY = -Double.infinity
        for stroke in strokes {
            let half = stroke.lineWidth / 2
            for point in stroke.points {
                minX = min(minX, point.x - half)
                minY = min(minY, point.y - half)
                maxX = max(maxX, point.x + half)
                maxY = max(maxY, point.y + half)
            }
        }

        let rawWidth = maxX - minX + 2 * padding
        let rawHeight = maxY - minY + 2 * padding
        let scale = min(1, maxSide / max(rawWidth, rawHeight))
        return InkRaster(
            width: max(1, Int((rawWidth * scale).rounded(.up))),
            height: max(1, Int((rawHeight * scale).rounded(.up))),
            strokes: strokes.map { stroke in
                InkRaster.Stroke(
                    points: stroke.points.map {
                        Pt(x: ($0.x - minX + padding) * scale, y: ($0.y - minY + padding) * scale)
                    },
                    lineWidth: max(1, stroke.lineWidth * scale)
                )
            }
        )
    }

    /// Size in bytes of what a base64 string decodes to, without decoding it.
    public static func decodedSize(ofBase64 base64: String) -> Int {
        let padding = base64.suffix(2).filter { $0 == "=" }.count
        return base64.utf8.count / 4 * 3 - padding
    }
}
