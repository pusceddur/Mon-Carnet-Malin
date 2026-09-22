import XCTest
@testable import CarnetKit

/// Lays out a page the way the reader would, so the anchoring can be tested without a screen.
/// Words are placed left to right at a fixed size, wrapping every `perLine` words.
enum FakeLayout {
    static let fontSize = 20.0
    static let lineHeight = 30.0
    static let charWidth = 10.0

    static func page(_ blockTexts: [String], pageIndex: Int = 0, perLine: Int = 4) -> TextLayout {
        var blocks: [BlockLayout] = []
        var words: [WordBox] = []
        var y = 0.0

        for (blockIndex, text) in blockTexts.enumerated() {
            blocks.append(BlockLayout(
                blockIndex: blockIndex,
                textHash: Anchoring.blockTextHash(text),
                text: text,
                fontSize: fontSize
            ))
            var x = 0.0
            for (position, token) in Tokenizer.tokenizeWords(text).enumerated() {
                if position > 0, position % perLine == 0 {
                    x = 0
                    y += lineHeight
                }
                let width = Double(token.word.utf16.count) * charWidth
                words.append(WordBox(
                    blockIndex: blockIndex,
                    charOffset: token.start,
                    length: token.end - token.start,
                    fontSize: fontSize,
                    rect: Rect(left: x, top: y, width: width, height: fontSize)
                ))
                x += width + charWidth
            }
            y += lineHeight * 2
        }
        return TextLayout(pageIndex: pageIndex, blocks: blocks, words: words)
    }

    static func content(_ blockTexts: [String], documentId: String = "doc-1") -> PageContent {
        let blocks = blockTexts.map { TextBlock(kind: .paragraph, text: $0) }
        return PageContent(
            documentId: documentId, pageIndex: 0, status: .ready, textSource: .pdfText,
            blocks: blocks, contentHash: Hashing.contentHash(of: blocks), updatedAt: 0
        )
    }
}

final class GeometryTests: XCTestCase {
    func testDistanceToASegment() {
        let a = Pt(x: 0, y: 0)
        let b = Pt(x: 10, y: 0)
        XCTAssertEqual(Geometry.distanceToSegment(Pt(x: 5, y: 3), a, b), 3, accuracy: 1e-9)
        XCTAssertEqual(Geometry.distanceToSegment(Pt(x: -4, y: 0), a, b), 4, accuracy: 1e-9)
        XCTAssertEqual(Geometry.distanceToSegment(Pt(x: 5, y: 0), a, b), 0, accuracy: 1e-9)
        // A segment of no length is a point.
        XCTAssertEqual(Geometry.distanceToSegment(Pt(x: 3, y: 4), a, a), 5, accuracy: 1e-9)
    }

    func testSegmentsThatCrossTouchOrLieAlongEachOther() {
        let a = Pt(x: 0, y: 0), b = Pt(x: 10, y: 10)
        XCTAssertTrue(Geometry.segmentsIntersect(a, b, Pt(x: 0, y: 10), Pt(x: 10, y: 0)))
        XCTAssertTrue(Geometry.segmentsIntersect(a, b, Pt(x: 5, y: 5), Pt(x: 20, y: 0)), "touching counts")
        XCTAssertTrue(Geometry.segmentsIntersect(a, b, Pt(x: 5, y: 5), Pt(x: 15, y: 15)), "overlapping counts")
        XCTAssertFalse(Geometry.segmentsIntersect(a, b, Pt(x: 0, y: 5), Pt(x: 3, y: 5)))
    }

    func testDistanceToARectangleIsZeroInside() {
        let rect = Rect(left: 10, top: 10, width: 20, height: 10)
        XCTAssertEqual(Geometry.distanceToRect(Pt(x: 15, y: 15), rect), 0)
        XCTAssertEqual(Geometry.distanceToRect(Pt(x: 10, y: 10), rect), 0, "the edge is inside")
        XCTAssertEqual(Geometry.distanceToRect(Pt(x: 5, y: 15), rect), 5, accuracy: 1e-9)
        XCTAssertEqual(Geometry.distanceToRect(Pt(x: 6, y: 6), rect), (32.0).squareRoot(), accuracy: 1e-9)
    }

    func testTheEraserReachesAStrokeByItsDrawnWidthNotItsLine() {
        // A thick stroke is rubbed out by an eraser passing beside its line but over its ink.
        let stroke = [Pt(x: 0, y: 0), Pt(x: 100, y: 0)]
        let eraser = [Pt(x: 50, y: 9), Pt(x: 60, y: 9)]
        XCTAssertTrue(Geometry.hitTestStroke(stroke: stroke, strokeWidth: 12, eraser: eraser, eraserRadius: 4))
        XCTAssertFalse(Geometry.hitTestStroke(stroke: stroke, strokeWidth: 1, eraser: eraser, eraserRadius: 4))
    }

