import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  balanceSats,
  cancelPayment,
  createPayment,
  DemoContext,
  seedData,
  settlePayment,
  withdraw,
} from "./store";
import type { DemoActions, DemoPayment } from "./store";

const randomVariableSymbol = (): string =>
  String(1_000_000_000 + Math.floor(Math.random() * 9_000_000_000));

/** In-memory shop data shared by every phone on the page, so a payment in one shows up in the others. */
export function DemoProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(() => seedData(Date.now()));
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
          createdAt: new Date(),
          paidAt: null,
        };
        setData((current) =>
          createPayment(current, { ...payment, now: payment.createdAt }),
        );
        return payment;
      },
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
      value={{ ...data, ...actions, balanceSats: balanceSats(data) }}
    >
      {children}
    </DemoContext>
  );
}
