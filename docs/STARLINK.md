# Network hosting — 1.3.0

Either person can host using this tool. In Overview choose Host a server or Join a friend. Join mode launches only the game; it does not require a local dedicated server or inbound router forwarding.

## Direct hosting without VPN software

1. In Setup > Network hosting, switch between Normal network and Starlink.
2. Normal: enable incoming connections for LAN/internet play; leave off for this PC only. Starlink direct: enable public IPv4 on an eligible service and use a router capable of forwarding. The Starlink router itself cannot forward ports; a suitable router and bypass mode may be needed.
3. Reserve the host PC's LAN IPv4 address in the router. For internet hosting, forward UDP game port through port + 4 (default 2302–2306) to that address. LAN-only hosting needs no router forwarding.
4. Enter the host router's public IPv4 for internet sharing. This is not the PC's private LAN address. CGNAT and private addresses are rejected in the public-IP field. Supplied addresses are not independently verified.
5. Set a join password, save, refresh hosting details and review the generated executable-scoped Windows Firewall command. Run it in administrator PowerShell. Start or restart the server.
6. Friends select Join a friend and enter the host's public IPv4 and game port, or use Arma's Direct Connect. Same-LAN friends use the host's LAN address. Match the game mods and enter the join password.

Public IPv4, forwarding and firewall access must be configured at the host. The app cannot bypass ISP CGNAT or configure arbitrary routers automatically. Host-side RCon monitoring stays localhost-only; its port is not forwarded. Do not share RCon credentials.

## Optional existing VPN

Starlink's advanced optional VPN route preserves older 1.2.0 configurations. Enable it only when you intend to use an existing VPN. Detect the host VPN address, allow friends access to that host through the same VPN, save and restart. Game traffic then binds only to the selected VPN address. Detection recognises adapter names rather than the shared CGNAT IP range. The app does not install or authenticate a VPN. New Starlink configurations default to direct hosting.

Copied connection details exclude passwords. Details reflect the running server until restart. Local checks do not establish remote reachability: have a friend join and confirm the in-game test message described in [Live monitoring](LIVE-MONITORING.md).

Sources: [Starlink IP addressing](https://starlink.com/support/article/1192f3ef-2a17-31d9-261a-a59d215629f4), [Tailscale game-server sharing](https://tailscale.com/docs/use-cases/personal-or-at-home-use/share-private-game-server).
