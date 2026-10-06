import { nostrConnectLoginAtom, useAtomSet } from "@linky-fit/linkstr-react";
import { Cause, Exit, Option } from "effect";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import type { I18nKey, Translate } from "../../i18n";
import {
  describeNostrConnectSite,
  type NostrConnectRequest,
} from "../../nostrConnect";

const SUCCESS_OVERLAY_MS = 2400;

const FAILURE_KEY_BY_TAG: Partial<Record<string, I18nKey>> = {
  LinkstrNotConfigured: "nostrConnectLoginUnavailable",
  NostrConnectAckNotDelivered: "nostrConnectLoginUnreachable",
  NostrConnectRelaysUnreachable: "nostrConnectLoginUnreachable",
  NostrConnectRequestRefused: "nostrConnectLoginRefused",
  NostrConnectTimedOut: "nostrConnectLoginTimedOut",
};

interface UseNostrConnectLoginParams {
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export interface NostrConnectLoginResult {
  closeNostrConnectLoginConfirmation: () => void;
  confirmNostrConnectLogin: () => Promise<void>;
  nostrConnectLoginIsBusy: boolean;
  nostrConnectLoginIsDone: boolean;
  pendingNostrConnectLoginConfirmation: NostrConnectRequest | null;
  requestNostrConnectLoginConfirmation: (request: NostrConnectRequest) => void;
}

/** What the inspector may see of a request: everything but its secret. */
const inspectorFields = (request: NostrConnectRequest) => ({
  links: { pubkey: request.clientPubkey },
  site: describeNostrConnectSite(request).label,
  payload: {
    name: request.name,
    url: request.url,
    perms: request.perms,
    relays: request.relays,
  },
});

/**
 * NIP-46 one-shot signer: a scanned `nostrconnect://` request waits for the
 * user's approval, then Linky acks it, hands out the identity's public key and
 * signs one login event. Nothing stays connected and nothing is stored.
 * A confirmed login keeps the dialog up in its done state for a moment; only
 * failures go to the status toast.
 */
export const useNostrConnectLogin = ({
  setStatus,
  t,
}: UseNostrConnectLoginParams): NostrConnectLoginResult => {
  const logIn = useAtomSet(nostrConnectLoginAtom, { mode: "promiseExit" });
  const [pending, setPending] = React.useState<NostrConnectRequest | null>(
    null,
  );
  const [isBusy, setIsBusy] = React.useState(false);
  const [isDone, setIsDone] = React.useState(false);
  const successTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const timerRef = successTimerRef;
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const showDone = React.useCallback(() => {
    setIsDone(true);
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current);
    }
    successTimerRef.current = window.setTimeout(() => {
      setIsDone(false);
      setPending(null);
      successTimerRef.current = null;
    }, SUCCESS_OVERLAY_MS);
  }, []);

  const requestNostrConnectLoginConfirmation = React.useCallback(
    (request: NostrConnectRequest) => {
      const { links, site, payload } = inspectorFields(request);
      reportAppLog({
        tag: "nostrConnectLogin.requested",
        summary: `Nostr Connect login requested by ${site ?? "an unnamed site"}`,
        links,
        payload,
      });
      setPending(request);
    },
    [],
  );

  const closeNostrConnectLoginConfirmation = React.useCallback(() => {
    if (isBusy || isDone) return;
    setPending(null);
  }, [isBusy, isDone]);

  const confirmNostrConnectLogin = React.useCallback(async () => {
    if (!pending || isBusy || isDone) return;
    const { links, site, payload } = inspectorFields(pending);

    setIsBusy(true);
    const exit = await logIn(pending);
    setIsBusy(false);

    if (Exit.isSuccess(exit)) {
      showDone();
      reportAppLog({
        tag: "nostrConnectLogin.approved",
        summary: `Nostr Connect login sent to ${site ?? "an unnamed site"}`,
        links,
        payload: {
          ...payload,
          signedKind: exit.value.signedKind,
          authorizedDevice: exit.value.authorizedDevice,
        },
      });
      return;
    }

    const failure = Option.getOrNull(Cause.failureOption(exit.cause));
    const message = t(
      (failure && FAILURE_KEY_BY_TAG[failure._tag]) ??
        "nostrConnectLoginFailed",
    );
    setStatus(`${t("errorPrefix")}: ${message}`);
    reportAppLog({
      tag: "nostrConnectLogin.failed",
      summary: `Nostr Connect login failed at ${site ?? "an unnamed site"}`,
      links,
      payload: {
        ...payload,
        error: failure ?? Cause.pretty(exit.cause),
      },
    });
  }, [isBusy, isDone, logIn, pending, setStatus, showDone, t]);

  return {
    closeNostrConnectLoginConfirmation,
    confirmNostrConnectLogin,
    nostrConnectLoginIsBusy: isBusy,
    nostrConnectLoginIsDone: isDone,
    pendingNostrConnectLoginConfirmation: pending,
    requestNostrConnectLoginConfirmation,
  };
};
