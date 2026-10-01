# ArmaHost Desktop 1.7.1

## Fixes
- **Copy buttons work in the desktop app.** Copying the address, the invite and the server command failed with "Write permission denied". The desktop app now copies through Windows directly.
- **Firewall helper reports the real problem.** The firewall change runs in a separate administrator window after the Windows prompt. That window's result is now passed back to ArmaHost, so a refused rule shows Windows' own reason instead of a confusing "could not be confirmed".

## Empty lobby (Role Assignment with no mission)
If the server starts without a mission, Arma waits for an admin to choose one, and everyone else sees an empty Role Assignment screen.
- **Start** now warns when no mission is chosen. You can pick one under Missions, or start anyway.
- **Admin Steam ID (Setup):** **Detect my Steam ID** finds your Steam account on this PC. You can then type `#login` in game without the admin password, and `#missions` to choose the mission.
- Overview, diagnostics and the invite message point out when no mission is set.

## Look and feel
- A new ArmaHost logo and app icon.
- The window's menu bar is hidden. Press Alt to show it.
- A tidier sidebar: version, update status with a **Check** button and an **Auto** switch, and links to Setup notes, the data folder and About.
