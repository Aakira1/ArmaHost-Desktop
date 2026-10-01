# ArmaHost Desktop 1.5.0

## Automatic updates
ArmaHost now checks for updates itself, downloads and verifies them in the background, and asks once: **Restart & update**.

- **Checks:** at startup and every 6 hours, with a **Check now** button. Automatic checking can be turned off.
- **Background download:** progress shows in the sidebar, and each download is verified against the release's SHA-256 checksum.
- **Banner:** "ArmaHost X is ready" offers **Restart & update**, **What's new** (release notes) and **Later**. You can also skip a version.
- **Installing:** the installer build updates silently and reopens. The portable build starts the new portable executable.
- **No token needed:** the old GitHub token step is gone; there is an optional field under Advanced for private forks.
- **Your server keeps running** while ArmaHost updates and is reconnected afterwards.

## UI improvements
- **Status in the top bar:** server state and uptime show on every page, with a quick **Start/Stop server** button.
- **Sidebar indicators:** a server status dot on Overview, a **LIVE** badge on Live map, and a count of new problems on Logs.
- **Logs:** error and warning lines are highlighted, and a **Problems only** filter shows just those.
- **Shortcuts:** Alt+1–7 switches pages, and clicking a notification dismisses it.

Note: 1.4.x installs use the older manual updater to get to 1.5.0. From 1.5.0 on, updates are automatic.
