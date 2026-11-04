"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { UserResponse } from "@fieldfix/contracts";
import {
  ApiError,
  isAbortError,
  loginApi,
  logoutApi,
  meApi,
  mfaChallengeApi,
  registerApi,
} from "./api";

/** Thrown by signIn when the account needs a second-factor code. */
export class MfaRequiredError extends Error {
  readonly mfaToken: string;

  constructor(mfaToken: string) {
    super("Two-factor code required.");
    this.name = "MfaRequiredError";
    this.mfaToken = mfaToken;
  }
}

const STORAGE_KEY = "fieldfix.auth";
const EMAIL_KEY = "fieldfix.email";

interface StoredAuth {
  token: string;
}

function readTokenFrom(store: Storage): StoredAuth | null {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "token" in parsed) {
      const token = (parsed as { token: unknown }).token;
      if (typeof token === "string" && token.length > 0) {
        return { token };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Persistent sign-ins live in localStorage; this-tab-only in sessionStorage. */
function readStored(): StoredAuth | null {
  try {
    return readTokenFrom(localStorage) ?? readTokenFrom(sessionStorage);
  } catch {
    return null;
  }
}

function readRememberedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

interface AuthContextValue {
  status: "loading" | "signed-out" | "signed-in";
  user: UserResponse | null;
  token: string | null;
  rememberedEmail: string;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  completeMfaSignIn: (mfaToken: string, code: string, remember: boolean) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  adoptSession: (user: UserResponse, token: string) => void;
  signOut: () => Promise<void>;
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Account authentication state. The login token is a bearer credential
 * for API calls (same trade-off as session tokens, documented in
 * SECURITY_REVIEW.md); it is validated against /auth/me on load.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [user, setUser] = useState<UserResponse | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [rememberedEmail, setRememberedEmail] = useState("");
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    setRememberedEmail(readRememberedEmail());
    const stored = readStored();
    if (!stored) {
      setStatus("signed-out");
      return;
    }
    const controller = new AbortController();
    void meApi(stored.token, controller.signal).then(
      (profile) => {
        setUser(profile);
        setToken(stored.token);
        setStatus("signed-in");
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) {
          return;
        }
        // Only a rejected token signs the user out for good. Network
        // blips keep the stored token so the next load retries it.
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          try {
            localStorage.removeItem(STORAGE_KEY);
            sessionStorage.removeItem(STORAGE_KEY);
          } catch {
            /* private mode */
          }
        }
        setStatus("signed-out");
      },
    );
    return () => controller.abort();
  }, [refreshCounter]);

  const persist = useCallback((next: string | null, remember: boolean) => {
    try {
      // The token lives in exactly one store: persistent or tab-scoped.
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
      if (next) {
        const store = remember ? localStorage : sessionStorage;
        store.setItem(STORAGE_KEY, JSON.stringify({ token: next }));
      }
    } catch {
      /* private mode */
    }
    setToken(next);
  }, []);

  const finishSignIn = useCallback(
    (email: string, result: { user: UserResponse; token: string }, remember: boolean) => {
      persist(result.token, remember);
      try {
        if (remember) {
          localStorage.setItem(EMAIL_KEY, email);
        } else {
          localStorage.removeItem(EMAIL_KEY);
        }
      } catch {
        /* private mode */
      }
      setRememberedEmail(remember ? email : "");
      setUser(result.user);
      setStatus("signed-in");
    },
    [persist],
  );

  const signIn = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const result = await loginApi({ email, password });
      if ("mfa_required" in result) {
        // Password accepted; hold the email for the challenge step.
        try {
          if (remember) {
            localStorage.setItem(EMAIL_KEY, email);
          }
        } catch {
          /* private mode */
        }
        setRememberedEmail(remember ? email : "");
        throw new MfaRequiredError(result.mfa_token);
      }
      finishSignIn(email, result, remember);
    },
    [finishSignIn],
  );

  const completeMfaSignIn = useCallback(
    async (mfaToken: string, code: string, remember: boolean) => {
      const result = await mfaChallengeApi({ mfa_token: mfaToken, code });
      finishSignIn(readRememberedEmail(), result, remember);
    },
    [finishSignIn],
  );

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    // Registration never signs in: the emailed confirmation link does.
    await registerApi({ name, email, password });
  }, []);

  const adoptSession = useCallback(
    (nextUser: UserResponse, nextToken: string) => {
      // Email verification proves ownership: keep the user signed in.
      persist(nextToken, true);
      setUser(nextUser);
      setStatus("signed-in");
    },
    [persist],
  );

  const signOut = useCallback(async () => {
    const current = token;
    persist(null, true);
    setUser(null);
    setStatus("signed-out");
    if (current) {
      await logoutApi(current).catch(() => undefined);
    }
  }, [persist, token]);

  const refresh = useCallback(() => setRefreshCounter((n) => n + 1), []);

  const value = useMemo(
    () => ({
      status,
      user,
      token,
      rememberedEmail,
      signIn,
      completeMfaSignIn,
      signUp,
      adoptSession,
      signOut,
      refresh,
    }),
    [
      status,
      user,
      token,
      rememberedEmail,
      signIn,
      completeMfaSignIn,
      signUp,
      adoptSession,
      signOut,
      refresh,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
