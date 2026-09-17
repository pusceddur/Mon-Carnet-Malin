import { DEFAULT_READING_PREFERENCES, DEFAULT_TTS_PREFERENCES } from '@aide/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReaderSettingsPanel } from '../../src/features/reader/ReaderSettingsPanel';
import { tts } from '../../src/i18n/fr/tts';
import { speechEngine } from '../../src/tts/SpeechEngine';
import { cleanup, render, wait } from '../design/render';

const v = (voiceURI: string, name: string, lang = 'fr-FR', localService = true): SpeechSynthesisVoice =>
  ({ voiceURI, name, lang, localService, default: false }) as SpeechSynthesisVoice;

async function openPanel(voices: SpeechSynthesisVoice[]): Promise<void> {
  vi.spyOn(speechEngine, 'frenchVoices').mockResolvedValue(voices);
  await render(
    <ReaderSettingsPanel
      open
      onClose={() => undefined}
      reading={DEFAULT_READING_PREFERENCES}
      tts={DEFAULT_TTS_PREFERENCES}
      onChange={() => undefined}
      onReset={() => undefined}
      voiceURI={null}
      onVoiceChange={() => undefined}
    />,
  );
  await wait(20);
}

describe('ReaderSettingsPanel · voice', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it('labels each voice with its quality and names the automatic choice (never a robotic voice)', async () => {
    await openPanel([
      v('com.apple.eloquence.fr-FR.Eddy', 'Eddy'),
      v('com.apple.voice.compact.fr-FR.Thomas', 'Thomas'),
    ]);
    const options = Array.from(document.querySelectorAll('option')).map((o) => o.textContent);
    expect(options[0]).toBe('Automatique (la meilleure voix : Thomas)');
    expect(options).toContain('Eddy · France · Robotique');
    expect(options).toContain('Thomas · France · Standard');
    // Only standard / robotic voices: the advice about a more natural voice is shown (desktop wording here).
    expect(document.body.textContent).toContain(tts.voices.betterVoiceTitle);
    expect(document.body.textContent).toContain(tts.voices.betterVoiceDesktop);
  });

  it('hides the download guide when a premium voice is installed', async () => {
    await openPanel([v('com.apple.voice.compact.fr-FR.Thomas', 'Thomas'), v('com.apple.voice.premium.fr-FR.Audrey', 'Audrey')]);
    expect(document.body.textContent).not.toContain(tts.voices.betterVoiceTitle);
    expect(document.querySelector('option')?.textContent).toBe('Automatique (la meilleure voix : Audrey)');
  });

  it('on iPad, says that Safari never offers the downloaded voices (no misleading download steps)', async () => {
    const support = await import('../../src/platform/support');
    vi.spyOn(support, 'isIPad').mockReturnValue(true);
    await openPanel([v('com.apple.voice.compact.fr-FR.Thomas', 'Thomas')]);
    expect(document.body.textContent).toContain(tts.voices.betterVoiceSafari);
    expect(document.body.textContent).toContain(tts.voices.betterVoiceSafariApp);
    expect(document.body.textContent).not.toContain('Contenu énoncé');
  });

  it('offers the sentence and paragraph pauses', async () => {
    await openPanel([v('com.apple.voice.premium.fr-FR.Audrey', 'Audrey')]);
    expect(document.body.textContent).toContain(tts.pauses.sentence);
    expect(document.body.textContent).toContain(tts.pauses.paragraph);
  });
});
