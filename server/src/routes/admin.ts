import { type InvitationConfig, UpdateInvitationRequestSchema } from '@aide/shared';
import { Router } from 'express';
import {
  generateInviteCode, getInvitation, resetInvitationFailures, saveInvitation,
} from '../auth/invitation';
import { parentIdOf, requireAuth, requireOwner, requireParentUnlock } from '../auth/middleware';
import { parseOrThrow } from '../errors';
import type { AppDeps } from '../types';

/** Mounted by app.ts at `/api/admin`: server-wide settings reserved to the owner account (unlocked). */
export function createAdminRouter(deps: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(deps), requireParentUnlock(deps), requireOwner(deps));

  router.get('/invitation', async (_req, res) => {
    const body: InvitationConfig = await getInvitation(deps.db);
    res.set('Cache-Control', 'no-store').json(body);
  });

  router.put('/invitation', async (req, res) => {
    const body = parseOrThrow(UpdateInvitationRequestSchema, req.body);
    const now = deps.now();
    const current = await getInvitation(deps.db);
    let code = current.code;
    if (body.regenerate === true) code = generateInviteCode();
    else if (body.code !== undefined) code = body.code;
    // Opening registrations always needs a code.
    if (body.enabled && code === '') code = generateInviteCode();
    await saveInvitation(deps.db, { enabled: body.enabled, code }, now);
    if (code !== current.code) await resetInvitationFailures(deps.db, now);
    deps.logger.info('invitation_updated', { userId: parentIdOf(req), enabled: body.enabled, codeChanged: code !== current.code });
    const updated: InvitationConfig = await getInvitation(deps.db);
    res.set('Cache-Control', 'no-store').json(updated);
  });

  return router;
}
