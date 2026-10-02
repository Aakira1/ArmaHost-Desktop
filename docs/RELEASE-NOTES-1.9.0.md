# ArmaHost Desktop 1.9.0

## Launch Arma 3 works like the first version again
Since 1.4 the Launch button had picked up extra behaviour (launcher by default, extra startup flags). 1.9.0 returns it to what v1.0.0 did, and adds checks so you can see what happened.

- **Direct start by default.** Launch Arma 3 & join starts the game itself with only `-noSplash -skipIntro -connect -port -password` and your mods, as v1.0.0 did.
- **BattlEye:** with BattlEye on (the default), the game is started through Arma's own BattlEye starter, still one click, because Arma refuses a game started without it. With BattlEye off, `arma3_x64.exe` is started exactly as in v1.0.0.
- **Extras are opt-in.** *Skip the menu scene* (`-world=empty`) and *Large memory pages* are now off by default. The Arma 3 Launcher is still there as **Open Arma 3 Launcher**.
- **You can see what runs.** The exact command (password hidden) is under *What Launch Arma 3 will run* on Overview, in Setup's launch commands and in Run diagnostics. The Logs page now shows `Starting Arma 3`, `Executable:`, `Command:` and `PID:`, like Start does.
- **It checks the game started.** ArmaHost waits up to 15 seconds for the game process. If it never appears you get a clear message with where to look, and nothing is silently retried through Steam.
- **A game that is already running** is listed with a **Close Arma 3 and launch again** button instead of a bare error. Your dedicated server is never closed.

## Upgrading
Settings saved before 1.9.0 are moved to the direct start once (the launcher and menu-scene skip were the old defaults). If you prefer the launcher, choose it again under Setup; it stays chosen.

## Start Dedicated Server
Unchanged. Start still spawns only the dedicated server program, never the game.
