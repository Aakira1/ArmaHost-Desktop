# Live map

The **Live map** page shows players, AI, vehicles and mission markers from your running dedicated server. Everything is drawn on a grid scaled to the terrain.

## Turn it on
1. Open Setup › Session configuration and enable **Live map**. You can also set the update interval (2–30 s, default 3 s).
2. Save, then press **Restart Server**, or start it.
3. Open **Live map**. The first update arrives once a mission is running.

## How it works
- When Live map is on, ArmaHost generates a tiny addon (`data/runtime/@ArmaHostMap`) and loads it with `-serverMod`.
- The addon runs **only on the dedicated server**, so players don't install anything and signature checks are unaffected.
- Its script only reads positions and markers, and writes them to the server's RPT log as `AHMAP|…` lines.
- ArmaHost already tails the RPT, so it reads those lines, draws the map and keeps them out of the Logs page.
- Limits per update: 600 units, 300 vehicles and 300 markers. With more than 300 units and vehicles, updates slow to at least every 5 s.
- Busy missions add tens of KB per minute to the RPT.

## Map images
Bohemia's terrain artwork can't be bundled, so the map defaults to a grid.

To add a picture, open a mission on that terrain, then press **Set map image…** and choose a square, top-down PNG or JPEG of the **whole** terrain (≤ 20 MB). The image is stretched to the terrain's edges and saved per terrain in `data/maps`.

## Reading the map
- **Colours:** BLUFOR blue, OPFOR red, Independent green, Civilian purple.
- **Players:** larger dots with a white ring and a name.
- **Vehicles:** squares. A filled square has crew, a faint one is empty, and a hollow one is destroyed.
- **Mission markers:** drawn in their own colour with their text. Areas show as ellipses or rectangles. The host sees every marker, regardless of side or channel.
- **Navigation:** drag to pan, scroll to zoom, and hover to see the name, side, group, vehicle and a 6-digit grid reference.
- **STALE** means no update has arrived for three intervals. The mission may have ended, the server may be loading, or the script may not be running; check the server log.

## Troubleshooting
- **"Waiting for data"**: Live map only starts after a mission is running. Check the RPT for `AHMAP|F` lines. If there are none, confirm that `-serverMod=…@ArmaHostMap` appears in the server command on Overview.
- **"Live map is off"**: the running server was started without it. Enable Live map, save, and press Restart Server.
