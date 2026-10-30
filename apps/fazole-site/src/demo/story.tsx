import { PaymentBanner } from "@linky-fit/ui";
import type { StoryScreenKey } from "../copy";
import { useCopy } from "../locale";
import { formatCrowns } from "./money";
import { OpenPaymentView } from "./screens/PaymentMock";
import { TerminalMock } from "./screens/TerminalMock";
import type { DemoPayment } from "./store";

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

/** The screen a step of the story shows: the app's own screens, frozen at that moment. */
export function StoryScreen({ screen }: { screen: StoryScreenKey }) {
  const t = useCopy().demo;
  switch (screen) {
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
}
