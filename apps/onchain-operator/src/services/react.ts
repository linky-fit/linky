import type { TokenTransfer, WalletBalances } from "@linky-fit/linkshu";
import type { Pubkey } from "@linky-fit/linkstr";
import { useHydrated, useLiveValue } from "@linky-fit/linksync/react";
import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import type { Chat, ReceivedTransferMessage } from "../domain/chat";
import type { OperatorProfile } from "../domain/profile";
import type { OperatorTransfer } from "../domain/transfer";
import { shortNpub } from "../format";
import type { AppServices } from "./appServices";
import type { Device, Session } from "./device";

export const DeviceContext = createContext<Device | null>(null);

export const useDevice = (): Device => {
  const device = useContext(DeviceContext);
  if (device === null) throw new Error("useDevice needs a DeviceProvider");
  return device;
};

/** Whether the device is signed out, opening the account, or signed in. */
export const useSession = (): Session => {
  const device = useDevice();
  return useSyncExternalStore(device.subscribe, device.session);
};

/** The signed-in account's services; only screens behind a signed-in session use it. */
export const useAppServices = (): AppServices => {
  const session = useSession();
  if (session._tag !== "SignedIn")
    throw new Error("useAppServices needs a signed-in session");
  return session.services;
};

/** Whether the account's data has arrived from a relay. */
export const useAccountHydrated = (): boolean =>
  useHydrated(useAppServices().store);

/** Every transfer; `null` until read. */
export const useTransfers = (): readonly OperatorTransfer[] | null =>
  useLiveValue<readonly OperatorTransfer[] | null>(
    useAppServices().live.transfers,
    null,
  );

/** The chat with every user; `null` until read. */
export const useChats = (): readonly Chat[] | null =>
  useLiveValue<readonly Chat[] | null>(useAppServices().live.chats, null);

/** Every transfer message users sent, raw, oldest first; `null` until read. */
export const useTransferLog = (): readonly ReceivedTransferMessage[] | null =>
  useLiveValue<readonly ReceivedTransferMessage[] | null>(
    useAppServices().live.transferLog,
    null,
  );

/** The saved profile; `undefined` until read, `null` before the first save. */
export const useProfile = (): OperatorProfile | null | undefined =>
  useLiveValue<OperatorProfile | null | undefined>(
    useAppServices().live.profile,
    undefined,
  );

/** The wallet balance in sats, total and per mint; `null` until read. */
export const useWalletBalance = (): WalletBalances | null =>
  useLiveValue<WalletBalances | null>(useAppServices().live.balances, null);

/** Issued tokens nobody claimed yet, newest first; `null` until read. */
export const useIssuedTokens = (): readonly TokenTransfer[] | null =>
  useLiveValue<readonly TokenTransfer[] | null>(
    useAppServices().live.issuedTokens,
    null,
  );

/** A user's profile name, or their short npub without one, and picture. */
export const usePeerProfile = (
  pubkey: Pubkey,
): { readonly name: string; readonly picture: string | undefined } => {
  const { peerProfiles } = useAppServices();
  useEffect(() => peerProfiles.request(pubkey), [peerProfiles, pubkey]);
  const profile = useSyncExternalStore(peerProfiles.subscribe, () =>
    peerProfiles.get(pubkey),
  );
  return {
    name: profile?.name ?? shortNpub(pubkey),
    picture: profile?.picture ?? undefined,
  };
};
