import { useAtomValue } from "@linky-fit/linkstr-react";
import React from "react";
import { deriveDefaultProfile } from "../../../derivedProfile";
import type { Route } from "../../../types/route";
import { parseProfileGeneralStatus } from "../../../nostrStatus";
import { getContactGroups } from "../../../utils/contactGroups";
import { formatShortNpub } from "../../../utils/formatting";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { unknownNamesAtom } from "../../state/contacts/chatContacts";
import { unknownSendersAtom } from "../../state/contacts/displayContacts";
import { profileCacheAtom } from "../../state/contacts/profiles";
import { contactsAtom } from "../../state/contacts/readModel";
import { currentNpubAtom } from "../../state/session/session";
import type {
  ContactRowLike,
  ProxyPaymentPayerContact,
} from "../../types/appTypes";
import { normalizePubkeyHex } from "../messages/contactIdentity";
import { useTranslation } from "../shell";

export type DisplayContact = ContactRowLike & {
  isUnknownContact?: boolean;
  unknownPubkeyHex?: string | null;
};

export interface ChatSelectedContact {
  chatPeerSeenAtSec?: number | null;
  chatPeerSeenSinceSec?: number | null;
  groupName?: string | null;
  id: string;
  isUnknownContact?: boolean;
  lnAddress?: string | null;
  name?: string | null;
  npub?: string | null;
  unknownPubkeyHex?: string | null;
}

/** The saved contacts with their conversation's read cursors, newest first. */
export const useContacts = () => useAtomValue(contactsAtom);

/** Profile statuses by npub, as the profile watch last saw them. */
export const useNostrStatusByNpub = () =>
  useAtomValue(profileCacheAtom, (cache) => cache.statusByNpub);

const routeContactId = (route: Route): string | null =>
  route.kind === "contact" ||
  route.kind === "contactEdit" ||
  route.kind === "contactPay" ||
  route.kind === "chat"
    ? route.id
    : route.kind === "bankPaymentOffer"
      ? route.chatId
      : null;

/** The saved contact the route is about, if any. */
export const useRouteContact = (route: Route) => {
  const contacts = useContacts();
  const id = routeContactId(route);
  return React.useMemo(
    () => (id ? (contacts.find((contact) => contact.id === id) ?? null) : null),
    [contacts, id],
  );
};

/** A contact's saved name, else a short npub. */
const useSavedContactName = () => {
  const { t } = useTranslation();
  return React.useCallback(
    (name: string | null, npub: string | null) => {
      const normalizedName = (name ?? "").trim();
      return (
        normalizedName ||
        (npub ? formatShortNpub(npub) : t("unknownContactTitle"))
      );
    },
    [t],
  );
};

/** Saved contacts followed by the unknown senders with a conversation. */
export const useDisplayContacts = () => {
  const contacts = useContacts();
  const unknownSenders = useAtomValue(unknownSendersAtom);
  const { t } = useTranslation();

  const unknownContacts = React.useMemo(() => {
    const prefix = t("unknownContactNamePrefix");
    return unknownSenders.map((sender): DisplayContact & { id: string } => ({
      id: sender.id,
      name: `${prefix} ${
        (sender.profileName ?? "").trim() ||
        (sender.npub ? formatShortNpub(sender.npub) : t("unknownContactTitle"))
      }`.trim(),
      npub: sender.npub,
      lnAddress: null,
      groupName: null,
      isUnknownContact: true,
      unknownPubkeyHex: sender.unknownPubkeyHex,
    }));
  }, [t, unknownSenders]);

  const displayContacts = React.useMemo<DisplayContact[]>(
    () => [...contacts, ...unknownContacts],
    [contacts, unknownContacts],
  );

  const displayContactById = React.useMemo(() => {
    const byId = new Map<string, DisplayContact>();
    for (const contact of displayContacts) {
      const id = (contact.id ?? "").trim();
      if (!id) continue;
      byId.set(id, contact);
    }
    return byId;
  }, [displayContacts]);

  return { displayContactById, displayContacts, unknownContacts };
};

/** The peer of the conversation the route shows, saved or not. */
export const useChatContact = (route: Route): ChatSelectedContact | null => {
  const { displayContactById } = useDisplayContacts();
  const selectedContact = useRouteContact(route);
  return React.useMemo(() => {
    if (route.kind !== "chat" && route.kind !== "bankPaymentOffer") return null;

    const chatId = (route.kind === "chat" ? route.id : route.chatId).trim();
    if (!chatId) return null;

    const source = displayContactById.get(chatId) ?? null;
    if (!source) return null;

    const normalizedId = (source.id ?? "").trim();
    if (!normalizedId) return null;

    const normalizedNpub = normalizeNpubIdentifier(source.npub ?? "");
    const normalizedUnknownPubkeyHex = normalizePubkeyHex(
      source.unknownPubkeyHex,
    );
    const sourceGroupName = (source.groupName ?? "").trim();
    const isUnknownContact = source.isUnknownContact === true;

    return {
      id: normalizedId,
      ...(sourceGroupName ? { groupName: sourceGroupName } : {}),
      ...(source.name !== undefined
        ? { name: (source.name ?? "").trim() || null }
        : {}),
      ...(source.lnAddress !== undefined
        ? { lnAddress: (source.lnAddress ?? "").trim() || null }
        : {}),
      ...(normalizedNpub ? { npub: normalizedNpub } : {}),
      ...(normalizedUnknownPubkeyHex
        ? { unknownPubkeyHex: normalizedUnknownPubkeyHex }
        : {}),
      ...(isUnknownContact ? { isUnknownContact: true } : {}),
      ...(selectedContact?.chatPeerSeenSinceSec != null &&
      selectedContact.chatPeerSeenAtSec != null
        ? {
            chatPeerSeenSinceSec: selectedContact.chatPeerSeenSinceSec,
            chatPeerSeenAtSec: selectedContact.chatPeerSeenAtSec,
          }
        : {}),
    };
  }, [displayContactById, route, selectedContact]);
};

