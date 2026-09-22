import AVFoundation
import CarnetKit
import SwiftUI

/// « Réglages de lecture », with the text changing under the child's hand as they move a slider.
///
/// The preview is the point. What helps one child hinders another — wide letter spacing helps some readers and slows
/// others down — and the only honest way to choose is to look at real words while the value moves.
struct ReaderSettingsPanel: View {
    @ObservedObject var reader: ReaderViewModel
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var voices: [AVSpeechSynthesisVoice] = []

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    preview

                    section(FR.Reader.sectionText) {
                        fontPicker
                        LabelledSlider(
                            title: FR.Reader.fontSize, value: $reader.reading.fontSizePx,
                            range: 16...44, step: 1
                        ) { "\(Int($0)) px" }
                    }

                    section(FR.Reader.sectionSpace) {
                        LabelledSlider(
                            title: FR.Reader.lineHeight, value: $reader.reading.lineHeight,
                            range: 1.2...2.6, step: 0.1
                        ) { decimal($0) }
                        LabelledSlider(
                            title: FR.Reader.letterSpacing, value: $reader.reading.letterSpacingEm,
                            range: 0...0.3, step: 0.01
                        ) { decimal($0, places: 2) }
                        LabelledSlider(
                            title: FR.Reader.wordSpacing, value: $reader.reading.wordSpacingEm,
                            range: 0...0.8, step: 0.02
                        ) { decimal($0, places: 2) }
                        LabelledSlider(
                            title: FR.Reader.columnWidth, value: $reader.reading.columnWidthEm,
                            range: 18...48, step: 1
                        ) { "\(Int($0))" }
                    }

                    section(FR.Reader.sectionDisplay) {
                        themePicker
                        palettePicker
                        ExplainedToggle(
                            title: FR.Reader.sentenceHighlight,
                            hint: FR.Reader.sentenceHighlightHint,
                            isOn: $reader.reading.sentenceHighlight
                        )
                        ExplainedToggle(
                            title: FR.Reader.readingGuide,
                            hint: FR.Reader.readingGuideHint,
                            isOn: $reader.reading.readingGuide
                        )
                    }

                    section(FR.Aids.title, hint: FR.Aids.hint) {
                        ExplainedToggle(
                            title: FR.Aids.syllables, hint: FR.Aids.syllablesHint,
                            isOn: $reader.aids.syllables
                        )
                        ExplainedToggle(
                            title: FR.Aids.silentLetters, hint: FR.Aids.silentLettersHint,
                            isOn: $reader.aids.silentLetters
                        )
                        ExplainedToggle(
                            title: FR.Aids.sounds, hint: FR.Aids.soundsHint,
                            isOn: $reader.aids.sounds
                        )
                        ExplainedToggle(
                            title: FR.Aids.changedLetters, hint: FR.Aids.changedLettersHint,
                            isOn: $reader.aids.changedLetters
                        )
                        ExplainedToggle(
                            title: FR.Aids.liaisons, hint: FR.Aids.liaisonsHint,
                            isOn: $reader.aids.liaisons
                        )
                    }

                    section(FR.Reader.sectionVoice) {
                        LabelledSlider(
                            title: FR.Reader.rate, value: $reader.tts.rate, range: 0.5...1.5, step: 0.05
                        ) { decimal($0, places: 2) + "×" }
                        LabelledSlider(
                            title: FR.TTS.sentencePause,
                            value: Binding(
                                get: { Double(reader.tts.sentencePauseMs) / 1000 },
                                set: { reader.tts.sentencePauseMs = Int($0 * 1000) }
                            ),
                            range: 0...2, step: 0.05
                        ) { FR.TTS.seconds($0) }
                        LabelledSlider(
                            title: FR.TTS.paragraphPause,
                            value: Binding(
                                get: { Double(reader.tts.paragraphPauseMs) / 1000 },
                                set: { reader.tts.paragraphPauseMs = Int($0 * 1000) }
                            ),
                            range: 0...3, step: 0.1
                        ) { FR.TTS.seconds($0) }
                        voicePicker
                        BigButton(title: FR.Reader.voiceTest, icon: "speaker.wave.2", kind: .secondary) {
                            reader.speakOnce(FR.Reader.settingsPreview)
                        }
                    }

