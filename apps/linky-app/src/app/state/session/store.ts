import {
  linkyScopes,
  makeContactsRepository,
  makeConversationsRepository,
  makeIdentityRepository,
  makeInboxCursorsRepository,
  makeKeryxSubscriptionsRepository,
  makeOnchainTransfersRepository,
  makeRecurringPaymentsRepository,
  makeSettingsRepository,
  makeTransactionsRepository,
  makeUnknownSendersRepository,
  makeWalletRepository,
  type LinkyStore,
} from "@linky-fit/linksync";
import { openLinkyStore } from "@linky-fit/linksync/evolu";
import { Effect, Schema } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { platformAtom } from "../platform";
import { evoluAtom } from "./evolu";
import { reportLinkyEvoluEvent } from "./evoluInspector";

export class SessionSignedOut extends Schema.TaggedError<SessionSignedOut>()(
  "SessionSignedOut",
  {},
) {}

// The store keeps this object, so the e2e rotation switch below reaches a running store.
const appScopes = {
  ...linkyScopes,
  messages: { ...linkyScopes.messages },
};

/** Test-only: rotates the messages shard after a few writes instead of at the production limits. */
export const setMessagesRotation = (enabled: boolean): void => {
  appScopes.messages.rotation = enabled
    ? { maxBytes: 256 * 1024, maxMutations: 8, cooldownMs: 0 }
    : linkyScopes.messages.rotation;
};

/** The session's shard store; see `openLinkyStore`. */
export const linkyStoreAtom = Atom.keepAlive(
  Atom.make((get) => {
    const opened = get.once(evoluAtom);
    if (opened === null) return Effect.fail(new SessionSignedOut());
    const { kv } = get.once(platformAtom);
    return Effect.promise(() =>
      openLinkyStore(opened.evolu, opened.ownerSync, {
        kv,
        scopes: appScopes,
        hasEvoluRelay: opened.hasEvoluRelay,
        onEvent: reportLinkyEvoluEvent,
      }),
    );
  }),
);

/** The store for code outside React, such as the e2e hooks. */
export const readLinkyStore = (
  registry: AtomRegistry.AtomRegistry,
): Promise<LinkyStore> =>
  Effect.runPromise(AtomRegistry.getResult(registry, linkyStoreAtom));

/** The session's app owner id; it scopes the owner's device-local storage keys. */
export const appOwnerIdAtom = Atom.keepAlive(
  Atom.mapResult(linkyStoreAtom, (store) => store.appOwner.id),
);

const repositoryAtom = <R>(make: (store: LinkyStore) => R) =>
  Atom.keepAlive(Atom.mapResult(linkyStoreAtom, make));

export const contactsRepositoryAtom = repositoryAtom(makeContactsRepository);
export const conversationsRepositoryAtom = repositoryAtom(
  makeConversationsRepository,
);
export const identityRepositoryAtom = repositoryAtom(makeIdentityRepository);
export const inboxCursorsRepositoryAtom = repositoryAtom(
  makeInboxCursorsRepository,
);
export const keryxSubscriptionsRepositoryAtom = repositoryAtom(
  makeKeryxSubscriptionsRepository,
);
export const onchainTransfersRepositoryAtom = repositoryAtom(
  makeOnchainTransfersRepository,
);
export const recurringPaymentsRepositoryAtom = repositoryAtom(
  makeRecurringPaymentsRepository,
);
export const settingsRepositoryAtom = repositoryAtom(makeSettingsRepository);
export const transactionsRepositoryAtom = repositoryAtom(
  makeTransactionsRepository,
);
export const unknownSendersRepositoryAtom = repositoryAtom(
  makeUnknownSendersRepository,
);
export const walletRepositoryAtom = repositoryAtom(makeWalletRepository);
