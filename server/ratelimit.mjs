// A fixed-window counter per key (an IP, a user, a mail alias). `hit(key)` counts one attempt and says whether it is
// still allowed; `reset(key)` forgets a key after a success. Old windows are swept on every call; the table is capped.
export class RateLimiter {
  constructor({ max = 10, windowMs = 600000, maxKeys = 5000, now = () => Date.now() } = {}) { Object.assign(this, { max, windowMs, maxKeys, now }); this.hits = new Map(); }
  sweep(t = this.now()) { for (const [key, entry] of this.hits) if (entry.until <= t) this.hits.delete(key); }
  // True when this attempt may proceed. The attempt is counted either way, so a flood keeps the key closed.
  hit(key) {
    const t = this.now(); this.sweep(t);
    if (this.hits.size >= this.maxKeys && !this.hits.has(key)) return false;
    const entry = this.hits.get(key) || { count: 0, until: t + this.windowMs };
    entry.count++; this.hits.set(key, entry);
    return entry.count <= this.max;
  }
  remaining(key) { const entry = this.hits.get(key); return entry && entry.until > this.now() ? Math.max(0, this.max - entry.count) : this.max; }
  reset(key) { this.hits.delete(key); }
}
