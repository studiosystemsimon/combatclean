// A tiny token-keyed IoC container. It exists so modules never construct each
// other directly: every dependency is registered once in the composition root
// and pulled by token.
//
// Three registration shapes:
//   registerValue     — a ready-made instance
//   registerSingleton — a factory run lazily once, then cached (the common case)
//   registerFactory   — a factory run on every resolve (transient)
//
// No decorators / reflect-metadata: factories receive the container and pull
// their own deps via `c.resolve(...)`. Explicit, debuggable, tree-shakeable.

import type { Token } from './token';

type Factory<T> = (c: Container) => T;

interface Entry<T> {
  factory: Factory<T>;
  singleton: boolean;
  hasInstance: boolean;
  instance?: T;
}

export class Container {
  private readonly entries = new Map<symbol, Entry<unknown>>();
  private readonly resolving = new Set<symbol>();

  registerValue<T>(tok: Token<T>, value: T): this {
    this.entries.set(tok.key, { factory: () => value, singleton: true, hasInstance: true, instance: value });
    return this;
  }

  registerSingleton<T>(tok: Token<T>, factory: Factory<T>): this {
    this.entries.set(tok.key, { factory, singleton: true, hasInstance: false });
    return this;
  }

  registerFactory<T>(tok: Token<T>, factory: Factory<T>): this {
    this.entries.set(tok.key, { factory, singleton: false, hasInstance: false });
    return this;
  }

  has<T>(tok: Token<T>): boolean {
    return this.entries.has(tok.key);
  }

  resolve<T>(tok: Token<T>): T {
    const entry = this.entries.get(tok.key) as Entry<T> | undefined;
    if (!entry) {
      throw new Error(`[di] Nothing registered for token "${tok.name}".`);
    }
    if (entry.singleton && entry.hasInstance) {
      return entry.instance as T;
    }
    if (this.resolving.has(tok.key)) {
      throw new Error(`[di] Circular dependency while resolving "${tok.name}".`);
    }
    this.resolving.add(tok.key);
    try {
      const value = entry.factory(this);
      if (entry.singleton) {
        entry.instance = value;
        entry.hasInstance = true;
      }
      return value;
    } finally {
      this.resolving.delete(tok.key);
    }
  }

  /** Optional resolve — returns undefined instead of throwing when unregistered. */
  tryResolve<T>(tok: Token<T>): T | undefined {
    return this.has(tok) ? this.resolve(tok) : undefined;
  }
}
