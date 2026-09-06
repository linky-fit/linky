import type { OwnerLaneIndex } from "./domain";

export const NOSTR_PATH = "m/44'/1237'/0'/0/0";
export const CASHU_SEED_PATH = "m/83696968'/39'/0'/24'/0'";
export const META_OWNER_PATH = "m/83696968'/39'/0'/24'/1'/0'";
export const ERROR_TRACKER_OWNER_PATH = "m/83696968'/39'/0'/24'/7'/0'";
export const IDENTITY_OWNER_PATH = "m/83696968'/39'/0'/24'/6'/0'";

export const contactsOwnerPath = (index: OwnerLaneIndex): string =>
  `m/83696968'/39'/0'/24'/2'/${index}'`;

export const cashuOwnerPath = (index: OwnerLaneIndex): string =>
  `m/83696968'/39'/0'/24'/3'/${index}'`;

export const messagesOwnerPath = (index: OwnerLaneIndex): string =>
  `m/83696968'/39'/0'/24'/4'/${index}'`;

export const transactionsOwnerPath = (index: OwnerLaneIndex): string =>
  `m/83696968'/39'/0'/24'/5'/${index}'`;
