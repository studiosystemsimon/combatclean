# di — token-keyed IoC container (register / resolve / create)

A tiny dependency-injection container so modules never construct each other: a dep is registered
once and pulled by `Token<T>`. Three shapes — `registerValue` (ready instance), `registerSingleton`
(lazy factory, cached once — the common case), `registerFactory` (transient, run per resolve).
`token<T>(name)` mints a typed key (the phantom `_type` is compile-time only).

**Invariants**
- No decorators / reflect-metadata — factories receive the container and pull their own deps via
  `c.resolve(...)`. Explicit, debuggable, tree-shakeable.
- `resolve` throws on an unregistered token, and throws on a circular dependency (it guards the
  in-progress set) rather than looping.
- Skeleton infrastructure: this port's live wiring seam is the React controller
  (`src/controller/GameContext.tsx`), not a DI composition root. The container/`Signal` primitives
  ship with the framework; only `../events` (Signal) is currently consumed (by `src/game`).
