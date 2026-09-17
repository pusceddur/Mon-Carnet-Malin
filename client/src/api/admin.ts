// Owner-only server settings (/api/admin, parent area unlocked).
import type { InvitationConfig, UpdateInvitationRequest } from '@aide/shared';
import { api } from './http';

export const getInvitation = (): Promise<InvitationConfig> => api<InvitationConfig>('GET', '/api/admin/invitation');
export const updateInvitation = (body: UpdateInvitationRequest): Promise<InvitationConfig> =>
  api<InvitationConfig>('PUT', '/api/admin/invitation', body);
