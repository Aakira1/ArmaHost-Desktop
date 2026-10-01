# Troubleshooting

## Start.bat closes or cannot find Node.js

Extract everything first, including `src/` and `public/`. Install Node.js 24 LTS with the normal PATH option, then open a new terminal. Run `node --version`; this project requires 22+. Run `node server.mjs --open` from the extracted folder to see the error directly. No package installation is needed. The scripts do not request elevation or change antivirus/security settings.

## Browser does not open, or asks for a session key

Copy the entire URL printed in the console, including `#token=...`. Each backend restart creates a new key. A bookmark to the bare address is not authenticated. Keep the launcher console open. Open only the printed local HTTP address, not an HTTPS variation, local HTML file, or another computer's IP.

Managed browsers or extensions may block local sites. Follow your device administrator's rules or use an approved browser; the application does not change browser policies. A tab stores its key in sessionStorage when available. With storage blocked, use the full private link after each refresh.

## Dashboard port is occupied

Close the other live/demo dashboard or choose a different management port:

```powershell
node server.mjs --open --port=3001
```

This does not change the Arma game port. The dashboard always binds to IPv4 loopback. `::1` is not supported.

## Local Host already appears to be running

Use the previous manager's console and browser. The lock prevents two writers from sharing a state directory. When no manager is running, a genuinely stale PID lock is removed automatically.

For an unreadable lock, first confirm in Task Manager that your manager is closed. Back up the data directory, then remove only `data/manager.lock` or `demo-data/manager.lock`. Do not delete it while another manager is active. An unrelated process can reuse an old PID, in which case manual investigation is necessary.

## Cannot save, or state.json is corrupt

Use a local writable folder, not Program Files, a network share, or the ZIP preview. The application deliberately preserves invalid state rather than silently resetting it. Stop the manager and back up `data/`. Restore a valid backup of `state.json`, or rename that file to keep it safe and start with new settings. Profiles and RPT files are separate.

A revision-conflict message means another tab changed settings. Copy any unsaved edits, then reload using the current private link. Apply the desired changes again. A running server retains its captured configuration until restart.

## Steam detection finds nothing

Paste the actual executable paths. Detection checks current-user Steam registry information, common Steam locations, libraryfolders.vdf, manifests, and expected installation folders; portable, unusual, inaccessible, or nonstandard installations may not be found. Use Steam's own installed-file browsing to locate your folders. Server and game installations need not be in the same library.

Only the expected Arma game/server executable names are accepted. This is not an arbitrary-program launcher. Paths containing spaces or Unicode are supported, but quotes, semicolons, control characters, and network/device shares are not.

## Server exits immediately

Read the Logs page and the raw `.rpt` under `data/profiles/`. Test a vanilla, up-to-date dedicated-server installation through your normal supported workflow. Confirm required game runtimes are installed, the executable and enabled mod folders exist, and the generated configuration is writable.

The utility generates `data/runtime/server.cfg` each start. Editing that generated file is temporary; change supported settings through the dashboard. Your original installation config is not overwritten. Mission dependencies and content correctness are Arma's responsibility, not validated by this tool.

An empty log does not prove success. Some failure output may only appear in a native dialog, Windows event logs, or Arma's own output. The real Windows paths were not exercised in the development test environment.

## Game ports are busy

Another process may already own one of the five checked UDP ports starting at the configured game port. Check for an existing dedicated server before choosing another game port in Setup. Do not terminate unrelated processes indiscriminately. If the manager was forcibly closed, inspect ownership manually; this utility does not adopt or kill servers by name.

## Server says RUNNING but joining fails

**Check whether the server is up:** press **Test server is up** on Overview. It sends the standard Steam server query (A2S_INFO) to game port + 1, the same query the in-game browser uses. A reply shows the server name, map and player count and proves the server process is answering. No reply usually means it is still loading (allow a minute, longer with mods) or it crashed; check the log. The test runs from this PC, so it does not prove friends can reach you through your router. The ONLINE / READY · MISSION STARTED badge is set only when the server log shows `Host identity created.` / `Game started.` or a query succeeds.

RUNNING means the owned process exists. It is not a game-protocol handshake or mission-ready check. Wait for Arma's startup/mission output, confirm the matching client/server versions and port, and test without mods. Use Direct Connect with `127.0.0.1`. Join only launches the game; it cannot confirm that you entered the server.

An already-open game may ignore a second launch or pass through Steam. Use the official launcher or in-game Direct Connect instead. The Join button has a 10-second cooldown to reduce duplicate launches.

