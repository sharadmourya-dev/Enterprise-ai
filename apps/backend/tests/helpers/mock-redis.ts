export class MockRedisClient {
  private kvStore = new Map<string, { value: string; expiresAt?: number }>();
  private zsetStore = new Map<string, Array<{ score: number; member: string }>>();
  public isDown = false;

  public async get(key: string): Promise<string | null> {
    if (this.isDown) throw new Error('Connection refused: Redis is down');
    const entry = this.kvStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.kvStore.delete(key);
      return null;
    }
    return entry.value;
  }

  public async set(key: string, value: string, ...args: any[]): Promise<'OK'> {
    if (this.isDown) throw new Error('Connection refused: Redis is down');
    let expiresAt: number | undefined;
    if (args[0] === 'EX' && typeof args[1] === 'number') {
      expiresAt = Date.now() + args[1] * 1000;
    }
    this.kvStore.set(key, { value, expiresAt });
    return 'OK';
  }

  public async del(key: string): Promise<number> {
    if (this.isDown) throw new Error('Connection refused: Redis is down');
    const existed = this.kvStore.delete(key) || this.zsetStore.delete(key);
    return existed ? 1 : 0;
  }

  public async incr(key: string): Promise<number> {
    if (this.isDown) throw new Error('Connection refused: Redis is down');
    const current = await this.get(key);
    const parsed = current ? parseInt(current, 10) : 0;
    const currentNum = Number.isFinite(parsed) ? parsed : 0;
    const nextVal = currentNum + 1;
    await this.set(key, nextVal.toString());
    return nextVal;
  }

  public async ping(): Promise<string> {
    if (this.isDown) throw new Error('Connection refused: Redis is down');
    return 'PONG';
  }

  public async eval(_script: string, _numKeys: number, key: string, ...args: any[]): Promise<any> {
    if (this.isDown) throw new Error('Connection refused: Redis is down');

    // Handle atomic generation counter script
    if (key === 'rag:cache:generation' || (_script.includes('INCR') && !_script.includes('ZREMRANGEBYSCORE'))) {
      const entry = this.kvStore.get(key);
      const current = entry?.value;
      const parsed = current ? parseInt(current, 10) : 0;
      const nextVal = (!current || !Number.isFinite(parsed) || parsed < 1) ? 2 : parsed + 1;
      this.kvStore.set(key, { value: nextVal.toString() });
      return nextVal;
    }

    const now = Number(args[0]);
    const windowMs = Number(args[1]);
    const maxRequests = Number(args[2]);
    const member = String(args[3]);

    let set = this.zsetStore.get(key) || [];
    // ZREMRANGEBYSCORE key -inf (now - windowMs)
    set = set.filter((item) => item.score > now - windowMs);

    const currentCount = set.length;
    if (currentCount < maxRequests) {
      set.push({ score: now, member });
      this.zsetStore.set(key, set);
      const remaining = maxRequests - currentCount - 1;
      return [1, remaining, Math.ceil(windowMs / 1000)];
    } else {
      const oldest = set[0];
      const resetMs = oldest ? Math.max(0, oldest.score + windowMs - now) : windowMs;
      const resetSec = Math.max(1, Math.ceil(resetMs / 1000));
      return [0, 0, resetSec];
    }
  }

  public async quit(): Promise<'OK'> {
    return 'OK';
  }

  public on(_event: string, _handler: (...args: any[]) => void): this {
    return this;
  }

  public clear(): void {
    this.kvStore.clear();
    this.zsetStore.clear();
    this.isDown = false;
  }
}

export function createMockRedis(): MockRedisClient {
  return new MockRedisClient();
}
