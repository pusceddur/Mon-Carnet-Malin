// §20 confirmation of use: every 180 days an e-mail asks to confirm that the account is still used; without a click within
// 14 days every device is signed out. A login with the password also counts as a confirmation. Nothing happens while
// e-mails are not configured.
import type { Knex } from 'knex';
import { createEmailToken } from '../db/repositories/emailTokens';
import { deleteUserSessions } from '../db/repositories/sessions';
import { listUsersToAskContinuity, listUsersWithExpiredContinuity, markContinuityEmailSent } from '../db/repositories/users';
import type { Mailer } from '../email/mailer';
import { continuityEmail } from '../email/templates.fr';
import type { Logger } from '../logger';

const DAY_MS = 24 * 60 * 60_000;
export const CONTINUITY = {
  /** Time between two confirmations. */
  periodMs: 180 * DAY_MS,
  /** Time to click the link before every device is signed out (also the life of the link). */
  graceMs: 14 * DAY_MS,
} as const;

export const CONTINUITY_PATH = '/confirmer';

const deadlineFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' });

export interface ContinuityReport {
  asked: number;
  failed: number;
  signedOut: number;
}

export async function runContinuity(deps: { db: Knex; now: number; mailer: Mailer; logger: Logger }): Promise<ContinuityReport> {
  const report: ContinuityReport = { asked: 0, failed: 0, signedOut: 0 };
  const { db, now, mailer } = deps;
  if (!mailer.enabled || !mailer.publicUrl) return report;

  for (const user of await listUsersToAskContinuity(db, now - CONTINUITY.periodMs)) {
    try {
      const token = await createEmailToken(db, user.id, 'continuity', now, CONTINUITY.graceMs);
      const link = `${mailer.publicUrl}${CONTINUITY_PATH}?jeton=${encodeURIComponent(token)}`;
      await mailer.send(continuityEmail(user.email, user.displayName, link, deadlineFormat.format(new Date(now + CONTINUITY.graceMs))));
      await markContinuityEmailSent(db, user.id, now);
      report.asked++;
    } catch (err) {
      // Not marked as sent: tried again at the next run, and nobody is signed out for an e-mail that did not leave.
      deps.logger.error('continuity_email_failed', { userId: user.id, error: err });
      report.failed++;
    }
  }

  for (const user of await listUsersWithExpiredContinuity(db, now - CONTINUITY.graceMs)) {
    const removed = await deleteUserSessions(db, user.id);
    if (removed > 0) {
      deps.logger.info('continuity_signed_out', { userId: user.id, sessions: removed });
      report.signedOut++;
    }
  }
  return report;
}