    func testAFarAwayStrokeIsRejectedWithoutMeasuringIt() {
        let stroke = [Pt(x: 0, y: 0), Pt(x: 10, y: 0)]
        let eraser = [Pt(x: 900, y: 900), Pt(x: 910, y: 900)]
        XCTAssertFalse(Geometry.hitTestStroke(stroke: stroke, strokeWidth: 4, eraser: eraser, eraserRadius: 8))
    }

    func testNothingIsHitByNothing() {
        XCTAssertFalse(Geometry.hitTestStroke(stroke: [], strokeWidth: 4, eraser: [Pt(x: 0, y: 0)], eraserRadius: 4))
        XCTAssertEqual(Geometry.distanceToPolyline(Pt(x: 0, y: 0), []), .infinity)
        XCTAssertNil(Geometry.boundingBox([Pt]()))
    }

    func testPointsAreAddedAlongALongSegment() {
        let dense = Geometry.densify([InkPoint(x: 0, y: 0, p: 0), InkPoint(x: 10, y: 0, p: 1)], maxStep: 2)
        XCTAssertEqual(dense.count, 6)
        XCTAssertEqual(dense.first?.x, 0)
        XCTAssertEqual(dense.last?.x, 10)
        // The pressure is carried along with the position.
        XCTAssertEqual(dense[3].p, 0.6, accuracy: 1e-9)
    }
}

final class StrokeEditingTests: XCTestCase {
    private func straightLine(from x0: Double, to x1: Double, y: Double = 0, step: Double = 5) -> [InkPoint] {
        stride(from: x0, through: x1, by: step).map { InkPoint(x: $0, y: y, p: 0.5) }
    }

    func testAStrokeTheEraserNeverTouchedIsLeftAlone() {
        XCTAssertNil(StrokeEditing.split(straightLine(from: 0, to: 100), eraser: [Pt(x: 0, y: 500)], radius: 5))
    }

    func testRubbingOutTheMiddleLeavesTheTwoEnds() throws {
        // A child correcting one mistake in the middle of a long letter keeps the line they were happy with.
        let fragments = try XCTUnwrap(StrokeEditing.split(
            straightLine(from: 0, to: 100), eraser: [Pt(x: 50, y: 0)], radius: 10
        ))
        XCTAssertEqual(fragments.count, 2)
        XCTAssertEqual(fragments[0].first?.x, 0)
        XCTAssertEqual(fragments[1].last?.x, 100)
        // The cut lands on the edge of the eraser, where the child put it, not at the nearest recorded point.
        XCTAssertEqual(fragments[0].last?.x ?? 0, 40, accuracy: 0.5)
        XCTAssertEqual(fragments[1].first?.x ?? 0, 60, accuracy: 0.5)
    }

    func testRubbingOutTheWholeStrokeLeavesNothing() {
        let pieces = StrokeEditing.split(
            straightLine(from: 0, to: 20), eraser: [Pt(x: -10, y: 0), Pt(x: 30, y: 0)], radius: 15
        )
        XCTAssertEqual(pieces?.count, 0, "touched, and nothing is left")
    }

    func testASpeckTooSmallToSeeIsNotLeftBehind() {
        // Everything is rubbed out but a tenth of a unit at the very start — something the child can neither see
        // nor rub out again. It goes with the rest.
        let pieces = StrokeEditing.split(
            straightLine(from: 0, to: 100, step: 1), eraser: [Pt(x: 0.3, y: 0), Pt(x: 200, y: 0)], radius: 0.2
        )
        XCTAssertEqual(pieces?.count, 0)
    }

    func testASingleDot() {
        XCTAssertEqual(StrokeEditing.split([InkPoint(x: 0, y: 0)], eraser: [Pt(x: 1, y: 0)], radius: 5)?.count, 0)
        XCTAssertNil(StrokeEditing.split([InkPoint(x: 0, y: 0)], eraser: [Pt(x: 50, y: 0)], radius: 5))
    }

    func testSimplifyingKeepsTheEndsAndTheCorners() {
        let points = [
            InkPoint(x: 0, y: 0), InkPoint(x: 5, y: 0.01), InkPoint(x: 10, y: 0),
            InkPoint(x: 15, y: 20), InkPoint(x: 20, y: 40),
        ]
        let simplified = StrokeEditing.simplify(points, epsilon: 1)
        XCTAssertEqual(simplified.first, points.first)
        XCTAssertEqual(simplified.last, points.last)
        XCTAssertLessThan(simplified.count, points.count)
        XCTAssertTrue(simplified.contains(InkPoint(x: 10, y: 0)), "the corner is what makes the shape")
    }

