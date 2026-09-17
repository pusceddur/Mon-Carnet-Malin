import { DEFAULT_PARENT_SETTINGS, KID_MESSAGES, type AIResult, type ParentSettings } from '@aide/shared';

export type AIFeature = keyof ParentSettings['ai']['features'];
export type NotOk<T> = Exclude<AIResult<T>, { status: 'ok' }>;

function settingsOrDefault(settings: ParentSettings | null | undefined): ParentSettings {
  return settings ?? DEFAULT_PARENT_SETTINGS;
}

/** Whether the client should even try the online help for a feature (the server enforces the same rules). */
export function aiFeatureEnabled(settings: ParentSettings | null | undefined, feature: AIFeature): boolean {
  const s = settingsOrDefault(settings);
  return s.ai.enabled && s.ai.features[feature];
}

export function handwritingRecognitionEnabled(settings: ParentSettings | null | undefined): boolean {
  const s = settingsOrDefault(settings);
  return s.ai.enabled && s.ai.handwritingRecognition;
}

/** Child-facing message of a non-ok result: the server/client message, or the matching standard message. */
export function kidMessage<T>(result: NotOk<T>): string {
  if (result.message.trim().length > 0) return result.message;
  switch (result.status) {
    case 'not_in_text':
      return KID_MESSAGES.notInText;
    case 'blocked':
      return result.reason === 'adult_redirect' ? KID_MESSAGES.adultRedirect : KID_MESSAGES.blocked;
    case 'unavailable':
      if (result.reason === 'offline') return KID_MESSAGES.offline;
      if (result.reason === 'quota') return KID_MESSAGES.quota;
      if (result.reason === 'budget') return KID_MESSAGES.budget;
      return KID_MESSAGES.unavailable;
  }
}