## BattlEye restart or authentication message

Close the direct-launched game and start through the official Arma launcher with BattlEye enabled. Select the required game mods, then Direct Connect. Keep Steam signed in. This tool does not use an unverified wrapper command or bypass authentication. BattlEye remains enabled in the default generated server config.

## Mod signatures, missing add-ons, or a mission fails to load

Begin with no mods and no forced mission. Then add a known-working mission/loadout. Install all required dependencies; choose a scope compatible with the mod's documentation. Verify matching versions, the intended load order, and trusted `.bikey` files in the server's `keys` directory where needed.

Mod scanning is shallow: roots must contain mod folders with `addons` directories. A `.pbo` file alone is not a selectable mod directory. Junction-based Steam folders are supported by scanning their resolved directories; unreadable targets will not be usable. Nothing is downloaded, copied, repaired, or automatically trusted.

## LAN peers cannot join

LAN/network mode must be explicitly enabled and have a password. It binds the game to all interfaces; it does not restrict clients to one subnet. Peers connect to the host PC's relevant LAN address and game port, not `127.0.0.1`. Review your own firewall and network configuration; do not forward the management dashboard. No firewall/router changes are made by the tool, and LAN connections were not tested in the development environment.

## Progress lost after Stop or Restart

Those actions terminate the owned server, not an in-game save/shutdown sequence. Persistent server mode is not autosave. Save using your scenario's supported mechanism before stopping. There is no RCON integration or automatic mission backup in this release.

## Logs take disk space or contain private data

The application keeps the newest 1,000 in-memory entries and rotates its own manager log after approximately 2 MiB. This does not rotate or delete Arma's raw RPT files. Review those when the server is stopped. Viewer exports redact known configured passwords, not every possible secret or player identifier; review before sharing.

## Uninstall / update

Stop the manager and managed server. Back up `data/` somewhere private before replacing source files. Deleting the extracted project folder removes this tool and its local data only; it does not uninstall Arma or Node.js. Do not delete data you need for profiles or saved mission progress.

## Stop Server and graceful shutdown

With live monitoring (BattlEye RCon) enabled, Stop Server first asks the server to shut down cleanly with `#shutdown` and waits up to 15 seconds. If the server does not exit, or RCon is off, the process is terminated as before.

## Restart the server if it crashes

Optional (Setup › Session configuration). When the dedicated server exits with an error while running, it is restarted after 5 seconds, at most 3 times in 10 minutes. Clean exits, Stop Server and failed first starts never trigger it. It only restarts the dedicated server and never launches the game.

## The game sits at the Arma logo, or Task Manager shows two "Arma 3"
- When you host and play on the same PC, two Arma 3 processes are normal: one is your dedicated server (`arma3server_x64.exe`) and one is the game (`arma3_x64.exe`). **Run diagnostics** lists every Arma process and what it is.
- Two copies of the **game** are not normal. A copy stuck at the logo (0% CPU) stops a new one from loading. Press **Open Arma 3 Launcher**: ArmaHost lists what is running and offers **Close Arma 3 and open the launcher**. It only closes the game, BattlEye and launcher processes, never a dedicated server.
- If Windows refuses to close it (access denied), end it in Task Manager (Details tab, `arma3_x64.exe`, End task) or restart the PC.
- Use the default join method, **Open the Arma 3 Launcher**, then Direct Connect with the copied address.
- The game's own log (the newest `.rpt` in `%LOCALAPPDATA%\Arma 3\`) shows what it is waiting on.

## Open Arma 3 Launcher does nothing
- ArmaHost starts `arma3launcher.exe` from the folder of the Arma 3 game executable set in Setup. If that file isn't there, it asks Steam to start Arma 3 instead, which follows your Steam launch options. Set the game path under **Arma 3 Game Installation** and run diagnostics: the **Arma 3 Launcher** row shows the path it will use.
- If the launcher is already open, ArmaHost says so instead of opening a second one. If you can't see it, choose **Close and reopen the launcher**.
- The Logs page shows `Opened Arma 3 Launcher: <path> (PID …)` for every launch.

## Overview shows 127.0.0.1 and "this PC only"
That's the address while **Allow incoming game connections** is off: only this PC can join.

1. Turn that option on and set a join password.
2. Press **Detect my public IP**, or type your router's public IPv4.
3. Forward UDP ports 2302-2306 to this PC, or try **Automatic port forwarding (UPnP)**.
4. Save, then restart the server.
