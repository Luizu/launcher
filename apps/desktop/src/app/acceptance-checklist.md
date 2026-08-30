# Windows acceptance checklist — Launcher MVP

> Executable by a tester without reading internal modules. Run on a Windows
> machine with Steam installed. The API must be running locally with PostgreSQL
> migrated (see the root `README.md`), or the installer build must point at a
> deployed API.

## Setup

1. Start PostgreSQL and the Bun API.
2. Start the desktop in dev mode (`VITE_API_URL=http://localhost:3000 bun run --cwd apps/desktop tauri dev`)
   or install the CI-built installer (NSIS `.exe`/MSI).

## Flow

1. Create an account and sign in.
2. Connect Steam in the system browser.
3. Return to the app and wait for the library sync.
4. Confirm a public profile shows remote games without local paths.
5. Refresh the local scan and confirm installed Steam games are marked installed.
6. Click **Jogar** and confirm Steam launches the selected AppID.
7. Choose a remote not-installed game and click **Instalar**.
8. Confirm the UI shows **Instalando…** and the Steam Downloads page is available.
9. Complete or cancel the download in Steam and confirm the launcher reaches
   `installed` or `unknown` with a recovery action (**Verificar na Steam**).
10. Repeat with a private profile and confirm the privacy state is clear
    (*Conta conectada; biblioteca indisponível*).
11. Run with Steam closed/uninstalled and confirm the app remains usable (the
    scan returns the stable `steam-not-installed` state with a retry action).
12. Open **Usuário**, click **Abrir logs**, and confirm the native log directory
    opens in the packaged app; in browser-only dev, confirm diagnostics stay in
    the browser/terminal console.
13. Click **Sair**, confirm the session is cleared, and confirm the auth screen
    returns without showing the previous account's data.
14. Install an older release, publish a newer signed GitHub Release, confirm the
    update banner appears, and complete **Atualizar e reiniciar**.

## Sign-off

MVP is accepted when steps 1–14 pass, plus:

- The UI distinguishes public, private, unavailable, loading, empty,
  installing, installed, and unknown states.
- No local absolute paths, raw manifest fields, AppIDs, or provider protocol
  terms appear as primary copy.
- No download percentage is shown anywhere.
- Every failure has a recovery action (retry, refresh, open Steam, or return
  to authentication).
