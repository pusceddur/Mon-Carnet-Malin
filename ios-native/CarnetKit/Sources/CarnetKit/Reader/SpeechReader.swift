#if canImport(AVFoundation)
import AVFoundation
import Foundation

/// What the interface needs to know while the book is being read aloud.
public struct SpeechState: Equatable, Sendable {
    public enum Activity: String, Sendable {
        case stopped, speaking, paused
    }

    public var activity: Activity = .stopped
    /// Index in the queue of the sentence being read.
    public var itemIndex: Int?
    /// Identifier of that sentence, for the reader to highlight it.
    public var itemId: String?
    /// The word being said, in the offsets of the **displayed** text.
    public var wordRange: NSRange?

    public static let idle = SpeechState()
}

/// Reading a book aloud with the voices of the system.
///
/// One sentence at a time, because that is what the reader highlights and what a child can follow. The silence between
/// sentences, and the longer one between paragraphs, are part of the profile: a child who reads slowly needs the pause
/// to catch up, and a voice that runs straight through is useless to them.
///
/// The system voices matter here: the ones a parent downloads in Settings (« Améliorée », « Premium ») are far better
/// than anything a web page can reach, and are the reason this part is native.
public final class SpeechReader: NSObject, @unchecked Sendable {
    private let synthesizer = AVSpeechSynthesizer()
    private let lock = NSLock()

    private var items: [SpeechItem] = []
    private var mappings: [Int: SpokenWordMapping] = [:]
    private var index = 0
    private var preferences = TTSPreferences.standard
    private var voiceIdentifier: String?
    private var state = SpeechState.idle
    private var pauseTimer: Timer?
    /// True while `stop` is tearing the queue down, so the delegate does not start the next sentence.
    private var stopping = false

    /// Called on the main thread whenever the state changes.
    public var onStateChange: (@Sendable (SpeechState) -> Void)?
    /// Called when the whole queue has been read.
    public var onFinished: (@Sendable () -> Void)?

    public override init() {
        super.init()
        synthesizer.delegate = self
    }

    public var currentState: SpeechState {
        lock.lock()
        defer { lock.unlock() }
        return state
    }

    // MARK: - Voices

