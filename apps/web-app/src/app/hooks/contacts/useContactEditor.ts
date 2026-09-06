import { contactsLimitMessage } from "./useSaveNpubContact";
import { writeContact } from "../../lib/writeContact";
import { toEvoluText, toContactTextFields } from "../../lib/contactFields";
import * as Evolu from "@evolu/common";
import {
  decodeNpub,
  encodeNpub,
  type ProfileMetadata,
  type ProfileSearchHit,
} from "@linky/linkstr";
import {
  fetchProfileAtom,
  searchProfilesAtom,
  useAtomSet,
} from "@linky/linkstr-react";
import { Exit } from "effect";
import React from "react";
import { evolu } from "../../../evolu";
import { ContactId, TransactionId } from "../../../evoluIds";
import { navigateTo } from "../../../hooks/useRouting";
import {
  getProfilePictureUrl,
  loadCachedProfile,
  saveCachedProfile,
} from "../../../profileCache";
import type { Route } from "../../../types/route";
import { MAX_CONTACTS_PER_OWNER } from "../../../utils/constants";
import {
  getContactGroups,
  serializeContactGroups,
} from "../../../utils/contactGroups";
import { getBestNostrName } from "../../../utils/formatting";
import {
  DEFAULT_NIP05_DOMAIN,
  parseNip05IdentifierInput,
  resolveNip05Input,
} from "../../../utils/nostrNip05";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { NOSTR_SEARCH_RELAYS } from "../../../utils/nostrRelays";
import {
  getContactPublicProfile,
  resolveContactProfile,
} from "../../lib/contactProfile";
import { getContactQueryPrefill } from "../../lib/contactQueryPrefill";
import type { ContactFormState, ContactRowLike } from "../../types/appTypes";
import { fetchAndCacheProfile } from "../useLinkstrProfileSync";
import { useContactSuggestions } from "./useContactSuggestions";
import { asNonEmptyString } from "../../../utils/validation";
import type { Translate } from "../../../i18n";

type EvoluMutations = ReturnType<typeof import("../../../evolu").useEvolu>;

interface ContactNewPrefill {
  lnAddress: string;
  npub: string | null;
  suggestedName: string | null;
}

export interface ContactSearchCandidate {
  existingContactId?: string;
  /** The query resolved to exactly this profile (npub or verified NIP-05). */
  isExactMatch: boolean;
  lnAddress: string;
  name: string;
  npub: string;
  pictureUrl: string | null;
  query: string;
}

const CONTACT_SEARCH_RESULT_LIMIT = 6;
const NIP05_RESOLVE_TIMEOUT_MS = 3000;
/** The exact candidate is shown before its profile arrives; wait at most this. */
const EXACT_PROFILE_WAIT_MS = 3000;

const settleWithin = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

export type ContactSearchResult =
  | { kind: "empty" }
  | { kind: "error"; identifier: string }
  | { kind: "found"; contacts: ContactSearchCandidate[] }
  | { kind: "not_found"; query: string };

const getMetadataLightningAddress = (
  metadata: ProfileMetadata | null,
  npub: string,
): string => getContactPublicProfile(npub, metadata).lnAddress;

type ContactRow = ContactRowLike;
type SelectedContactRow = ContactRowLike & { id: ContactId };

type ContactFieldsPatch = {
  id: ContactId;
  lnAddressSetByUser?: typeof Evolu.SqliteBoolean.Type | null;
  nameSetByUser?: typeof Evolu.SqliteBoolean.Type | null;
} & Partial<
  Record<
    "groupName" | "groupNamesJson" | "lnAddress" | "name" | "npub",
    typeof Evolu.NonEmptyString1000.Type | null
  >
>;

interface UseContactEditorParams {
  activeOwnerContactsCount: number;
  appOwnerId: Evolu.OwnerId | null;
  contactNewPrefill: ContactNewPrefill | null;
  contacts: readonly ContactRow[];
  currentNpub: string | null;
  insert: EvoluMutations["insert"];
  route: Route;
  selectedContactMetadata: ProfileMetadata | null | undefined;
  selectedContact: SelectedContactRow | null;
  setContactNewPrefill: React.Dispatch<
    React.SetStateAction<ContactNewPrefill | null>
  >;
  setPendingDeleteId: React.Dispatch<React.SetStateAction<ContactId | null>>;
  setRecentlyAddedContactId: React.Dispatch<
    React.SetStateAction<ContactId | null>
  >;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
  transactionsOwnerId: Evolu.OwnerId | null;
  update: EvoluMutations["update"];
  upsert: EvoluMutations["upsert"];
}

