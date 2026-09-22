import Foundation

/// Rubbing out part of a stroke, and keeping strokes small enough to store and send.
/// Ported from `client/src/pencil/geometry.ts`.
public enum StrokeEditing {
    /// The partial eraser: takes out the parts of a stroke the eraser passed over, and leaves the rest.
    ///
    /// Nil when the eraser never came near the stroke — which is the common case and has to stay cheap. Otherwise the
    /// pieces that remain, possibly none at all.
    ///
    /// The ends of each remaining piece are placed on the edge of the eraser rather than at the nearest recorded
    /// point, so the cut lands where the child put it. Without that, rubbing out the middle of a long letter would
    /// take the whole letter, and a child correcting one mistake would lose the line they were happy with.
    public static func split(_ points: [InkPoint], eraser: [Pt], radius: Double) -> [[InkPoint]]? {
        guard let strokeBox = Geometry.boundingBox(points),
              let eraserBox = Geometry.boundingBox(eraser),
              strokeBox.expanded(by: radius).intersects(eraserBox)
        else { return nil }

        // Only the eraser segments near this stroke matter, so a long sweep across the page stays cheap.
        let near = strokeBox.expanded(by: radius)
        var segments: [(Pt, Pt)] = []
        if eraser.count == 1 {
            segments.append((eraser[0], eraser[0]))
        } else {
            for index in 1..<eraser.count {
                let a = eraser[index - 1]
                let b = eraser[index]
                let box = Box(
                    minX: min(a.x, b.x), minY: min(a.y, b.y), maxX: max(a.x, b.x), maxY: max(a.y, b.y)
                )
                if box.intersects(near) { segments.append((a, b)) }
            }
        }
        guard !segments.isEmpty else { return nil }

        func isRubbedOut(_ p: Pt) -> Bool {
            segments.contains { Geometry.distanceToSegment(p, $0.0, $0.1) <= radius }
        }
        if points.count == 1 { return isRubbedOut(Pt(points[0])) ? [] : nil }

        let dense = Geometry.densify(points, maxStep: max(radius / 2, 0.25))
        let flags = dense.map { isRubbedOut(Pt($0)) }
        guard flags.contains(true) else { return nil }

        /// Walks in from the point that survived towards the one that did not, to find the eraser's edge between
        /// them. Ten halvings is well under a pixel at any size a child draws at.
        func boundary(from outside: InkPoint, to inside: InkPoint) -> InkPoint {
            var low = 0.0
            var high = 1.0
            for _ in 0..<10 {
                let mid = (low + high) / 2
                if isRubbedOut(Pt(Geometry.lerp(outside, inside, mid))) { high = mid } else { low = mid }
            }
            return Geometry.lerp(outside, inside, low)
        }

        var fragments: [[InkPoint]] = []
        var current: [InkPoint] = []
        for index in dense.indices {
            let point = dense[index]
            if flags[index] {
                if !current.isEmpty {
                    current.append(boundary(from: dense[index - 1], to: point))
                    fragments.append(current)
                    current = []
                }
                continue
            }
            if index > 0, flags[index - 1] {
                current.append(boundary(from: point, to: dense[index - 1]))
            }
            current.append(point)
        }
        if !current.isEmpty { fragments.append(current) }

        // A fragment of two points a hair apart is a speck the child cannot see and cannot rub out either.
        return fragments
            .filter { $0.count >= 2 && Geometry.pathLength($0.map(Pt.init)) > max(radius * 0.1, 0.5) }
            .map(dedupe)
    }

    private static func dedupe(_ points: [InkPoint]) -> [InkPoint] {
        var out: [InkPoint] = []
        for point in points {
            if let last = out.last, last.x == point.x, last.y == point.y { continue }
            out.append(point)
        }
        return out
    }

    /// Ramer–Douglas–Peucker, which also keeps the points where the pressure changed.
    ///
    /// Pressure is part of what a stroke looks like — it is what makes a pencil line thin at the start of a letter
    /// and thick in the middle. Simplifying on position alone would flatten that and hand the child back a line that
    /// is not the one they drew.
    ///
    /// Iterative rather than recursive: a child colouring a whole page in one go produces strokes long enough to
    /// overflow the stack.
    public static func simplify(_ points: [InkPoint], epsilon: Double, pressureEpsilon: Double = 0.05) -> [InkPoint] {
        guard points.count > 2, epsilon > 0 else { return points }
        var keep = [Bool](repeating: false, count: points.count)
        keep[0] = true
        keep[points.count - 1] = true

        var stack: [(Int, Int)] = [(0, points.count - 1)]
        while let (start, end) = stack.popLast() {
            let a = points[start]
            let b = points[end]
            var worst = 0.0
            var worstIndex = -1

            guard start + 1 < end else { continue }
            for index in (start + 1)..<end {
                let point = points[index]
                let offTheLine = Geometry.distanceToSegment(Pt(point), Pt(a), Pt(b)) / epsilon
                let t = Double(index - start) / Double(end - start)
                let offThePressure = abs(point.p - (a.p + (b.p - a.p) * t)) / max(pressureEpsilon, 1e-9)
                let score = max(offTheLine, offThePressure)
                if score > worst {
                    worst = score
                    worstIndex = index
                }
            }
            if worstIndex != -1, worst > 1 {
                keep[worstIndex] = true
                stack.append((start, worstIndex))
                stack.append((worstIndex, end))
            }
        }
        return points.indices.filter { keep[$0] }.map { points[$0] }
    }

    /// Simplifies harder and harder until the stroke is short enough.
    ///
    /// A hard ceiling rather than a best effort, because these travel through the sync: one scribble of ten thousand
    /// points would hold up every other change a child made that day.
    public static func capPointCount(_ points: [InkPoint], maxPoints: Int, epsilon: Double) -> [InkPoint] {
        var eps = max(epsilon, 1e-6)
        var out = simplify(points, epsilon: eps)
        // Pressure stops being protected here: past this point the shape matters more than the shading.
        while out.count > maxPoints, eps.isFinite {
            eps *= 2
            let next = simplify(out, epsilon: eps, pressureEpsilon: 1)
            if next.count == out.count { break }
            out = next
        }
        return out
    }
}