    func testAChangeOfPressureIsKeptEvenOnAStraightLine() {
        // Pressure is what makes a pencil line thin at the start of a letter and thick in the middle. Flattening it
        // would hand the child back a line that is not the one they drew.
        let points = [
            InkPoint(x: 0, y: 0, p: 0.1), InkPoint(x: 5, y: 0, p: 0.9), InkPoint(x: 10, y: 0, p: 0.1),
        ]
        XCTAssertEqual(StrokeEditing.simplify(points, epsilon: 1).count, 3)
        // Unless nobody pressed differently.
        let flat = [InkPoint(x: 0, y: 0, p: 0.5), InkPoint(x: 5, y: 0, p: 0.5), InkPoint(x: 10, y: 0, p: 0.5)]
        XCTAssertEqual(StrokeEditing.simplify(flat, epsilon: 1).count, 2)
    }

    func testAScribbleIsBroughtUnderTheCeiling() {
        // These travel through the sync: one stroke of ten thousand points would hold up a whole day's work.
        let scribble = (0..<4000).map {
            InkPoint(x: Double($0) * 0.3, y: sin(Double($0) / 7) * 20, p: 0.5)
        }
        let capped = StrokeEditing.capPointCount(scribble, maxPoints: 300, epsilon: 0.5)
        XCTAssertLessThanOrEqual(capped.count, 300)
        XCTAssertGreaterThan(capped.count, 2)
        XCTAssertEqual(capped.first, scribble.first)
        XCTAssertEqual(capped.last, scribble.last)
    }

    func testAnImpossibleCeilingStopsInsteadOfLoopingForever() {
        let points = (0..<50).map { InkPoint(x: Double($0), y: 0) }
        XCTAssertGreaterThanOrEqual(StrokeEditing.capPointCount(points, maxPoints: 1, epsilon: 0.5).count, 2)
    }
}

final class AnchoringTests: XCTestCase {
    private let text = "Le renard traverse la clairière pendant la nuit tranquille."
    private lazy var layout = FakeLayout.page([text])
    private lazy var source = BlockTextSource(layout: layout, page: FakeLayout.content([text]))

    func testAStrokeComesBackWhereItWasDrawn() throws {
        // Anchored and resolved in an unchanged layout, the geometry must be exact.
        let drawn = [
            InkPoint(x: 100, y: 12, p: 0.4), InkPoint(x: 140, y: 14, p: 0.6), InkPoint(x: 180, y: 12, p: 0.5),
        ]
        let anchored = try XCTUnwrap(Anchoring.anchorToText(points: drawn, width: 3, layout: layout, source: source))
        let space = anchored.space
        guard case let .text(_, blockIndex, charOffset, _, _, endAnchor) = space else {
            return XCTFail("a stroke over words is anchored to text")
        }
        XCTAssertEqual(blockIndex, 0)
        XCTAssertNil(endAnchor, "one line, one anchor")

        let resolved = try XCTUnwrap(Anchoring.resolveTextStroke(
            anchor: Anchoring.TextAnchorRef(blockIndex: blockIndex, charOffset: charOffset),
            points: anchored.points, width: anchored.width, layout: layout
        ))
        for (original, restored) in zip(drawn, resolved.points) {
            XCTAssertEqual(restored.x, original.x, accuracy: 0.01)
            XCTAssertEqual(restored.y, original.y, accuracy: 0.01)
        }
        XCTAssertEqual(resolved.width, 3, accuracy: 0.01)
    }

    func testTheStrokeIsStoredInEmSoItFollowsTheTextSize() throws {
        let drawn = [InkPoint(x: 100, y: 10), InkPoint(x: 120, y: 10)]
        let anchored = try XCTUnwrap(Anchoring.anchorToText(points: drawn, width: 10, layout: layout, source: source))
        // The width was ten points at a twenty-point font: half an em, whatever size the child later chooses.
        XCTAssertEqual(anchored.width, 0.5, accuracy: 1e-6)
    }

