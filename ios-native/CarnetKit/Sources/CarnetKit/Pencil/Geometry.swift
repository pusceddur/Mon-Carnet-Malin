import Foundation

/// A point with no pressure, used everywhere the geometry does not care how hard the pencil was pressed.
public struct Pt: Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    public init(_ point: InkPoint) {
        self.init(x: point.x, y: point.y)
    }
}

public struct Box: Equatable, Sendable {
    public var minX: Double
    public var minY: Double
    public var maxX: Double
    public var maxY: Double

    public init(minX: Double, minY: Double, maxX: Double, maxY: Double) {
        self.minX = minX
        self.minY = minY
        self.maxX = maxX
        self.maxY = maxY
    }

    public var center: Pt { Pt(x: (minX + maxX) / 2, y: (minY + maxY) / 2) }

    public func expanded(by radius: Double) -> Box {
        Box(minX: minX - radius, minY: minY - radius, maxX: maxX + radius, maxY: maxY + radius)
    }

    public func intersects(_ other: Box) -> Bool {
        minX <= other.maxX && other.minX <= maxX && minY <= other.maxY && other.minY <= maxY
    }
}

/// A rectangle written the way a laid-out box is: from its top-left corner.
public struct Rect: Equatable, Sendable {
    public var left: Double
    public var top: Double
    public var width: Double
    public var height: Double

    public init(left: Double, top: Double, width: Double, height: Double) {
        self.left = left
        self.top = top
        self.width = width
        self.height = height
    }

    public var right: Double { left + width }
    public var bottom: Double { top + height }

    public func contains(_ point: Pt) -> Bool {
        point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
    }
}

/// Plain 2D geometry for strokes: distances, hit tests, boxes.
/// Ported from `client/src/pencil/geometry.ts`.
///
/// It knows nothing about ink, text or the screen, which is why it can be tested on its own — and it is the piece the
/// eraser rests on, where being a pixel wrong means rubbing out a word the child wanted to keep.
public enum Geometry {
    public static func distanceSquared(_ a: Pt, _ b: Pt) -> Double {
        let dx = a.x - b.x
        let dy = a.y - b.y
        return dx * dx + dy * dy
    }

    public static func distance(_ a: Pt, _ b: Pt) -> Double {
        distanceSquared(a, b).squareRoot()
    }

    /// Distance from a point to the segment `[a, b]`. A segment of no length is a point.
    public static func distanceToSegment(_ p: Pt, _ a: Pt, _ b: Pt) -> Double {
        let dx = b.x - a.x
        let dy = b.y - a.y
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared > 0 else { return distance(p, a) }
        let t = min(max(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared, 0), 1)
        return distance(p, Pt(x: a.x + t * dx, y: a.y + t * dy))
    }

    private static func cross(_ o: Pt, _ a: Pt, _ b: Pt) -> Double {
        (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }

    private static func onSegment(_ a: Pt, _ b: Pt, _ p: Pt) -> Bool {
        min(a.x, b.x) <= p.x && p.x <= max(a.x, b.x) && min(a.y, b.y) <= p.y && p.y <= max(a.y, b.y)
    }

    /// True when the closed segments `[a, b]` and `[c, d]` meet, touching and lying along each other included.
    public static func segmentsIntersect(_ a: Pt, _ b: Pt, _ c: Pt, _ d: Pt) -> Bool {
        let d1 = cross(c, d, a)
        let d2 = cross(c, d, b)
        let d3 = cross(a, b, c)
        let d4 = cross(a, b, d)
        if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) { return true }
        return (d1 == 0 && onSegment(c, d, a))
            || (d2 == 0 && onSegment(c, d, b))
            || (d3 == 0 && onSegment(a, b, c))
            || (d4 == 0 && onSegment(a, b, d))
    }

    public static func segmentToSegmentDistance(_ a: Pt, _ b: Pt, _ c: Pt, _ d: Pt) -> Double {
        if segmentsIntersect(a, b, c, d) { return 0 }
        return min(
            distanceToSegment(a, c, d), distanceToSegment(b, c, d),
            distanceToSegment(c, a, b), distanceToSegment(d, a, b)
        )
    }

    /// Distance from a point to a run of segments. A single point counts as one. Infinite for nothing at all.
    public static func distanceToPolyline(_ p: Pt, _ line: [Pt]) -> Double {
        guard let first = line.first else { return .infinity }
        guard line.count > 1 else { return distance(p, first) }
        var best = Double.infinity
        for index in 1..<line.count {
            best = min(best, distanceToSegment(p, line[index - 1], line[index]))
        }
        return best
    }