const readLightningAddressFromDetailsJson = (value: unknown): string | null => {
  const detailsJson = asNonEmptyString(value);
  if (!detailsJson) return null;

  try {
    const parsed: unknown = JSON.parse(detailsJson);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }

    return asNonEmptyString(
      "lightningAddress" in parsed ? parsed.lightningAddress : null,
    );
  } catch {
    return null;
  }
};

const decodeDirectNpubIdentifier = async (
  value: string,
): Promise<string | null> => {
  const normalized = normalizeNpubIdentifier(value);
  if (!normalized || !/^npub1/i.test(normalized)) return null;

  return decodeNpub(normalized) ? normalized : null;
};

const makeEmptyContactForm = (): ContactFormState => ({
  name: "",
  npub: "",
  lnAddress: "",
  groups: [],
});

export const useContactEditor = ({
  activeOwnerContactsCount,
  appOwnerId,
  contactNewPrefill,
  contacts,
  currentNpub,
  insert,
  route,
  selectedContactMetadata,
  selectedContact,
  setContactNewPrefill,
  setPendingDeleteId,
  setRecentlyAddedContactId,
  setStatus,
  t,
  transactionsOwnerId,
  update,
  upsert,
}: UseContactEditorParams) => {
  const [form, setForm] = React.useState<ContactFormState>(
    makeEmptyContactForm(),
  );
  const [editingId, setEditingId] = React.useState<ContactId | null>(null);
  const [isSavingContact, setIsSavingContact] = React.useState(false);
  const [contactEditInitial, setContactEditInitial] = React.useState<{
    groups: string[];
    id: ContactId;
    lnAddress: string;
    name: string;
    npub: string;
  } | null>(null);
  const previousRouteKindRef = React.useRef<Route["kind"] | null>(null);

  const transactionsQuery = React.useMemo(
    () =>
      evolu.createQuery((db) =>
        db
          .selectFrom("transaction")
          .select(["id", "ownerId", "contactId", "method", "detailsJson"])
          .where("isDeleted", "is not", Evolu.sqliteTrue),
      ),
    [],
  );

  const openScannedContactPendingNpubRef = React.useRef<string | null>(null);

  const fetchProfileOneShot = useAtomSet(fetchProfileAtom, {
    mode: "promiseExit",
  });
  const searchProfilesOneShot = useAtomSet(searchProfilesAtom, {
    mode: "promiseExit",
  });

  const clearContactForm = React.useCallback(() => {
    setForm(makeEmptyContactForm());
    setEditingId(null);
    setContactEditInitial(null);
  }, []);

  const contactSuggestionKnownNpubsKey = Array.from(
    new Set(
      [
        ...contacts.map((contact) =>
          normalizeNpubIdentifier(contact.npub ?? ""),
        ),
        normalizeNpubIdentifier(currentNpub ?? ""),
      ].filter((npub): npub is string => Boolean(npub)),
    ),
  )
    .sort()
    .join("\n");
  const contactSuggestions = useContactSuggestions(
    route.kind === "contactNew",
    contactSuggestionKnownNpubsKey,
  );

  const buildFullContactOverridePayload = React.useCallback(
    (payload: ContactFieldsPatch) => {
      const currentOwnerId = asNonEmptyString(appOwnerId);
      if (!currentOwnerId) return null;

      const source =
        contacts.find((contact) => contact.id === payload.id) ?? null;
      const sourceOwnerId = asNonEmptyString(source?.ownerId);
      if (!source || !sourceOwnerId || sourceOwnerId === currentOwnerId) {
        return null;
      }

      const sourceNameSetByUser = Evolu.SqliteBoolean.fromUnknown(
        source.nameSetByUser,
      );
      const sourceLnAddressSetByUser = Evolu.SqliteBoolean.fromUnknown(
        source.lnAddressSetByUser,
      );

      return {
        lnAddressSetByUser:
          payload.lnAddressSetByUser !== undefined
            ? payload.lnAddressSetByUser
            : sourceLnAddressSetByUser.ok
              ? sourceLnAddressSetByUser.value
              : null,
        nameSetByUser:
          payload.nameSetByUser !== undefined
            ? payload.nameSetByUser
            : sourceNameSetByUser.ok
              ? sourceNameSetByUser.value
              : null,
        id: payload.id,
        name:
          payload.name !== undefined ? payload.name : toEvoluText(source.name),
        npub:
          payload.npub !== undefined ? payload.npub : toEvoluText(source.npub),
        lnAddress:
          payload.lnAddress !== undefined
            ? payload.lnAddress
            : toEvoluText(source.lnAddress),
        groupName:
          payload.groupName !== undefined
            ? payload.groupName
            : toEvoluText(source.groupName),
        groupNamesJson:
          payload.groupNamesJson !== undefined
            ? payload.groupNamesJson
            : toEvoluText(source.groupNamesJson),
      };
    },
    [appOwnerId, contacts],
  );

  const updateContactFields = React.useCallback(
    (payload: ContactFieldsPatch) => {
      const fullOverridePayload = buildFullContactOverridePayload(payload);
      if (fullOverridePayload && appOwnerId) {
        return upsert("contact", fullOverridePayload, { ownerId: appOwnerId });
      }

      return writeContact(update, payload, appOwnerId);
    },
    [appOwnerId, buildFullContactOverridePayload, update, upsert],
  );

  const updateTransactionFields = React.useCallback(
    (
      payload: { contactId: ContactId; id: TransactionId },
      rowOwnerId: unknown,
    ) => {
      const parsedOwnerId = Evolu.OwnerId.fromUnknown(rowOwnerId);
      if (parsedOwnerId.ok) {
        return update("transaction", payload, {
          ownerId: parsedOwnerId.value,
        });
      }

      if (transactionsOwnerId) {
        return update("transaction", payload, {
          ownerId: transactionsOwnerId,
        });
      }

      return update("transaction", payload);
    },
    [transactionsOwnerId, update],
  );

  const backfillLightningAddressTransactions = React.useCallback(
    async (contactId: ContactId, lnAddress: string) => {
      const normalizedLnAddress = lnAddress.trim().toLowerCase();
      if (!normalizedLnAddress) return;

      const transactionRows = await evolu.loadQuery(transactionsQuery);
      for (const row of transactionRows) {
        const transactionId = row.id;
        if (!transactionId) continue;

        const existingContactId = asNonEmptyString(row.contactId);
        if (existingContactId) continue;

        const method = asNonEmptyString(row.method);
        if (method !== "lightning_address") continue;

        const transactionLnAddress = readLightningAddressFromDetailsJson(
          row.detailsJson,
        );
        if (!transactionLnAddress) continue;
        if (transactionLnAddress.toLowerCase() !== normalizedLnAddress)
          continue;

        updateTransactionFields(
          {
            id: transactionId,
            contactId,
          },
          row.ownerId,
        );
      }
    },
    [transactionsQuery, updateTransactionFields],
  );

  const seededEditContactIdRef = React.useRef<ContactId | null>(null);

  React.useEffect(() => {
    const previousRouteKind = previousRouteKindRef.current;
    previousRouteKindRef.current = route.kind;

    if (route.kind === "contactNew") {
      seededEditContactIdRef.current = null;
      setPendingDeleteId(null);
      setEditingId(null);
      setContactEditInitial(null);
      if (contactNewPrefill) {
        setForm({
          name: contactNewPrefill.suggestedName ?? "",
          npub: contactNewPrefill.npub ?? "",
          lnAddress: contactNewPrefill.lnAddress,
          groups: [],
        });
        setContactNewPrefill(null);
      } else if (previousRouteKind !== "contactNew") {
        setForm(makeEmptyContactForm());
      }
      return;
    }

    if (route.kind !== "contactEdit") {
      seededEditContactIdRef.current = null;
      return;
    }
    setPendingDeleteId(null);

    if (!selectedContact) {
      seededEditContactIdRef.current = null;
      setEditingId(null);
      setContactEditInitial(null);
      setForm(makeEmptyContactForm());
      return;
    }

    // Seed once per edited contact; later row/profile updates must not wipe
    // what the user is typing.
    if (seededEditContactIdRef.current === selectedContact.id) return;
    seededEditContactIdRef.current = selectedContact.id;

    setEditingId(selectedContact.id);
    const resolvedProfile = resolveContactProfile(
      selectedContact,
      selectedContactMetadata,
    );
    setContactEditInitial({
      id: selectedContact.id,
      name: resolvedProfile.localName,
      npub: selectedContact.npub ?? "",
      lnAddress: resolvedProfile.localLnAddress,
      groups: getContactGroups(selectedContact),
    });
    setForm({
      name: resolvedProfile.localName,
      npub: selectedContact.npub ?? "",
      lnAddress: resolvedProfile.localLnAddress,
      groups: getContactGroups(selectedContact),
    });
  }, [
    contactNewPrefill,
    route.kind,
    selectedContactMetadata,
    selectedContact,
    setContactNewPrefill,
    setPendingDeleteId,
  ]);

  const selectedContactPublicProfile = React.useMemo(() => {
    const npub = normalizeNpubIdentifier(form.npub);
    if (!npub) return { lnAddress: "", name: "" };

    const selectedNpub = normalizeNpubIdentifier(selectedContact?.npub ?? "");
    if (selectedContact && selectedNpub === npub) {
      // The row backs the public value for non-overridden fields, so the
      // hint stays correct even when the profile cache is empty.
      const resolved = resolveContactProfile(
        selectedContact,
        selectedContactMetadata,
      );
      return { lnAddress: resolved.lnAddress, name: resolved.name };
    }

    return getContactPublicProfile(
      npub,
      loadCachedProfile(npub)?.metadata ?? undefined,
    );
  }, [form.npub, selectedContact, selectedContactMetadata]);

  const handleSaveContact = React.useCallback(async () => {
    if (isSavingContact) return; // Prevent double-click

    const name = form.name.trim();
    const rawNpub = form.npub.trim();
    const lnAddressInput = form.lnAddress.trim();
    const groups = form.groups;
    const group = groups[0] ?? "";
    const groupNamesJson = serializeContactGroups(groups);

    if (!name && !rawNpub && !lnAddressInput) {
      setStatus(t("fillAtLeastOne"));
      return;
    }

    if (!editingId && activeOwnerContactsCount >= MAX_CONTACTS_PER_OWNER) {
      setStatus(contactsLimitMessage(t));
      return;
    }

    setIsSavingContact(true);

    let npub = rawNpub ? (normalizeNpubIdentifier(rawNpub) ?? rawNpub) : "";
    let lnAddress = lnAddressInput;

    if (rawNpub) {
      const nip05Result = await resolveNip05Input(rawNpub);
      if (nip05Result.kind === "resolved") {
        npub = nip05Result.npub;
        if (
          !lnAddress &&
          nip05Result.identifier.domain === DEFAULT_NIP05_DOMAIN
        ) {
          lnAddress = nip05Result.identifier.identifier;
        }
      } else if (nip05Result.kind === "not_found") {
        setStatus(
          t("nip05NotFound").replace(
            "{identifier}",
            nip05Result.identifier.identifier,
          ),
        );
        setIsSavingContact(false);
        return;
      } else if (nip05Result.kind === "error") {
        setStatus(
          t("nip05ResolveFailed").replace(
            "{identifier}",
            nip05Result.identifier.identifier,
          ),
        );
        setIsSavingContact(false);
        return;
      }
    }

    const currentProfileNpub = normalizeNpubIdentifier(currentNpub ?? "");

    if (npub && currentProfileNpub && npub === currentProfileNpub) {
      setStatus(t("contactIsYou"));
      navigateTo({ route: "profile" });
      setIsSavingContact(false);
      return;
    }

    if (npub) {
      const duplicate = contacts.find((contact) => {
        if (editingId && contact.id === editingId) return false;
        return normalizeNpubIdentifier(contact.npub ?? "") === npub;
      });

      if (duplicate?.id) {
        setStatus(t("contactExists"));
        navigateTo({ route: "contact", id: ContactId.orThrow(duplicate.id) });
        setIsSavingContact(false);
        return;
      }
    }

    const payload = toContactTextFields({
      name,
      npub,
      lnAddress,
      groupName: group,
      groupNamesJson: groups.length ? groupNamesJson : null,
    });
    let savedContactId: ContactId | null = editingId;
    const selectedNpub = normalizeNpubIdentifier(selectedContact?.npub ?? "");
    const cachedMetadata = npub
      ? (loadCachedProfile(npub)?.metadata ?? undefined)
      : undefined;
    const publicProfile =
      editingId && selectedContact && npub && selectedNpub === npub
        ? resolveContactProfile(selectedContact, cachedMetadata)
        : getContactPublicProfile(npub, cachedMetadata);
    const parsePublicText = (value: string) => {
      const parsed = value ? Evolu.NonEmptyString1000.fromUnknown(value) : null;
      return parsed?.ok ? parsed.value : null;
    };

    const createPayload: Partial<{
      groupName: typeof Evolu.NonEmptyString1000.Type;
      groupNamesJson: typeof Evolu.NonEmptyString1000.Type;
      lnAddress: typeof Evolu.NonEmptyString1000.Type;
      lnAddressSetByUser: typeof Evolu.SqliteBoolean.Type;
      name: typeof Evolu.NonEmptyString1000.Type;
      nameSetByUser: typeof Evolu.SqliteBoolean.Type;
      npub: typeof Evolu.NonEmptyString1000.Type;
    }> = {};
    if (payload.name) {
      createPayload.name = payload.name;
      if (name !== publicProfile.name) {
        createPayload.nameSetByUser = Evolu.sqliteTrue;
      }
    } else {
      const publicName = parsePublicText(publicProfile.name);
      if (publicName) createPayload.name = publicName;
    }
    if (payload.npub) createPayload.npub = payload.npub;
    if (payload.lnAddress) {
      createPayload.lnAddress = payload.lnAddress;
      if (lnAddress.toLowerCase() !== publicProfile.lnAddress.toLowerCase()) {
        createPayload.lnAddressSetByUser = Evolu.sqliteTrue;
      }
    } else {
      const publicLnAddress = parsePublicText(publicProfile.lnAddress);
      if (publicLnAddress) createPayload.lnAddress = publicLnAddress;
    }
    if (payload.groupName) createPayload.groupName = payload.groupName;
    if (payload.groupNamesJson)
      createPayload.groupNamesJson = payload.groupNamesJson;

    if (editingId) {
      // Build update payload with only changed fields to minimize history entries.
      const initial = contactEditInitial;
      const changedFields: ContactFieldsPatch = { id: editingId };

      if (initial?.id === editingId) {
        const nextName = payload.name ? payload.name : null;
        const nextNpub = payload.npub ? payload.npub : null;
        const nextLn = payload.lnAddress ? payload.lnAddress : null;
        const nextGroup = payload.groupName ? payload.groupName : null;
        const nextGroupsJson = payload.groupNamesJson
          ? payload.groupNamesJson
          : null;

        const prevName = initial.name || null;
        const prevNpub = initial.npub || null;
        const prevLn = initial.lnAddress || null;
        const prevGroup = initial.groups[0] ?? null;
        const prevGroupsJson = initial.groups.length
          ? serializeContactGroups(initial.groups)
          : null;

        if ((prevName ?? "") !== (nextName ?? "")) {
          changedFields.name = payload.name;
        }
        if ((prevNpub ?? "") !== (nextNpub ?? "")) {
          changedFields.npub = payload.npub;

          if (!name && !selectedContact?.nameSetByUser) {
            changedFields.name = null;
          }
          if (!lnAddress && !selectedContact?.lnAddressSetByUser) {
            changedFields.lnAddress = null;
          }
        }
        if ((prevLn ?? "") !== (nextLn ?? "")) {
          changedFields.lnAddress = payload.lnAddress;
        }
        if ((prevGroup ?? "") !== (nextGroup ?? "")) {
          changedFields.groupName = payload.groupName;
        }
        if ((prevGroupsJson ?? "") !== (nextGroupsJson ?? "")) {
          changedFields.groupNamesJson = payload.groupNamesJson;
        }
      } else {
        // Fallback: if we don't have initial data, update all fields.
        Object.assign(changedFields, payload);
      }

      // A typed value that differs from the profile is a user override;
      // otherwise the row keeps mirroring the profile, so store the public
      // value (the row is the display source) and clear the flag.
      if (changedFields.name !== undefined) {
        const isNameOverride = Boolean(name) && name !== publicProfile.name;
        changedFields.nameSetByUser = isNameOverride ? Evolu.sqliteTrue : null;
        if (!isNameOverride) {
          changedFields.name = parsePublicText(publicProfile.name);
        }
      }

      if (changedFields.lnAddress !== undefined) {
        const isLnAddressOverride =
          Boolean(lnAddress) &&
          lnAddress.toLowerCase() !== publicProfile.lnAddress.toLowerCase();
        changedFields.lnAddressSetByUser = isLnAddressOverride
          ? Evolu.sqliteTrue
          : null;
        if (!isLnAddressOverride) {
          changedFields.lnAddress = parsePublicText(publicProfile.lnAddress);
        }
      }

      // Only update if there are actual changes (besides just the id).
      if (Object.keys(changedFields).length > 1) {
        const result = updateContactFields(changedFields);
        if (result.ok) {
          setStatus(t("contactUpdated"));
        } else {
          setStatus(`${t("errorPrefix")}: ${String(result.error)}`);
          setIsSavingContact(false);
          return;
        }
      } else {
        setStatus(t("contactUpdated"));
      }
    } else {
      const result = writeContact(insert, createPayload, appOwnerId);
      if (result.ok) {
        savedContactId = result.value.id;
        setRecentlyAddedContactId(result.value.id);
        setStatus(t("contactSaved"));
      } else {
        setStatus(`${t("errorPrefix")}: ${String(result.error)}`);
        setIsSavingContact(false);
        return;
      }
    }

    if (savedContactId && lnAddress) {
      await backfillLightningAddressTransactions(savedContactId, lnAddress);
    }

    if (route.kind === "contactEdit" && editingId) {
      navigateTo({ route: "contact", id: editingId });
      setIsSavingContact(false);
      return;
    }

    clearContactForm();
    setPendingDeleteId(null);
    navigateTo({ route: "contacts" });
    setIsSavingContact(false);
  }, [
    activeOwnerContactsCount,
    appOwnerId,
    backfillLightningAddressTransactions,
    clearContactForm,
    contactEditInitial,
    contacts,
    currentNpub,
    editingId,
    form.groups,
    form.lnAddress,
    form.name,
    form.npub,
    insert,
    isSavingContact,
    route.kind,
    selectedContact,
    setPendingDeleteId,
    setRecentlyAddedContactId,
    setStatus,
    t,
    updateContactFields,
  ]);

  const findExistingContactId = React.useCallback(
    (npub: string): string | undefined => {
      const existingContact = contacts.find(
        (contact) => normalizeNpubIdentifier(contact.npub ?? "") === npub,
      );
      return existingContact?.id ? existingContact.id : undefined;
    },
    [contacts],
  );

  const toSearchCandidate = React.useCallback(
    (
      npub: string,
      metadata: ProfileMetadata | null,
      query: string,
      fallback: { name: string; lnAddress: string; isExactMatch: boolean },
    ): ContactSearchCandidate => {
      const existingContactId = findExistingContactId(npub);
      return {
        ...(existingContactId ? { existingContactId } : {}),
        isExactMatch: fallback.isExactMatch,
        lnAddress:
          getMetadataLightningAddress(metadata, npub) || fallback.lnAddress,
        name: (metadata ? getBestNostrName(metadata) : null) ?? fallback.name,
        npub,
        pictureUrl: getProfilePictureUrl(metadata),
        query,
      };
    },
    [findExistingContactId],
  );

  const resolveExactContact = React.useCallback(
    async (
      rawQuery: string,
      onCandidate: (candidate: ContactSearchCandidate) => void,
    ): Promise<
      | { kind: "resolved"; contact: ContactSearchCandidate }
      | { kind: "error"; identifier: string }
      | { kind: "none" }
    > => {
      const resolveExact = async (
        npub: string,
        fallback: { name: string; lnAddress: string },
      ) => {
        const candidateWith = (metadata: ProfileMetadata | null) =>
          toSearchCandidate(npub, metadata, rawQuery, {
            ...fallback,
            isExactMatch: true,
          });
        const cachedMetadata = loadCachedProfile(npub)?.metadata ?? null;
        onCandidate(candidateWith(cachedMetadata));
        const fetched = fetchAndCacheProfile(fetchProfileOneShot, npub).then(
          (metadata) => {
            const contact = candidateWith(metadata ?? cachedMetadata);
            onCandidate(contact);
            return contact;
          },
        );
        // The identity is settled; a slow profile fetch keeps filling the
        // candidate in through onCandidate instead of holding the result.
        const contact = await settleWithin(fetched, EXACT_PROFILE_WAIT_MS);
        return {
          contact: contact ?? candidateWith(cachedMetadata),
          kind: "resolved" as const,
        };
      };

      const directNpub = await decodeDirectNpubIdentifier(rawQuery);
      if (directNpub)
        return resolveExact(directNpub, { lnAddress: "", name: "" });
      if (!parseNip05IdentifierInput(rawQuery)) return { kind: "none" };

      const queryPrefill = getContactQueryPrefill(rawQuery);
      const nip05Result = await resolveNip05Input(rawQuery, {
        signal: AbortSignal.timeout(NIP05_RESOLVE_TIMEOUT_MS),
      });
      if (nip05Result.kind === "none" || nip05Result.kind === "not_found") {
        return { kind: "none" };
      }
      if (nip05Result.kind === "error") {
        return queryPrefill.lnAddress
          ? { kind: "none" }
          : { identifier: nip05Result.identifier.identifier, kind: "error" };
      }

      const { identifier } = nip05Result;
      return resolveExact(nip05Result.npub, {
        lnAddress:
          queryPrefill.lnAddress ||
          (identifier.domain === DEFAULT_NIP05_DOMAIN
            ? identifier.identifier
            : ""),
        name: queryPrefill.name ? identifier.localPart : "",
      });
    },
    [fetchProfileOneShot, toSearchCandidate],
  );

  const searchProfileCandidates = React.useCallback(
    async (
      rawQuery: string,
      onCandidates: (candidates: ContactSearchCandidate[]) => void,
    ): Promise<ContactSearchCandidate[]> => {
      // An npub is an exact identifier; text search would only add noise.
      if (/^npub1/i.test(normalizeNpubIdentifier(rawQuery) ?? "")) return [];
      const toCandidates = (hits: ReadonlyArray<ProfileSearchHit>) =>
        hits.map((hit) => {
          const npub = encodeNpub(hit.pubkey);
          saveCachedProfile(npub, hit.metadata, hit.updatedAt);
          return toSearchCandidate(npub, hit.metadata, rawQuery, {
            isExactMatch: false,
            lnAddress: "",
            name: "",
          });
        });
      const exit = await searchProfilesOneShot({
        options: {
          limit: CONTACT_SEARCH_RESULT_LIMIT,
          searchRelays: NOSTR_SEARCH_RELAYS,
          // Linky users first; fresh accounts carry only the synthetic
          // `npub…@linky.fit` lud16, so the raw suffix is the signal.
          preferredDomains: [DEFAULT_NIP05_DOMAIN],
          onHits: (hits) => onCandidates(toCandidates(hits)),
        },
        query: rawQuery,
      });
      return Exit.isFailure(exit) ? [] : toCandidates(exit.value);
    },
    [searchProfilesOneShot, toSearchCandidate],
  );

  /**
   * Two concurrent lookups; `onProgress` receives the merged list every time
   * either one learns something, with the exact (npub / NIP-05) candidate
   * always first. The returned promise settles when both are done.
   */
  const searchNewContact = React.useCallback(
    async (
      query?: string,
      onProgress?: (result: ContactSearchResult) => void,
    ): Promise<ContactSearchResult> => {
      if (route.kind !== "contactNew") return { kind: "empty" };

      const rawQuery = (query ?? form.npub).trim();
      if (!rawQuery) return { kind: "empty" };

      let exact: ContactSearchCandidate | null = null;
      let searched: ContactSearchCandidate[] = [];
      const mergeCandidates = (): ContactSearchCandidate[] => {
        const contacts: ContactSearchCandidate[] = exact ? [exact] : [];
        for (const candidate of searched) {
          if (contacts.length >= CONTACT_SEARCH_RESULT_LIMIT) break;
          if (contacts.some((known) => known.npub === candidate.npub)) continue;
          contacts.push(candidate);
        }
        return contacts;
      };
      const publishProgress = () => {
        const contacts = mergeCandidates();
        if (contacts.length > 0) onProgress?.({ contacts, kind: "found" });
      };

      const [exactResult] = await Promise.all([
        resolveExactContact(rawQuery, (candidate) => {
          exact = candidate;
          publishProgress();
        }),
        searchProfileCandidates(rawQuery, (candidates) => {
          searched = candidates;
          publishProgress();
        }),
      ]);

      const contacts = mergeCandidates();
      if (contacts.length > 0) return { contacts, kind: "found" };
      if (exactResult.kind === "error") {
        return { identifier: exactResult.identifier, kind: "error" };
      }
      return { kind: "not_found", query: rawQuery };
    },
    [form.npub, resolveExactContact, route.kind, searchProfileCandidates],
  );

  const addNewContactFromSearchResult = React.useCallback(
    async (candidate: ContactSearchCandidate) => {
      if (isSavingContact) return;

      if (activeOwnerContactsCount >= MAX_CONTACTS_PER_OWNER) {
        setStatus(contactsLimitMessage(t));
        return;
      }

      const npub = normalizeNpubIdentifier(candidate.npub);
      if (!npub) {
        setStatus(t("contactIdentifierInvalid"));
        return;
      }

      const currentProfileNpub = normalizeNpubIdentifier(currentNpub ?? "");
      if (currentProfileNpub && npub === currentProfileNpub) {
        setStatus(t("contactIsYou"));
        navigateTo({ route: "profile" });
        return;
      }

      const duplicate = contacts.find(
        (contact) => normalizeNpubIdentifier(contact.npub ?? "") === npub,
      );
      if (duplicate?.id) {
        setStatus(t("contactExists"));
        navigateTo({ route: "contact", id: ContactId.orThrow(duplicate.id) });
        return;
      }

      const parsedNpub = Evolu.NonEmptyString1000.from(npub);
      if (!parsedNpub.ok) {
        setStatus(t("contactIdentifierInvalid"));
        return;
      }
      const name = candidate.name.trim();
      const lnAddress = candidate.lnAddress.trim();
      const createPayload: Partial<{
        lnAddress: typeof Evolu.NonEmptyString1000.Type;
        name: typeof Evolu.NonEmptyString1000.Type;
        npub: typeof Evolu.NonEmptyString1000.Type;
      }> = {
        npub: parsedNpub.value,
      };
      const parsedName = Evolu.NonEmptyString1000.from(name);
      if (parsedName.ok) createPayload.name = parsedName.value;
      const parsedLnAddress = Evolu.NonEmptyString1000.from(lnAddress);
      if (parsedLnAddress.ok) createPayload.lnAddress = parsedLnAddress.value;

      setIsSavingContact(true);
      const result = writeContact(insert, createPayload, appOwnerId);

      if (!result.ok) {
        setStatus(`${t("errorPrefix")}: ${String(result.error)}`);
        setIsSavingContact(false);
        return;
      }

      setRecentlyAddedContactId(result.value.id);
      setStatus(t("contactSaved"));
      if (lnAddress) {
        await backfillLightningAddressTransactions(result.value.id, lnAddress);
      }
      clearContactForm();
      setPendingDeleteId(null);
      navigateTo({ route: "contacts" });
      setIsSavingContact(false);
    },
    [
      activeOwnerContactsCount,
      appOwnerId,
      backfillLightningAddressTransactions,
      clearContactForm,
      contacts,
      currentNpub,
      insert,
      isSavingContact,
      setPendingDeleteId,
      setRecentlyAddedContactId,
      setStatus,
      t,
    ],
  );

  const addNewContactFromIdentifier = React.useCallback(
    async (identifier: string) => {
      const result = await searchNewContact(identifier);
      if (result.kind === "found") {
        const [bestMatch] = result.contacts;
        if (bestMatch) await addNewContactFromSearchResult(bestMatch);
        return;
      }

      if (result.kind === "error") {
        setStatus(
          t("nip05ResolveFailed").replace("{identifier}", result.identifier),
        );
        return;
      }

      if (result.kind === "not_found") {
        setStatus(t("contactSearchNoResult"));
      }
    },
    [addNewContactFromSearchResult, searchNewContact, setStatus, t],
  );

  React.useEffect(() => {
    const targetNpub = openScannedContactPendingNpubRef.current;
    if (!targetNpub) return;
    const normalizedTarget = normalizeNpubIdentifier(targetNpub);
    if (!normalizedTarget) return;
    const existing = contacts.find(
      (c) => normalizeNpubIdentifier(c.npub ?? "") === normalizedTarget,
    );
    if (!existing?.id) return;
    openScannedContactPendingNpubRef.current = null;
    navigateTo({ route: "contact", id: ContactId.orThrow(existing.id) });
  }, [contacts]);

  // Drops the local override: writes the watch-fed cached profile value into
  // the row (the pubkey is watched, so the cache is as fresh as the relays)
  // and empties the form field, so the public value shows as placeholder.
  const resetEditedContactFieldFromNostr = React.useCallback(
    (field: "name" | "lnAddress") => {
      if (route.kind !== "contactEdit") return;
      if (!editingId) return;

      const npub = normalizeNpubIdentifier(form.npub);
      const metadata = npub
        ? (loadCachedProfile(npub)?.metadata ?? null)
        : null;

      if (field === "name") {
        const bestName = metadata ? getBestNostrName(metadata) : null;
        const parsedName = bestName
          ? Evolu.NonEmptyString1000.fromUnknown(bestName)
          : null;
        updateContactFields({
          id: editingId,
          name: parsedName?.ok ? parsedName.value : null,
          nameSetByUser: null,
        });
      } else {
        const ln = getContactPublicProfile(npub, metadata).lnAddress;
        const parsedLn = ln ? Evolu.NonEmptyString1000.fromUnknown(ln) : null;
        updateContactFields({
          id: editingId,
          lnAddress: parsedLn?.ok ? parsedLn.value : null,
          lnAddressSetByUser: null,
        });
      }

      setForm((prev) => ({ ...prev, [field]: "" }));
      setContactEditInitial((prev) =>
        prev && prev.id === editingId ? { ...prev, [field]: "" } : prev,
      );
    },
    [editingId, form.npub, route.kind, updateContactFields],
  );

  const contactEditsSavable = React.useMemo(() => {
    if (!editingId) return false;
    if (route.kind !== "contactEdit") return false;
    const initial = contactEditInitial;
    if (!initial || initial.id !== editingId) return false;

    const name = form.name.trim();
    const npub = form.npub.trim();
    const lnAddress = form.lnAddress.trim();
    const groups = serializeContactGroups(form.groups);

    const hasRequired = Boolean(name || npub || lnAddress);
    if (!hasRequired) return false;

    const dirty =
      name !== initial.name.trim() ||
      npub !== initial.npub.trim() ||
      lnAddress !== initial.lnAddress.trim() ||
      groups !== serializeContactGroups(initial.groups);

    return dirty;
  }, [
    contactEditInitial,
    editingId,
    form.groups,
    form.lnAddress,
    form.name,
    form.npub,
    route.kind,
  ]);

  return {
    addNewContactFromIdentifier,
    addNewContactFromSearchResult,
    clearContactForm,
    contactEditsSavable,
    contactSuggestions,
    editingId,
    form,
    handleSaveContact,
    isSavingContact,
    openScannedContactPendingNpubRef,
    selectedContactPublicProfile,
    resetEditedContactFieldFromNostr,
    searchNewContact,
    setForm,
  };
};
