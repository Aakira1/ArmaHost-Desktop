# ArmaHost Desktop 1.7.1

Windows desktop edition built on Arma 3 Local Host 1.0.0. The original project is preserved in its original directory.

**1.7.1:** Copy buttons work in the desktop app, the menu bar is hidden, a new logo and sidebar, admin Steam ID with no password, a warning before starting without a mission, and the firewall helper now reports Windows' real error.

**1.7.0:** **Who will play?** setup (just me / home network / friends elsewhere), **Invite a friend** with an evidence-only connection checklist, and a **Windows Firewall helper**. The launcher is now confirmed to have started (Steam is the fallback).

**1.6.2:** **Open Arma 3 Launcher** starts the launcher directly from your Arma 3 folder; ArmaHost shows which Arma processes are running and can close a stuck game.

**1.6.1:** Join opens the Arma 3 Launcher; detect public IP; optional UPnP port forwarding.

**1.6.0:** Live map topographic maps built from your own server (see [Live map](docs/LIVE-MAP.md)).

**1.5.0:** automatic in-app updates (see [Updates](docs/UPDATES.md)) and UI improvements.

**1.4.0:** new Live map page showing players, AI, vehicles and markers from your server. See [Live map](docs/LIVE-MAP.md).

**1.3.2:** Start Dedicated Server launches only the Arma 3 server process; the game is launched separately by Launch Game & Join. See [release notes](docs/RELEASE-NOTES-1.3.2.md).

## Run

Choose Host a server or Join a friend in Overview. Setup includes a Normal network / Starlink switch. Starlink direct hosting requires public IPv4 and router forwarding, with no VPN software needed. See [Network setup](docs/STARLINK.md) and [Live players and test messages](docs/LIVE-MONITORING.md).

Download the installer or portable executable from [GitHub Releases](https://github.com/Aakira1/ArmaHost-Desktop/releases/latest). Open the Setup executable to install, or Portable to run without installation. Packaged builds include their runtime; Node.js is not required.

The repository and source ZIP do not include `dist`. For source development, install Node.js 22+, run `npm ci`, then `npm start`. `npm run demo` runs the demo server; `npm run build` creates the installer and portable executable in `dist`.

## Desktop improvements

- Native executable and folder dialogs for installations, mods and scan roots.
- Single-instance startup focuses the existing window.
- Window size persists between launches.
- Ctrl+S saves unsaved dashboard changes.
- Closing warns about unsaved edits; the dedicated server stays running.
- File menu and sidebar open the persistent data directory.
- Loopback manager uses an available port automatically.
- Sandboxed renderer, isolated preload and restricted desktop bridge.
- Host/Join roles, normal LAN/internet hosting and direct Starlink hosting.
- BattlEye RCon player names, slot IDs, ping, observed connection activity and an in-game test-message button.

Settings and logs live under the Windows user profile, accessible through Open data folder. Live and demo data are separate. Existing browser settings are not automatically migrated; reconfigure paths in Setup. Existing missions, mods, presets, diagnostics, launch previews and server controls are retained.

## Build and verify

npm test runs the backend tests. npm run smoke launches the real desktop UI, verifies connection and native controls, starts and stops a demo worker, and saves desktop-smoke.json plus docs/screenshots/desktop.png. npm run build creates Windows x64 installer and portable executables in dist.

The executables are unsigned. Live Arma 3 hosting requires the game and dedicated server installations. Joining launches through the official BattlEye bootstrap when enabled. An already-running game or dedicated server blocks a second launch.

The dedicated server runs independently of the desktop and stays running after closing it. Reopen ArmaHost to reconnect to the verified saved server session. Use **Stop server** to stop it; save mission progress first. A desktop renderer crash reloads the dashboard. This does not recover a dedicated server that itself crashes. Passwords remain in local settings in plain text, matching the original utility.

### Updates

Open **App updates** in the sidebar. Check for updates, download the verified installer, then install. Private repository access requires a GitHub token with Contents read access; the token is kept only in memory for the session. You can also use **Open GitHub Releases** in your signed-in browser. Portable updates reveal the downloaded executable in Explorer and close the old app; open the new file afterwards. Version 1.3.0 needs one manual update to gain this updater.

Original documentation: docs/LEGACY-README.md. Desktop implementation: desktop/main.mjs and desktop/preload.cjs.

## License

ArmaHost Desktop is licensed under the [MIT License](LICENSE). Original contributor notices are preserved. Arma 3, Steam and BattlEye remain the property of their respective owners.
