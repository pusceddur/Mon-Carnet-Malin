import CarnetKit
import Foundation

/// Reads a piece of text aloud outside the reader: an answer, a summary, a message.
///
/// With the child's own voice settings, not the system's defaults. A child who slowed the voice down in the reader
/// did it because the default was too fast for them, and it would be too fast here as well.
@MainActor
final class Speaker: ObservableObject {
    private let reader = SpeechReader()
    private var preferences: TTSPreferences = .standard
    private var voiceIdentifier: String?

    func configure(for child: ChildProfile, voiceIdentifier: String?) {
        preferences = child.tts
        self.voiceIdentifier = voiceIdentifier
    }

    func speakOnce(_ text: String) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        reader.speak(
            items: [SpeechItem(id: "once", text: clean)],
            preferences: preferences,
            voiceIdentifier: voiceIdentifier
        )
    }

    func stop() {
        reader.stop()
    }
}
