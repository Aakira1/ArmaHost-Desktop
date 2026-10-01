# ArmaHost Desktop 1.3.2

Windows desktop edition built on Arma 3 Local Host 1.0.0. The original project is preserved in its original directory.

## Run

Download the installer or portable executable from [GitHub Releases](https://github.com/Aakira1/ArmaHost-Desktop/releases/latest). Packaged builds include their runtime; Node.js is not required. The source download does not include dist. For source development, install Node.js 22+ and run npm ci, then npm start. npm run demo runs the demo server; npm run build generates dist.

## Desktop improvements

- Native executable and folder dialogs for installations, mods and scan roots.
- Single-instance startup focuses the existing window.
- Window size persists between launches.
- Ctrl+S saves unsaved dashboard changes.
- Closing warns about unsaved edits; the dedicated server stays running.
- File menu and sidebar open the persistent data directory.
- Loopback manager uses an available port automatically.
- Sandboxed renderer, isolated preload and restricted desktop bridge.

Settings and logs live under the Windows user profile, accessible through Open data folder. Live and demo data are separate. Existing browser settings are not automatically migrated; reconfigure paths in Setup. Existing missions, mods, presets, diagnostics, launch previews and server controls are retained.

## Build and verify

npm test runs the backend tests. npm run smoke launches the real desktop UI, verifies connection and native controls, starts and stops a demo worker, and saves desktop-smoke.json plus docs/screenshots/desktop.png. npm run build creates Windows x64 installer and portable executables in dist.

The executables are unsigned. Live Arma 3 hosting requires the game and dedicated server installations and has not been verified by the demo test. The dedicated server stays running when the desktop closes. Reopen the app to reconnect; use Stop server to stop it. Passwords remain in local settings in plain text, matching the original utility.

Original documentation: docs/LEGACY-README.md. Desktop implementation: desktop/main.mjs and desktop/preload.cjs.
