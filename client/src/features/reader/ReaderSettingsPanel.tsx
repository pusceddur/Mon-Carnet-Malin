import { DEFAULT_TTS_PREFERENCES, PREFERENCE_RANGES, type LayoutMode, type ReadingFont, type ReadingPreferences, type ReadingTheme, type TTSPreferences , type ReadingPalette } from '@aide/shared';
import { useEffect, useId, useState, type JSX } from 'react';
import { BottomSheet, Button, Segmented, Select, Slider, Toggle } from '../../design/components';
import { READING_FONTS, READING_PALETTES, READING_THEMES, readingFontClass } from '../../design/reading';
import { format } from '../../i18n/fr';
import { aids as aidStrings } from '../../i18n/fr/aids';
import { common } from '../../i18n/fr/common';
import { reader } from '../../i18n/fr/reader';
import { tts as ttsStrings } from '../../i18n/fr/tts';
import { speechEngine } from '../../tts/SpeechEngine';
import { bestFrenchVoiceQuality, isFranceFrench, normalizeLang, pickFrenchVoice, voiceQuality } from '../../tts/voices';
import { isNativeApp } from '../../platform/nativeApp';
import { isAndroid, isIPad } from '../../platform/support';
import { READING_AID_KEYS, readingAidsOf } from './aids';
import type { PreferencesPatch } from './preferences';
import { ReadingPreview } from './ReadingPreview';

export interface ReaderSettingsPanelProps {
  open: boolean;
  onClose(): void;
  reading: ReadingPreferences;
  tts: TTSPreferences;
  onChange(patch: PreferencesPatch): void;
  onReset(): void;
  voiceURI: string | null;
  onVoiceChange(voiceURI: string | null): void;
}

const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const n = (value: number): string => numberFormat.format(value);

const AUTOMATIC_VOICE = '';

export function voiceOptionLabel(voice: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'voiceURI' | 'localService'>): string {
  const lang = normalizeLang(voice.lang);
  const regions: Readonly<Record<string, string>> = ttsStrings.voices.regions;
  return format(ttsStrings.voices.optionLabel, {
    name: voice.name,
    region: regions[lang] ?? ttsStrings.voices.regions.other,
    quality: ttsStrings.voices.quality[voiceQuality(voice)],
  });
}

