import CarnetKit
import SwiftUI

#if canImport(UIKit)
import UIKit

/// What the pencil is set to.
struct InkSettings: Equatable {
    var tool: InkTool = .pencil
    var colour = "#1D4ED8"
    var thickness: Thickness = .medium
    var eraser: EraserMode?
    /// True when there is no Apple Pencil and the family chose to draw with a finger.
    var fingerDraws = false

    /// Width in screen points, before it is turned into the units of its space.
    var widthInPoints: Double {
        switch (tool, thickness) {
        case (.highlighter, .fine): return 14
        case (.highlighter, .medium): return 20
        case (.highlighter, .thick): return 28
        case (_, .fine): return 2
        case (_, .medium): return 4
        case (_, .thick): return 7
        }
    }

    var opacity: Double { tool == .highlighter ? 0.35 : 1 }
}

/// The layer the child draws on, over the text or over the page image.
///
/// Vector strokes of its own rather than PencilKit. PencilKit would be less code and the wrong choice: its drawings
/// are an opaque blob, and every mark here has to be a list of points in a space the web app understands, anchored to
/// a word by a UTF-16 offset. A child who underlines a word on the iPad has to find that underline under the same
/// word in the browser at home — and a PencilKit drawing could not be re-anchored when the page text changes.
struct InkCanvasView: UIViewRepresentable {
    /// The strokes already on the page, in screen points.
    let strokes: [ResolvedStroke]
    let settings: InkSettings
    let isEnabled: Bool
    /// A finished stroke, in screen points.
    let onStroke: ([InkPoint], Double) -> Void
    /// The eraser passed over these strokes.
    let onErase: ([Pt], Double) -> Void

    /// A stored stroke, already put back into screen points.
    struct ResolvedStroke: Identifiable, Equatable {
        let id: String
        let points: [InkPoint]
        let width: Double
        let colour: String
        let tool: InkTool
        let opacity: Double
    }

    func makeUIView(context: Context) -> InkCanvasUIView {
        let view = InkCanvasUIView()
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: InkCanvasUIView, context: Context) {
        view.settings = settings
        view.isDrawingEnabled = isEnabled
        view.onStroke = onStroke
        view.onErase = onErase
        view.setStrokes(strokes)
    }
}

final class InkCanvasUIView: UIView {
    var settings = InkSettings()
    var isDrawingEnabled = false
    var onStroke: (([InkPoint], Double) -> Void)?
    var onErase: (([Pt], Double) -> Void)?

    private var strokes: [InkCanvasView.ResolvedStroke] = []
    private var live: [InkPoint] = []
    private var eraserPath: [Pt] = []
    /// True while the gesture that started belongs to the pencil rather than to scrolling.
    private var isDrawing = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = false
        contentMode = .redraw
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func setStrokes(_ strokes: [InkCanvasView.ResolvedStroke]) {
        guard self.strokes != strokes else { return }
        self.strokes = strokes
        setNeedsDisplay()
    }

