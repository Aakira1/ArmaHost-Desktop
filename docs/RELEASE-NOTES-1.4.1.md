# ArmaHost Desktop 1.4.1

**Faster Launch Game & Join.**

- **Fast join (on by default):** the game launches with `-world=empty`, so it skips loading a terrain for its main menu and goes straight to connecting. You can turn it off in Setup › Arma 3 Game Installation.
- **Join when ready:** if you press Launch Game & Join while the dedicated server is still loading, ArmaHost offers to wait. It launches the game automatically once the server is online, judged by the server log or by the server answering a query, so the game and server don't load on the same PC at the same time. A notice shows the wait, with **Launch now** and **Cancel**. Stop and Restart stay available, and the wait gives up after 10 minutes with a clear message.
- **Large memory pages (optional):** adds `-hugePages`, which can speed up loading on PCs with plenty of RAM. Off by default.

If the game still sits at the Arma logo, check the newest `.rpt` file in `%LOCALAPPDATA%\Arma 3\`. Its last lines show what it is waiting on, for example a hidden BattlEye or Windows permission prompt, or Steam.
