# ArmaHost Desktop 1.7.0

## Who will play?
Setup now starts with one question instead of a technical toggle:
- **Just me:** the server listens on 127.0.0.1, so only this PC can join.
- **People on my home network:** the server accepts network connections, and friends use this PC's LAN address. No router changes.
- **Friends elsewhere:** also asks for your public IPv4 and shows the port forwarding, UPnP and Starlink/VPN options.

ArmaHost sets the server's network options to match. Your existing settings carry over: incoming connections off becomes Just me, and on becomes home network, or friends elsewhere when a public IP was saved.

## Invite a friend
A new Overview card builds the message to send a friend from the **running** server:
- the address and port;
- Arma 3 Launcher › Direct Connect steps;
- required mods, with Steam Workshop links when the mod has one.

The join password is only included if you tick the box. Your admin and RCon passwords, the ArmaHost link and your folders are never included.

Its **connection checklist** only marks what ArmaHost actually saw: process started, server answering on this PC, firewall rule, players on the server. Anything it can't check, such as reaching you from outside your network, says **Not tested**.

## Windows Firewall helper
**Allow this Arma server through Windows Firewall** adds one inbound rule for the server program and its 5 UDP game ports, on your current network type, after the Windows admin prompt. ArmaHost:
- shows Windows' own block rules for the server program (block rules beat allow rules) and can remove those, after you confirm;
- can remove its own rule;
- never turns the firewall off or touches other rules.

## Launcher
After starting `arma3launcher.exe`, ArmaHost now checks that it (or the game) is really running. If it closes straight away, ArmaHost asks Steam to start Arma 3 and tells you. "Start the game directly" is now labelled as the advanced option.

## Tested on real Windows
The Windows CI build now runs these on a real Windows machine, with stand-in programs instead of Arma:
- the launcher start;
- the tasklist check;
- closing a stuck copy with taskkill, while the server stand-in survives;
- adding, checking and removing the firewall rule.
