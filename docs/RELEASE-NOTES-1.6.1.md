# ArmaHost Desktop 1.6.1

## Join through the Arma 3 Launcher (new default)
**Launch Game & Join** now opens the official **Arma 3 Launcher** through Steam instead of starting the game directly. The launcher handles BattlEye, mods and game updates itself.

- The server address is copied to your clipboard. In the game, go to **Multiplayer > Server Browser > Direct Connect** and paste it.
- ArmaHost lists any mods you need to enable in the launcher first.
- If Arma 3 is already running, including a stuck copy, ArmaHost says so and suggests checking Task Manager.
- Prefer the old behaviour? Setup › Arma 3 Game Installation › **When you press Launch Game & Join** › *Start the game directly*.

## Easier hosting for friends
- **Detect my public IP**, next to the public IPv4 field, fills in your internet address. This is the only time ArmaHost contacts an outside service (ipify.org), and only when you press the button.
- **Automatic port forwarding (UPnP):** a new option that turns on Arma's own UPnP support, so the server asks your router to open the game ports. It needs UPnP enabled on the router; otherwise forward the ports manually.
- When the server is set to "this PC only", Overview now shows **Friends can't join yet: set up hosting →** next to the `127.0.0.1` address.
