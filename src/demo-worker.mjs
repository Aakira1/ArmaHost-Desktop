// Harmless process used only by --demo; never loads or impersonates the game.
console.log('DEMO process started. This is not an Arma 3 server.');
const heartbeat = setInterval(() => console.log('DEMO heartbeat — process is alive; no game session or players.'), 4000);
function stop() { clearInterval(heartbeat); console.log('DEMO process stopped.'); process.exit(0); }
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('disconnect', stop);
