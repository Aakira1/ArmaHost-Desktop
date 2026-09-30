# Host over Starlink — 1.2.0

1. Install and connect Tailscale on the host and each friend's PC.
2. Invite friends to your private network or share the host device. Allow game traffic in the VPN access policy.
3. In Setup > Host over Starlink, detect the host VPN address, enable Starlink hosting, enter a join password and save.
4. Review the generated Windows Firewall command and run it in administrator PowerShell. It permits the server executable's UDP ports at the selected VPN address.
5. Start or restart the server. Copy the friend connection details. Friends use Arma 3 Direct Connect with the VPN IP, game port, matching mods and password.

Starlink mode binds only to the selected VPN address and takes priority over LAN mode. The host game connects to that address too. Live launch checks the address is assigned to this PC. Detection identifies adapters by name rather than the 100.x range, because Starlink and Tailscale share CGNAT address space. Other VPN addresses can be entered manually.

The app does not install or authenticate the VPN, invite friends, change access policies or run firewall commands automatically. Copied details exclude the password. Network details reflect the running server until restart. Local checks do not confirm remote access or game readiness; test Direct Connect with a friend. Relay connections may increase latency.

Sources: [Starlink IP addressing](https://starlink.com/support/article/1192f3ef-2a17-31d9-261a-a59d215629f4), [Tailscale game-server sharing](https://tailscale.com/docs/use-cases/personal-or-at-home-use/share-private-game-server).
