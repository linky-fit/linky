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
  walletActivity,
  type Payment,
  type ShopProfile,
  type WalletActivity,
  type Withdrawal,
} from "../domain";
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

/** Payments, receipts and withdrawals, newest first; `null` until read. */
export const useFazoleRecords = (): FazoleRecords | null =>
  useLiveValue<FazoleRecords | null>(useAppServices().live.records, null);

/** Every payment, newest first; empty until read. */
export const usePayments = (): ReadonlyArray<Payment> =>
  useFazoleRecords()?.payments ?? [];

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

/** What moved through the wallet, newest first; empty until read. */
export const useWalletActivity = (limit?: number): WalletActivity[] => {
  const records = useFazoleRecords();
  return useMemo(
    () =>
      records === null
        ? []
        : walletActivity(
            records.payments,
            records.receipts,
            records.withdrawals,
            limit,
          ),
    [records, limit],
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
