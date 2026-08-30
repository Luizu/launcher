import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SessionResponse, SignInInput, SignUpInput } from "@launcher/contracts";

/**
 * The slice of {@link AuthClient} the session state needs. Injected so tests
 * can drive the state machine with fakes; `AppProviders` passes the real
 * client.
 */
export interface AuthClientLike {
  getSession(): Promise<SessionResponse | null>;
  signIn(input: SignInInput): Promise<SessionResponse>;
  signUp(input: SignUpInput): Promise<SessionResponse>;
  signOut(): Promise<void>;
}

export interface AuthContextValue {
  session: SessionResponse | null;
  isLoading: boolean;
  sessionError: string | null;
  retry: () => void;
  signIn: (input: SignInInput) => Promise<SessionResponse>;
  signUp: (input: SignUpInput) => Promise<SessionResponse>;
  signOut: () => Promise<void>;
  isSigningOut: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_CHECK_FAILED = "Não foi possível verificar sua sessão. Tente novamente.";

/**
 * Reads the numeric HTTP status carried by a rejected value, if any. The
 * check is shape-based (not `instanceof`) so errors from duplicate module
 * copies, different realms, or test fakes are recognized the same way.
 */
function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function hasStatus(error: unknown, status: number): boolean {
  return errorStatus(error) === status;
}

/**
 * Maps client failures to human-readable messages. Server JSON, error codes,
 * and session internals never reach the UI. Any value carrying an HTTP
 * `status` is treated as an API error (same shape check used for the 401
 * session mapping).
 */
export function toHumanReadableAuthError(error: unknown): string {
  const status = errorStatus(error);
  switch (status) {
    case 401:
      return "E-mail ou senha incorretos.";
    case 403:
      return "Acesso negado. Entre novamente.";
    case 409:
      return "Já existe uma conta com este e-mail.";
    case 422:
      return "Dados inválidos. Verifique o e-mail e a senha.";
    case 429:
      return "Muitas tentativas. Aguarde um momento e tente novamente.";
    default:
      return status === undefined
        ? "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente."
        : "Não foi possível completar a ação. Tente novamente.";
  }
}

/**
 * Owns the session state machine. On mount it calls `getSession`; a 401 maps
 * to the signed-out state, any other failure to a retryable error. Sign-in,
 * sign-up, and sign-out run as QueryClient mutations, and a successful auth
 * change clears the query cache so no user's data leaks into the next one.
 */
export function AuthProvider({
  client,
  children,
}: {
  client: AuthClientLike;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const loadSession = useCallback(async () => {
    setIsLoading(true);
    setSessionError(null);
    try {
      setSession(await client.getSession());
    } catch (error) {
      setSession(null);
      if (!hasStatus(error, 401)) {
        setSessionError(SESSION_CHECK_FAILED);
      }
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    // The initial state already is "loading, no error", so the mount effect
    // flips only the outcome flags inside promise callbacks — never
    // synchronously in the effect body.
    let cancelled = false;
    void client
      .getSession()
      .then((result) => {
        if (!cancelled) setSession(result);
      })
      .catch((error) => {
        if (cancelled) return;
        setSession(null);
        if (!hasStatus(error, 401)) setSessionError(SESSION_CHECK_FAILED);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const signInMutation = useMutation({
    mutationFn: (input: SignInInput) => client.signIn(input),
    onSuccess: (result) => {
      setSession(result);
      queryClient.clear();
    },
  });

  const signUpMutation = useMutation({
    mutationFn: (input: SignUpInput) => client.signUp(input),
    onSuccess: (result) => {
      setSession(result);
      queryClient.clear();
    },
  });

  const signOutMutation = useMutation({
    mutationFn: () => client.signOut(),
    onSuccess: () => {
      setSession(null);
      queryClient.clear();
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      sessionError,
      retry: () => {
        void loadSession();
      },
      signIn: (input) => signInMutation.mutateAsync(input),
      signUp: (input) => signUpMutation.mutateAsync(input),
      signOut: () => signOutMutation.mutateAsync(undefined),
      isSigningOut: signOutMutation.isPending,
    }),
    [session, isLoading, sessionError, loadSession, signInMutation, signUpMutation, signOutMutation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
