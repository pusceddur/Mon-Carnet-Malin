// French voice discovery and selection (§11.4, §15.7). The chosen voice is stored per device in Dexie kv `ttsVoiceURI`.
import { db } from '../db/localDb';

export const TTS_VOICE_KV_KEY = 'ttsVoiceURI';

/** The subset of SpeechSynthesisVoice used here (lets tests build plain objects). */
export interface VoiceLike {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
  /** Quality reported by the system (iPad app voices); the name and URI rules still flag robotic voices. */
  qualityHint?: VoiceQuality;
}

export interface VoiceSource {
  getVoices(): SpeechSynthesisVoice[];
  addEventListener?: (type: 'voiceschanged', listener: () => void) => void;
  removeEventListener?: (type: 'voiceschanged', listener: () => void) => void;
}

export function normalizeLang(lang: string): string {
  const [language = '', region] = lang.replace(/_/g, '-').split('-');
  return region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase();
}

export function isFrenchVoice(voice: Pick<VoiceLike, 'lang'>): boolean {
  return normalizeLang(voice.lang).startsWith('fr');
}

/** French of France (or French without a region). The other accents (Canada, Belgique, Suisse…) are a choice of their own. */
export function isFranceFrench(voice: Pick<VoiceLike, 'lang'>): boolean {
  const lang = normalizeLang(voice.lang);
  return lang === 'fr-FR' || lang === 'fr';
}

/**
 * Perceived quality of a system voice, from its URI and name (Safari/iOS, macOS, Chrome, Edge):
 * - premium / enhanced: Apple voices downloaded in the device settings (natural prosody and pauses);
 * - natural: network neural voices of desktop browsers (Microsoft « Natural », Google);
 * - standard: default compact voices;
 * - robotic: Eloquence and novelty voices (Eddy, Flo, Grand-mère, Reed, Rocko, Sandy, Shelley…), never chosen automatically.
 */
export type VoiceQuality = 'premium' | 'enhanced' | 'natural' | 'standard' | 'robotic';

const ROBOTIC_NAMES = new Set([
  'eddy', 'flo', 'grandma', 'grandpa', 'grand-mère', 'grand-père', 'grand-mere', 'grand-pere', 'mamie', 'papi', 'reed', 'rocko', 'sandy', 'shelley',
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'good news', 'jester', 'organ', 'superstar', 'trinoids',
  'whisper', 'wobble', 'zarvox', 'junior', 'ralph', 'fred', 'kathy',
]);

/** Whole-word match that also works with accented letters (JS \b is ASCII-only). */
function hasWord(text: string, alternatives: string): boolean {
  return new RegExp(String.raw`(?<![\p{L}\p{N}])(?:` + alternatives + String.raw`)(?![\p{L}\p{N}])`, 'u').test(text);
}

export function voiceQuality(voice: Pick<VoiceLike, 'voiceURI' | 'name' | 'localService' | 'qualityHint'>): VoiceQuality {
  const uri = voice.voiceURI.toLowerCase();
  const name = voice.name.toLowerCase();
  const baseName = name.replace(/\s*\(.*\)\s*$/, '').trim();
  if (uri.includes('eloquence') || uri.includes('novelty') || ROBOTIC_NAMES.has(baseName)) return 'robotic';
  if (voice.qualityHint) return voice.qualityHint;
  if (uri.includes('.premium.') || hasWord(name, 'premium')) return 'premium';
  // Siri voices (com.apple.ttsbundle.siri_…) sound far more natural than the compact ones.
  if (uri.includes('.enhanced.') || uri.includes('siri') || hasWord(name, 'enhanced|am[ée]lior[ée]e?|migliorat[ao]|siri')) return 'enhanced';
  if (hasWord(name, 'natural|neural') || (!voice.localService && hasWord(name, 'google|microsoft'))) return 'natural';
  return 'standard';
}

const QUALITY_ORDER: Readonly<Record<VoiceQuality, number>> = { premium: 0, enhanced: 1, natural: 2, standard: 3, robotic: 9 };

/**
 * Groups first: French of France, then the other accents (a natural Canadian voice never beats a standard French one: the
 * accent is only chosen by hand, decision 2026-09-19), then network voices while offline (they cannot speak), then robotic
 * voices. Inside a group: quality, system default, on-device.
 */
function rank(voice: VoiceLike, online: boolean): number {
  const quality = voiceQuality(voice);
  const group = quality === 'robotic' ? 3 : !voice.localService && !online ? 2 : isFranceFrench(voice) ? 0 : 1;
  return group * 1000 + QUALITY_ORDER[quality] * 100 + (voice.default ? 0 : 2) + (voice.localService ? 0 : 1);
}

function isOnlineNow(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** French voices only: France first, then the other accents, each by quality (robotic voices last), then system default, on-device, name. */
export function sortFrenchVoices<V extends VoiceLike>(voices: readonly V[], online: boolean = isOnlineNow()): V[] {
  return voices
    .filter(isFrenchVoice)
    .slice()
    .sort((a, b) => rank(a, online) - rank(b, online) || a.name.localeCompare(b.name, 'fr'));
}

/**
 * Voice to use: the preferred URI when it is still installed (any accent chosen by hand), otherwise the best voice of France,
 * another accent only when the device has none. Robotic voices are only used when they are the only French voices. Null when
 * the device has no French voice.
 */
export function pickFrenchVoice<V extends VoiceLike>(voices: readonly V[], preferredURI: string | null, online: boolean = isOnlineNow()): V | null {
  if (preferredURI) {
    const preferred = voices.find((v) => v.voiceURI === preferredURI);
    if (preferred) return preferred;
  }
  return sortFrenchVoices(voices, online)[0] ?? null;
}

/** Best quality available among the French voices (for the « download a better voice » advice). */
export function bestFrenchVoiceQuality(voices: readonly VoiceLike[]): VoiceQuality | null {
  const best = sortFrenchVoices(voices, true)[0];
  return best ? voiceQuality(best) : null;
}

/**
 * Resolves with the installed voices. Safari fills the list late: waits for `voiceschanged` or polls until `timeoutMs`.
 * Never rejects.
 */
export function loadVoices(source: VoiceSource, timeoutMs = 1500, pollMs = 250): Promise<SpeechSynthesisVoice[]> {
  const read = (): SpeechSynthesisVoice[] => {
    try {
      return source.getVoices() ?? [];
    } catch {
      return [];
    }
  };
  const initial = read();
  if (initial.length > 0) return Promise.resolve(initial);

  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      source.removeEventListener?.('voiceschanged', onChange);
      resolve(read());
    };
    const onChange = (): void => {
      if (read().length > 0) finish();
    };
    const poll = setInterval(onChange, pollMs);
    const timer = setTimeout(finish, timeoutMs);
    source.addEventListener?.('voiceschanged', onChange);
  });
}

export async function getStoredVoiceURI(): Promise<string | null> {
  try {
    const record = await db.kv.get(TTS_VOICE_KV_KEY);
    return typeof record?.value === 'string' && record.value !== '' ? record.value : null;
  } catch {
    return null;
  }
}

export async function setStoredVoiceURI(voiceURI: string | null): Promise<void> {
  try {
    if (voiceURI) await db.kv.put({ key: TTS_VOICE_KV_KEY, value: voiceURI });
    else await db.kv.delete(TTS_VOICE_KV_KEY);
  } catch {
    // Storage unavailable: the choice only lasts for this session.
  }
}
