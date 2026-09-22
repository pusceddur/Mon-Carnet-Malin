import CarnetKit
import SwiftUI

/// « Règle de lecture »: a clear band over the line being read, the rest of the page slightly dimmed.
///
/// It stands in for the ruler or the finger a child slides under the line on paper. The rest is dimmed only a
/// little — enough that the eye settles on the band, not so much that the next line cannot be seen coming.
///
/// It follows the voice while the page is read aloud, jumps to a word the child taps, and can be dragged by its
/// handle. Nothing else on the page reacts to it: a ruler that got in the way of tapping words would be switched off.
struct ReadingGuideBand: View {
    @Binding var top: CGFloat
    let height: CGFloat
    let palette: ReaderPalette

    @State private var dragStart: CGFloat?

    var body: some View {
        GeometryReader { geometry in
            let total = geometry.size.height
            let clampedTop = min(max(0, top), max(0, total - height))

            ZStack(alignment: .topLeading) {
                // Above and below: dimmed, and transparent to touches.
                palette.ink.opacity(0.07)
                    .frame(height: clampedTop)
                    .allowsHitTesting(false)
                palette.ink.opacity(0.07)
                    .frame(height: max(0, total - clampedTop - height))
                    .offset(y: clampedTop + height)
                    .allowsHitTesting(false)

                // The band itself: an outline, no fill, so the colours of the reading aids stay exactly as they are.
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(palette.guideLine, lineWidth: 2)
                    .frame(height: height)
                    .offset(y: clampedTop)
                    .allowsHitTesting(false)

                handle
                    .offset(x: geometry.size.width - 34, y: clampedTop + height / 2 - 22)
                    .gesture(
                        DragGesture()
                            .onChanged { value in
                                if dragStart == nil { dragStart = clampedTop }
                                top = min(max(0, (dragStart ?? 0) + value.translation.height), max(0, total - height))
                            }
                            .onEnded { _ in dragStart = nil }
                    )
            }
            .animation(.easeOut(duration: 0.18), value: clampedTop)
        }
    }

    private var handle: some View {
        Image(systemName: "line.3.horizontal")
            .font(.system(size: 16, weight: .bold))
            .foregroundStyle(palette.ink.opacity(0.7))
            .frame(width: 30, height: 44)
            .background(palette.guideLine)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
            .accessibilityLabel(FR.Reader.guideHandle)
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: top += height
                case .decrement: top = max(0, top - height)
                @unknown default: break
                }
            }
    }
}
