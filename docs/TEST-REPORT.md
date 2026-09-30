# Verification report — version 1.0.0

Date: 29 September 2026.

## Environment

- Debian Linux development container, Node.js 22.16.0.
- Chromium 144.0.7559.96, driven by Python Playwright for offline-rendered UI checks.
- No Windows runtime, Arma 3 executable, dedicated-server executable, Steam client, or BattlEye client was available for a real integration test.

## Automated backend suite

Command: `node --test tests/*.test.mjs`

**19 tests passed; 0 failures; 0 skipped** in the final source-tree run. The same 19-test suite also passed from a clean copied release in a temporary folder containing spaces and Unicode.

Covered behaviours include:

- Strict configuration types, names, bounds, executable allowlist and path/config injection rejection.
- Local-only defaults, optional LAN password requirement, and auto-init prerequisites.
- Server configuration generation, argument-array construction, mod scoping and password redaction.
- Atomic state writes, stale revision rejection, preset lifecycle, and preserving corrupt state files.
- Bounded redacted logs; fixture mission/mod discovery; safe text metadata parsing; Steam VDF parsing.
- Incremental RPT reads preserving partial lines.
- A real Node demo child: start, duplicate-start rejection, active-settings snapshot, restart, demo Join, and stop.
- Live-platform rejection on Linux without spawning an Arma process.
- Actual loopback HTTP requests: static UI response, CSP, token-required API reads, hostile Host/Origin rejection, static-file allowlisting, configuration writes/conflicts, start and stop.
- Malformed session keys, oversized JSON, invalid JSON/content type, cross-site fetch metadata and null Origin rejection.

The malformed Unicode-token regression was first reproduced as an internal error, then fixed to return 401 and re-tested. Request rejection is tested using native HTTP when a test client normalises restricted headers.

## Browser-rendered workflows

The container's managed Chromium policy blocks HTTP navigation. That policy was left unchanged. The UI was instead rendered from its shipped HTML/CSS/JavaScript in an offline page, with a **test-only Python bridge to the actual local HTTP backend**. Location/sessionStorage were simulated in this harness. The application distributed in the ZIP does not include or use that bridge.

This exercised configuration and mission saves, adding/removing mods, creating/loading/deleting presets, demo start/join/restart/stop, active-versus-saved connection settings, diagnostics, password-redacted logs, rejection of older configuration responses, stored-session bootstrap simulation, and the unauthenticated lock screen. No JavaScript page errors were observed.

Desktop layout at **1440 × 1080** and mobile layout at **390 × 844** were rendered and visually inspected. The mobile viewport had no document-level horizontal overflow. Screenshots are included under `docs/screenshots/` and explicitly show demo mode.

These checks do **not** establish real browser navigation, CSP enforcement during a normal page load, native sessionStorage persistence, clipboard/download integration, or Windows browser-opening behaviour. HTTP-level protections were tested separately against the real server.

## CLI / clean-copy smoke check

A copied release was run from a temporary directory containing spaces and Unicode. Verified startup, private-link generation, authenticated HTTP access, a real demo child, duplicate-instance lock rejection, redacted preview, Quit shutdown, owned-child exit, lock cleanup, and the copied 19-test suite. This is Linux path handling, not proof of Windows path handling.

All shipped JavaScript source and test files passed `node --check`. `node server.mjs --help` and duplicate-lock failure behaviour were also checked. The project has no compilation/build step and no third-party runtime packages.

## Not verified here

**Windows `.bat` execution; Windows ACL behaviour; Steam registry and installation detection on a real PC; game/server startup; mission readiness; actual game connections; BattlEye/Steam handoff; real-world mod loadouts and signatures; Windows RPT output; LAN/firewall/router behaviour; abrupt Windows console closure.**

The client directly launches an installed Arma executable; the official launcher may still be required for a BattlEye session. Stop/restart are process termination, not mission save or graceful in-game shutdown. The dashboard's RUNNING indicator reports process existence only.

Treat the first real Windows session as a vanilla integration test. Follow README.md and TROUBLESHOOTING.md before adding custom missions and mods. The tests are development evidence, not a security audit or compatibility certification.
