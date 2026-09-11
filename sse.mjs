// Live updates: one in-process bus, streamed to browsers as Server-Sent Events with replay.
export class EventBus {
  constructor({ bufferSize = 1000, heartbeatMs = 25000, maxPerSession = 4, liveThrottleMs = 500 } = {}) {
    this.seq = 0; this.buffer = []; this.bufferSize = bufferSize; this.clients = new Set(); this.heartbeatMs = heartbeatMs; this.maxPerSession = maxPerSession;
    this.liveThrottleMs = liveThrottleMs; this.liveTimers = new Map(); this.listeners = new Set();
  }
  publish(type, data) {
    const event = { id: ++this.seq, type, data, at: Date.now() };
    this.buffer.push(event); if (this.buffer.length > this.bufferSize) this.buffer.shift();
    for (const client of this.clients) this.write(client, event);
    for (const listener of this.listeners) { try { listener(event); } catch {} }
    return event;
  }
  on(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  // Draft text arrives many times a second; browsers get the latest version at most twice a second per task.
  publishLive(key, type, data) {
    const pending = this.liveTimers.get(key);
    if (pending) { pending.data = data; return; }
    const entry = { data, timer: null };
    this.liveTimers.set(key, entry);
    this.publish(type, data);
    entry.timer = setTimeout(() => { this.liveTimers.delete(key); if (entry.data !== data) this.publish(type, entry.data); }, this.liveThrottleMs);
    entry.timer.unref?.();
  }
  // A client with a filter (a member of a hosted office) receives only the events it may see; a resync always passes.
  write(client, event) { if (client.filter && event.type !== 'resync' && !client.filter(event)) return; try { client.res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`); } catch { this.drop(client); } }
  drop(client) { clearInterval(client.heartbeat); this.clients.delete(client); try { client.res.end(); } catch {} }
  handle(req, res, { session = 'default', lastEventId, filter = null } = {}) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 3000\n\n`);
    const mine = [...this.clients].filter(c => c.session === session);
    while (mine.length >= this.maxPerSession) this.drop(mine.shift());
    const client = { res, session, filter, heartbeat: setInterval(() => { try { res.write(': ping\n\n'); } catch { this.drop(client); } }, this.heartbeatMs) };
    client.heartbeat.unref?.();
    this.clients.add(client);
    const after = Number(lastEventId ?? req.headers['last-event-id']);
    if (Number.isFinite(after) && after > 0) {
      const oldest = this.buffer[0]?.id ?? this.seq + 1;
      if (after < oldest - 1) this.write(client, { id: this.seq, type: 'resync', data: { reason: 'Missed updates while disconnected.' } });
      else for (const event of this.buffer) if (event.id > after) this.write(client, event);
    }
    req.on('close', () => this.drop(client));
    return client;
  }
  close() { for (const client of [...this.clients]) this.drop(client); for (const entry of this.liveTimers.values()) clearTimeout(entry.timer); this.liveTimers.clear(); }
}
