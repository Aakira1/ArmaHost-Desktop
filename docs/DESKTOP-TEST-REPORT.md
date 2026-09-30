# Desktop verification — 30 September 2026

- Backend tests in 1.2.0: 23 passed, one platform-specific skip, zero failures.
- Starlink tests cover VPN binding, address and password validation, adapter detection, private sharing details, scoped firewall commands, API authentication and active versus saved settings.
- Desktop smoke also verifies Starlink controls and the network panel API response.
- Packaged 1.2.0 executable passed the same smoke check and exited. Windows x64 installer and portable builds completed.
- Source Electron smoke: connected UI, four native browse controls, demo process started and stopped.
- Packaged Windows x64 executable: same smoke checks passed.
- Windows installer and portable build: completed successfully.
- Production dependency audit: zero vulnerabilities.
- Dashboard screenshot inspected: docs/screenshots/desktop.png.
- Live Arma 3 hosting, interactive native dialog selection and installer installation have not been tested.
