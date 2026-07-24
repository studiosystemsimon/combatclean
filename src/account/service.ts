// === AccountService — load / commit / persist the local account ===
//
// Holds the in-memory account view, applies transaction patches through the ONE pure applier, and
// persists to the local store after each commit. A future server swap replaces `commit`'s in-process
// resolution with a REST round-trip that returns the SAME patch — callers are unchanged.
import { createLocalStore, type ILocalStore } from './store.ts';
import { ACCOUNT_DOC, applyTransaction, freshAccount } from './account.ts';
import type { AccountPatch, ClientAccountView } from '@bishop/meta-contract';

export class AccountService {
  private view: ClientAccountView;

  constructor(private readonly store: ILocalStore = createLocalStore()) {
    this.view = store.read<ClientAccountView>(ACCOUNT_DOC) ?? freshAccount();
  }

  /** The current (read-only) account view. */
  get account(): ClientAccountView {
    return this.view;
  }

  /** Apply a resolved transaction patch and persist. Returns the new view. */
  commit(patch: AccountPatch): ClientAccountView {
    this.view = applyTransaction(this.view, patch);
    this.store.write(ACCOUNT_DOC, this.view);
    return this.view;
  }
}