/** The name and picture a message shows for an npub it mentions. */
export const useNpubMessageContactInfo = () => {
  const contacts = useContacts();
  const unknownNames = useAtomValue(unknownNamesAtom);
  const pictures = useAtomValue(
    profileCacheAtom,
    (cache) => cache.pictureByNpub,
  );
  const currentNpub = useAtomValue(currentNpubAtom);
  const { lang } = useTranslation();
  const savedContactName = useSavedContactName();

  return React.useCallback(
    (rawNpub: string) => {
      const npub = normalizeNpubIdentifier(rawNpub);
      if (!npub) return null;

      const knownContact =
        contacts.find(
          (contact) => normalizeNpubIdentifier(contact.npub ?? "") === npub,
        ) ?? null;
      const derivedProfile = deriveDefaultProfile(npub, lang);
      const displayName = savedContactName(
        (knownContact?.name ?? "").trim() || unknownNames[npub] || null,
        npub,
      );
      const pictureUrl = pictures[npub] ?? derivedProfile.pictureUrl ?? null;

      return {
        displayName,
        isSaved:
          Boolean(knownContact) ||
          normalizeNpubIdentifier(currentNpub ?? "") === npub,
        npub,
        pictureUrl,
      };
    },
    [contacts, currentNpub, lang, pictures, savedContactName, unknownNames],
  );
};

/** The contacts a message can mention, with their groups and offered currencies. */
export const useMentionContacts = () => {
  const contacts = useContacts();
  const statusByNpub = useNostrStatusByNpub();
  return React.useMemo(
    () =>
      contacts.flatMap((contact) => {
        const name = (contact.name ?? "").trim();
        const npub = normalizeNpubIdentifier(contact.npub ?? "");
        if (!name || !npub) return [];
        const groupName = (contact.groupName ?? "").trim();
        const groupNames = getContactGroups(contact);
        return [
          {
            name,
            npub,
            groupName: groupName || null,
            groupNames,
            statusNames: parseProfileGeneralStatus(statusByNpub[npub])
              .currencies,
          },
        ];
      }),
    [contacts, statusByNpub],
  );
};

/** The contact screens' view of the saved contact the route is about. */
export const useRoutePeopleContact = (route: Route) => {
  const selectedContact = useRouteContact(route);
  const routeContactId =
    route.kind === "contact" ||
    route.kind === "contactEdit" ||
    route.kind === "contactPay"
      ? route.id
      : null;
  return React.useMemo(() => {
    if (!selectedContact || !routeContactId) return null;

    return {
      archivedAtSec:
        typeof selectedContact.archivedAtSec === "number" ||
        typeof selectedContact.archivedAtSec === "string"
          ? selectedContact.archivedAtSec
          : null,
      groupName:
        typeof selectedContact.groupName === "string"
          ? selectedContact.groupName
          : null,
      groupNamesJson:
        typeof selectedContact.groupNamesJson === "string"
          ? selectedContact.groupNamesJson
          : null,
      id: routeContactId,
      lnAddress:
        typeof selectedContact.lnAddress === "string"
          ? selectedContact.lnAddress
          : null,
      name:
        typeof selectedContact.name === "string" ? selectedContact.name : null,
      npub:
        typeof selectedContact.npub === "string" ? selectedContact.npub : null,
    };
  }, [routeContactId, selectedContact]);
};

/** Contacts who offer proxy payments, with the currencies they offer, by name. */
export const useProxyPaymentPayerContacts = () => {
  const contacts = useContacts();
  const statusByNpub = useNostrStatusByNpub();
  const pictures = useAtomValue(
    profileCacheAtom,
    (cache) => cache.pictureByNpub,
  );
  const { lang } = useTranslation();
  return React.useMemo<ProxyPaymentPayerContact[]>(() => {
    const collator = new Intl.Collator(lang, {
      usage: "sort",
      numeric: true,
      sensitivity: "variant",
    });
    return contacts
      .flatMap((contact) => {
        if ((contact.archivedAtSec ?? 0) > 0) return [];
        const npub = normalizeNpubIdentifier(contact.npub ?? "");
        const currencies = npub
          ? parseProfileGeneralStatus(statusByNpub[npub]).currencies
          : [];
        if (currencies.length === 0) return [];
        return [
          {
            contact,
            currencies,
            pictureUrl: npub ? (pictures[npub] ?? null) : null,
          },
        ];
      })
      .sort((left, right) =>
        collator.compare(left.contact.name ?? "", right.contact.name ?? ""),
      );
  }, [contacts, lang, pictures, statusByNpub]);
};
