import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SignInInput, SignUpInput } from "@fuse-launcher/contracts";
import { ActionButton } from "../../components/button/action-button";
import { TextField } from "../../components/input/text-field";
import { InlineStatus } from "../../components/status/inline-status";
import { toHumanReadableAuthError } from "./auth-context";

export type AuthMode = "sign-in" | "sign-up";

export interface AuthFormProps {
  mode: AuthMode;
  onSignIn: (input: SignInInput) => Promise<unknown>;
  onSignUp: (input: SignUpInput) => Promise<unknown>;
  onToggleMode?: () => void;
}

/**
 * Sign-in/sign-up form. The submit button is disabled while the request is
 * pending, the entered e-mail is preserved across failures, and rejected
 * submissions show a human-readable `role="alert"` error that receives focus.
 * Switching the mode clears the previous mode's error and password.
 */
export function AuthForm({ mode, onSignIn, onSignUp, onToggleMode }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const isSignUp = mode === "sign-up";

  // Adjust state during render when the mode prop changes (the documented
  // "storing information from previous renders" pattern): a sign-up error
  // must not be announced in sign-in mode, and the password must not carry
  // across modes. The e-mail is preserved — users often switch modes with
  // the same address.
  const [prevMode, setPrevMode] = useState(mode);
  if (mode !== prevMode) {
    setPrevMode(mode);
    setError(null);
    setPassword("");
  }

  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    if (!email || !password) {
      setError("Preencha o e-mail e a senha.");
      return;
    }

    if (error) {
      setError(null);
      // The error alert held focus; removing it would drop focus to <body>.
      // Park focus on the first field — the submit button is disabled while
      // the request is pending, so it cannot hold focus.
      event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
    }
    setPending(true);
    try {
      if (isSignUp) {
        await onSignUp({ email, password });
      } else {
        await onSignIn({ email, password });
      }
    } catch (submitError) {
      setError(toHumanReadableAuthError(submitError));
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <TextField
        label="E-mail"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={setEmail}
      />
      <TextField
        label="Senha"
        type="password"
        autoComplete={isSignUp ? "new-password" : "current-password"}
        required
        value={password}
        onChange={setPassword}
      />
      {error && (
        <InlineStatus tone="error" ref={errorRef}>
          {error}
        </InlineStatus>
      )}
      <ActionButton type="submit" disabled={pending}>
        {pending
          ? isSignUp
            ? "Criando conta…"
            : "Entrando…"
          : isSignUp
            ? "Criar conta"
            : "Entrar"}
      </ActionButton>
      {onToggleMode && (
        <button
          type="button"
          onClick={onToggleMode}
          disabled={pending}
          className="rounded text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
        >
          {isSignUp ? "Trocar para entrar" : "Trocar para criar conta"}
        </button>
      )}
    </form>
  );
}