    func testAStrokeCrossingLinesIsHeldByBothItsEnds() throws {
        // A bracket down a margin, a line joining two ideas: after a reflow it has to stretch between the same two
        // words rather than lie across whatever is there.
        let first = layout.words[0]
        let later = try XCTUnwrap(layout.words.first { !TextLayout.sameLine($0, first) })
        let drawn = [
            InkPoint(x: first.left + 2, y: first.top + 2),
            InkPoint(x: later.left + 2, y: later.top + 2),
        ]
        let anchored = try XCTUnwrap(Anchoring.anchorToText(points: drawn, width: 2, layout: layout, source: source))
        guard case let .text(_, blockIndex, charOffset, _, _, endAnchor) = anchored.space else {
            return XCTFail("anchored to text")
        }
        let end = try XCTUnwrap(endAnchor, "a stroke across two lines carries a second anchor")
        XCTAssertEqual(charOffset, first.charOffset)
        XCTAssertEqual(end.charOffset, later.charOffset)

        let resolved = try XCTUnwrap(Anchoring.resolveTextStroke(
            anchor: Anchoring.TextAnchorRef(blockIndex: blockIndex, charOffset: charOffset, endAnchor: end),
            points: anchored.points, width: anchored.width, layout: layout
        ))
        XCTAssertEqual(resolved.points.first?.x ?? 0, drawn[0].x, accuracy: 0.01)
        XCTAssertEqual(resolved.points.last?.y ?? 0, drawn[1].y, accuracy: 0.01)
    }

    func testAMissingEndWordLeavesTheStrokeHangingFromItsFirstAnchorRatherThanVanishing() throws {
        let drawn = [InkPoint(x: 0, y: 0), InkPoint(x: 10, y: 40)]
        let anchored = try XCTUnwrap(Anchoring.anchorToText(points: drawn, width: 2, layout: layout, source: source))
        guard case let .text(_, blockIndex, charOffset, _, _, _) = anchored.space else { return XCTFail("text") }
        let resolved = Anchoring.resolveTextStroke(
            anchor: Anchoring.TextAnchorRef(
                blockIndex: blockIndex, charOffset: charOffset,
                endAnchor: TextEndAnchor(blockIndex: 9, charOffset: 9999)
            ),
            points: anchored.points, width: anchored.width, layout: layout
        )
        XCTAssertNotNil(resolved, "wrong by a little beats gone entirely")
    }

    func testAStrokeOnAPageWithNoWordsCannotBeAnchored() {
        let empty = TextLayout(pageIndex: 0, blocks: [], words: [])
        let emptySource = BlockTextSource(layout: empty, page: nil)
        XCTAssertNil(Anchoring.anchorToText(
            points: [InkPoint(x: 0, y: 0)], width: 1, layout: empty, source: emptySource
        ))
    }

    func testTheContextKeptIsTheAnchorWordAndTheFewAfterIt() {
        // One word would not say which « la » the child meant; many would be more likely to have changed.
        let context = Anchoring.buildContextText(text, 3)
        XCTAssertTrue(context.hasPrefix("renard"))
        XCTAssertLessThanOrEqual(Tokenizer.countWords(context), Anchoring.contextWords)
        XCTAssertTrue(text.contains(context))
    }

    func testTheContextNearTheEndOfABlockIsWhatIsLeft() {
        let context = Anchoring.buildContextText(text, text.utf16.count - 6)
        XCTAssertFalse(context.isEmpty)
        XCTAssertTrue(text.contains(context))
    }

    // MARK: - The page image and the answer box

    func testThePageImageKeepsItsProportionsAndIsCentred() {
        let frame = Anchoring.fitPageFrame(
            surfaceWidth: 1000, surfaceHeight: 1000, imageSize: (width: 600, height: 900)
        )
        XCTAssertEqual(frame.height, 1000, accuracy: 1e-9)
        XCTAssertEqual(frame.width, 666.6666, accuracy: 0.01)
        XCTAssertEqual(frame.left, (1000 - frame.width) / 2, accuracy: 1e-9)
        XCTAssertEqual(frame.top, 0)
    }

    func testWithoutAnImageTheWholeSurfaceIsThePage() {
        let frame = Anchoring.fitPageFrame(surfaceWidth: 800, surfaceHeight: 600, imageSize: nil)
        XCTAssertEqual(frame.width, 800)
        XCTAssertEqual(frame.height, 600)
    }

    func testAMarkOnAScanComesBackWhereItWasPut() throws {
        let frame = Anchoring.fitPageFrame(
            surfaceWidth: 1000, surfaceHeight: 1000, imageSize: (width: 500, height: 1000)
        )
        let drawn = [InkPoint(x: 300, y: 200, p: 0.5), InkPoint(x: 600, y: 700, p: 0.9)]
        let stored = try XCTUnwrap(Anchoring.toOriginalSpace(points: drawn, width: 5, frame: frame))
        for point in stored.points {
            XCTAssertTrue((0...1).contains(point.x))
            XCTAssertTrue((0...1).contains(point.y))
        }
        let back = Anchoring.fromOriginalSpace(points: stored.points, width: stored.width, frame: frame)
        for (original, restored) in zip(drawn, back.points) {
            XCTAssertEqual(restored.x, original.x, accuracy: 0.05)
            XCTAssertEqual(restored.y, original.y, accuracy: 0.05)
        }
    }

