import {
  buildCallbackUrl,
  fetchDomainDocument,
  isLinkauthLink,
  parseLinkauthLink,
  resolveLinkauthLink,
  type FetchDomainResult,
  type ResolveLinkauthResult,
} from "@linky-fit/linkauth/signer";
import { linkauthAudience } from "@linky-fit/linkstr";
import { nostrConnectLoginAtom, useAtomSet } from "@linky-fit/linkstr-react";
import { Cause, Exit, Option } from "effect";
import React from "react";
import { navigateAwayTo } from "../../hooks/useRouting";
import { reportAppLog } from "../../devtools/inspector/appLog";
import type { I18nKey, Translate } from "../../i18n";
import {
  describeSiteLogin,
  type PendingSiteLogin,
  type SiteLoginRequest,
} from "../../siteLogin";
import { deliverSiteLoginAtom, signSiteLoginAtom } from "../../siteLoginSigner";

const SUCCESS_OVERLAY_MS = 2400;

const FAILURE_KEY_BY_TAG: Partial<Record<string, I18nKey>> = {
  LinkstrNotConfigured: "siteLoginUnavailable",
  NostrConnectAckNotDelivered: "siteLoginUnreachable",
  NostrConnectRelaysUnreachable: "siteLoginUnreachable",
  NostrConnectRequestRefused: "siteLoginRefused",
  NostrConnectTimedOut: "siteLoginTimedOut",
  SiteLoginNotDelivered: "siteLoginUnreachable",
};

const INSPECTOR_TAGS = {
  relay: {
    requested: "nostrConnectLogin.requested",
    approved: "nostrConnectLogin.approved",
    failed: "nostrConnectLogin.failed",
    refused: "nostrConnectLogin.refused",
  },
  linkauth: {
    requested: "linkauthLogin.requested",
    approved: "linkauthLogin.approved",
    denied: "linkauthLogin.denied",
    failed: "linkauthLogin.failed",
  },
} as const;

interface UseSiteLoginParams {
  /** Loads an origin's domain document with the browser's own fetch; a seam for tests. */
  fetchDomain?: (origin: string) => Promise<FetchDomainResult>;
  /** Where a callback login sends the browser back; a seam for tests. */
  navigate?: (url: string) => void;
  /** Verifies a `#linkauth` link against its site's domain document; a seam for tests. */
  resolve?: (text: string) => Promise<ResolveLinkauthResult>;
  setStatus: React.Dispatch<React.SetStateAction<string | null>>;
  t: Translate;
}

export interface SiteLoginResult {
  closeSiteLoginConfirmation: () => void;
  confirmSiteLogin: () => Promise<void>;
  pendingSiteLoginConfirmation: PendingSiteLogin | null;
  requestLinkauthLogin: (link: string) => Promise<void>;
  requestSiteLoginConfirmation: (login: SiteLoginRequest) => Promise<void>;
  siteLoginIsBusy: boolean;
  siteLoginIsDone: boolean;
}

/** What the inspector may see of a request: everything but its secret. */
const inspectorFields = (login: SiteLoginRequest) => {
  const { audience, name } = describeSiteLogin(login);
  const site = audience ?? name ?? "an unnamed site";
  if (login.channel === "linkauth") {
    const { delivery, domain, nonce } = login.login;
    return {
      links: { linkauthNonce: nonce },
      site,
      payload: {
        audience,
        name,
        delivery: delivery.kind,
        relays: domain.relays.length,
      },
    };
  }
  const { clientPubkey, image, perms, relays, url } = login.request;
  return {
    links: { pubkey: clientPubkey },
    site,
    payload: { name, url, image, perms, relays },
  };
};

const resolvedPayload = (
  result: ResolveLinkauthResult,
  origin: string | null,
) =>
  result.ok
    ? {
        origin,
        outcome: "verified",
        name: result.login.domain.name,
        relays: result.login.domain.relays.length,
        delivery: result.login.delivery.kind,
      }
    : { origin, outcome: result.reason, detail: result.detail };

/**
 * One-shot login signer: a scanned or opened site login waits for the user's
 * approval. A relay request (`nostrconnect://`) is then answered over NIP-46:
 * Linky acks it, hands out the identity's public key and signs one login
 * event. A `#linkauth` link is first verified against the site's domain
 * document, then answered by signing that event: the browser goes back to the
 * site with it (callback), or it is wrapped to the site's key and published to
 * the document's relays (QR). A link that cannot be verified is refused with
 * no way to approve, and so is a relay login to an origin that publishes a
 * domain document: any page can show such a request for it, while its own
 * `#linkauth` link is bound to it. Nothing stays connected and nothing is
 * stored. A confirmed login keeps the dialog up in its done state for a
 * moment; only failures go to the status toast.
 */