    /// Only what is being drawn on takes touches; everywhere else the page keeps scrolling under the child's hand.
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        isDrawingEnabled && super.point(inside: point, with: event)
    }

    // MARK: - Touches

    /// A touch counts when it is the Apple Pencil, or when there is no pencil and the family said the finger draws.
    ///
    /// The distinction matters more than it looks. With a pencil, the finger must keep scrolling the page: a child
    /// resting their hand while they write should not leave a line across the paragraph.
    private func accepts(_ touch: UITouch) -> Bool {
        guard isDrawingEnabled else { return false }
        if touch.type == .pencil { return true }
        return settings.fingerDraws
    }

    private func point(from touch: UITouch) -> InkPoint {
        let location = touch.location(in: self)
        // A finger reports no pressure; half force keeps a finger line an even width instead of a hairline.
        let pressure = touch.type == .pencil && touch.maximumPossibleForce > 0
            ? Double(touch.force / touch.maximumPossibleForce)
            : 0.5
        return InkPoint(x: Double(location.x), y: Double(location.y), p: min(max(pressure, 0.05), 1))
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first, accepts(touch) else {
            super.touchesBegan(touches, with: event)
            return
        }
        isDrawing = true
        if settings.eraser != nil {
            eraserPath = [Pt(point(from: touch))]
        } else {
            live = [point(from: touch)]
        }
        setNeedsDisplay()
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard isDrawing, let touch = touches.first else {
            super.touchesMoved(touches, with: event)
            return
        }
        // Coalesced touches: the pencil reports far more often than the screen refreshes, and taking only the last
        // one would turn a fast curve into a handful of straight lines.
        let moves = event?.coalescedTouches(for: touch) ?? [touch]
        for move in moves {
            if settings.eraser != nil {
                eraserPath.append(Pt(point(from: move)))
            } else {
                live.append(point(from: move))
            }
        }
        setNeedsDisplay()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard isDrawing else {
            super.touchesEnded(touches, with: event)
            return
        }
        finish()
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard isDrawing else {
            super.touchesCancelled(touches, with: event)
            return
        }
        // A cancelled gesture is a gesture the child did not finish making: nothing is kept.
        isDrawing = false
        live = []
        eraserPath = []
        setNeedsDisplay()
    }

    private func finish() {
        isDrawing = false
        defer {
            live = []
            eraserPath = []
            setNeedsDisplay()
        }

        if settings.eraser != nil {
            guard !eraserPath.isEmpty else { return }
            onErase?(eraserPath, settings.widthInPoints / 2 + 6)
            return
        }

        guard live.count >= 2 else {
            // A single point is a dot, which is a mark a child may well have meant to make.
            if let dot = live.first {
                onStroke?([dot, InkPoint(x: dot.x + 0.5, y: dot.y + 0.5, p: dot.p)], settings.widthInPoints)
            }
            return
        }

        // Simplified before it is stored: a stroke straight off the pencil is hundreds of points a fraction of a
        // millimetre apart, and every one of them travels through the sync on every change.
        let simplified = StrokeEditing.capPointCount(
            StrokeEditing.simplify(live, epsilon: 0.6), maxPoints: 400, epsilon: 0.6
        )
        onStroke?(simplified, settings.widthInPoints)
    }

    // MARK: - Drawing

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }
        context.setLineCap(.round)
        context.setLineJoin(.round)

        for stroke in strokes {
            draw(
                points: stroke.points, width: stroke.width, colour: stroke.colour,
                opacity: stroke.opacity, tool: stroke.tool, in: context
            )
        }
        if !live.isEmpty {
            draw(
                points: live, width: settings.widthInPoints, colour: settings.colour,
                opacity: settings.opacity, tool: settings.tool, in: context
            )
        }
        if !eraserPath.isEmpty, let last = eraserPath.last {
            // A ring showing where the eraser is, so the child can see what it will take before they let go.
            let radius = settings.widthInPoints / 2 + 6
            context.setStrokeColor(UIColor.systemGray.withAlphaComponent(0.8).cgColor)
            context.setLineWidth(1.5)
            context.strokeEllipse(in: CGRect(
                x: last.x - radius, y: last.y - radius, width: radius * 2, height: radius * 2
            ))
        }
    }

    private func draw(
        points: [InkPoint], width: Double, colour: String, opacity: Double, tool: InkTool, in context: CGContext
    ) {
        guard points.count >= 2, let stroke = UIColor(hex: colour) else { return }
        context.setStrokeColor(stroke.withAlphaComponent(opacity).cgColor)
        context.setBlendMode(tool == .highlighter ? .multiply : .normal)

        if tool == .pencil {
            // A pencil thickens where the child pressed. Drawn segment by segment because a single path can only
            // have one width, and a line of even thickness does not look like a pencil at all.
            for index in 1..<points.count {
                let a = points[index - 1]
                let b = points[index]
                context.setLineWidth(width * (0.55 + 0.9 * (a.p + b.p) / 2))
                context.move(to: CGPoint(x: a.x, y: a.y))
                context.addLine(to: CGPoint(x: b.x, y: b.y))
                context.strokePath()
            }
        } else {
            context.setLineWidth(width)
            context.move(to: CGPoint(x: points[0].x, y: points[0].y))
            for point in points.dropFirst() {
                context.addLine(to: CGPoint(x: point.x, y: point.y))
            }
            context.strokePath()
        }
        context.setBlendMode(.normal)
    }
}

extension UIColor {
    /// « #rrggbb », which is how the colours travel.
    convenience init?(hex: String) {
        guard let colour = ReaderColor(hex: hex) else { return nil }
        self.init(red: colour.red, green: colour.green, blue: colour.blue, alpha: 1)
    }
}
#endif
