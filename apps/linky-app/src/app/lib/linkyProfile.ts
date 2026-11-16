import type { ProfileMetadata } from "@linky-fit/linkstr";
import { DEFAULT_NIP05_DOMAIN } from "../../utils/nostrNip05";

const LINKY_ADDRESS_SUFFIX = `@${DEFAULT_NIP05_DOMAIN}`;

/** Whether an address is on Linky's domain, where every Linky account gets one. */
export const isLinkyAddress = (address: string | null | undefined): boolean =>
  (address ?? "").trim().toLowerCase().endsWith(LINKY_ADDRESS_SUFFIX);

/**
 * Whether a profile looks like a Linky account: a fresh one carries the
 * synthetic `npub…@linky.fit` lightning address, a named one a NIP-05 there.
 */
export const isLinkyProfile = (metadata: ProfileMetadata): boolean =>
  isLinkyAddress(metadata.lud16) ||
  isLinkyAddress(metadata.lud06) ||
  isLinkyAddress(metadata.nip05);
