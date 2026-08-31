# Fuse Launcher Desktop

Public source and release pipeline for the Windows desktop application. The
private monorepo contains the API and the complete development environment; this
repository intentionally contains only the desktop runtime and shared wire
contracts needed to build it.

The public desktop product is **Fuse Launcher** (short name: **Fuse**) and uses
the proprietary **CUT** identity. The canonical release tag family is
`fuse-launcher-vX.Y.Z`; the workflow accepts legacy `launcher-vX.Y.Z` tags during
the migration.

## Development

Requirements: Bun 1.3.14, Rust, WebView2 and Steam on Windows.

```bash
bun install
bun run --cwd apps/desktop dev
bun run --cwd apps/desktop tauri dev
```

Set `VITE_API_URL` when the API is running locally. Production releases receive
the deployed API URL from GitHub Actions; it is embedded at build time and is
not a credential.

## Updates and diagnostics

Production builds use the signed Tauri updater and consume the latest release
manifest from this repository. The application displays its injected product
version in the sidebar and in the diagnostics panel. The user menu can open the
native log directory in a packaged desktop runtime.

The renderer and native desktop Sentry DSNs are public runtime identifiers. The
Sentry auth token, updater private key and signing password must remain GitHub
Actions secrets and are never committed here.

## Release signing

Tauri updater signatures and Windows Authenticode signatures are different:

- the updater key validates that an update was produced by this project;
- Authenticode is the Windows trust signal for the installer itself.

Until a trusted Authenticode certificate is available, Windows may display a
SmartScreen warning. A self-signed certificate is supported only for local
testing and does not make a public release trusted by Windows.

The public repository must have an OSI-approved open-source license and a
documented signing policy before applying to the SignPath Foundation.
