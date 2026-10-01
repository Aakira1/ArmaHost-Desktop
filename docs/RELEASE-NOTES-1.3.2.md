# ArmaHost Desktop 1.3.2

**Fixed dedicated-server startup so Start Dedicated Server launches only the Arma 3 server process and remains separate from launching/joining the game client.**

## Server launch
- Start only ever spawns `arma3server_x64.exe` / `arma3server.exe` (`shell:false`, `detached:true`). The executable is re-validated immediately before spawning; `arma3_x64.exe`, `arma3.exe`, `arma3battleye.exe`, launchers and client paths are rejected, as is a server path that resolves to the game file. There is no fallback to the game executable.
- The log now records `Starting dedicated server`, `Executable: <path>` and `PID: <pid>`.
- A server is no longer reported running just because Windows accepted `CreateProcess`. After spawning, the app watches for an immediate exit, confirms the PID is the configured server executable, and reports `FAILED` with the exit code and last console output otherwise. States: STARTING, RUNNING, STOPPING, STOPPED, FAILED. "Running" still does not mean the mission is ready.
- PID/session recovery and leaving the server running when the desktop app closes are unchanged; failed starts no longer leave a recoverable session file.
- Steam detection now lists dedicated-server installs before a server binary found inside the game folder.
- Empty `-mod=`: not added. It could not be verified against current Arma documentation, so vanilla launches keep their existing arguments.

## New
- **Test server is up**: queries the running server the same way the in-game browser does (Steam A2S_INFO on game port + 1) and shows its name, map, player count and response time, or an honest "no reply" with next steps.
- **Readiness badge**: ONLINE / READY · MISSION STARTED appear only when the server log shows `Host identity created.` / `Game started.` or a query succeeds.
- **Graceful stop**: with live monitoring enabled, Stop Server sends `#shutdown` over BattlEye RCon and waits up to 15 s before terminating the process. Arbitrary RCon commands remain blocked.
- **Restart on crash** (opt-in): restarts only the dedicated server after an unexpected exit, up to 3 times in 10 minutes.
- **App icon**, plus installer names that match the in-app updater (`ArmaHost.Desktop.Setup.<version>.exe`).
- **CI**: tests run on Windows for every push and pull request. Releases are built and published by GitHub Actions on a real Windows runner.

## UI
- Host and Join are separate: `Start Dedicated Server` / `Restart Server` / `Stop Server` for process 1, `Launch Game & Join` for process 2.
- Dedicated server panel: executable, PID, state, uptime, ports, mission, mods, network mode, command and latest startup error, labelled `ACTIVE SERVER CONFIG` vs `NEXT SERVER START`.
- Setup separates Dedicated Server Installation from Arma 3 Game Installation; the game path is only needed to Join. Wrong executables are flagged as you type.
- Copy server command; a Run diagnostics shortcut on startup errors.

## Diagnostics
Server executable and name, game/server difference, server directory, `server.cfg` and profile writability, UDP game ports, RCon port, BattlEye server DLL, mod folders and VPN address, each with an actionable message.