    /// The French voices this device has, best quality first: what the settings offer the parent.
    public static func frenchVoices() -> [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("fr") }
            // `by:` spelled out: recent SDKs also offer `sorted(using:)`, and a bare trailing closure can be
            // read as a `SortComparator`.
            .sorted(by: { first, second in
                if first.quality.rank != second.quality.rank { return first.quality.rank > second.quality.rank }
                return first.name < second.name
            })
    }

    /// The best French voice available, which is what a profile uses until someone chooses another.
    public static func defaultFrenchVoiceIdentifier() -> String? {
        frenchVoices().first?.identifier
    }

    // MARK: - Reading

    /// Starts reading `items` from `startIndex`.
    public func speak(
        items: [SpeechItem],
        from startIndex: Int = 0,
        preferences: TTSPreferences = .standard,
        voiceIdentifier: String? = nil
    ) {
        stop()
        lock.lock()
        self.items = items
        self.preferences = preferences
        self.voiceIdentifier = voiceIdentifier ?? Self.defaultFrenchVoiceIdentifier()
        self.index = max(0, min(startIndex, max(0, items.count - 1)))
        self.mappings = [:]
        self.stopping = false
        lock.unlock()

        guard !items.isEmpty else { return }
        configureAudioSession()
        speakCurrent()
    }

    public func pause() {
        synthesizer.pauseSpeaking(at: .word)
        update { $0.activity = .paused }
    }

    public func resume() {
        guard synthesizer.isPaused else { return }
        synthesizer.continueSpeaking()
        update { $0.activity = .speaking }
    }

    public func stop() {
        lock.lock()
        stopping = true
        pauseTimer?.invalidate()
        pauseTimer = nil
        lock.unlock()
        synthesizer.stopSpeaking(at: .immediate)
        update {
            $0.activity = .stopped
            $0.itemIndex = nil
            $0.itemId = nil
            $0.wordRange = nil
        }
    }

    /// Skips to the next sentence, as the « next » button does.
    public func next() {
        advance(by: 1)
    }

    /// Goes back to the start of the sentence being read, or to the one before when it just started.
    public func previous() {
        advance(by: -1)
    }

    private func advance(by delta: Int) {
        lock.lock()
        let target = index + delta
        let inRange = target >= 0 && target < items.count
        if inRange { index = target }
        stopping = true
        lock.unlock()
        synthesizer.stopSpeaking(at: .immediate)
        lock.lock()
        stopping = false
        lock.unlock()
        if inRange { speakCurrent() } else { finish() }
    }

    private func speakCurrent() {
        lock.lock()
        guard index >= 0, index < items.count else {
            lock.unlock()
            finish()
            return
        }
        let item = items[index]
        let current = index
        let prefs = preferences
        let voice = voiceIdentifier
        // The mapping is worked out once per sentence: it is the same for every word of it.
        if mappings[current] == nil {
            mappings[current] = item.spoken.flatMap { SpokenWordMapping(display: item.text, spoken: $0) }
                ?? SpokenWordMapping(identity: item.text)
        }
        lock.unlock()

        let utterance = AVSpeechUtterance(string: item.utterance)
        if let voice, let found = AVSpeechSynthesisVoice(identifier: voice) {
            utterance.voice = found
        } else {
            utterance.voice = AVSpeechSynthesisVoice(language: "fr-FR")
        }
        // The profile rate is 0.5…1.5 around normal speech; the system scale is its own, so it is mapped rather than
        // passed through, or a child's « slower » would be barely slower at all.
        utterance.rate = Self.systemRate(prefs.rate)
        utterance.pitchMultiplier = Float(min(max(prefs.pitch, 0.5), 2.0))
        utterance.postUtteranceDelay = 0

        update {
            $0.activity = .speaking
            $0.itemIndex = current
            $0.itemId = item.id
            $0.wordRange = nil
        }
        synthesizer.speak(utterance)
    }

    /// The silence after a sentence: longer when the next one opens a paragraph.
    private func pauseAfterCurrent() -> TimeInterval {
        lock.lock()
        defer { lock.unlock() }
        guard index >= 0, index < items.count else { return 0 }
        let currentBlock = SpeechQueue.position(fromItemId: items[index].id)
        let nextBlock = index + 1 < items.count ? SpeechQueue.position(fromItemId: items[index + 1].id) : nil
        let newParagraph = nextBlock != nil && currentBlock != nil
            && (nextBlock!.blockIndex != currentBlock!.blockIndex || nextBlock!.pageIndex != currentBlock!.pageIndex)
        let ms = newParagraph ? preferences.paragraphPauseMs : preferences.sentencePauseMs
        return TimeInterval(ms) / 1000
    }

    private func finish() {
        update {
            $0.activity = .stopped
            $0.itemIndex = nil
            $0.itemId = nil
            $0.wordRange = nil
        }
        onFinished?()
    }

    private func update(_ change: (inout SpeechState) -> Void) {
        lock.lock()
        change(&state)
        let snapshot = state
        lock.unlock()
        let notify = onStateChange
        if Thread.isMainThread {
            notify?(snapshot)
        } else {
            DispatchQueue.main.async { notify?(snapshot) }
        }
    }

    /// The system scale is not the profile's: 0.5 means « half speed » to a parent, and something else to AVFoundation.
    static func systemRate(_ rate: Double) -> Float {
        let normal = Double(AVSpeechUtteranceDefaultSpeechRate)
        let slowest = Double(AVSpeechUtteranceMinimumSpeechRate)
        let fastest = Double(AVSpeechUtteranceMaximumSpeechRate)
        let clamped = min(max(rate, 0.5), 1.5)
        let value = clamped <= 1
            ? slowest + (normal - slowest) * ((clamped - 0.5) / 0.5)
            : normal + (fastest - normal) * ((clamped - 1) / 0.5)
        return Float(min(max(value, slowest), fastest))
    }

    private func configureAudioSession() {
        #if os(iOS)
        // Reading aloud is the point of the app at that moment: it plays even with the silent switch on, and it stops
        // whatever else was playing rather than talking over it.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? session.setActive(true, options: [])
        #endif
    }
}

// MARK: - The synthesizer talking back

extension SpeechReader: AVSpeechSynthesizerDelegate {
    public func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        willSpeakRangeOfSpeechString characterRange: NSRange,
        utterance: AVSpeechUtterance
    ) {
        lock.lock()
        let mapping = mappings[index]
        lock.unlock()
        // The range is inside the spoken text; the reader highlights inside the shown one.
        let shown = mapping?.displayRange(forSpokenRange: characterRange)
        update { $0.wordRange = shown }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        lock.lock()
        let wasStopping = stopping
        let hasNext = index + 1 < items.count
        lock.unlock()
        guard !wasStopping else { return }

        guard hasNext else {
            finish()
            return
        }
        let delay = pauseAfterCurrent()
        let continueReading = { [weak self] in
            guard let self else { return }
            self.lock.lock()
            let stillGoing = !self.stopping
            if stillGoing { self.index += 1 }
            self.lock.unlock()
            if stillGoing { self.speakCurrent() }
        }
        if delay <= 0 {
            continueReading()
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: continueReading)
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        // A cancellation is either `stop` or a skip; both have already said what happens next.
    }
}

// `AVSpeechSynthesisVoiceQuality` is a type of its own in Swift, not nested inside the voice class.
private extension AVSpeechSynthesisVoiceQuality {
    /// Premium above enhanced above the default one.
    var rank: Int {
        switch self {
        case .premium: return 3
        case .enhanced: return 2
        default: return 1
        }
    }
}
#endif
