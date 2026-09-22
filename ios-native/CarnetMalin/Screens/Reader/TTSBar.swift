import CarnetKit
import SwiftUI

/// The bar that appears when the book is being read aloud.
///
/// It is a bar and not a menu because the child needs the same three buttons in the same place every time: back,
/// pause, forward. Looking for a control is the sort of interruption that loses the thread of a sentence.
struct TTSBar: View {
    /// §22 « Préparer la lecture » for the page on screen; nil when it cannot be offered (offline, help off).
    struct Preparation {
        let status: ReadingPreparation.Status
        let prepare: () -> Void
    }

    @ObservedObject var reader: ReaderViewModel
    var preparation: Preparation?
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            button("backward.end.fill", FR.TTS.previous) { reader.speakPrevious() }

            Button {
                switch reader.speech.activity {
                case .speaking: reader.pauseSpeaking()
                case .paused: reader.resumeSpeaking()
                case .stopped: reader.startSpeaking()
                }
            } label: {
                Image(systemName: reader.speech.activity == .speaking ? "pause.fill" : "play.fill")
                    .font(AppFont.ui(28, weight: .bold))
                    .frame(width: 64, height: 64)
                    .background(Palette.accent)
                    .foregroundStyle(.white)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playLabel)

            button("forward.end.fill", FR.TTS.next) { reader.speakNext() }

            Divider().frame(height: 30)

            // The speed of the voice, where the child can reach it. A voice that is too fast is the single most
            // common reason a child stops using it at all, and burying it in a settings panel means it stays wrong.
            HStack(spacing: 8) {
                button("tortoise.fill", FR.TTS.slower) { changeRate(by: -0.05) }
                Text(String(format: "%.2f×", reader.tts.rate).replacingOccurrences(of: ".", with: ","))
                    .font(AppFont.ui(15, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(Palette.muted)
                    .frame(minWidth: 56)
                button("hare.fill", FR.TTS.faster) { changeRate(by: 0.05) }
            }

            Spacer(minLength: 4)

            if let preparation { prepareButton(preparation) }

            button("xmark", FR.TTS.close) {
                reader.stopSpeaking()
                onClose()
            }
        }
        .padding(.horizontal, Metrics.gutter)
        .padding(.vertical, 10)
        .background(Palette.card)
        .overlay(alignment: .top) { Divider().overlay(Palette.line) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(FR.TTS.barLabel)
    }

    private var playLabel: String {
        switch reader.speech.activity {
        case .speaking: return FR.TTS.pause
        case .paused: return FR.TTS.resume
        case .stopped: return FR.TTS.play
        }
    }

    private func button(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(AppFont.ui(20))
                .frame(width: 48, height: 48)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Palette.ink)
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private func prepareButton(_ preparation: Preparation) -> some View {
        switch preparation.status {
        case .ready:
            Label(FR.TTS.Prepare.done, systemImage: "checkmark.circle.fill")
                .font(AppFont.ui(15, weight: .medium))
                .foregroundStyle(Palette.success)
        case .sending, .waiting:
            HStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text(FR.TTS.Prepare.busy).font(AppFont.ui(15))
            }
            .foregroundStyle(Palette.muted)
            .accessibilityElement(children: .combine)
        case .idle:
            Button(action: preparation.prepare) {
                Label(FR.TTS.Prepare.button, systemImage: "wand.and.stars")
                    .font(AppFont.ui(15, weight: .medium))
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(Palette.accent.opacity(0.12), in: Capsule())
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.accent)
            .accessibilityHint(FR.TTS.Prepare.hint)
        }
    }

    private func changeRate(by delta: Double) {
        reader.tts.rate = min(max(reader.tts.rate + delta, 0.5), 1.5)
        // Applied straight away rather than at the next sentence: the child changed it because this sentence is
        // going wrong.
        if reader.isSpeaking { reader.startSpeaking(fromItemId: reader.speech.itemId) }
        Task { _ = await reader.saveSettings() }
    }
}
