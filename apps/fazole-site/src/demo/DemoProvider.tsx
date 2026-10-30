import { fetchFiatRates } from "@linky-fit/linkshu";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  attachBitcoin,
  balanceSats,
  cancelPayment,
  createPayment,
  DemoContext,
  seedData,
  settlePayment,
  withdraw,
} from "./store";
import type { DemoActions, DemoPayment } from "./store";

const RATE_TIMEOUT_MS = 8_000;

const randomVariableSymbol = (): string =>
  String(1_000_000_000 + Math.floor(Math.random() * 9_000_000_000));

type Rate =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly czkPerBtc: number }
  | { readonly status: "failed" };

/** The CZK price of bitcoin, fetched once per page and again on demand. */
const useCzkRate = () => {
  const [rate, setRate] = useState<Rate>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    fetchFiatRates(AbortSignal.timeout(RATE_TIMEOUT_MS))
      .then((rates) => {
        if (!current) return;
        setRate(
          rates === null
            ? { status: "failed" }
            : { status: "ready", czkPerBtc: rates.czkPerBtc },
        );
      })
      .catch(() => {
        if (current) setRate({ status: "failed" });
      });
    return () => {
      current = false;
    };
  }, [attempt]);
  const refreshRate = useCallback(() => {
    setRate({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);
  return { rate, refreshRate };
};

/** In-memory shop data shared by every phone on the page, so a payment in one shows up in the others. */
export function DemoProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(() => seedData(Date.now()));
  const { rate, refreshRate } = useCzkRate();
  // Stable actions, so a mock's effect that uses one does not restart on every change.
  const actions = useMemo<DemoActions>(
    () => ({
      requestPayment: (amountHalere, tipHalere) => {
        const payment: DemoPayment = {
          id: crypto.randomUUID(),
          amountHalere,
          tipHalere,
          vs: randomVariableSymbol(),
          method: null,
          status: "pending",
          sats: null,
          payer: null,
          bitcoin: null,
          createdAt: new Date(),
          paidAt: null,
        };
        setData((current) =>
          createPayment(current, { ...payment, now: payment.createdAt }),
        );
        return payment;
      },
      attachBitcoin: (id, bitcoin) =>
        setData((current) => attachBitcoin(current, id, bitcoin)),
      settle: (id, settlement) =>
        setData((current) =>
          settlePayment(current, id, settlement, new Date()),
        ),
      cancel: (id) => setData((current) => cancelPayment(current, id)),
      withdraw: (quote) =>
        setData((current) =>
          withdraw(current, quote, crypto.randomUUID(), new Date()),
        ),
      setOfferTips: (offerTips) =>
        setData((current) => ({ ...current, offerTips })),
    }),
    [],
  );
  return (
    <DemoContext
      value={{
        ...data,
        ...actions,
        balanceSats: balanceSats(data),
        czkPerBtc: rate.status === "ready" ? rate.czkPerBtc : null,
        rateFailed: rate.status === "failed",
        refreshRate,
      }}
    >
      {children}
    </DemoContext>
  );
}
