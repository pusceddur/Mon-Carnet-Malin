import AVFoundation
import Capacitor
import Foundation
import UIKit

/// Reads aloud with the iPad system voices. Unlike the web view, the system synthesizer also offers the voices
/// downloaded in Settings › Accessibility › Spoken Content › Voices (enhanced and premium quality).
/// Events: speechStart / speechRange (word being spoken, UTF-16 offsets) / speechEnd / speechCancel.
@objc(NativeSpeechPlugin)
public class NativeSpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "NativeSpeechPlugin"
    public let jsName = "NativeSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise)
    ]

    private struct Entry {
        let utterance: AVSpeechUtterance
        let id: String
    }

    private let synthesizer = AVSpeechSynthesizer()
    /// Utterances waiting or being spoken, with the id chosen by the web app. Main thread only.
    private var entries: [ObjectIdentifier: Entry] = [:]
    private var audioSessionReady = false

    override public func load() {
        synthesizer.delegate = self
        synthesizer.usesApplicationAudioSession = true
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(audioSessionInterrupted(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    // MARK: - Methods

    @objc func getVoices(_ call: CAPPluginCall) {
        let voices = AVSpeechSynthesisVoice.speechVoices().map { voice -> [String: Any] in
            var novelty = false
            var personal = false
            if #available(iOS 17.0, *) {
                novelty = voice.voiceTraits.contains(.isNoveltyVoice)
                personal = voice.voiceTraits.contains(.isPersonalVoice)
            }
            return [
                "identifier": voice.identifier,
                "name": voice.name,
                "language": voice.language,
                "quality": NativeSpeechPlugin.qualityName(voice.quality),
                "novelty": novelty,
                "personal": personal
            ]
        }
        call.resolve(["voices": voices])
    }

    @objc func speak(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let text = call.getString("text") else {
            call.reject("id and text are required")
            return
        }
        let voiceIdentifier = call.getString("voiceIdentifier")
        let language = call.getString("lang") ?? "fr-FR"
        let rate = call.getFloat("rate") ?? 1.0
        let pitch = call.getFloat("pitch") ?? 1.0
        let volume = call.getFloat("volume") ?? 1.0

        DispatchQueue.main.async {
            self.prepareAudioSession()
            let utterance = AVSpeechUtterance(string: text)
            if let voiceIdentifier = voiceIdentifier, let voice = AVSpeechSynthesisVoice(identifier: voiceIdentifier) {
                utterance.voice = voice
            } else {
                utterance.voice = AVSpeechSynthesisVoice(language: language)
            }
            utterance.rate = NativeSpeechPlugin.systemRate(rate)
            utterance.pitchMultiplier = min(2.0, max(0.5, pitch))
            utterance.volume = min(1.0, max(0.0, volume))
            self.entries[ObjectIdentifier(utterance)] = Entry(utterance: utterance, id: id)
            self.synthesizer.speak(utterance)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // The web app already ignores the utterances it stops: no event for them.
            self.entries.removeAll()
            self.synthesizer.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    @objc func keepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve()
        }
    }

    // MARK: - Synthesizer events

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            guard let entry = self.entry(for: utterance) else { return }
            self.notifyListeners("speechStart", data: ["id": entry.id])
        }
    }

    public func speechSynthesizer(
        _ synthesizer: AVSpeechSynthesizer,
        willSpeakRangeOfSpeechString characterRange: NSRange,
        utterance: AVSpeechUtterance
    ) {
        DispatchQueue.main.async {
            guard let entry = self.entry(for: utterance) else { return }
            self.notifyListeners("speechRange", data: [
                "id": entry.id,
                "start": characterRange.location,
                "length": characterRange.length
            ])
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            guard let entry = self.removeEntry(for: utterance) else { return }
            self.notifyListeners("speechEnd", data: ["id": entry.id])
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            guard let entry = self.removeEntry(for: utterance) else { return }
            self.notifyListeners("speechCancel", data: ["id": entry.id, "reason": "canceled"])
        }
    }

    /// Phone call, alarm, another app taking the audio: stop and let the web app settle in pause.
    @objc private func audioSessionInterrupted(_ notification: Notification) {
        guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
        DispatchQueue.main.async {
            let interrupted = self.entries.values.map { $0.id }
            self.entries.removeAll()
            self.synthesizer.stopSpeaking(at: .immediate)
            self.audioSessionReady = false
            for id in interrupted {
                self.notifyListeners("speechCancel", data: ["id": id, "reason": "interrupted"])
            }
        }
    }

    // MARK: - Helpers

    private func entry(for utterance: AVSpeechUtterance) -> Entry? {
        guard let entry = entries[ObjectIdentifier(utterance)], entry.utterance === utterance else { return nil }
        return entry
    }

    private func removeEntry(for utterance: AVSpeechUtterance) -> Entry? {
        guard let entry = entry(for: utterance) else { return nil }
        entries.removeValue(forKey: ObjectIdentifier(utterance))
        return entry
    }

    /// Spoken audio that plays even when the iPad is in silent mode and lowers other sounds.
    private func prepareAudioSession() {
        guard !audioSessionReady else { return }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
            audioSessionReady = true
        } catch {
            print("NativeSpeech: audio session unavailable: \(error.localizedDescription)")
        }
    }

    /// Web app rate (1 = normal speed) to the system rate (AVSpeechUtteranceDefaultSpeechRate = normal speed).
    private static func systemRate(_ rate: Float) -> Float {
        let value = rate * AVSpeechUtteranceDefaultSpeechRate
        return min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, value))
    }

    /// 3 = premium, 2 = enhanced (raw values, the premium case needs iOS 16).
    private static func qualityName(_ quality: AVSpeechSynthesisVoiceQuality) -> String {
        switch quality.rawValue {
        case 3:
            return "premium"
        case 2:
            return "enhanced"
        default:
            return "default"
        }
    }
}
