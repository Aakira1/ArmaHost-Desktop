# Desktop verification — 30 September 2026

- Version 1.3.1: 42 tests passed, one platform-specific skip, zero failures.
- Source Electron smoke passed updater controls, renderer crash recovery and preservation of the same demo server PID, plus existing Host/Join/network/live UI checks.
- Live Windows lifecycle test: temporary dedicated server on UDP 24302 survived forced termination of its manager. A new manager verified the executable/configuration, adopted the PID and stopped it successfully.
- Launcher log showed repeated Steam Workshop subscription/connection errors. The new Join path uses the documented BattlEye bootstrap. An actual successful game join and resolution of the user's game crash remain unverified.
- Private GitHub updater fixture verifies SHA-256/size and ensures credentials are not forwarded to download storage.
- Packaged 1.3.1 desktop smoke passed all checks, including renderer crash recovery and server preservation, and exited successfully. Orphaned renderer HTTP connections are closed during desktop shutdown.

- Current 1.3.0 tests: 36 passed, one platform-specific skip, zero failures.
- Review regression verifies that closed RCon clients cancel queued messages rather than reconnecting to a replacement server.
- RCon protocol fixture verifies authentication, CRC32, out-of-order multipart replies, event acknowledgement, timeout and login rejection.
- Monitor/API tests verify player observations, stale-list handling, stop races, local generated config, authentication, message validation, rate limiting and honest demo labels.
- Join mode validates host/port, redacts passwords and works without a local server.
- Source desktop smoke passed Host/Join, direct Starlink switch, live check and test-message UI in demo mode.
- Packaged 1.3.0 executable passed those checks with an isolated test profile and exited successfully. Installer and portable builds completed.
- Starlink tests cover VPN binding, address and password validation, adapter detection, private sharing details, scoped firewall commands, API authentication and active versus saved settings.
- Desktop smoke also verifies Starlink controls and the network panel API response.
- Packaged 1.2.0 executable passed the same smoke check and exited. Windows x64 installer and portable builds completed.
- Source Electron smoke: connected UI, four native browse controls, demo process started and stopped.
- Packaged Windows x64 executable: same smoke checks passed.
- Windows installer and portable build: completed successfully.
- Production dependency audit: zero vulnerabilities.
- Dashboard screenshot inspected: docs/screenshots/desktop.png.
- Live Arma 3 hosting, interactive native dialog selection and installer installation have not been tested.