    func testAnAnswerKeepsItsShapeWhenItsBoxGrowsTaller() throws {
        // Both coordinates are fractions of the WIDTH. Measuring the vertical against the height would squash what
        // the child had already written every time the box grew under their hand.
        let drawn = [InkPoint(x: 20, y: 10), InkPoint(x: 60, y: 50)]
        let stored = try XCTUnwrap(Anchoring.toAnswerSpace(points: drawn, width: 2, boxWidth: 200))
        let back = Anchoring.fromAnswerSpace(points: stored.points, width: stored.width, boxWidth: 200)
        for (original, restored) in zip(drawn, back.points) {
            XCTAssertEqual(restored.x, original.x, accuracy: 0.01)
            XCTAssertEqual(restored.y, original.y, accuracy: 0.01)
        }
        // At double the width, everything scales together and the writing keeps its proportions.
        let wider = Anchoring.fromAnswerSpace(points: stored.points, width: stored.width, boxWidth: 400)
        XCTAssertEqual(wider.points[1].x - wider.points[0].x, (drawn[1].x - drawn[0].x) * 2, accuracy: 0.05)
        XCTAssertEqual(wider.points[1].y - wider.points[0].y, (drawn[1].y - drawn[0].y) * 2, accuracy: 0.05)
    }

    func testABoxWithNoWidthIsRefusedRatherThanDividedBy() {
        XCTAssertNil(Anchoring.toAnswerSpace(points: [InkPoint(x: 1, y: 1)], width: 1, boxWidth: 0))
        XCTAssertNil(Anchoring.toOriginalSpace(
            points: [InkPoint(x: 1, y: 1)], width: 1,
            frame: Anchoring.PageFrame(left: 0, top: 0, width: 0, height: 0)
        ))
    }
}

final class HighlightingTests: XCTestCase {
    private let text = "Le renard traverse la clairière pendant la nuit tranquille."
    private lazy var layout = FakeLayout.page([text], perLine: 100)
    private lazy var source = BlockTextSource(layout: layout, page: FakeLayout.content([text]))

    func testTheWordsASweepReallyWentThrough() {
        let first = layout.words[1]
        let third = layout.words[3]
        let stroke = [
            Pt(x: first.left + 1, y: first.top + first.height / 2),
            Pt(x: third.rect.right - 1, y: third.top + third.height / 2),
        ]
        let crossed = layout.wordsCrossed(by: stroke).map(\.charOffset)
        XCTAssertEqual(crossed, [first.charOffset, layout.words[2].charOffset, third.charOffset])
    }

    func testClippingTheEdgeOfALineDoesNotColourIt() {
        // Colouring in two lines when the child meant one is worse than colouring neither.
        let wrapped = FakeLayout.page([text], perLine: 3)
        let secondLine = wrapped.words[3]
        let justAbove = [
            Pt(x: secondLine.left, y: secondLine.top - 0.5),
            Pt(x: secondLine.rect.right, y: secondLine.top - 0.5),
        ]
        XCTAssertFalse(wrapped.wordsCrossed(by: justAbove).contains { $0.charOffset == secondLine.charOffset })
    }

    func testAHighlightRunsFromTheFirstWordToTheLast() {
        // A child sweeping across a line does not touch every word evenly, and a highlight full of gaps is not
        // what they meant to make.
        let words = [layout.words[1], layout.words[4]]
        let ranges = Highlighting.ranges(from: words, pageIndex: 0, source: source)
        XCTAssertEqual(ranges.count, 1)
        XCTAssertEqual(ranges[0].start, layout.words[1].charOffset)
        XCTAssertEqual(ranges[0].end, layout.words[4].endOffset)
        XCTAssertEqual(ranges[0].text, "renard traverse la clairière")
    }

    func testEachBlockGetsItsOwnRange() {
        let twoBlocks = FakeLayout.page(["Le chat dort.", "Le chien joue."], perLine: 100)
        let twoSource = BlockTextSource(layout: twoBlocks, page: FakeLayout.content(["Le chat dort.", "Le chien joue."]))
        let ranges = Highlighting.ranges(from: twoBlocks.words, pageIndex: 0, source: twoSource)
        XCTAssertEqual(ranges.map(\.blockIndex), [0, 1])
        XCTAssertEqual(ranges[0].text, "Le chat dort")
        XCTAssertEqual(ranges[1].text, "Le chien joue")
    }

