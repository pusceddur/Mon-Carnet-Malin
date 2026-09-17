// Thin wrappers over §7 /api/auth (§15.8).
import type {
  AuthStatus, ChangePasswordRequest, ChangePinRequest, LoginRequest, OkResponse, RegisterRequest, SetupRequest, UnlockRequest,
} from '@aide/shared';
import { api } from './http';

export const getAuthStatus = (): Promise<AuthStatus> => api<AuthStatus>('GET', '/api/auth/status');
export const setup = (body: SetupRequest): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/setup', body);
/** Invitation-only sign-up (201): opens the session like login. */
export const register = (body: RegisterRequest): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/register', body);
export const login = (body: LoginRequest): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/login', body);
export const logout = (): Promise<OkResponse> => api<OkResponse>('POST', '/api/auth/logout');
export const unlock = (body: UnlockRequest): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/unlock', body);
export const lock = (): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/lock');
export const changePin = (body: ChangePinRequest): Promise<OkResponse> => api<OkResponse>('PUT', '/api/auth/pin', body);
export const changePassword = (body: ChangePasswordRequest): Promise<OkResponse> => api<OkResponse>('PUT', '/api/auth/password', body);
