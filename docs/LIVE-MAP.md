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

## Base maps
Choose the base map above the map. Every option uses data you already own; nothing is downloaded.

### Topographic (default)
An in-game-style map: sea depth, relief shading, contour lines (every 10 m, or 20 m on large terrains, with a bold line every fifth), forests, roads (main roads, roads, tracks, trails), buildings, and town, hill and airport names.

- **How it's built:** the first time a terrain runs with Live map on, the ArmaHost server script reads it using standard read-only commands available on any dedicated server: `getTerrainHeightASL`, `nearestTerrainObjects`, `getRoadInfo`, `boundingBoxReal` and `nearestLocations`.
- **While it builds:** it works slowly in the background over a few minutes, and the page shows its progress. You keep using the satellite map in the meantime.
- **Caching:** the result is saved in `data/maps/topo` and drawn in the app. Next time that terrain is skipped entirely, with no extra load on the server.
- **Limits:** up to 400 × 400 height samples, 200 × 200 forest cells, 60,000 road segments, 150,000 buildings and 3,000 place names.
- **Side effects:** it adds a few MB to that session's server log (RPT), once per terrain. With very large building counts the server may hitch briefly for a moment while collecting them.

### Satellite
The terrain's own overview map, shown automatically:

1. The server script reports the loaded terrain (`worldName`) and the path of its built-in overview map, the terrain's `pictureMap` (for example `A3\map_Altis\data\pictureMap_ca.paa`).
2. ArmaHost finds that file in the `.pbo` archives of **your own installation**: the dedicated server folder, the Arma 3 game folder (including DLC folders such as Expansion and Enoch), and any enabled mod folders. It only reads the archive headers to locate it.
3. It converts the texture (DXT1/DXT5 `.paa`, up to 2048 × 2048) to PNG once and caches it in `data/maps/auto`, then draws it under the grid at the terrain's exact size.

Modded terrains work too, provided the mod is on this PC and enabled in your Mods list.

If a terrain has no picture map, or uses a texture format ArmaHost can't read, the page says why and shows the grid. You can always choose your own image with **Set map image…** (PNG or JPEG, square, whole terrain, up to 20 MB). Your image takes priority, and **Remove my image** goes back to the terrain map.

No Bohemia artwork ships with ArmaHost; images come from the game files you already own.

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
