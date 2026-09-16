// STUB: client-shell — thin wrappers over §7 /api/auth
import type {
  AuthStatus, ChangePasswordRequest, ChangePinRequest, LoginRequest, OkResponse, SetupRequest, UnlockRequest,
} from '@aide/shared';
import { api } from './http';

export const getAuthStatus = (): Promise<AuthStatus> => api<AuthStatus>('GET', '/api/auth/status');
export const setup = (body: SetupRequest): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/setup', body);
export const login = (body: LoginRequest): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/login', body);
export const logout = (): Promise<OkResponse> => api<OkResponse>('POST', '/api/auth/logout');
export const unlock = (body: UnlockRequest): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/unlock', body);
export const lock = (): Promise<AuthStatus> => api<AuthStatus>('POST', '/api/auth/lock');
export const changePin = (body: ChangePinRequest): Promise<OkResponse> => api<OkResponse>('PUT', '/api/auth/pin', body);
export const changePassword = (body: ChangePasswordRequest): Promise<OkResponse> => api<OkResponse>('PUT', '/api/auth/password', body);
