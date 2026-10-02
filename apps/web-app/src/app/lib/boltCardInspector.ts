import { getInspectorEmissionEnabled } from "../../devtools/inspector/inspectorEnabled";
import { reportInspectorRows } from "../../devtools/inspector/reportInspectorRows";

export type BoltCardInspectorTag =
  | "boltCard.sessionStarted"
  | "boltCard.nfcStarted"
  | "boltCard.bridgeReady"
  | "boltCard.bridgeLost"
  | "boltCard.tagRead"
  | "boltCard.withdrawAnswered"
  | "boltCard.invoiceAnswered"
  | "boltCard.sessionEnded";

interface BoltCardInspectorEvent {
  tag: BoltCardInspectorTag;
  summary: string;
  sessionId: string;
  cardId: string;
  bridgeUrl: string;
  payload: Record<string, string | number | boolean | null>;
}

/** Card keys, `p`/`c` and full invoices never reach the row; ids and amounts do. */
export const reportBoltCardEvent = ({
  tag,
  summary,
  sessionId,
  cardId,
  bridgeUrl,
  payload,
}: BoltCardInspectorEvent): void => {
  if (!getInspectorEmissionEnabled()) return;
  reportInspectorRows([
    {
      at: Date.now(),
      channel: "boltcard",
      tag,
      summary,
      links: { boltCardSession: sessionId, boltCard: cardId },
      context: { bridge: bridgeUrl },
      payload,
    },
  ]);
};
