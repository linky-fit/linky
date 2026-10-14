import { Effect } from "effect";
import {
  makeConversationsRepository,
  makeTransactionsRepository,
  makeWalletRepository,
  type ConversationsRepository,
  type LinkyStore,
  type TransactionsRepository,
  type WalletRepository,
} from "@linky-fit/linksync";
import { makeSettingsRepository, type SettingsRepository } from "./shop";

/** The account's synced data, one repository per table the app uses. */
export interface Repositories {
  readonly store: LinkyStore;
  readonly transactions: TransactionsRepository;
  readonly settings: SettingsRepository;
  readonly wallet: WalletRepository;
  readonly conversations: ConversationsRepository;
}

export const makeRepositories = (store: LinkyStore): Repositories => ({
  store,
  transactions: makeTransactionsRepository(store),
  settings: makeSettingsRepository(store),
  wallet: makeWalletRepository(store),
  conversations: makeConversationsRepository(store),
});

/** Resolves once the store is hydrated; background writes wait for it, as linksync asks. */
export const whenHydrated = async (store: LinkyStore): Promise<void> => {
  let unsubscribe = () => {};
  await new Promise<void>((resolve) => {
    unsubscribe = store.subscribeHydration(resolve);
    void Effect.runPromise(store.hydrated).then((hydrated) => {
      if (hydrated) resolve();
    });
  });
  unsubscribe();
};