    func testTheEraserTakesBackOneWordAndKeepsTheRest() throws {
        let words = layout.blocks[0]?.words ?? []
        let target = words[2]
        let path = [
            Pt(x: target.left + 1, y: target.top + target.height / 2),
            Pt(x: target.rect.right - 1, y: target.top + target.height / 2),
        ]
        let remaining = try XCTUnwrap(Highlighting.erase(
            highlight: (blockIndex: 0, start: words[0].charOffset, end: words[4].endOffset),
            layout: layout, eraserPath: path, radius: 2, mode: .partial
        ))
        XCTAssertEqual(remaining.count, 2, "one word taken out of the middle leaves two pieces")
        XCTAssertEqual(remaining[0].start, words[0].charOffset)
        XCTAssertEqual(remaining[1].end, words[4].endOffset)
    }

    func testInStrokeModeTheWholeHighlightGoes() throws {
        let words = layout.blocks[0]?.words ?? []
        let target = words[2]
        let path = [Pt(x: target.left + 1, y: target.top + 1)]
        let remaining = try XCTUnwrap(Highlighting.erase(
            highlight: (blockIndex: 0, start: words[0].charOffset, end: words[4].endOffset),
            layout: layout, eraserPath: path, radius: 4, mode: .stroke
        ))
        XCTAssertTrue(remaining.isEmpty)
    }

    func testAHighlightTheEraserMissedIsLeftAlone() {
        XCTAssertNil(Highlighting.erase(
            highlight: (blockIndex: 0, start: 0, end: 10),
            layout: layout, eraserPath: [Pt(x: 0, y: 5000)], radius: 4, mode: .partial
        ))
    }
}

final class ReanchorTests: XCTestCase {
    private let original = "Le renard traverse la clairière pendant la nuit tranquille."
    private let second = "Un hibou observe la forêt depuis sa branche préférée."

    private func highlight(start: Int, end: Int, in text: String, blockIndex: Int = 0) -> TextHighlight {
        let units = Array(text.utf16)
        return TextHighlight(
            id: "h1", childId: "c1", documentId: "d1", color: "#FFD97A", pageIndex: 0, blockIndex: blockIndex,
            start: start, end: end, blockTextHash: Anchoring.blockTextHash(text),
            text: String(decoding: units[start..<end], as: UTF16.self),
            createdAt: 0, updatedAt: 0
        )
    }

    func testAnUntouchedPageLeavesEverythingWhereItIs() {
        let page = FakeLayout.content([original, second])
        let mark = highlight(start: 3, end: 9, in: original)
        XCTAssertEqual(Reanchor.find(.highlight(mark), in: page), .found(blockIndex: 0, start: 3, end: 9))
    }

    func testATypoFixedElsewhereInTheBlockDoesNotMoveTheMark() {
        // The most common case by far: a parent corrects one word and every other mark on the page must stay put.
        let corrected = "Le renard traverse la clairière pendant la nuit tranquile."
        let page = FakeLayout.content([corrected])
        let mark = highlight(start: 3, end: 9, in: original)
        XCTAssertEqual(Reanchor.find(.highlight(mark), in: page), .found(blockIndex: 0, start: 3, end: 9))
    }

    func testAMarkFollowsItsWordsWhenTextIsInsertedBeforeThem() {
        let expanded = "Ce soir-là, le renard traverse la clairière pendant la nuit tranquille."
        let page = FakeLayout.content([expanded])
        let mark = highlight(start: 10, end: 18, in: original) // « traverse »
        guard case let .found(blockIndex, start, end) = Reanchor.find(.highlight(mark), in: page) else {
            return XCTFail("the words are still there, further along")
        }
        XCTAssertEqual(blockIndex, 0)
        let units = Array(expanded.utf16)
        XCTAssertEqual(String(decoding: units[start..<end], as: UTF16.self), "traverse")
    }

    func testAMarkFollowsItsWordsIntoAnotherBlock() {
        // A page re-read with the paragraphs split differently.
        let page = FakeLayout.content(["Un titre.", "Le renard traverse la clairière pendant la nuit tranquille."])
        let mark = highlight(start: 3, end: 9, in: original)
        guard case let .found(blockIndex, start, _) = Reanchor.find(.highlight(mark), in: page) else {
            return XCTFail("found in the next block")
        }
        XCTAssertEqual(blockIndex, 1)
        XCTAssertEqual(start, 3)
    }

    func testTextThatIsSimplyGoneMakesAnOrphan() {
        let page = FakeLayout.content(["Une page entièrement différente, sur un tout autre sujet."])
        let mark = highlight(start: 3, end: 9, in: original)
        XCTAssertEqual(Reanchor.find(.highlight(mark), in: page), .orphan)
    }