                    BigButton(title: FR.Reader.reset, kind: .secondary) {
                        reader.resetSettings()
                    }
                    .padding(.bottom, 40)
                }
                .padding(Metrics.gutter)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Palette.paper)
            .navigationTitle(FR.Reader.settingsTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(FR.Common.done) {
                        Task {
                            if let updated = await reader.saveSettings() { model.update(updated) }
                            dismiss()
                        }
                    }
                    .font(AppFont.ui(18, weight: .semibold))
                }
            }
        }
        .task { voices = SpeechReader.frenchVoices() }
    }

    /// Real words, with everything applied, so a choice can be seen rather than imagined.
    private var preview: some View {
        VStack(alignment: .leading, spacing: 8) {
            #if canImport(UIKit)
            let block = ReaderModel.buildBlock(
                pageIndex: 0, blockIndex: 0,
                block: TextBlock(kind: .paragraph, text: FR.Aids.preview)
            )
            ReaderBlockView(
                block: block,
                aids: reader.aids(for: block),
                highlights: [],
                typography: reader.typography,
                selection: nil,
                spokenSentence: nil,
                spokenWord: nil,
                onLayout: { _ in },
                onTapWord: { _ in }
            )
            .frame(minHeight: reader.typography.lineHeight * 3)
            #else
            Text(FR.Aids.preview)
            #endif
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(reader.palette.paper)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Palette.line, lineWidth: 1))
    }

    private func section<Content: View>(
        _ title: String, hint: String? = nil, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(AppFont.ui(22, weight: .bold)).foregroundStyle(Palette.ink)
            if let hint {
                Text(hint).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            }
            content()
        }
    }

    private var fontPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(FR.Reader.font).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.Reader.font, selection: $reader.reading.font) {
                ForEach(ReadingFont.allCases, id: \.self) { font in
                    Text(FR.Fonts.name(ReadingFontName(font))).tag(font)
                }
            }
            .pickerStyle(.menu)
            .tint(Palette.accent)
            .labelsHidden()
        }
    }

    private var themePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(FR.Reader.theme).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.Reader.theme, selection: $reader.reading.theme) {
                Text(FR.Themes.creme).tag(ReadingTheme.creme)
                Text(FR.Themes.clair).tag(ReadingTheme.clair)
                Text(FR.Themes.sombre).tag(ReadingTheme.sombre)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
    }

    /// §31 The set of colours, chosen apart from the paper colour: the two answer different needs.
    private var palettePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(FR.Reader.palette).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            Picker(FR.Reader.palette, selection: $reader.reading.palette) {
                ForEach(ReadingPalette.allCases, id: \.self) { palette in
                    Text(FR.Palettes.name(palette)).tag(palette)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text(FR.Palettes.hint(reader.reading.palette))
                .font(AppFont.ui(15)).foregroundStyle(Palette.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var voicePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(FR.Reader.voice).font(AppFont.ui(18, weight: .medium)).foregroundStyle(Palette.ink)
            if voices.isEmpty {
                Text(FR.TTS.voiceNone).font(AppFont.ui(15)).foregroundStyle(Palette.muted)
            } else {
                Picker(FR.Reader.voice, selection: Binding(
                    get: { reader.currentVoiceIdentifier ?? "" },
                    set: { Task { await reader.chooseVoice($0.isEmpty ? nil : $0) } }
                )) {
                    Text(FR.TTS.voiceAutomatic).tag("")
                    ForEach(voices, id: \.identifier) { voice in
                        Text("\(voice.name) · \(voice.language)").tag(voice.identifier)
                    }
                }
                .pickerStyle(.menu)
                .tint(Palette.accent)
                .labelsHidden()
            }

            // The better voices are free and already on the iPad; they only have to be downloaded once.
            DisclosureGroup(FR.TTS.betterVoiceTitle) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(FR.TTS.betterVoiceIntro).font(AppFont.ui(15))
                    ForEach(Array(FR.TTS.betterVoiceSteps.enumerated()), id: \.offset) { index, step in
                        Text("\(index + 1). \(step)").font(AppFont.ui(15))
                    }
                }
                .foregroundStyle(Palette.muted)
                .padding(.top, 6)
            }
            .font(AppFont.ui(16, weight: .medium))
            .tint(Palette.accent)
        }
    }

    /// French writes a decimal point as a comma, and a child reading « 1.8 » reads it as a mistake.
    private func decimal(_ value: Double, places: Int = 1) -> String {
        String(format: "%.\(places)f", value).replacingOccurrences(of: ".", with: ",")
    }
}
