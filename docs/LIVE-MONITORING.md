# Live players and connection test

1. In Setup, keep BattlEye enabled and turn on Live server monitoring.
2. Generate an RCon password, use an unused UDP port outside the five game ports (default 2307), then save and restart.
3. In Overview > Host a server, select Check connection & refresh players. A recognised BattlEye player response sets RCON CONNECTED and lists names, slot IDs and ping.
4. Ask your friend to join, then click Send test to all players. Their confirmation that they saw the message verifies the game path from their PC. The host seeing a command acknowledgement alone does not prove that any player received it.

The list refreshes every five seconds. New and removed rows generate observed join/leave entries. Players already online on the first check are marked present. Connections that start and end between checks may be missed by list comparison, while BattlEye console events are received during the authenticated session. GUIDs and addresses are parsed internally for identity; the UI lists name, slot ID and ping. Logs may contain player identifiers from BattlEye messages.

RCon uses 127.0.0.1 only. No arbitrary command console, kick or ban operations are exposed. The only commands are players and say -1, with message validation and a 10-second broadcast limit. Timed-out commands are not automatically resent, avoiding duplicate broadcasts. Failed checks keep a clearly marked last-known player list until the server stops. Restart clears the monitor session.

The manager writes BEServer.cfg and BEServer_x64.cfg in its own runtime/BattlEye directory and launches with -BEpath. It copies the matching server BattlEye DLL from the installation, which must already be installed through Steam. Original installation configs are preserved. RCon passwords are stored locally in plain text, excluded from command previews and redacted from manager logs.

Demo mode labels checks and messages as simulated and never invents connected players. The UDP protocol was tested against a local fake server; real Arma/BattlEye operation and a remote friend still require live verification.

Sources: [BattlEye RCon protocol](https://www.battleye.com/downloads/BERConProtocol.txt), [BattlEye command documentation](https://www.battleye.com/support/documentation/), [Bohemia BattlEye configuration](https://community.bistudio.com/wiki/BattlEye).
