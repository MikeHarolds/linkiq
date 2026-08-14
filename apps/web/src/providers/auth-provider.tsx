'use client';

import type {
  AuthResponseDto,
  MeResponseDto,
  UserDto,
  WorkspaceSummaryDto,
} from '@linkiq/types';
import * as React from 'react';

import { api, ApiError, setAccessToken } from '@/lib/api-client';
import type {
  LoginFormValues,
  RegisterFormValues,
} from '@/lib/validations/auth';

interface AuthContextValue {
  user: UserDto | null;
  workspaces: WorkspaceSummaryDto[];
  currentWorkspaceId: string | null;
  /** True until the initial silent-refresh attempt on page load resolves. */
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Returns the freshly authenticated user directly — callers that need
   * to branch on it (e.g. the login page's post-login redirect) should
   * use this return value, not read `user` from context right after
   * calling this: the `setUser` update below hasn't necessarily flushed
   * to context consumers by the time this promise resolves. */
  login: (values: LoginFormValues) => Promise<UserDto>;
  register: (values: RegisterFormValues) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => void;
  refetchMe: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

const CURRENT_WORKSPACE_STORAGE_KEY = 'linkiq:currentWorkspaceId';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<UserDto | null>(null);
  const [workspaces, setWorkspaces] = React.useState<WorkspaceSummaryDto[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = React.useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const applyWorkspaces = React.useCallback((next: WorkspaceSummaryDto[]) => {
    setWorkspaces(next);
    setCurrentWorkspaceId((prev) => {
      if (prev && next.some((w) => w.id === prev)) {
        return prev;
      }
      const stored =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(CURRENT_WORKSPACE_STORAGE_KEY)
          : null;
      const restored =
        stored && next.some((w) => w.id === stored) ? stored : null;
      return restored ?? next[0]?.id ?? null;
    });
  }, []);

  const refetchMe = React.useCallback(async () => {
    const res = await api.get<MeResponseDto>('/auth/me');
    setUser(res.user);
    applyWorkspaces(res.workspaces);
  }, [applyWorkspaces]);

  // On mount: attempt a silent refresh using the httpOnly cookie. If it
  // succeeds, the access token is populated and we can fetch /auth/me. If
  // it fails (no cookie, expired, revoked), the user is simply signed out
  // — this is expected on a fresh visit, not an error to surface.
  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await api.post<AuthResponseDto>(
          '/auth/refresh',
          undefined,
          { skipAuthRetry: true },
        );
        if (cancelled) return;
        setAccessToken(res.accessToken);
        setUser(res.user);
        applyWorkspaces(res.workspaces);
      } catch {
        if (cancelled) return;
        setAccessToken(null);
        setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyWorkspaces]);

  const login = React.useCallback(
    async (values: LoginFormValues) => {
      const res = await api.post<AuthResponseDto>('/auth/login', values, {
        skipAuthRetry: true,
      });
      setAccessToken(res.accessToken);
      setUser(res.user);
      applyWorkspaces(res.workspaces);
      return res.user;
    },
    [applyWorkspaces],
  );

  const register = React.useCallback(
    async (values: RegisterFormValues) => {
      const res = await api.post<AuthResponseDto>('/auth/register', values, {
        skipAuthRetry: true,
      });
      setAccessToken(res.accessToken);
      setUser(res.user);
      applyWorkspaces(res.workspaces);
    },
    [applyWorkspaces],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined, { skipAuthRetry: true });
    } catch {
      // Logout is best-effort client-side regardless of network errors —
      // we still clear local state below.
    }
    setAccessToken(null);
    setUser(null);
    setWorkspaces([]);
    setCurrentWorkspaceId(null);
  }, []);

  const logoutAll = React.useCallback(async () => {
    try {
      await api.post('/auth/logout-all');
    } finally {
      setAccessToken(null);
      setUser(null);
      setWorkspaces([]);
      setCurrentWorkspaceId(null);
    }
  }, []);

  const switchWorkspace = React.useCallback((workspaceId: string) => {
    setCurrentWorkspaceId(workspaceId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CURRENT_WORKSPACE_STORAGE_KEY, workspaceId);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    workspaces,
    currentWorkspaceId,
    isLoading,
    isAuthenticated: user !== null,
    login,
    register,
    logout,
    logoutAll,
    switchWorkspace,
    refetchMe,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export { ApiError };
