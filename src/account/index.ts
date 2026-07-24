// account — MergeCombat's economy on the six-section blob (transactions → applyPatch), backed locally.
export { createLocalStore, type ILocalStore } from './store.ts';
export {
  ACCOUNT_DOC,
  RES,
  freshAccount,
  balance,
  canAfford,
  itemsOfKind,
  findItem,
  newIid,
  incResource,
  spendResource,
  grantItem,
  updateItem,
  removeItem,
  grantUnlock,
  setProfile,
  setFeature,
  applyTransaction,
} from './account.ts';
export { AccountService } from './service.ts';
