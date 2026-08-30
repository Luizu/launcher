import { useState } from "react";
import { InlineStatus } from "../../components/status/inline-status";
import { AuthForm, type AuthMode } from "./auth-form";
import { useSession } from "./use-session";

/** Compact loading shown while the session is still unknown. */
export function SessionLoading() {
  return (
    <div role="status" className="flex flex-1 items-center justify-center">
      <p className="text-sm text-zinc-400">Verificando sessão…</p>
    </div>
  );
}

/**
 * Single auth screen that switches between sign-in and sign-up (no second
 * route). Shows a compact loading state while the session is unknown and an
 * inline retry when the session check itself failed.
 */
export function AuthPage() {
  const { isLoading, sessionError, retry, signIn, signUp } = useSession();
  const [mode, setMode] = useState<AuthMode>("sign-in");

  if (isLoading) {
    return <SessionLoading />;
  }

  const isSignUp = mode === "sign-up";

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
      <div className="flex w-full max-w-sm flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isSignUp ? "Criar conta" : "Entrar"}
        </h1>
        <p className="text-sm text-zinc-400">
          {isSignUp
            ? "Crie sua conta para gerenciar sua biblioteca."
            : "Acesse sua conta para gerenciar sua biblioteca."}
        </p>
      </div>
      {sessionError && (
        <InlineStatus tone="error" onRetry={retry}>
          {sessionError}
        </InlineStatus>
      )}
      <AuthForm
        mode={mode}
        onSignIn={signIn}
        onSignUp={signUp}
        onToggleMode={() => setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"))}
      />
    </div>
  );
}
