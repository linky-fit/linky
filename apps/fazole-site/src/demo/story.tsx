import { PaymentBanner } from "@linky-fit/ui";
import type { ReactNode } from "react";
import { copy } from "../copy";
import type { StoryScreenKey } from "../copy";
import { formatCrowns } from "./money";
import { OpenPaymentView } from "./screens/PaymentMock";
import { TerminalMock } from "./screens/TerminalMock";
import type { DemoPayment } from "./store";

const t = copy.demo;
const noop = () => {};
const amountHalere = 25_000;

/** The payment the story shows; it is in no store, so no phone can act on it. */
const storyPayment: DemoPayment = {
  id: "story",
  amountHalere,
  tipHalere: null,
  method: null,
  status: "pending",
  vs: "4820130700",
  sats: null,
  payer: null,
  bitcoin: null,
  createdAt: new Date(0),
  paidAt: null,
};

export const storyLabels: Record<StoryScreenKey, string> = {
  amount: t.labels.amountStep,
  qr: t.labels.qrStep,
  paid: t.labels.paidStep,
};

/** The screen a step of the story shows: the app's own screens, frozen at that moment. */
export const storyScreen = (key: StoryScreenKey): ReactNode => {
  switch (key) {
    case "amount":
      return (
        <TerminalMock
          start={{ input: "250", tipping: false }}
          onOpenPayment={noop}
          onOpenSections={noop}
        />
      );
    case "qr":
      return (
        <OpenPaymentView
          payment={storyPayment}
          leg="bank"
          onLegChange={noop}
          onMarkPaid={noop}
          onCancel={noop}
          onClose={noop}
        />
      );
    case "paid":
      return (
        <TerminalMock
          start={{ input: "", tipping: false }}
          banner={
            <PaymentBanner
              contained
              title={t.payment.paidTitle}
              amount={formatCrowns(amountHalere)}
              unit={t.czk}
              direction="in"
            />
          }
          onOpenPayment={noop}
          onOpenSections={noop}
        />
      );
  }
};
