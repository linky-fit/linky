import {
  makeConversationsRepository,
  makeOnchainTransfersRepository,
  makeWalletRepository,
  tableRepository,
  type ConversationsRepository,
  type LinkyDbSchema,
  type LinkyStore,
  type OnchainTransfersRepository,
  type TableRepository,
  type WalletRepository,
} from "@linky-fit/linksync";
import { Effect } from "effect";

export type SettingsRepository = TableRepository<LinkyDbSchema["setting"]>;

/** The account's synced data, one repository per table the app uses. */
export interface Repositories {
  readonly store: LinkyStore;
  /** Rows of the meta `setting` table; the app writes its own keys. */
  readonly settings: SettingsRepository;
  readonly wallet: WalletRepository;
  readonly conversations: ConversationsRepository;
  readonly transfers: OnchainTransfersRepository;
}

export const makeRepositories = (store: LinkyStore): Repositories => ({
  store,
  settings: tableRepository(store, "meta", "setting"),
  wallet: makeWalletRepository(store),
  conversations: makeConversationsRepository(store),
  transfers: makeOnchainTransfersRepository(store),
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
