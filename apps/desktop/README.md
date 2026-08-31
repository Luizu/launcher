# Fuse Launcher Desktop

Tauri 2 desktop runtime for Fuse Launcher (Windows-first). React + TypeScript shell in
Vite, native runtime in Rust under `src-tauri/`.

The product's short name is **Fuse** and its proprietary identity is **CUT**,
represented by the geometric F mark in the shell and native app icon.

## Windows prerequisites

- **Rust toolchain** — install via [rustup](https://rustup.rs). For Windows builds,
  rustup also installs the MSVC toolchain; the crate is checked on this host against
  `x86_64-pc-windows-msvc`. macOS/Linux hosts only need the native target for
  development and fixture tests.
- **WebView2 runtime** — the Tauri shell renders through Microsoft Edge WebView2. It
  ships with Windows 11 and most Windows 10 installations; if missing, install the
  Evergreen runtime from the
  [Microsoft Edge WebView2 page](https://developer.microsoft.com/microsoft-edge/webview2/).
- **Steam** — installed from the [Steam client](https://store.steampowered.com/). The
  native runtime reads the Valve registry keys and `libraryfolders.vdf` to discover
  libraries, and opens `steam://` URIs through the registered Steam protocol handler.
  The app must remain usable when Steam is absent (the scan returns the stable
  `steam-not-installed` error and the rest of the surface keeps working).

## Local development

```bash
bun run --cwd apps/desktop dev        # Vite dev server on http://localhost:5173 (strictPort)
bun run --cwd apps/desktop tauri dev  # Tauri dev window (requires Rust)
```

The full dev flow needs the API running locally: start the API first (PostgreSQL
must be up and migrated), then launch the desktop pointing at it:

```bash
VITE_API_URL=http://localhost:3000 bun run --cwd apps/desktop tauri dev
```

Requests to the local API (`http://localhost:3000/*`) and the production Railway
API use the official Tauri HTTP plugin and its native cookie store for Better
Auth sessions. Other remote or otherwise unscoped `VITE_API_URL` values use
browser `fetch` until their origin is deliberately added to both the native
capability and the transport allowlist.

Production installers are built by CI with
`VITE_API_URL=https://launcher-api-production-e506.up.railway.app`. The value is
embedded by Vite at build time, so a release does not fall back to localhost.
The CI build also synchronizes the root release version into the Tauri config and
Cargo metadata before bundling, keeping the installer filename aligned with the
release tag.

### In-app updates and diagnostics

Production Windows builds use the signed Tauri updater and check the static
manifest published at the latest GitHub Release. When a release is available,
the app shows **Atualizar e reiniciar**, downloads the signed update in-app, and
relaunches itself. `bun dev` and browser tests never call the updater.

The user menu contains **Sair** and **Abrir logs**. The latter opens the native
Tauri-managed log directory in a packaged app (and in `tauri dev`); browser-only
development keeps diagnostics in the browser/terminal console. The full setup,
Sentry projects, signing secrets, alert rules, and incident runbook are in the
private monorepo's `docs/operations/desktop-release-observability.md`.

### Windows installer signing

The current NSIS and MSI artifacts are not Authenticode-signed: the repository
does not contain a Windows code-signing certificate or GitHub secrets for one.
Windows may therefore show a SmartScreen warning or block the download. This is
different from Tauri updater signing; updater artifacts use a separate key.

To remove that warning in CI, add a real code-signing certificate as the GitHub
secrets `WINDOWS_CERTIFICATE` (base64-encoded `.pfx`) and
`WINDOWS_CERTIFICATE_PASSWORD`, then configure the certificate thumbprint,
SHA-256 digest, and timestamp service in the Windows Tauri bundle configuration.
Never commit the certificate or its private key. Until then, use the NSIS
installer's Windows SmartScreen **More info → Run anyway** path for local testing
when Windows offers it.

This Authenticode certificate is separate from the Tauri updater key. The updater
private key is `TAURI_SIGNING_PRIVATE_KEY` in GitHub Actions; only its public key
is committed in `src-tauri/tauri.conf.json`. A release also needs the matching
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret (empty only when the generated key has
no password).

For a personal test build, the CI workflow also supports a manual
`self_signed=true` run. It creates a disposable development certificate, signs
the NSIS/MSI artifacts, and uploads the public `.cer` separately. Import that
certificate into the current user's **Trusted Publishers** store before running
the matching installer; do not use this certificate for public releases.

Rust checks (run from the repo root or `apps/desktop`):

```bash
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features smoke
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --features smoke -- -D warnings
```

`tests/windows_smoke.rs` is the Windows smoke harness (gated behind the `smoke`
feature): it drives the same services the
Tauri commands use (fake Steam registry + fake opener in the deterministic scenario,
and the real `WindowsSteamRegistry` adapter in the host scenario), so the full
checklist — registry path, library scan, installed-manifest normalization, launch,
install, and status refresh — passes on any Rust host and exercises the real Steam
registry on Windows. Note the harness fakes the opener port on every host: the
OS-level `steam://` dispatch through the real opener adapter is only verified by
manual runs on a real Windows machine. Running the harness against real Steam on a
Windows machine with Steam installed is deferred and documented here.

### Tauri CLI on hosts with an old node

On hosts where the system node is too old for the CLI wrapper's syntax (e.g. node
12), `bun x tauri`/`bun run tauri` fails with a `SyntaxError`; run the wrapper with bun
instead: `bun node_modules/@tauri-apps/cli/tauri.js <args>`.

## Icons & CSP before release

- **Icons:** `src-tauri/icons/app-icon.png` is the committed 1024px source image;
  the generated desktop set is committed under the same directory and referenced
  by `bundle.icon` in `src-tauri/tauri.conf.json`. If the source changes, regenerate
  it from `apps/desktop` with `bun x tauri icon --output src-tauri/icons
  src-tauri/icons/app-icon.png`; Windows CI validates the committed set before bundling.
- **CSP:** `security.csp` is intentionally `null` for development (Tauri default; Vite
  HMR requires inline scripts). Before any release build, set a production CSP, e.g.:

  ```json
  "security": {
    "csp": "default-src 'self' ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
  }
  ```
