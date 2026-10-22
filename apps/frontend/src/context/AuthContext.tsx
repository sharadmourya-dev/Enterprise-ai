'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  Role,
  ClearanceLevel,
  CLEARANCE_RANK,
  ISafeUser,
  ITokenPair,
  ILoginRequest,
  IRegisterRequest,
} from '@enterprise-ai/shared-types';
import { ApiClient } from '@/lib/api-client';
import { TokenStorage } from '@/lib/token-storage';

export interface AuthContextType {
  user: ISafeUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  role: Role | null;
  clearance: ClearanceLevel | null;
  isAdmin: boolean;
  hasRole: (...roles: Role[]) => boolean;
  hasClearance: (minimumClearance: ClearanceLevel) => boolean;
  login: (credentials: ILoginRequest) => Promise<void>;
  register: (data: IRegisterRequest) => Promise<ISafeUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<ISafeUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Clears user state and storage
  const handleSessionClear = useCallback(() => {
    TokenStorage.clearSession();
    setUser(null);
  }, []);

  // Atomic refresh handler passed to ApiClient for 401 retry coordination
  const handleRefreshToken = useCallback(async (): Promise<string | null> => {
    const refreshToken = TokenStorage.getRefreshToken();
    if (!refreshToken) {
      handleSessionClear();
      return null;
    }

    try {
      const tokens = await ApiClient.post<ITokenPair>(
        '/auth/refresh',
        { refreshToken },
        { skipAuth: true }
      );

      if (!tokens?.accessToken || !tokens?.refreshToken) {
        handleSessionClear();
        return null;
      }

      TokenStorage.setAccessToken(tokens.accessToken);
      TokenStorage.setRefreshToken(tokens.refreshToken);
      return tokens.accessToken;
    } catch {
      handleSessionClear();
      return null;
    }
  }, [handleSessionClear]);

  // Wire ApiClient auth callbacks
  useEffect(() => {
    ApiClient.configureAuth(
      () => TokenStorage.getAccessToken(),
      handleRefreshToken,
      handleSessionClear
    );
  }, [handleRefreshToken, handleSessionClear]);

  // Initialize session on mount using stored refresh token
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      const cachedUser = TokenStorage.getUser();
      const storedRefreshToken = TokenStorage.getRefreshToken();

      if (cachedUser && storedRefreshToken) {
        // Optimistically set cached user to prevent jarring UI shifts
        setUser(cachedUser);
      }

      if (storedRefreshToken) {
        try {
          const freshAccessToken = await handleRefreshToken();
          if (freshAccessToken && isMounted) {
            // Verify and refresh latest user claims from backend
            const profile = await ApiClient.get<ISafeUser>('/auth/me');
            if (isMounted && profile) {
              setUser(profile);
              TokenStorage.setUser(profile);
            }
          }
        } catch {
          if (isMounted) {
            handleSessionClear();
          }
        }
      }

      if (isMounted) {
        setIsLoading(false);
      }
    }

    initSession();

    return () => {
      isMounted = false;
    };
  }, [handleRefreshToken, handleSessionClear]);

  const login = useCallback(async (credentials: ILoginRequest): Promise<void> => {
    setIsLoading(true);
    try {
      const result = await ApiClient.post<{ user: ISafeUser; tokens: ITokenPair }>(
        '/auth/login',
        credentials,
        { skipAuth: true }
      );

      if (!result?.tokens?.accessToken || !result?.user) {
        throw new Error('Invalid login response from server');
      }

      TokenStorage.setAccessToken(result.tokens.accessToken);
      TokenStorage.setRefreshToken(result.tokens.refreshToken);
      TokenStorage.setUser(result.user);
      setUser(result.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (data: IRegisterRequest): Promise<ISafeUser> => {
    // Note: Public registration strictly passes email, password, name, department
    const newUser = await ApiClient.post<ISafeUser>('/auth/register', data, {
      skipAuth: true,
    });
    return newUser;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      // Best-effort remote session revocation
      await ApiClient.post('/auth/logout');
    } catch {
      // Network failure on logout must not prevent local session cleanup
    } finally {
      handleSessionClear();
    }
  }, [handleSessionClear]);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    const token = await handleRefreshToken();
    return token !== null;
  }, [handleRefreshToken]);

  // Authorization helper: Check if user has one of the allowed roles
  const hasRole = useCallback(
    (...allowedRoles: Role[]): boolean => {
      if (!user) return false;
      return allowedRoles.includes(user.role);
    },
    [user]
  );

  // Authorization helper: Hierarchical clearance level verification
  const hasClearance = useCallback(
    (minimumClearance: ClearanceLevel): boolean => {
      if (!user) return false;
      const userRank = CLEARANCE_RANK[user.securityClearance] ?? -1;
      const requiredRank = CLEARANCE_RANK[minimumClearance] ?? 999;
      return userRank >= requiredRank;
    },
    [user]
  );

  const role = user?.role ?? null;
  const clearance = user?.securityClearance ?? null;
  const isAdmin = role === Role.ADMIN || role === Role.SUPER_ADMIN;
  const isAuthenticated = Boolean(user && TokenStorage.getRefreshToken());

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      role,
      clearance,
      isAdmin,
      hasRole,
      hasClearance,
      login,
      register,
      logout,
      refreshSession,
    }),
    [
      user,
      isAuthenticated,
      isLoading,
      role,
      clearance,
      isAdmin,
      hasRole,
      hasClearance,
      login,
      register,
      logout,
      refreshSession,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
