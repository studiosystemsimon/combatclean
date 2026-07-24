// A typed key used to register and resolve a dependency from the Container.
// The phantom `_type` carries the resolved type at compile time only.

export interface Token<T> {
  readonly key: symbol;
  readonly name: string;
  /** Phantom — never read at runtime. */
  readonly _type?: T;
}

export function token<T>(name: string): Token<T> {
  return { key: Symbol(name), name };
}
