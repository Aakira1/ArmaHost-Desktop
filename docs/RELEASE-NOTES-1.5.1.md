# ArmaHost Desktop 1.5.1

## Live map: real terrain maps
The Live map now shows the **actual map of the terrain your server is running**, chosen automatically from what the server reports.

- The server script now also reports the terrain's built-in map image (its `pictureMap`).
- ArmaHost finds that image in your own Arma 3 game or dedicated-server files, including DLC terrains and modded terrains from enabled mods. It converts the image once and draws it under the live positions.
- If the map can't be found or read, the page explains why and keeps the grid. Your own **Set map image…** still overrides it, and removing your image goes back to the terrain map.
- Restart the server once after updating so it loads the new map script.

No Bohemia artwork is bundled; maps come from the game files you already have.
