# Arma 3 Local Host

**Version 1.0.0 · Windows localhost server manager and game launcher**

A browser dashboard for starting your own Arma 3 dedicated server, launching your installed game to join it, choosing missions and mod loadouts, saving presets, and reading logs. This is an independent, unofficial utility, not a replacement game client.

The ZIP contains the complete editable source, Windows launch scripts, documentation, and automated tests. **Node.js and the game/server binaries are not bundled.** There is no npm install, build step, cloud login, subscription, or runtime package dependency.

## Start here

1. Extract the **entire** ZIP into a writable local folder, such as `C:\Arma3LocalHost`. Do not run from inside the ZIP, a network share, or a protected system folder.
2. Install **Node.js 24 LTS** from the official Node.js website. This application requires Node.js 22 or newer. Open a new terminal after installing it.
3. For a real session, install/update Arma 3 and the Arma 3 dedicated server through your existing Steam setup. Keep Steam signed in, and launch the game normally once to complete any first-run setup.
4. Double-click **`Start.bat`**. It starts the local backend and asks Windows to open your browser.
5. In **Setup**, choose **Detect Steam installs**, or paste the full executable paths manually. Review and save the results. Custom Steam libraries may require manual paths.
6. Leave mods and the mission field empty for your first test. Run diagnostics, return to **Overview**, and click **Start server**.
7. Read the logs while the server starts, then click **Join in Arma 3**. A running process is not proof that a mission is ready. For an already-open game, use Direct Connect with `127.0.0.1` and the configured game port (default `2302`).

**Try the interface first:** double-click **`Demo.bat`**. It uses a harmless Node child process instead of any Arma executable. Demo settings are isolated in `demo-data/`; they do not become your live configuration. Node.js is still required. Stop the demo manager before starting the live manager on the same dashboard port.

### Example installation paths

These are examples, not assumptions about your computer:

```text
Game:   C:\Program Files (x86)\Steam\steamapps\common\Arma 3\arma3_x64.exe
Server: C:\Program Files (x86)\Steam\steamapps\common\Arma 3 Server\arma3server_x64.exe
```

The accepted filenames are `arma3_x64.exe`, `arma3.exe`, `arma3server_x64.exe`, and `arma3server.exe`, in the appropriate game/server fields. Point to actual executable files, not shortcuts, Steam URLs, or launcher executables. Paths containing spaces and Unicode are supported. Network/device paths, quotes, control characters, and semicolon-separated paths in a single field are rejected. Add mods as separate rows instead.

## Included features

| Page | Controls |
|---|---|
| Overview | Start, stop, restart, join; owned process ID; process uptime; enabled mod count; configured player limit; live activity; redacted command/config previews. |
| Setup | Steam-library detection; executable paths; hostname; game port; player limit; join/admin passwords; difficulty; signature checking; BattlEye; persistent server; optional auto-init and LAN/network mode. |
| Missions | Scan the configured server's `MPMissions` directory or enter a mission template manually. |
| Mods | Scan installed mod roots, add folders, enable/disable, reorder, and select game + server, server-only, or game-only scope. |
| Presets | Save, load, and delete named snapshots of all settings. |
| Logs | Process output and profile `.rpt` activity, filters, pause display, and redacted text export. |

The player tile is the **configured maximum**, not the number of connected players. Uptime is **process lifetime**, not mission runtime. No readiness, FPS, player counts, ping, or gameplay telemetry is fabricated.

## The two ports

The **management dashboard** is HTTP on `127.0.0.1:3000` by default. The console prints a private URL containing a fresh `#token=...` session key. Open that entire URL; opening the bare address in a new session shows a locked screen. The browser stores the key for that tab's session and removes it from the visible address. Restarting the manager invalidates old keys.

The **game server** uses the separate game port, default `2302`. The application checks five UDP ports beginning at that port before launching. The exact services Arma opens are controlled by Arma, not by the web dashboard.

The default game mode binds to `127.0.0.1` and generates `loopback=1`. Optional LAN/network mode binds the game server to `0.0.0.0`, generates `loopback=0`, and requires a nonempty join password. **That binds all network interfaces; it is not a LAN-subnet security boundary.** Existing firewall/router rules can affect reachability. The utility does not alter those rules and disables UPnP in its generated configuration. The dashboard remains loopback-only even in LAN/network mode. Never forward the dashboard port.

## Missions

Use an installed multiplayer scenario. The mission field is its template name without `.pbo`, including the terrain suffix:

```text
ExampleCoop.Altis
MyPatrol.Stratis
```

Those are naming examples, not included playable missions. The application does not verify mission dependencies or install scenarios. Place your own mission PBO in the dedicated server's `MPMissions` directory using your normal file-management workflow, then scan. Unpacked mission directories containing `mission.sqm` are also listed.

A blank field leaves no fixed mission in the generated rotation. Select an available mission through Arma. **Auto-init** is optional and requires both a mission template and persistent server mode. Persistent server mode is not mission autosave; save using the mission's own supported mechanism.

## Mods

Install mods through your normal Arma/Steam workflow first. A scan root is a folder **containing** mod folders, such as your game's `!Workshop` folder or a Steam library's `steamapps\workshop\content\107410` folder. Scans are shallow and bounded; they do not crawl an entire drive.

