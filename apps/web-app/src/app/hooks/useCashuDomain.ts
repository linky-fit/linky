import { useLatest } from "../../hooks/useLatest";
import type { TokenTransfer } from "@linky/linkshu";
import React from "react";

interface UseCashuDomainParams {
  /** Tokens the wallet sent or received as text. */
  cashuTransfers: readonly TokenTransfer[];
  /** True once the wallet inventory answered its first read. */
  walletLoaded: boolean;
}

export const useCashuDomain = ({
  cashuTransfers,
  walletLoaded,
}: UseCashuDomainParams) => {
  const cashuTransfersRef = useLatest(cashuTransfers);

  const optimisticallyKnownCashuTokensRef = React.useRef<Set<string>>(
    new Set(),
  );

  const normalizeCashuTokenText = React.useCallback(
    (tokenRaw: string): string => {
      return tokenRaw.trim();
    },
    [],
  );

  const isOptimisticallyKnownCashuToken = React.useCallback(
    (tokenRaw: string): boolean => {
      const normalized = normalizeCashuTokenText(tokenRaw);
      if (!normalized) return false;
      return optimisticallyKnownCashuTokensRef.current.has(normalized);
    },
    [normalizeCashuTokenText],
  );

  const rememberCashuTokenKnown = React.useCallback(
    (...tokens: readonly string[]) => {
      for (const token of tokens) {
        const normalized = normalizeCashuTokenText(token);
        if (!normalized) continue;
        optimisticallyKnownCashuTokensRef.current.add(normalized);
      }
    },
    [normalizeCashuTokenText],
  );

  // Auto-accept of message-borne tokens waits for the inventory, so a token
  // the wallet already holds is not offered to the mint again on boot.
  const cashuTokensHydratedRef = React.useRef(false);
  React.useEffect(() => {
    cashuTokensHydratedRef.current = walletLoaded;
  }, [walletLoaded]);

  // A failed receive does not count as stored: pasting the text again retries.
  const isTransferStored = React.useCallback(
    (raw: string): boolean =>
      cashuTransfersRef.current.some(
        (transfer) =>
          transfer.tokenText === raw &&
          !(transfer.kind === "receive" && transfer.status === "failed"),
      ),
    [cashuTransfersRef],
  );

  const isCashuTokenStored = React.useCallback(
    (tokenRaw: string): boolean => {
      const raw = normalizeCashuTokenText(tokenRaw);
      if (!raw) return false;
      return isOptimisticallyKnownCashuToken(raw) || isTransferStored(raw);
    },
    [
      isOptimisticallyKnownCashuToken,
      isTransferStored,
      normalizeCashuTokenText,
    ],
  );

  const isCashuTokenKnownAny = React.useCallback(
    (tokenRaw: string): boolean => {
      const raw = normalizeCashuTokenText(tokenRaw);
      if (!raw) return false;
      return (
        isOptimisticallyKnownCashuToken(raw) ||
        cashuTransfersRef.current.some((transfer) => transfer.tokenText === raw)
      );
    },
    [
      cashuTransfersRef,
      isOptimisticallyKnownCashuToken,
      normalizeCashuTokenText,
    ],
  );

  return {
    cashuTokensHydratedRef,
    isCashuTokenKnownAny,
    isCashuTokenStored,
    rememberCashuTokenKnown,
  };
};
