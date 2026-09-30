import { AppError } from './config.mjs';
import { RconClient, parsePlayers } from './rcon.mjs';

export class LiveMonitor {
  constructor(manager, logs, clientFactory = options => new RconClient(options)) {
    this.manager = manager; this.logs = logs; this.clientFactory = clientFactory;
    this.child = null; this.client = null; this.pending = null; this.lastMessage = 0; this.closed = false;
    this.reset();
    this.timer = setInterval(() => { if (this.manager.child && this.manager.activeSettings?.rconEnabled) void this.refresh().catch(() => {}); else this.sync(); }, 5000);
    this.timer.unref();
  }
  reset() {
    this.data = { status: 'disabled', players: [], events: [], checkedAt: null, error: '', demo: this.manager.demo, lastMessage: null };
    this.baseline = false;
  }
  sync() {
    if (this.child !== this.manager.child) {
      this.client?.close(); this.client = null; this.child = this.manager.child; this.lastMessage = 0; this.reset();
    }
    const s = this.manager.activeSettings;
    if (!this.child) { this.data.status = 'stopped'; this.data.players = []; }
    else if (!s?.rconEnabled) this.data.status = 'disabled';
    else if (this.manager.demo && this.data.status === 'disabled') this.data.status = 'connecting';
    else if (!this.client && !this.manager.demo && !this.closed) {
      this.data.status = 'connecting';
      const child = this.child;
      this.client = this.clientFactory({ port: s.rconPort, password: s.rconPassword, onMessage: message => { if (!this.closed && this.manager.child === child) this.event('server', message); } });
    }
    return s;
  }
  snapshot() { this.sync(); return structuredClone(this.data); }
  event(type, message) {
    const entry = { time: new Date().toISOString(), type, message: this.logs.scrub(message).slice(0, 1000) };
    this.data.events.push(entry); this.data.events = this.data.events.slice(-100);
    this.logs.add(entry.message, 'rcon');
  }
  refresh() {
    const s = this.sync();
    if (this.closed || !this.child) return Promise.reject(new AppError('Start the managed server first.', 409));
    if (!s.rconEnabled) return Promise.reject(new AppError('Enable live monitoring in Setup, save and restart the server.', 409));
    if (this.pending) return this.pending;
    const child = this.child; const client = this.client;
    const task = (async () => {
      try {
        // Demo never pretends to be a real RCon connection or invents joined players.
        const players = this.manager.demo ? [] : parsePlayers(await client.command('players'));
        if (this.closed || this.manager.child !== child) return this.snapshot();
        const key = player => `${player.id}:${player.guid}:${player.name}`;
        if (this.baseline) {
          const previous = new Set(this.data.players.map(key)); const current = new Set(players.map(key));
          for (const p of players) if (!previous.has(key(p))) this.event('joined', `${p.name} appeared in the player list (slot ${p.id}).`);
          for (const p of this.data.players) if (!current.has(key(p))) this.event('left', `${p.name} left the player list (slot ${p.id}).`);
        } else for (const p of players) this.event('present', `${p.name} is already connected (slot ${p.id}).`);
        this.baseline = true; this.data.players = players;
        this.data.status = this.manager.demo ? 'demo' : 'connected'; this.data.error = '';
        this.data.checkedAt = new Date().toISOString();
      } catch (error) {
        if (this.manager.child === child && !this.closed) { this.data.status = 'disconnected'; this.data.error = this.logs.scrub(error.message); }
      }
      return this.snapshot();
    })();
    this.pending = task;
    void task.finally(() => { if (this.pending === task) this.pending = null; }).catch(() => {});
    return task;
  }
  async broadcast(message) {
    const s = this.sync();
    if (this.closed || !this.child || !s?.rconEnabled) throw new AppError('Start a server with live monitoring enabled first.', 409);
    if (typeof message !== 'string' || !/^[\x20-\x7e]{1,200}$/.test(message) || !message.trim()) throw new AppError('Use 1–200 printable ASCII characters for the message, without line breaks.');
    if (Date.now() - this.lastMessage < 10000) throw new AppError('Wait 10 seconds between test messages.', 429);
    const child = this.child; this.lastMessage = Date.now();
    try {
      const reply = this.manager.demo ? '' : await this.client.command('say -1 ' + message);
      if (this.manager.child !== child || this.closed) throw new AppError('The server changed while sending the message. Delivery is unknown.', 409);
      if (reply.trim() && !/^(?:OK|Message sent|Say command executed)\.?$/i.test(reply.trim())) throw new AppError('RCon returned: ' + this.logs.scrub(reply.trim()), 502);
      this.data.lastMessage = new Date().toISOString();
      this.event('message', this.manager.demo ? `DEMO message simulated: ${message}` : `RCon acknowledged broadcast: ${message}`);
      return { message: this.manager.demo ? 'Demo only: no in-game message was sent.' : 'RCon acknowledged the test message. Ask a connected player to confirm they saw it.', demo: this.manager.demo };
    } catch (error) {
      if (this.manager.child === child) { this.data.status = 'disconnected'; this.data.error = this.logs.scrub(error.message); }
      throw new AppError(this.logs.scrub(error.message), error.status || 502);
    }
  }
  close() { this.closed = true; clearInterval(this.timer); this.client?.close(); this.client = null; }
}