    func testAPageWithNoTextYetIsNotAPageThatLostTheMark() {
        // A book still being read would otherwise declare every mark on it an orphan while the pages arrive.
        let pending = PageContent(documentId: "d1", pageIndex: 0, status: .pending, updatedAt: 0)
        let mark = Annotation.highlight(highlight(start: 3, end: 9, in: original))
        XCTAssertFalse(Reanchor.isOrphan(mark, on: pending))
        XCTAssertFalse(Reanchor.isOrphan(mark, on: nil))
        XCTAssertTrue(Reanchor.isOrphan(mark, on: FakeLayout.content(["Rien à voir avec ce texte-là."])))
    }

    func testTheNearestOfSeveralIdenticalPassagesWins() {
        // « la nuit » appears twice; the one the child marked is the one near where they marked it.
        let repeated = "La nuit tombe. Le renard traverse la clairière pendant la nuit tranquille."
        let page = FakeLayout.content([repeated])
        let units = Array(repeated.utf16)
        let secondOccurrence = 55
        let mark = highlight(start: secondOccurrence, end: secondOccurrence + 7, in: repeated)
        XCTAssertEqual(String(decoding: units[55..<62], as: UTF16.self), "la nuit")

        let moved = "Un mot de plus. " + repeated
        guard case let .found(_, start, _) = Reanchor.find(.highlight(mark), in: FakeLayout.content([moved])) else {
            return XCTFail("found")
        }
        XCTAssertEqual(start, secondOccurrence + 16, "the later one, not the one at the start of the page")
    }

    func testAMovedHighlightCarriesItsNewTextAndHash() throws {
        let expanded = "Ce soir-là, le renard traverse la clairière pendant la nuit tranquille."
        let page = FakeLayout.content([expanded])
        let mark = Annotation.highlight(highlight(start: 10, end: 18, in: original))
        let moved = try XCTUnwrap(Reanchor.move(mark, from: nil, to: page))
        guard case let .highlight(updated) = moved else { return XCTFail("still a highlight") }
        XCTAssertEqual(updated.text, "traverse")
        XCTAssertEqual(updated.blockTextHash, Anchoring.blockTextHash(expanded))
        XCTAssertNotEqual(updated.start, 10)
    }

    func testAnUnchangedAnnotationIsHandedBackAsItIs() throws {
        let page = FakeLayout.content([original])
        let mark = Annotation.highlight(highlight(start: 3, end: 9, in: original))
        XCTAssertEqual(try XCTUnwrap(Reanchor.move(mark, from: nil, to: page)), mark)
    }

    func testAnOrphanIsNotMovedAndNotDestroyed() {
        // `move` returning nil means « leave it alone and list it in Mes notes », never « delete it ».
        let page = FakeLayout.content(["Un texte sans aucun rapport avec celui d’avant."])
        let mark = Annotation.highlight(highlight(start: 3, end: 9, in: original))
        XCTAssertNil(Reanchor.move(mark, from: nil, to: page))
    }

    func testAStrokeFollowsItsAnchorWord() throws {
        let layout = FakeLayout.page([original])
        let source = BlockTextSource(layout: layout, page: FakeLayout.content([original]))
        let word = try XCTUnwrap(layout.words.first { $0.charOffset == 10 })
        let anchored = try XCTUnwrap(Anchoring.anchorToText(
            points: [InkPoint(x: word.left + 2, y: word.top + 2), InkPoint(x: word.rect.right, y: word.top + 2)],
            width: 2, layout: layout, source: source
        ))

        let ink = InkAnnotation(
            id: "i1", childId: "c1", documentId: "d1", tool: .pencil, color: "#1D4ED8",
            width: anchored.width, opacity: 1, space: anchored.space, points: anchored.points,
            createdAt: 0, updatedAt: 0
        )
        let expanded = "Ce soir-là, le renard traverse la clairière pendant la nuit tranquille."
        let moved = try XCTUnwrap(Reanchor.move(.ink(ink), from: nil, to: FakeLayout.content([expanded])))
        guard case let .ink(updated) = moved, case let .text(_, _, charOffset, _, _, _) = updated.space else {
            return XCTFail("still an ink stroke anchored to text")
        }
        let units = Array(expanded.utf16)
        XCTAssertEqual(
            String(decoding: units[charOffset..<(charOffset + 8)], as: UTF16.self), "traverse",
            "the stroke is now on the same word, further along the line"
        )
    }