- **Game + server:** sent through `-mod` to both processes.
- **Server only:** sent through `-serverMod` to the dedicated server only.
- **Game only:** sent through `-mod` to the game only.

Rows preserve your selected order within each scope. The tool does not infer load order or required dependencies. It does not download Workshop content, synchronise mods between PCs, execute metadata files, copy signing keys, or modify your installation. Where signature checking is enabled, arrange the appropriate trusted `.bikey` files in the server's `keys` folder yourself. Start vanilla before diagnosing a complex mod loadout.

## Joining, Steam, and BattlEye

The Join button starts the configured **game executable directly** with local address, port, join password, and client mod arguments. It does not automate the official launcher, negotiate Steam login, or manage a BattlEye wrapper process.

A BattlEye-enabled session may require a restart or launching through the official Arma launcher. When direct launch is rejected or the game is already running, open Arma normally with BattlEye enabled and the same required game mods, then use **Direct Connect**. There is no anti-cheat or licensing bypass. Leave BattlEye enabled unless you deliberately configure a suitable private test session.

Join uses the **running server's captured settings**, not newly edited settings. Changing the saved port/password/mods cannot silently redirect a join to a different session. Restart applies the saved configuration. The game executable path can be corrected while a server is running.

## Stop and exit

**Stop and Restart terminate the owned server process. They do not issue a graceful in-game shutdown or save the mission.** Save progress through your mission before using them. The confirmation dialog repeats this warning.

Use **Quit Local Host** or `Ctrl+C` in the console to stop the owned server and close the backend. Keep the console open while hosting. The separately launched game is left running. The manager never terminates unrelated processes by executable name and does not attach to an existing dedicated server.

A forced console close, crash, or machine shutdown can leave an unmanaged process or lose progress. Inspect Task Manager before launching another session; the tool will not guess ownership of an existing process.

## Local files and privacy

Created on first use, adjacent to the source:

```text
data/
  state.json              Settings, revision, and presets
  manager.lock            Instance lock with manager PID
  manager.log             Redacted application log
  manager.log.1           One rotated application log
  runtime/server.cfg      Generated server configuration
  profiles/               Dedicated-server profile and RPT output

demo-data/                Equivalent, isolated demo files
```

**Settings, presets, and generated server.cfg contain plain-text passwords.** File modes are requested where supported; actual protection on Windows depends on your folder permissions. There is no encryption or secure credential vault. Do not put this folder in a public share or share the private console URL. Game join arguments may also be visible to other sufficiently privileged local processes.

The log viewer redacts known configured passwords and bounds its memory buffer. Raw Arma `.rpt` files are not rewritten and can contain player identifiers, paths, or other private details. Review exports before sharing. Old raw `.rpt` files are not automatically deleted, so review disk usage periodically.

The backend binds only to IPv4 loopback, authenticates all API requests, checks Host/Origin and cross-site requests, serves a fixed asset allowlist, bounds request sizes, and launches processes without a shell. These are protections against unintended web access, not a sandbox against a malicious local user or a substituted executable.

## Commands and troubleshooting

Run these inside the extracted folder:

```powershell
node server.mjs --open
node server.mjs --demo --open
node server.mjs --open --port=3001
node --test tests/*.test.mjs
```

`npm start`, `npm run demo`, and `npm test` are equivalent shortcuts. No `npm install` is required. `Run-Tests.bat` runs the automated tests and keeps the results visible. Some tests intentionally run a harmless local child process and temporary loopback HTTP service.

Only one manager can use a given data directory. Live and demo instances have separate directories but cannot share a dashboard port. Changing the dashboard port does not change the game port.

See **[Troubleshooting](docs/TROUBLESHOOTING.md)** and **[Test report](docs/TEST-REPORT.md)**. Source layout and endpoint contracts are in **[Architecture](docs/ARCHITECTURE.md)**.

## Verification and scope

The automated backend suite and offline-rendered browser workflows were tested in a Linux container with Node.js 22.16.0. Windows batch execution, real Arma process launching, Steam/BattlEye handoff, gameplay connections, real RPT output, and LAN/firewall behaviour were **not** tested on a Windows gaming machine. Treat the first real launch as an integration test. There is no bundled executable installer or Windows service.

This version does not include remote management, RCON, player administration, scheduled restarts, Workshop downloads, mission creation, headless clients, server attachment, or automatic updates.

## Official references

Implementation and setup reference points; no game content is reproduced or bundled:

- Node.js releases: https://nodejs.org/en/about/previous-releases
- Node.js downloads: https://nodejs.org/en/download
- Node.js process spawning: https://nodejs.org/api/child_process.html
- Arma 3 startup parameters: https://community.bistudio.com/wiki/Arma_3:_Startup_Parameters
- Arma 3 server configuration: https://community.bistudio.com/wiki/Arma_3:_Server_Config_File
- Arma 3 dedicated server: https://community.bistudio.com/wiki/Arma_3:_Dedicated_Server

Node.js 24 was listed as LTS when checked on 29 September 2026. Follow official sources for changes to runtime support and game behaviour.

## Licence

The original utility source is provided under the MIT licence; see `LICENSE`. Arma 3, Steam, BattlEye, their content, and their trademarks remain with their respective owners. This utility is not affiliated with or endorsed by those organisations.
