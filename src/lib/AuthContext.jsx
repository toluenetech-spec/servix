/**
 * SERVIX AUTH CONTEXT — Phase B.
 *
 * Provides the authenticated user (or null) to the app, with session
 * resume on load via the httpOnly refresh cookie. When no API is
 * configured (`authAvailable === false`) the context reports auth as
 * unavailable and the auth pages show honest pre-launch messaging —
 * exactly the previous behaviour.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from './authApi.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(authApi.authAvailable);

  // Resume session once on app load.
  useEffect(() => {
    if (!authApi.authAvailable) return;
    let cancelled = false;
    authApi
      .resumeSession()
      .then((resumed) => {
        if (!cancelled) setUser(resumed);
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const u = await authApi.login(credentials);
    setUser(u);
    return u;
  }, []);

  const register = useCallback(async (details) => {
    const u = await authApi.register(details);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const u = await authApi.fetchMe();
    if (u) setUser(u);
    return u;
  }, []);

  const value = useMemo(
    () => ({
      user,
      initializing,
      authAvailable: authApi.authAvailable,
      login,
      register,
      logout,
      refreshUser,
      verifyEmail: authApi.verifyEmail,
      resendVerification: authApi.resendVerification,
      forgotPassword: authApi.forgotPassword,
      resetPassword: authApi.resetPassword,
      setUser,
    }),
    [user, initializing, login, register, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
