# Architecture and maintenance

## Runtime

`Start.bat` invokes `server.mjs --open`. The entry point validates the runtime and flags, acquires a data-directory instance lock, creates the HTTP application on `127.0.0.1`, prints the private fragment-token URL, and opens the browser using Windows Explorer. Quit/Ctrl+C closes the owned server and HTTP service. No build system or external runtime packages are involved.

The frontend is vanilla JavaScript with a two-second poll. Saved state has a revision number to reject stale writes. The running server keeps a deep settings snapshot; UI drafts, saved settings, and active settings are distinct. Late frontend responses with older saved revisions are ignored.

## Source boundaries

| File | Responsibility |
|---|---|
| `server.mjs` | CLI, lock, private URL, browser opening, shutdown hooks. |
| `src/config.mjs` | Strict schema, path validation, server.cfg generation, argument arrays, command redaction. |
| `src/store.mjs` | Atomic serialized state writes, revisions, presets, corrupt-state preservation. |
| `src/process-manager.mjs` | Start/stop/restart locks, active snapshot, UDP preflight, owned process, game join. |
| `src/discovery.mjs` | Steam discovery, bounded mission/mod scans, preflight diagnostics. |
| `src/logs.mjs` | Redacted bounded log buffer, disk rotation, incremental RPT reader. |
| `src/http.mjs` | Loopback HTTP, token/Host/Origin checks, static allowlist, validated API. |
| `src/demo-worker.mjs` | Harmless child process for exercising lifecycle without Arma. |
| `public/` | Static interface, CSS, module JavaScript, original favicon. |
| `tests/` | Built-in Node test runner; fixture-driven unit and integration checks. |

## API

All `/api/` requests require `X-Arma-Token` with the current 64-character hex token. POST bodies must be JSON objects, maximum 128 KiB. Mutating configuration/preset requests carry the current `revision`. Never put tokens into shared logs or examples.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/state` | Saved configuration, preset metadata, process status and active-session summary. |
| GET | `/api/preview` | Redacted next-server command/config and active-session client command. |
| GET | `/api/logs?after=0` | Bounded incremental entries and monotonic cursor. |
| GET | `/api/logs/export` | JSON containing the current redacted log text. |
| POST | `/api/config` | `{settings, revision}`; validates the whole settings object. |
| POST | `/api/presets/create` | `{name, revision}`; captures saved settings. |
| POST | `/api/presets/load` | `{id, revision}`; changes saved settings, not an active process. |
| POST | `/api/presets/delete` | `{id, revision}`. |
| POST | `/api/discover` | Detect Steam installation candidates. |
| POST | `/api/missions/scan` | Scan saved server's MPMissions directory. |
| POST | `/api/mods/scan` | Scan saved mod-root directories. |
| POST | `/api/diagnostics` | File/platform/configuration checks. |
| POST | `/api/server/start` | Start the saved configuration unless another managed instance exists. |
| POST | `/api/server/stop` | Terminate the owned server process. |
| POST | `/api/server/restart` | Stop, then start with saved settings. |
| POST | `/api/game/join` | Launch the game with active connection/mod settings. |
| POST | `/api/quit` | Stop owned process and close manager. |

Do not expose this API outside loopback or add unrestricted commands/file paths. There is no login/account system, remote session isolation, TLS, RCON, or extension mechanism. Same-machine users/processes with access to state and tokens are within the trust boundary.

## Extension and verification

Use `node --test tests/*.test.mjs` before and after changes. Keep launch arguments as arrays with `shell:false`; never concatenate untrusted commands. Preserve configuration validation and versioned-state semantics. Add tests before modifying process lifecycle or authentication.

Windows-specific integration must be validated on Windows with legitimate installed game/server binaries. Fixture tests and demo processes do not establish game compatibility. See TEST-REPORT.md for the exact shipped test scope.
