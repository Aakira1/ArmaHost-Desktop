# ArmaHost Desktop 1.6.0

## Live map: real topographic maps
The Live map can now show an **in-game-style topographic map** of the terrain your server is running: sea, relief, contour lines, forests, roads, buildings, and town, hill and airport names.

- **Built by your own server** from the terrain itself, once per terrain, using standard read-only commands available on any dedicated server. Nothing is downloaded and no Bohemia artwork is bundled.
- **The first build runs in the background** for a few minutes, with progress shown on the Live map page. It's then cached, and later sessions on that terrain skip it.
- **New Base map selector:** **Topographic**, **Satellite** (the terrain's built-in map image from your game files, added in 1.5.1) or **Grid only**. Your own map image still works.
- **Restart the server once** after updating so it loads the new map script.

## Fixes
- An incomplete terrain export can no longer be cached by mistake.