    func testABoxOnAScanIsNeverReanchored() {
        let box = Annotation.textBox(TextBoxAnnotation(
            id: "t1", childId: "c1", documentId: "d1", pageIndex: 0, x: 0.1, y: 0.2, width: 0.5,
            fontSize: 0.03, color: "#111827", text: "ma réponse", createdAt: 0, updatedAt: 0
        ))
        XCTAssertFalse(box.isTextAnchored)
        XCTAssertEqual(Reanchor.move(box, from: nil, to: FakeLayout.content(["autre chose"])), box)
    }

    func testBlocksAreSearchedNearestFirst() {
        XCTAssertEqual(Reanchor.blockOrder(count: 5, origin: 2), [2, 3, 1, 4, 0])
        XCTAssertEqual(Reanchor.blockOrder(count: 3, origin: 0), [0, 1, 2])
        XCTAssertEqual(Reanchor.blockOrder(count: 3, origin: 9), [2, 1, 0])
        XCTAssertEqual(Reanchor.blockOrder(count: 0, origin: 0), [])
    }

    func testHowCloseTwoStretchesOfTextHaveToBe() {
        XCTAssertEqual(Reanchor.similarity(["a", "b", "c"], ["a", "b", "c"]), 1)
        XCTAssertEqual(Reanchor.similarity(["a", "b", "c", "d"], ["a", "b", "c"]), 0.75, accuracy: 1e-9)
        XCTAssertEqual(Reanchor.similarity([], []), 0)
    }
}

final class AnnotationWireFormatTests: XCTestCase {
    func testAStrokeIsWrittenTheWayTheServerStoresIt() throws {
        let ink = InkAnnotation(
            id: "i1", childId: "c1", documentId: "d1", tool: .highlighter, color: "#FFD97A", width: 0.5,
            opacity: 0.4,
            space: .text(
                pageIndex: 2, blockIndex: 1, charOffset: 42, blockTextHash: "abc",
                contextText: "le renard traverse", endAnchor: TextEndAnchor(blockIndex: 1, charOffset: 80)
            ),
            points: [InkPoint(x: 0.5, y: -0.25, p: 0.8)],
            createdAt: 1, updatedAt: 2
        )
        let json = try XCTUnwrap(String(data: try JSONEncoder().encode(ink), encoding: .utf8))
        XCTAssertTrue(json.contains("\"type\":\"ink\""))
        XCTAssertTrue(json.contains("\"kind\":\"text\""))
        XCTAssertTrue(json.contains("\"p\":0.8"), "pressure is one letter on the wire")
        XCTAssertEqual(try JSONDecoder().decode(InkAnnotation.self, from: try JSONEncoder().encode(ink)), ink)
    }

    func testAllThreeKindsSurviveBeingWrittenAndReadBack() throws {
        let annotations: [Annotation] = [
            .ink(InkAnnotation(
                id: "i1", childId: "c1", documentId: nil, tool: .pen, color: "#000000", width: 0.1, opacity: 1,
                space: .answer(exerciseId: "e1", questionId: "q1"),
                points: [InkPoint(x: 0, y: 0, p: 0.5)], createdAt: 1, updatedAt: 2
            )),
            .ink(InkAnnotation(
                id: "i2", childId: "c1", documentId: "d1", tool: .pencil, color: "#111111", width: 0.02, opacity: 1,
                space: .original(pageIndex: 3), points: [InkPoint(x: 0.5, y: 0.5, p: 1)], createdAt: 1, updatedAt: 2
            )),
            .highlight(TextHighlight(
                id: "h1", childId: "c1", documentId: "d1", color: "#FFD97A", pageIndex: 0, blockIndex: 1,
                start: 3, end: 9, blockTextHash: "abc", text: "renard", createdAt: 1, updatedAt: 2
            )),
            .textBox(TextBoxAnnotation(
                id: "t1", childId: "c1", documentId: "d1", pageIndex: 0, x: 0.1, y: 0.2, width: 0.5,
                fontSize: 0.03, color: "#111827", text: "ma réponse", createdAt: 1, updatedAt: 2
            )),
        ]
        for annotation in annotations {
            let data = try JSONEncoder().encode(annotation)
            XCTAssertEqual(try JSONDecoder().decode(Annotation.self, from: data), annotation)
            let json = try XCTUnwrap(String(data: data, encoding: .utf8))
            XCTAssertTrue(json.contains("\"type\":\"\(annotation.type)\""))
        }
    }

    func testAnAnnotationOfAKindTheAppDoesNotKnowIsRefusedRatherThanGuessed() {
        let json = Data("{\"type\":\"sticker\",\"id\":\"x\"}".utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(Annotation.self, from: json))
    }
}
