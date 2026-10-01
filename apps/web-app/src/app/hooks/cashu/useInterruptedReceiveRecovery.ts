import type { TokenTransfer } from "@linky-fit/linkshu";
import React from "react";
import { isInterruptedReceive } from "../../lib/cashuTransfers";
import { extractCashuTokenFromText } from "../../lib/tokenText";
import type { LocalNostrMessage } from "../../types/appTypes";

interface UseInterruptedReceiveRecoveryParams {
  cashuTransfers: readonly TokenTransfer[];
  /** Messages chat auto-accept scans for tokens. */
  messages: readonly LocalNostrMessage[];
  /** Wallet loaded, initial sync settled, linkshu runtime composed. */
  ready: boolean;
  saveCashuFromText: (text: string) => Promise<void>;
}

/**
 * Resumes, once per launch, every receive a reload, crash or unreachable
 * mint cut short. It waits for the initial sync, so a receive another
 * device finished is `done` by then. Tokens an incoming message carries are left to chat
 * auto-accept, which records their sender and payment request.
 */
export const useInterruptedReceiveRecovery = ({
  cashuTransfers,
  messages,
  ready,
  saveCashuFromText,
}: UseInterruptedReceiveRecoveryParams): void => {
  const resumedRef = React.useRef(false);

  React.useEffect(() => {
    if (!ready || resumedRef.current) return;
    resumedRef.current = true;
    const carried = new Set(
      messages
        .filter((message) => message.direction === "in")
        .map((message) => extractCashuTokenFromText(message.content)),
    );
    for (const transfer of cashuTransfers) {
      if (!isInterruptedReceive(transfer)) continue;
      if (carried.has(transfer.tokenText)) continue;
      void saveCashuFromText(transfer.tokenText);
    }
  }, [cashuTransfers, messages, ready, saveCashuFromText]);
};
