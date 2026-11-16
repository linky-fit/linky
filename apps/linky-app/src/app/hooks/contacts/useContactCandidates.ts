import { decodeNpub, type ProfileMetadata } from "@linky-fit/linkstr";
import { useLinkstrCommands } from "@linky-fit/linkstr-react";
import React from "react";
import { getProfilePictureUrl, loadCachedProfile } from "../../../profileCache";
import { getBestNostrName } from "../../../utils/formatting";
import {
  DEFAULT_NIP05_DOMAIN,
  parseNip05IdentifierInput,
  resolveNip05Input,
} from "../../../utils/nostrNip05";
import { normalizeNpubIdentifier } from "../../../utils/nostrNpub";
import { getContactPublicProfile } from "../../lib/contactProfile";
import { getContactQueryPrefill } from "../../lib/contactQueryPrefill";
import { isLinkyAddress, isLinkyProfile } from "../../lib/linkyProfile";
import type { ContactRowLike } from "../../types/appTypes";
import { fetchAndCacheProfile } from "../useLinkstrProfileSync";

export interface ContactSearchCandidate {
  existingContactId?: string;
  /** The user's own identity, which opens the profile instead of saving. */
  isSelf?: boolean;
  /** The query resolved to exactly this profile (npub or verified NIP-05). */
  isExactMatch: boolean;
  lnAddress: string;
  name: string;
  /** The NIP-05 identifier the profile claims, or the one the query resolved. */
  nip05: string;
  /** The query itself resolved `nip05` to this npub, so it needs no further check. */
  nip05Verified: boolean;
  npub: string;
  pictureUrl: string | null;
  query: string;
  /** The profile looks like a Linky account rather than another Nostr client's. */
  usesLinky: boolean;
}

export type ExactContactResolution =
  | { kind: "resolved"; contact: ContactSearchCandidate }
  | { kind: "error"; identifier: string }
  | { kind: "none" };

const NIP05_RESOLVE_TIMEOUT_MS = 3000;
/** The exact candidate is shown before its profile arrives; wait at most this. */
const EXACT_PROFILE_WAIT_MS = 3000;

const settleWithin = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);

const decodeDirectNpubIdentifier = (value: string): string | null => {
  const normalized = normalizeNpubIdentifier(value);
  if (!normalized || !/^npub1/i.test(normalized)) return null;
  return decodeNpub(normalized) ? normalized : null;
};

/** Whether a search query names exactly one profile: an npub or a NIP-05, bare names meaning Linky's domain. */
export const isExactContactQuery = (query: string): boolean =>
  Boolean(
    decodeDirectNpubIdentifier(query) || parseNip05IdentifierInput(query),
  );

/** Turns profiles into search candidates and resolves a query naming exactly one profile. */
export const useContactCandidates = (
  contacts: readonly ContactRowLike[],
  currentNpub: string | null,
) => {
  const { fetchProfile: fetchProfileOneShot } = useLinkstrCommands();

  const toSearchCandidate = React.useCallback(
    (
      npub: string,
      metadata: ProfileMetadata | null,
      query: string,
      fallback: {
        name: string;
        lnAddress: string;
        isExactMatch: boolean;
        verifiedNip05?: string;
      },
    ): ContactSearchCandidate => {
      const existingContactId = contacts.find(
        (contact) => normalizeNpubIdentifier(contact.npub ?? "") === npub,
      )?.id;
      const isSelf = npub === normalizeNpubIdentifier(currentNpub ?? "");
      const lnAddress =
        getContactPublicProfile(npub, metadata).lnAddress || fallback.lnAddress;
      return {
        ...(existingContactId ? { existingContactId } : {}),
        ...(isSelf ? { isSelf } : {}),
        isExactMatch: fallback.isExactMatch,
        lnAddress,
        name: (metadata ? getBestNostrName(metadata) : null) ?? fallback.name,
        nip05: fallback.verifiedNip05 ?? metadata?.nip05?.trim() ?? "",
        nip05Verified: fallback.verifiedNip05 !== undefined,
        npub,
        pictureUrl: getProfilePictureUrl(metadata),
        query,
        usesLinky:
          (metadata !== null && isLinkyProfile(metadata)) ||
          isLinkyAddress(lnAddress),
      };
    },
    [contacts, currentNpub],
  );

  /** `onCandidate` sees the candidate as soon as the identity is settled and again once its profile arrives. */
  const resolveExactContact = React.useCallback(
    async (
      rawQuery: string,
      onCandidate: (candidate: ContactSearchCandidate) => void,
    ): Promise<ExactContactResolution> => {
      const resolveExact = async (
        npub: string,
        fallback: { name: string; lnAddress: string; verifiedNip05?: string },
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

      const directNpub = decodeDirectNpubIdentifier(rawQuery);
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
        verifiedNip05: identifier.identifier,
      });
    },
    [fetchProfileOneShot, toSearchCandidate],
  );

  return { resolveExactContact, toSearchCandidate };
};