    public static func boundingBox(_ points: [Pt]) -> Box? {
        guard let first = points.first else { return nil }
        var box = Box(minX: first.x, minY: first.y, maxX: first.x, maxY: first.y)
        for point in points {
            box.minX = min(box.minX, point.x)
            box.minY = min(box.minY, point.y)
            box.maxX = max(box.maxX, point.x)
            box.maxY = max(box.maxY, point.y)
        }
        return box
    }

    public static func boundingBox(_ points: [InkPoint]) -> Box? {
        boundingBox(points.map(Pt.init))
    }

    /// Distance from a point to a rectangle, zero inside it.
    public static func distanceToRect(_ p: Pt, _ r: Rect) -> Double {
        let dx = max(r.left - p.x, 0, p.x - r.right)
        let dy = max(r.top - p.y, 0, p.y - r.bottom)
        return (dx * dx + dy * dy).squareRoot()
    }

    /// Distance from a segment to a rectangle, zero when it crosses or lies inside.
    public static func segmentToRectDistance(_ a: Pt, _ b: Pt, _ r: Rect) -> Double {
        if r.contains(a) || r.contains(b) { return 0 }
        let topLeft = Pt(x: r.left, y: r.top)
        let topRight = Pt(x: r.right, y: r.top)
        let bottomRight = Pt(x: r.right, y: r.bottom)
        let bottomLeft = Pt(x: r.left, y: r.bottom)
        return min(
            segmentToSegmentDistance(a, b, topLeft, topRight),
            segmentToSegmentDistance(a, b, topRight, bottomRight),
            segmentToSegmentDistance(a, b, bottomRight, bottomLeft),
            segmentToSegmentDistance(a, b, bottomLeft, topLeft)
        )
    }

    public static func polylineToRectDistance(_ line: [Pt], _ r: Rect) -> Double {
        guard let first = line.first else { return .infinity }
        guard line.count > 1 else { return distanceToRect(first, r) }
        var best = Double.infinity
        for index in 1..<line.count {
            let d = segmentToRectDistance(line[index - 1], line[index], r)
            if d == 0 { return 0 }
            best = min(best, d)
        }
        return best
    }

    /// The closest the two runs of segments come to each other.
    public static func polylineDistance(_ a: [Pt], _ b: [Pt]) -> Double {
        guard !a.isEmpty, !b.isEmpty else { return .infinity }
        if a.count == 1 { return distanceToPolyline(a[0], b) }
        if b.count == 1 { return distanceToPolyline(b[0], a) }
        var best = Double.infinity
        for i in 1..<a.count {
            for j in 1..<b.count {
                let d = segmentToSegmentDistance(a[i - 1], a[i], b[j - 1], b[j])
                if d == 0 { return 0 }
                best = min(best, d)
            }
        }
        return best
    }

    /// True when the eraser, with its own radius, touches the stroke as it is drawn — its line plus its full width.
    ///
    /// The box test first: a child rubbing out one word drags the eraser past every other stroke on the page, and
    /// comparing each of them segment by segment would make the page stutter under their hand.
    public static func hitTestStroke(
        stroke: [Pt], strokeWidth: Double, eraser: [Pt], eraserRadius: Double
    ) -> Bool {
        guard let strokeBox = boundingBox(stroke), let eraserBox = boundingBox(eraser) else { return false }
        let reach = eraserRadius + strokeWidth / 2
        guard strokeBox.expanded(by: reach).intersects(eraserBox) else { return false }
        return polylineDistance(stroke, eraser) <= reach
    }

    public static func pathLength(_ points: [Pt]) -> Double {
        guard points.count > 1 else { return 0 }
        return (1..<points.count).reduce(0) { $0 + distance(points[$1 - 1], points[$1]) }
    }

    public static func lerp(_ a: InkPoint, _ b: InkPoint, _ t: Double) -> InkPoint {
        InkPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t)
    }

    /// Adds points along the way so that no step is longer than `maxStep`.
    ///
    /// A stroke as it is recorded is a handful of points a long way apart; the partial eraser works point by point,
    /// so without this it would take out whole segments where the child only touched the middle of one.
    public static func densify(_ points: [InkPoint], maxStep: Double) -> [InkPoint] {
        guard let first = points.first, maxStep > 0, points.count > 1 else { return points }
        var out: [InkPoint] = [first]
        for index in 1..<points.count {
            let a = points[index - 1]
            let b = points[index]
            let steps = Int(ceil(distance(Pt(a), Pt(b)) / maxStep))
            if steps > 1 {
                for step in 1..<steps { out.append(lerp(a, b, Double(step) / Double(steps))) }
            }
            out.append(b)
        }
        return out
    }
}
