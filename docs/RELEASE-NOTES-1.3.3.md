# ArmaHost Desktop 1.3.3

**Fixed "mod folder not found" errors for mods that are no longer in your Mods list.**

Join used the running server's start-time settings, including its mod list. That list is also restored when ArmaHost reconnects to a server that kept running after the app closed. A mod you had since removed, often a game-only mod, which Start never checks, could therefore still block Launch Game & Join, even with an empty Mods list.

- Join now uses the running server's shared (game + server) mods, which the game must match, plus your current game-only mods. Removing a game-only mod takes effect without restarting the server.
- If the running server still uses a shared mod you have since removed, the error says so and tells you to press Restart Server, instead of reporting an unknown mod.
- Overview names any mods the running server is still using that are no longer in your list.
- The "Game — active session" command preview matches what Join will launch.
- Mod-not-found errors from Start and Join say which list the mod came from.

No mod paths are built into the app; the only mod path in the UI is an input placeholder.
