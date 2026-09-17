export interface GuardIssue {
  /** Stable machine code, logged in ai_requests.rejection_detail. Never contains child text. */
  code: string;
  /** Short technical detail for logs (no child free text). */
  detail: string;
  /** French instruction sent to the model for the single regeneration. */
  feedback?: string;
}

export interface GuardResult {
  ok: boolean;
  issues: GuardIssue[];
}

export const PASS: GuardResult = Object.freeze({ ok: true, issues: [] }) as GuardResult;

export function guardResult(issues: GuardIssue[]): GuardResult {
  return { ok: issues.length === 0, issues };
}

export function truncateForLog(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
