import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  getCachedAccessToken,
  signInBasicGoogle,
  signInWithGoogleWorkspace,
  signOutUser,
  subscribeToAuth,
  syncFirestoreUserProfile,
} from '../lib/firebase.ts';
import { DbUser, OnlineUser } from '../types.ts';

export interface WsEvent {
  type: string;
  payload?: unknown;
  timestamp?: number;
}

interface AuthContextValue {
  firebaseUser: User | null;
  dbUser: DbUser | null;
  accessToken: string | null;
  authReady: boolean;
  isSigningIn: boolean;
  authError: string | null;
  wsConnected: boolean;
  onlineUsers: OnlineUser[];
  lastSyncEvent: WsEvent | null;
  signIn: (
    withWorkspace?: boolean,
    includeEnterpriseChat?: boolean,
    includeEnterpriseKeep?: boolean
  ) => Promise<void>;
  signOut: () => Promise<void>;
  apiFetch: <T = unknown>(url: string, options?: RequestInit) => Promise<T>;
  refreshUserProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [lastSyncEvent, setLastSyncEvent] = useState<WsEvent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const apiFetch = useCallback(
    async <T = unknown>(url: string, options: RequestInit = {}): Promise<T> => {
      const currentUser = firebaseUser;
      if (!currentUser) {
        throw new Error('Authentication required');
      }
      const idToken = await currentUser.getIdToken();
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${idToken}`);
      if (options.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const res = await fetch(url, { ...options, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return data as T;
    },
    [firebaseUser]
  );

  const fetchMe = useCallback(async (user: User) => {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDbUser(data.user);
      }
    } catch (err) {
      console.error('Failed to sync profile:', err);
    }
  }, []);

  const refreshUserProfile = useCallback(async () => {
    if (firebaseUser) {
      await fetchMe(firebaseUser);
    }
  }, [firebaseUser, fetchMe]);

  useEffect(() => {
    const unsubscribe = subscribeToAuth(async (user) => {
      setFirebaseUser(user);
      if (user) {
        setAccessToken(getCachedAccessToken());
        await fetchMe(user);
        void syncFirestoreUserProfile(user).catch((err) => {
          console.warn('Firestore profile sync skipped:', err);
        });
      } else {
        setDbUser(null);
        setAccessToken(null);
        setOnlineUsers([]);
      }
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, [fetchMe]);

  // Real-time WebSocket connection synced with Firebase Auth
  useEffect(() => {
    if (!firebaseUser) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

    let cancelled = false;

    const connectWs = async () => {
      if (cancelled) return;
      try {
        const token = await firebaseUser.getIdToken();
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: 'auth', token }));
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'auth:ok') {
              setWsConnected(true);
            } else if (msg.type === 'presence:update') {
              setOnlineUsers(Array.isArray(msg.onlineUsers) ? msg.onlineUsers : []);
            } else if (msg.type && msg.type !== 'pong') {
              setLastSyncEvent(msg);
            }
          } catch {
            // ignore malformed frame
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          if (!cancelled) {
            reconnectTimerRef.current = window.setTimeout(() => {
              void connectWs();
            }, 3000);
          }
        };
      } catch {
        setWsConnected(false);
      }
    };

    void connectWs();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [firebaseUser]);

  const signIn = useCallback(
    async (withWorkspace = true, includeEnterpriseChat = false, includeEnterpriseKeep = false) => {
      setIsSigningIn(true);
      setAuthError(null);
      try {
        if (withWorkspace) {
          const res = await signInWithGoogleWorkspace(includeEnterpriseChat, includeEnterpriseKeep);
          setAccessToken(res.accessToken);
          await fetchMe(res.user);
          void syncFirestoreUserProfile(res.user).catch(() => undefined);
        } else {
          const res = await signInBasicGoogle();
          setAccessToken(getCachedAccessToken());
          await fetchMe(res.user);
          void syncFirestoreUserProfile(res.user).catch(() => undefined);
        }
      } catch (err: any) {
        console.error('Sign-in failed:', err);
        setAuthError(
          err?.message || 'Sign-in was canceled or blocked. Please allow popups and try again.'
        );
      } finally {
        setIsSigningIn(false);
      }
    },
    [fetchMe]
  );

  const signOut = useCallback(async () => {
    await signOutUser();
    setDbUser(null);
    setAccessToken(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        dbUser,
        accessToken,
        authReady,
        isSigningIn,
        authError,
        wsConnected,
        onlineUsers,
        lastSyncEvent,
        signIn,
        signOut,
        apiFetch,
        refreshUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
