// Thin wrappers over §7 /api/auth (§15.8).
import {
  DeviceSessionsResponseSchema, type AuthStatus, type ChangePasswordRequest, type ChangePinRequest, type ContinuityConfirm,
  type DeviceNameRequest, type DeviceSession, type LoginRequest, type OkResponse, type PasswordResetConfirm, type PasswordResetRequest,
  type PinRequiredRequest, type RegisterRequest, type SetupRequest, type UnlockRequest,
} from '@aide/shared';
import { setSessionToken } from './endpoint';
import { ApiError, api } from './http';

/**
 * §29 The bundled app receives the session token once, when the session opens, and keeps it itself: it has no cookie
 * jar of its own. In the browser the field is absent and the httpOnly cookie keeps doing the work.
 */
function keepSession(status: AuthStatus): AuthStatus {
  if (typeof status.sessionToken === 'string' && status.sessionToken !== '') setSessionToken(status.sessionToken);
  return status;
}

/** A session that is no longer open leaves no token behind. */
function forgetIfSignedOut(status: AuthStatus): AuthStatus {
  if (!status.authenticated) setSessionToken(null);
  return status;
}

export const getAuthStatus = async (): Promise<AuthStatus> => forgetIfSignedOut(await api<AuthStatus>('GET', '/api/auth/status'));
export const setup = async (body: SetupRequest): Promise<AuthStatus> => keepSession(await api<AuthStatus>('POST', '/api/auth/setup', body));
/** Invitation-only sign-up (201): opens the session like login. */
export const register = async (body: RegisterRequest): Promise<AuthStatus> => keepSession(await api<AuthStatus>('POST', '/api/auth/register', body));
export const login = async (body: LoginRequest): Promise<AuthStatus> => keepSession(await api<AuthStatus>('POST', '/api/auth/login', body));
export const logout = async (): Promise<OkResponse> => {
  const done = await api<OkResponse>('POST', '/api/auth/logout');
  setSessionToken(null);
  return done;
};
export const unlock = (body: UnlockRequest): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/unlock', body);
export const lock = (): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/lock');
export const changePin = (body: ChangePinRequest): Promise<OkResponse> => api<OkResponse>('PUT', '/api/auth/pin', body);
export const changePassword = (body: ChangePasswordRequest): Promise<OkResponse> => api<OkResponse>('PUT', '/api/auth/password', body);

// ---------- §20 account security ----------

/** Code of the Réglages asked or not; the password confirms the change. */
export const setPinRequired = (body: PinRequiredRequest): Promise<AuthStatus> => api<AuthStatus>('PUT', '/api/auth/pin-required', body);

/** Name of this device in « Appareils connectés ». */
export const setDeviceName = (body: DeviceNameRequest): Promise<OkResponse> => api<OkResponse>('PUT', '/api/auth/device', body);

export async function listDeviceSessions(): Promise<DeviceSession[]> {
  const raw = await api<unknown>('GET', '/api/auth/sessions');
  const parsed = DeviceSessionsResponseSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(200, 'invalid_response', 'Invalid device list');
  return parsed.data.sessions;
}

export const signOutDevice = (id: string): Promise<OkResponse> => api<OkResponse>('DELETE', `/api/auth/sessions/${encodeURIComponent(id)}`);
export const signOutOtherDevices = (): Promise<OkResponse> => api<OkResponse>('POST', '/api/auth/sessions/revoke-others');

/** « Mot de passe oublié »: always ok (the server does not say whether the address has an account). */
export const requestPasswordReset = (body: PasswordResetRequest): Promise<OkResponse> => api<OkResponse>('POST', '/api/auth/password-reset', body);
export const confirmPasswordReset = (body: PasswordResetConfirm): Promise<OkResponse> =>
  api<OkResponse>('POST', '/api/auth/password-reset/confirm', body);

/** Link of the e-mail sent every 180 days. */
export const confirmContinuity = (body: ContinuityConfirm): Promise<OkResponse> => api<OkResponse>('POST', '/api/auth/continuity/confirm', body);
