# ArmaHost Desktop 1.3.0

Windows desktop edition built on Arma 3 Local Host 1.0.0. The original project is preserved in its original directory.

## Run

Choose Host a server or Join a friend in Overview. Setup includes a Normal network / Starlink switch. Starlink direct hosting requires public IPv4 and router forwarding, with no VPN software needed. See [Network setup](docs/STARLINK.md) and [Live players and test messages](docs/LIVE-MONITORING.md).

Open the installer or portable executable in dist. Packaged builds include their runtime; Node.js is not required. For source development, install Node.js 22+ and run npm ci, then npm start. npm run demo runs the harmless demo server.

## Desktop improvements

- Native executable and folder dialogs for installations, mods and scan roots.
- Single-instance startup focuses the existing window.
- Window size persists between launches.
- Ctrl+S saves unsaved dashboard changes.
- Closing warns about unsaved edits or a running managed server, then stops the owned process.
- File menu and sidebar open the persistent data directory.
- Loopback manager uses an available port automatically.
- Sandboxed renderer, isolated preload and restricted desktop bridge.
- Host/Join roles, normal LAN/internet hosting and direct Starlink hosting.
- BattlEye RCon player names, slot IDs, ping, observed connection activity and an in-game test-message button.

Settings and logs live under the Windows user profile, accessible through Open data folder. Live and demo data are separate. Existing browser settings are not automatically migrated; reconfigure paths in Setup. Existing missions, mods, presets, diagnostics, launch previews and server controls are retained.

## Build and verify

npm test runs the backend tests. npm run smoke launches the real desktop UI, verifies connection and native controls, starts and stops a demo worker, and saves desktop-smoke.json plus docs/screenshots/desktop.png. npm run build creates Windows x64 installer and portable executables in dist.

The executables are unsigned. Live Arma 3 hosting requires the game and dedicated server installations and has not been verified by the demo test. Closing the manager terminates its owned server; save mission progress first. Passwords remain in local settings in plain text, matching the original utility.

Original documentation: docs/LEGACY-README.md. Desktop implementation: desktop/main.mjs and desktop/preload.cjs.

## License

ArmaHost Desktop is licensed under the [MIT License](LICENSE). Original contributor notices are preserved. Arma 3, Steam and BattlEye remain the property of their respective owners.
