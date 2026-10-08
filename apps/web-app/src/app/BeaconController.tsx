import {
  identityFromNsec,
  parsePubkey,
  type NostrSecretKey,
  type Pubkey,
} from "@linky-fit/linkstr";
import type {
  ContactId,
  ConversationRow,
  MessageRow,
} from "@linky-fit/linksync";
import React from "react";
import { navigateTo } from "../hooks/useRouting";
import type { NativeBeaconKey } from "../platform/nativeBridge";
import { formatShortNpub } from "../utils/formatting";
import { normalizeNpubIdentifier } from "../utils/nostrNpub";
import { useBeacon, useBeaconSupport } from "./hooks/useBeacon";
import {
  useContactRows,
  useConversationRows,
  useMessageRows,
} from "./hooks/useLinksync";
import { contactIdByConversationId } from "./hooks/messages/messageRows";
import { beaconKeysFor } from "./lib/beaconKeys";
import {
  getBeaconSnapshot,
  NO_BEACON_PEERS,
  setBeaconKeyTable,
  setBeaconPeers,
  subscribeBeacon,
  takeBeaconPendingOpen,
} from "./lib/beaconStore";
import { readBlockList } from "./lib/blockList";

const KEY_TABLE_DEBOUNCE_MS = 500;

interface BeaconContact {
  readonly id: ContactId;
  readonly pubkey: Pubkey;
  readonly name: string;
}

const useBeaconContacts = (
  ownPubkey: Pubkey | null,
): ReadonlyArray<BeaconContact> => {
  const rows = useContactRows();
  return React.useMemo(() => {
    const hidden = new Set(readBlockList());
    if (ownPubkey) hidden.add(ownPubkey);
    return rows.flatMap((row) => {
      const npub = normalizeNpubIdentifier(row.npub ?? "");
      const pubkey = npub ? parsePubkey(npub) : null;
      if (!npub || !pubkey || hidden.has(pubkey)) return [];
      return [{ id: row.id, pubkey, name: row.name ?? formatShortNpub(npub) }];
    });
  }, [ownPubkey, rows]);
};

const byLastMessage = (
  contacts: ReadonlyArray<BeaconContact>,
  conversations: ReadonlyArray<ConversationRow>,
  messages: ReadonlyArray<MessageRow>,
): ReadonlyArray<BeaconContact> => {
  const contactByConversation = contactIdByConversationId(
    conversations,
    contacts,
  );
  const lastAt = new Map<string, number>();
  for (const { conversationId, createdAtSec } of messages) {
    const contactId = conversationId
      ? contactByConversation.get(conversationId)
      : undefined;
    if (!contactId || !createdAtSec) continue;
    lastAt.set(contactId, Math.max(lastAt.get(contactId) ?? 0, createdAtSec));
  }
  return [...contacts].sort(
    (a, b) => (lastAt.get(b.id) ?? 0) - (lastAt.get(a.id) ?? 0),
  );
};

/** Derives the key table while the beacon is on; recently messaged contacts get the lowest priority, so native advertises them first. */
const BeaconKeyTable = ({
  contacts,
  secretKey,
}: {
  contacts: ReadonlyArray<BeaconContact>;
  secretKey: NostrSecretKey;
}) => {
  const messages = useMessageRows();
  const conversations = useConversationRows();

  React.useEffect(() => {
    const timeout = window.setTimeout(() => {
      const ordered = byLastMessage(contacts, conversations, messages);
      const keys = beaconKeysFor(
        secretKey,
        ordered.map((contact) => contact.pubkey),
      );
      setBeaconKeyTable(
        ordered.flatMap((contact, priority): NativeBeaconKey[] => {
          const beaconKeyHex = keys.get(contact.pubkey);
          return beaconKeyHex
            ? [
                {
                  pubkey: contact.pubkey,
                  beaconKeyHex,
                  priority,
                  name: contact.name,
                },
              ]
            : [];
        }),
      );
    }, KEY_TABLE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [contacts, conversations, messages, secretKey]);

  React.useEffect(() => () => setBeaconKeyTable(null), []);
  return null;
};

const usePendingOpenConversation = (
  contacts: ReadonlyArray<BeaconContact>,
): void => {
  const pendingOpen = React.useSyncExternalStore(
    subscribeBeacon,
    () => getBeaconSnapshot().pendingOpen,
  );
  React.useEffect(() => {
    if (!pendingOpen) return;
    const contact = contacts.find(
      ({ pubkey }) => pubkey === pendingOpen.pubkey,
    );
    if (!contact) return;
    if (takeBeaconPendingOpen()) navigateTo({ route: "chat", id: contact.id });
  }, [contacts, pendingOpen]);
};

/** Mounted once in the authenticated shell: feeds contacts and keys to the beacon store and opens chats from trade notifications. */
export const BeaconController = ({ currentNsec }: { currentNsec: string }) => {
  const identity = React.useMemo(
    () => identityFromNsec(currentNsec),
    [currentNsec],
  );
  const supported = useBeaconSupport();
  const { enabled } = useBeacon();
  const contacts = useBeaconContacts(identity?.pubkey ?? null);

  React.useEffect(() => {
    const hidden = new Set(readBlockList());
    if (identity) hidden.add(identity.pubkey);
    setBeaconPeers({
      supported,
      peers: {
        contactIdByPubkey: new Map(
          contacts.map(({ pubkey, id }) => [pubkey, id]),
        ),
        hidden,
      },
      ownPubkey: identity?.pubkey ?? null,
    });
  }, [contacts, identity, supported]);

  React.useEffect(
    () => () =>
      setBeaconPeers({
        supported: false,
        peers: NO_BEACON_PEERS,
        ownPubkey: null,
      }),
    [],
  );

  usePendingOpenConversation(contacts);

  return supported && enabled && identity ? (
    <BeaconKeyTable contacts={contacts} secretKey={identity.secretKey} />
  ) : null;
};
