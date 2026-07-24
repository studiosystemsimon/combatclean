// A typed observer primitive. Cross-module communication flows through Signals
// so modules stay decoupled (a publisher never knows its subscribers).
//
// `owner` lets a subscriber tag its listeners so they can all be torn down at
// once (e.g. when an entity is destroyed) via unsubscribeByOwner().

export type Listener<T> = (payload: T) => void;

interface Subscription<T> {
  fn: Listener<T>;
  owner?: object;
  once: boolean;
}

export class Signal<T = void> {
  private subs: Subscription<T>[] = [];

  subscribe(fn: Listener<T>, owner?: object): () => void {
    this.subs.push({ fn, owner, once: false });
    return () => this.unsubscribe(fn);
  }

  once(fn: Listener<T>, owner?: object): () => void {
    this.subs.push({ fn, owner, once: true });
    return () => this.unsubscribe(fn);
  }

  unsubscribe(fn: Listener<T>): void {
    this.subs = this.subs.filter((s) => s.fn !== fn);
  }

  unsubscribeByOwner(owner: object): void {
    this.subs = this.subs.filter((s) => s.owner !== owner);
  }

  dispatch(payload: T): void {
    // Snapshot so once-handlers / unsubscribes during dispatch are safe.
    const current = this.subs;
    let hadOnce = false;
    for (let i = 0; i < current.length; i++) {
      const s = current[i];
      s.fn(payload);
      if (s.once) hadOnce = true;
    }
    if (hadOnce) this.subs = this.subs.filter((s) => !s.once);
  }

  clear(): void {
    this.subs = [];
  }

  get listenerCount(): number {
    return this.subs.length;
  }
}
