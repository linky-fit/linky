import type { WalletBalances } from "@linky-fit/linkshu";
import type { Pubkey } from "@linky-fit/linkstr";
import { useHydrated, useLiveValue } from "@linky-fit/linksync/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  historyEntries,
  type CzkAmount,
  type DirectTransfer,
  type HistoryEntry,
  type Payment,
  type Pledge,
  pledgeRemainingCzk,
  type ShopProfile,
  type SupportChat,
  type Withdrawal,
} from "../domain";
import { shortNpub } from "../format";
import type { BitcoinQrMode } from "../storage/bitcoinQrSetting";
import type { MonetaConnection } from "../storage/monetaSetting";
import type { FazoleRecords } from "../storage/transactions";
import type { AppServices } from "./appServices";
import type { Device, Session } from "./device";
import type { PayerProfile } from "./nostr";

export const DeviceContext = createContext<Device | null>(null);

export const useDevice = (): Device => {
  const device = useContext(DeviceContext);
  if (device === null) throw new Error("useDevice needs a DeviceProvider");
  return device;
};

/** Whether the device is signed out, opening an account, or signed in. */
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

/** Whether the account's data has arrived from a relay; a restored device shows nothing before. */
export const useAccountHydrated = (): boolean =>
  useHydrated(useAppServices().store);

/** The shop profile; `undefined` until read, `null` while the account has none (yet). */
export const useShopProfile = (): ShopProfile | null | undefined =>
  useLiveValue<ShopProfile | null | undefined>(
    useAppServices().live.shop,
    undefined,
  );

/** Whether the terminal offers a tip; `undefined` until read. */
export const useOfferTips = (): boolean | undefined =>
  useLiveValue<boolean | undefined>(useAppServices().live.offerTips, undefined);

/** What the Bitcoin QR carries; `undefined` until read. */
export const useBitcoinQrMode = (): BitcoinQrMode | undefined =>
  useLiveValue<BitcoinQrMode | undefined>(
    useAppServices().live.bitcoinQrMode,
    undefined,
  );

/** The MONETA connection; `undefined` until read, `null` while the shop has none. */
export const useMonetaConnection = (): MonetaConnection | null | undefined =>
  useLiveValue<MonetaConnection | null | undefined>(
    useAppServices().live.moneta,
    undefined,
  );
/** The mint new payments are minted at; `undefined` until read. */
export const useMintUrl = (): string | undefined =>
  useLiveValue<string | undefined>(useAppServices().live.mintUrl, undefined);

/** The payer's Nostr profile once a relay answers; `null` before, without one, or for no payer. */
export const usePayerProfile = (pubkey: Pubkey | null): PayerProfile | null => {
  const { payers } = useAppServices();
  const [loaded, setLoaded] = useState<{
    readonly pubkey: Pubkey;
    readonly profile: PayerProfile | null;
  } | null>(null);
  useEffect(() => {
    if (pubkey === null) return;
    let current = true;
    void payers.profile(pubkey).then((profile) => {
      if (current) setLoaded({ pubkey, profile });
    });
    return () => {
      current = false;
    };
  }, [payers, pubkey]);
  return loaded !== null && loaded.pubkey === pubkey ? loaded.profile : null;
};

/** What to call the payer: their Nostr name, or their short npub while there is none. */
export const usePayerName = (pubkey: Pubkey): string =>
  usePayerProfile(pubkey)?.name ?? shortNpub(pubkey);

/** The chat with Fazole support; `null` until read. */
export const useSupportChat = (): SupportChat | null =>
  useLiveValue<SupportChat | null>(useAppServices().supportChat.live, null);

/** Payments, receipts, direct transfers and withdrawals, newest first; `null` until read. */
export const useFazoleRecords = (): FazoleRecords | null =>
  useLiveValue<FazoleRecords | null>(useAppServices().live.records, null);

/** Payments and direct transfers, as the history lists them; empty until read. */
export const useHistory = (): HistoryEntry[] => {
  const records = useFazoleRecords();
  return useMemo(
    () =>
      records === null
        ? []
        : historyEntries(records.payments, records.directTransfers),
    [records],
  );
};

/** Every direct transfer, newest first; empty until read. */
export const useDirectTransfers = (): ReadonlyArray<DirectTransfer> =>
  useFazoleRecords()?.directTransfers ?? [];

/** The payment a route names; `undefined` until read, `null` when there is none. */
export const usePayment = (id: string): Payment | null | undefined => {
  const records = useFazoleRecords();
  return records === null
    ? undefined
    : (records.payments.find((payment) => payment.id === id) ?? null);
};

/** Every withdrawal, newest first; empty until read. */
export const useWithdrawals = (): ReadonlyArray<Withdrawal> =>
  useFazoleRecords()?.withdrawals ?? [];

/** The open pledge; `undefined` until read, `null` while there is none. */
export const usePledge = (): Pledge | null | undefined =>
  useLiveValue<Pledge | null | undefined>(
    useAppServices().live.pledge,
    undefined,
  );

/** Who the pledge is owed to: their Nostr name, the address typed, or their short npub. */
export const usePledgerName = (pledge: Pledge): string =>
  usePayerProfile(pledge.pubkey)?.name ??
  pledge.address ??
  shortNpub(pledge.pubkey);

/** The open pledge with what is still owed; `null` while there is none. */
export const usePledgeStatus = (): {
  readonly pledge: Pledge;
  readonly remainingCzk: CzkAmount;
} | null => {
  const pledge = usePledge();
  const withdrawals = useWithdrawals();
  return useMemo(
    () =>
      pledge
        ? { pledge, remainingCzk: pledgeRemainingCzk(pledge, withdrawals) }
        : null,
    [pledge, withdrawals],
  );
};

/** The wallet balance in sats, total and per mint; `null` until read. */
export const useWalletBalance = (): WalletBalances | null =>
  useLiveValue<WalletBalances | null>(useAppServices().live.balances, null);

export type CzkRate =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly czkPerBtc: number }
  | { readonly status: "failed"; readonly retry: () => void };

/** CZK per BTC for "≈ CZK" hints, with a retry when the rate service is down. */
export const useCzkRate = (): CzkRate => {
  const { rates } = useAppServices();
  const [attempt, setAttempt] = useState(0);
  const [rate, setRate] = useState<number | null | undefined>(undefined);
  const retry = useCallback(() => {
    setRate(undefined);
    setAttempt((current) => current + 1);
  }, []);
  useEffect(() => {
    let current = true;
    void rates.czkPerBtc().then((czkPerBtc) => {
      if (current) setRate(czkPerBtc);
    });
    return () => {
      current = false;
    };
  }, [rates, attempt]);
  if (rate === undefined) return { status: "loading" };
  return rate === null
    ? { status: "failed", retry }
    : { status: "ready", czkPerBtc: rate };
};