export const useSiteLogin = ({
  fetchDomain = fetchDomainDocument,
  navigate = navigateAwayTo,
  resolve = resolveLinkauthLink,
  setStatus,
  t,
}: UseSiteLoginParams): SiteLoginResult => {
  const logInOverRelays = useAtomSet(nostrConnectLoginAtom, {
    mode: "promiseExit",
  });
  const signLogin = useAtomSet(signSiteLoginAtom, { mode: "promiseExit" });
  const deliverLogin = useAtomSet(deliverSiteLoginAtom, {
    mode: "promiseExit",
  });
  const [pending, setPending] = React.useState<PendingSiteLogin | null>(null);
  const resolutionRef = React.useRef(0);
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

  const offerSiteLogin = React.useCallback(
    (login: SiteLoginRequest, extra: Record<string, unknown> = {}) => {
      const { links, site, payload } = inspectorFields(login);
      reportAppLog({
        tag: INSPECTOR_TAGS[login.channel].requested,
        summary: `Login requested by ${site}`,
        links,
        payload: { ...payload, ...extra },
      });
      setPending(login);
    },
    [],
  );

  const requestSiteLoginConfirmation = React.useCallback(
    async (login: SiteLoginRequest) => {
      resolutionRef.current += 1;
      const resolution = resolutionRef.current;
      const origin =
        login.channel === "relay" ? linkauthAudience(login.request) : null;
      if (origin === null) return offerSiteLogin(login);
      setPending({ channel: "checking", origin });
      const published = await fetchDomain(origin);
      if (resolution !== resolutionRef.current) return;
      if (!published.ok) {
        return offerSiteLogin(login, { domainDocument: published.reason });
      }
      const { links, payload } = inspectorFields(login);
      reportAppLog({
        tag: INSPECTOR_TAGS.relay.refused,
        summary: `Refused a Nostr Connect login to ${origin}: it supports Linky login`,
        links,
        payload: { ...payload, domainName: published.domain.name },
      });
      setPending({ channel: "refused", origin, reason: "linkauth-available" });
    },
    [fetchDomain, offerSiteLogin],
  );

  const requestLinkauthLogin = React.useCallback(
    async (text: string) => {
      if (!isLinkauthLink(text)) return;
      resolutionRef.current += 1;
      const resolution = resolutionRef.current;
      const link = parseLinkauthLink(text);
      const origin = link?.audience ?? null;
      if (origin !== null) setPending({ channel: "checking", origin });
      const result = await resolve(text);
      if (resolution !== resolutionRef.current) return;
      reportAppLog({
        tag: "linkauthLogin.resolved",
        summary: result.ok
          ? `Verified ${origin ?? "site"}`
          : `Refused login link: ${result.reason}`,
        links: link ? { linkauthNonce: link.nonce } : {},
        payload: resolvedPayload(result, origin),
      });
      if (!result.ok) {
        const reason =
          result.reason === "not-a-linkauth-link"
            ? "malformed-link"
            : result.reason;
        setPending({ channel: "refused", origin, reason });
        return;
      }
      offerSiteLogin({ channel: "linkauth", login: result.login });
    },
    [offerSiteLogin, resolve],
  );

  const closeSiteLoginConfirmation = React.useCallback(() => {
    if (isBusy || isDone || !pending) return;
    resolutionRef.current += 1;
    setPending(null);
    if (pending.channel !== "linkauth") return;
    const { links, site, payload } = inspectorFields(pending);
    reportAppLog({
      tag: INSPECTOR_TAGS.linkauth.denied,
      summary: `Login denied for ${site}`,
      links,
      payload,
    });
    const { delivery } = pending.login;
    if (delivery.kind === "callback") {
      navigate(buildCallbackUrl(delivery.url, "denied"));
    }
  }, [isBusy, isDone, navigate, pending]);

  const confirmSiteLogin = React.useCallback(async () => {
    if (!pending || isBusy || isDone) return;
    if (pending.channel === "checking" || pending.channel === "refused") return;
    const { audience } = describeSiteLogin(pending);
    if (audience === null) return;
    const { links, site, payload } = inspectorFields(pending);

    const approved = (
      extra: Record<string, unknown>,
      extraLinks: Record<string, string> = {},
    ) => {
      showDone();
      reportAppLog({
        tag: INSPECTOR_TAGS[pending.channel].approved,
        summary: `Login sent to ${site}`,
        links: { ...links, ...extraLinks },
        payload: { ...payload, ...extra },
      });
    };
    const failed = (cause: Cause.Cause<{ _tag: string }>) => {
      const failure = Option.getOrNull(Cause.failureOption(cause));
      const message = t(
        (failure && FAILURE_KEY_BY_TAG[failure._tag]) ?? "siteLoginFailed",
      );
      setStatus(`${t("errorPrefix")}: ${message}`);
      reportAppLog({
        tag: INSPECTOR_TAGS[pending.channel].failed,
        summary: `Login failed at ${site}`,
        links,
        payload: { ...payload, error: failure ?? Cause.pretty(cause) },
      });
    };

    setIsBusy(true);
    if (pending.channel === "relay") {
      const exit = await logInOverRelays(pending.request);
      setIsBusy(false);
      if (!Exit.isSuccess(exit)) return failed(exit.cause);
      approved({
        signedKind: exit.value.signedKind,
        authorizedDevice: exit.value.authorizedDevice,
      });
      return;
    }

    const { delivery, template } = pending.login;
    const signed = await signLogin(template);
    if (!Exit.isSuccess(signed)) {
      setIsBusy(false);
      return failed(signed.cause);
    }
    if (delivery.kind === "callback") {
      setIsBusy(false);
      approved({});
      navigate(buildCallbackUrl(delivery.url, signed.value));
      return;
    }
    const sent = await deliverLogin({
      assertion: signed.value,
      pubkey: delivery.pubkey,
      relays: delivery.relays,
    });
    setIsBusy(false);
    if (!Exit.isSuccess(sent)) return failed(sent.cause);
    const { results, wrapId } = sent.value;
    approved(
      { results: results.map(({ accepted, relay }) => ({ accepted, relay })) },
      { wrap: wrapId },
    );
  }, [
    deliverLogin,
    isBusy,
    isDone,
    logInOverRelays,
    navigate,
    pending,
    setStatus,
    showDone,
    signLogin,
    t,
  ]);

  return {
    closeSiteLoginConfirmation,
    confirmSiteLogin,
    pendingSiteLoginConfirmation: pending,
    requestLinkauthLogin,
    requestSiteLoginConfirmation,
    siteLoginIsBusy: isBusy,
    siteLoginIsDone: isDone,
  };
};
