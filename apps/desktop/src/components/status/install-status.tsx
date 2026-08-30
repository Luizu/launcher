import { ActionButton } from "../button/action-button";

export interface InstallStatusProps {
  /** The merged state that needs the status treatment. */
  state: "installing" | "unknown";
  /** Disables the Steam action while another action is pending. */
  disabled?: boolean;
  /** Opens Steam's downloads page; only offered for `unknown`. */
  onCheckSteam?: () => void;
}

/**
 * Install-state treatment for games that are installing or unverifiable.
 * `installing` renders a disabled `Instalando…` button — no percentage is
 * ever shown; `unknown` offers `Verificar na Steam` so the user can inspect
 * the download from Steam's own downloads page.
 */
export function InstallStatus({
  state,
  disabled = false,
  onCheckSteam,
}: InstallStatusProps) {
  if (state === "installing") {
    return <ActionButton disabled>Instalando…</ActionButton>;
  }
  return (
    <ActionButton
      variant="secondary"
      disabled={disabled || !onCheckSteam}
      onClick={onCheckSteam}
    >
      Verificar na Steam
    </ActionButton>
  );
}
