// In-memory fixed-window rate limiter (bounded map; single-process).
export class RateLimiter {
  constructor({ windowMs, max, maxKeys = 10000 }) {
    this.windowMs = windowMs; this.max = max; this.maxKeys = maxKeys;
    this.hits = new Map();
  }
  /** Returns true if allowed. */
  hit(key) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || now - e.start >= this.windowMs) {
      if (this.hits.size >= this.maxKeys) this.prune(now);
      e = { start: now, count: 0 };
      this.hits.set(key, e);
    }
    e.count++;
    return e.count <= this.max;
  }
  reset(key) { this.hits.delete(key); }
  prune(now = Date.now()) {
    for (const [k, e] of this.hits) if (now - e.start >= this.windowMs) this.hits.delete(k);
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }
}
