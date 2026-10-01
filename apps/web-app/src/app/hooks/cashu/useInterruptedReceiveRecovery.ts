import type { TokenTransfer } from "@linky-fit/linkshu";
import React from "react";
import { isInterruptedReceive } from "../../lib/cashuTransfers";
import { extractCashuTokenFromText } from "../../lib/tokenText";
import type { LocalNostrMessage } from "../../types/appTypes";
import type { SaveCashuFromTextOptions } from "./useSaveCashuFromText";

interface UseInterruptedReceiveRecoveryParams {
  cashuTransfers: readonly TokenTransfer[];
  /** Messages chat auto-accept scans for tokens. */
  messages: readonly LocalNostrMessage[];
  /** Wallet loaded, initial sync settled, linkshu runtime composed. */
  ready: boolean;
  saveCashuFromText: (
    text: string,
    options?: SaveCashuFromTextOptions,
  ) => Promise<void>;
}

/**
 * Resumes, once per launch, every receive a reload, crash or unreachable
 * mint cut short. It waits for the initial sync, so a receive another
 * device finished is usually `done` by then. Tokens an incoming message
 * carries are left to chat auto-accept, which records their sender and
 * payment request. The app starts these, not the user, so they run quiet: a
 * token that lands is announced, anything else reaches only the inspector.
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
      void saveCashuFromText(transfer.tokenText, { automatic: true });
    }
  }, [cashuTransfers, messages, ready, saveCashuFromText]);
};
