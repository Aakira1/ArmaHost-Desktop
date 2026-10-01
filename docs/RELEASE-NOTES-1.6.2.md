# ArmaHost Desktop 1.6.2

## Open Arma 3 Launcher, every time
- **Open Arma 3 Launcher** is a new button on Overview and in Join a friend. It starts `arma3launcher.exe` straight from your Arma 3 folder, the same as double-clicking it. It works whether or not your server is running. If your server is running, its address is copied for Direct Connect.
- **Launch Game & Join** (with the default launcher join method) now opens the launcher at once. It no longer waits for the server to finish loading first.
- Steam is only used as a fallback when `arma3launcher.exe` can't be found next to the game executable set in Setup.

## Duplicate or stuck Arma processes
- If Arma 3 is already running, ArmaHost no longer silently refuses. It shows every Arma process with its PID and what it is: the game, the BattlEye start-up, the Arma 3 Launcher, or your dedicated server.
- **Close Arma 3 and open the launcher** closes the stuck game copies and then opens a fresh launcher. ArmaHost never closes a dedicated server.
- Hosting and playing on the same PC shows two Arma 3 processes in Task Manager: your server and your game. That is expected, and ArmaHost now says so.
- **Run diagnostics** lists the running Arma processes, flags two copies of the game, and shows which `arma3launcher.exe` will be used.
