# ArmaHost Desktop 1.4.0

## New: Live map
A new **Live map** page shows **players, AI, vehicles and mission markers** from your running dedicated server, updated every few seconds.

- **Turning it on:** go to Setup › Session configuration › **Live map**, then Restart Server.
- **Server only:** ArmaHost loads a small read-only script on the dedicated server through `-serverMod`. Players install nothing and nothing changes on their side.
- **Map view:** a grid scaled to the terrain, with pan, zoom, side colours, heading ticks, player names, vehicle states, mission markers and areas. Hover for details and a grid reference.
- **Map images:** optional, per terrain. Use **Set map image…** to choose a PNG or JPEG of the terrain.
- **Status:** a LIVE / STALE / WAITING badge, counts by side, and the time of the last update.
- **Demo mode:** shows a simulated map so you can try it without Arma.

See [docs/LIVE-MAP.md](LIVE-MAP.md) for details and troubleshooting.

## Notes
- The script and the generated addon were tested against the expected data format but not yet on a real Arma 3 server. Please report what you see.
- Position frames are written to the server RPT. Busy missions add tens of KB per minute.