/** Reading comfort settings (BottomSheet): every change applies immediately. */
export function ReaderSettingsPanel({ open, onClose, reading, tts, onChange, onReset, voiceURI, onVoiceChange }: ReaderSettingsPanelProps): JSX.Element | null {
  const s = reader.settings;
  const r = PREFERENCE_RANGES;
  const voiceSelectId = useId();
  const fontGroupId = useId();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    void speechEngine.frenchVoices().then((list) => {
      if (!cancelled) setVoices(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const setReading = (patch: Partial<ReadingPreferences>): void => onChange({ reading: patch });
  const automaticVoice = pickFrenchVoice(voices, null);
  const bestQuality = bestFrenchVoiceQuality(voices);
  // The automatic voice has another accent only when the device has no voice of France (2026-09-19).
  const otherAccent = voiceURI === null && automaticVoice !== null && !isFranceFrench(automaticVoice);
  const regions: Readonly<Record<string, string>> = ttsStrings.voices.regions;
  const showBetterVoiceTip = voices.length === 0 || otherAccent || bestQuality === 'standard' || bestQuality === 'robotic';

  return (
    <BottomSheet open={open} onClose={onClose} title={s.title} height="tall">
      <div className="rd-settings">
        <ReadingPreview text={s.preview} reading={reading} className="rd-settings__preview" />

        <section className="rd-settings__section" aria-labelledby={`${fontGroupId}-title`}>
          <h3 id={`${fontGroupId}-title`} className="rd-settings__title">{s.sectionText}</h3>
          <div className="rd-settings__fonts" role="radiogroup" aria-label={s.font}>
            {READING_FONTS.map((font: ReadingFont) => (
              <button
                key={font}
                type="button"
                role="radio"
                aria-checked={reading.font === font}
                className={`rd-settings__font ${readingFontClass(font)}`}
                onClick={() => setReading({ font })}
              >
                <span className="rd-settings__font-sample" aria-hidden="true">{s.fontSample}</span>
                <span className="rd-settings__font-name">{common.readingFonts[font]}</span>
              </button>
            ))}
          </div>
          <Slider label={s.fontSize} value={reading.fontSizePx} min={r.fontSizePx.min} max={r.fontSizePx.max} step={2}
            formatValue={(v) => format(s.values.px, { value: n(v) })} onChange={(fontSizePx) => setReading({ fontSizePx })} />
        </section>

        <section className="rd-settings__section">
          <h3 className="rd-settings__title">{s.sectionSpace}</h3>
          <Slider label={s.lineHeight} value={reading.lineHeight} min={r.lineHeight.min} max={r.lineHeight.max} step={0.1}
            formatValue={(v) => format(s.values.em, { value: n(v) })} onChange={(lineHeight) => setReading({ lineHeight })} />
          <Slider label={s.letterSpacing} value={reading.letterSpacingEm} min={r.letterSpacingEm.min} max={r.letterSpacingEm.max} step={0.02}
            formatValue={(v) => format(s.values.em, { value: n(v) })} onChange={(letterSpacingEm) => setReading({ letterSpacingEm })} />
          <Slider label={s.wordSpacing} value={reading.wordSpacingEm} min={r.wordSpacingEm.min} max={r.wordSpacingEm.max} step={0.04}
            formatValue={(v) => format(s.values.em, { value: n(v) })} onChange={(wordSpacingEm) => setReading({ wordSpacingEm })} />
          <Slider label={s.columnWidth} value={reading.columnWidthEm} min={r.columnWidthEm.min} max={r.columnWidthEm.max} step={2}
            formatValue={(v) => format(s.values.em, { value: n(v) })} onChange={(columnWidthEm) => setReading({ columnWidthEm })} />
        </section>

        <section className="rd-settings__section">
          <h3 className="rd-settings__title">{s.sectionDisplay}</h3>
          <Segmented<ReadingTheme>
            label={s.theme}
            value={reading.theme}
            options={READING_THEMES.map((theme) => ({ value: theme, label: common.themes[theme] }))}
            onChange={(theme) => setReading({ theme })}
          />
          <Segmented<ReadingPalette>
            label={s.palette}
            value={reading.palette}
            options={READING_PALETTES.map((palette) => ({ value: palette, label: common.palettes[palette] }))}
            onChange={(palette) => setReading({ palette })}
          />
          <p className="rd-settings__hint">{common.paletteHints[reading.palette]}</p>
          <Segmented<LayoutMode>
            label={s.layout}
            value={reading.layoutMode}
            options={[
              { value: 'page', label: s.layoutPage, icon: '📄' },
              { value: 'continu', label: s.layoutContinu, icon: '📜' },
            ]}
            onChange={(layoutMode) => setReading({ layoutMode })}
          />
          <Toggle label={s.sentenceHighlight} description={s.sentenceHighlightHint} checked={reading.sentenceHighlight}
            onChange={(sentenceHighlight) => setReading({ sentenceHighlight })} />
          <Toggle label={s.readingGuide} description={s.readingGuideHint} checked={reading.readingGuide}
            onChange={(readingGuide) => setReading({ readingGuide })} />
        </section>

        <section className="rd-settings__section">
          <h3 className="rd-settings__title">{aidStrings.title}</h3>
          <p className="rd-settings__hint">{aidStrings.hint}</p>
          {READING_AID_KEYS.map((key) => (
            <Toggle
              key={key}
              label={aidStrings[key]}
              description={aidStrings[`${key}Hint`]}
              checked={readingAidsOf(reading)[key]}
              onChange={(on) => setReading({ aids: { ...readingAidsOf(reading), [key]: on } })}
            />
          ))}
        </section>

        <section className="rd-settings__section">
          <h3 className="rd-settings__title">{s.sectionVoice}</h3>
          <Slider label={s.rate} value={tts.rate} min={r.ttsRate.min} max={r.ttsRate.max} step={0.05}
            formatValue={(v) => format(s.values.times, { value: n(v) })} onChange={(rate) => onChange({ tts: { rate } })} />
          <div className="rd-settings__voice">
            {voices.length === 0 && <p className="rd-settings__hint">{ttsStrings.voices.none}</p>}
            {voices.length > 0 && (
              <>
                <label htmlFor={voiceSelectId} className="rd-settings__label">{s.voice}</label>
                <Select
                  id={voiceSelectId}
                  value={voiceURI ?? AUTOMATIC_VOICE}
                  onChange={(event) => onVoiceChange(event.target.value === AUTOMATIC_VOICE ? null : event.target.value)}
                  options={[
                    { value: AUTOMATIC_VOICE, label: automaticVoice ? format(ttsStrings.voices.automaticBest, { name: automaticVoice.name }) : ttsStrings.voices.automatic },
                    ...voices.map((voice) => ({ value: voice.voiceURI, label: voiceOptionLabel(voice) })),
                  ]}
                />
              </>
            )}
            <Button variant="secondary" onClick={() => speechEngine.speakOnce(ttsStrings.voices.sample)}>{s.voiceTest}</Button>
          </div>
          {otherAccent && automaticVoice && (
            <p className="rd-settings__hint" role="note">
              {format(ttsStrings.voices.otherAccent, { region: regions[normalizeLang(automaticVoice.lang)] ?? ttsStrings.voices.regions.other })}
            </p>
          )}
          <Slider label={ttsStrings.pauses.sentence} value={tts.sentencePauseMs ?? DEFAULT_TTS_PREFERENCES.sentencePauseMs}
            min={r.ttsSentencePauseMs.min} max={r.ttsSentencePauseMs.max} step={50}
            formatValue={(v) => format(ttsStrings.pauses.value, { value: n(v / 1000) })} onChange={(sentencePauseMs) => onChange({ tts: { sentencePauseMs } })} />
          <Slider label={ttsStrings.pauses.paragraph} value={tts.paragraphPauseMs ?? DEFAULT_TTS_PREFERENCES.paragraphPauseMs}
            min={r.ttsParagraphPauseMs.min} max={r.ttsParagraphPauseMs.max} step={100}
            formatValue={(v) => format(ttsStrings.pauses.value, { value: n(v / 1000) })} onChange={(paragraphPauseMs) => onChange({ tts: { paragraphPauseMs } })} />
          {showBetterVoiceTip && (
            <div className="rd-settings__tip" role="note">
              <p className="rd-settings__tip-title">{ttsStrings.voices.betterVoiceTitle}</p>
              {isNativeApp()
                ? (
                  <>
                    <p>{ttsStrings.voices.betterVoiceIntro}</p>
                    <ol>
                      {ttsStrings.voices.betterVoiceSteps.map((step) => <li key={step}>{step}</li>)}
                    </ol>
                  </>
                )
                : isIPad()
                  ? (
                    <>
                      <p>{ttsStrings.voices.betterVoiceSafari}</p>
                      <p>{ttsStrings.voices.betterVoiceSafariApp}</p>
                    </>
                  )
                  : isAndroid()
                    ? (
                      <>
                        <p>{ttsStrings.voices.betterVoiceAndroidIntro}</p>
                        <ol>
                          {ttsStrings.voices.betterVoiceAndroidSteps.map((step) => <li key={step}>{step}</li>)}
                        </ol>
                        <p>{ttsStrings.voices.betterVoiceAndroidNote}</p>
                      </>
                    )
                    : <p>{ttsStrings.voices.betterVoiceDesktop}</p>}
            </div>
          )}
        </section>

        <Button variant="ghost" block onClick={onReset}>{s.reset}</Button>
      </div>
    </BottomSheet>
  );
}
