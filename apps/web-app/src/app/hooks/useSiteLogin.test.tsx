import { buildCallbackUrl } from "@linky-fit/linkauth/signer";
import type {
  FetchDomainResult,
  ResolveLinkauthResult,
} from "@linky-fit/linkauth/signer";
import {
  NostrConnectLoginReceipt,
  NostrConnectRequestRefused,
  NostrConnectTimedOut,
  parseNostrConnectUri,
  type NostrConnectRequest,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { Exit } from "effect";
import { finalizeEvent } from "nostr-tools";
import { act, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteLoginRequest } from "../../siteLogin";
import { renderIntoDocument } from "../../testUtils/renderIntoDocument";
import {
  CALLBACK_URL,
  NONCE,
  SHOP,
  SITE_PUBKEY,
  SITE_RELAYS,
  callbackLogin,
  linkauthFragment,
  nostrLogin,
} from "../../testUtils/siteLoginFixtures";

const { deliverMock, logInMock, reportAppLogMock, signMock } = vi.hoisted(
  () => ({
    deliverMock: vi.fn(),
    logInMock:
      vi.fn<
        (
          request: NostrConnectRequest,
        ) => Promise<Exit.Exit<NostrConnectLoginReceipt, { _tag: string }>>
      >(),
    reportAppLogMock:
      vi.fn<
        (row: {
          tag: string;
          payload: unknown;
          links?: Record<string, unknown>;
        }) => void
      >(),
    signMock: vi.fn(),
  }),
);

vi.mock("@linky-fit/linkstr-react", () => ({
  nostrConnectLoginAtom: "nostrConnectLogin",
  useAtomSet: (atom: string) =>
    atom === "signSiteLogin"
      ? signMock
      : atom === "deliverSiteLogin"
        ? deliverMock
        : logInMock,
}));
vi.mock("../../siteLoginSigner", () => ({
  deliverSiteLoginAtom: "deliverSiteLogin",
  signSiteLoginAtom: "signSiteLogin",
}));
vi.mock("../../devtools/inspector/appLog", () => ({
  reportAppLog: reportAppLogMock,
}));

import { useSiteLogin, type SiteLoginResult } from "./useSiteLogin";

const parsed = parseNostrConnectUri(
  `nostrconnect://${makeIdentity().pubkey}?relay=wss%3A%2F%2Frelay.example.com&secret=s3cr3t&name=Example&url=https%3A%2F%2Fexample.com&perms=sign_event%3A24139`,
);
if (!parsed) throw new Error("fixture URI did not parse");
const RELAY: SiteLoginRequest = { channel: "relay", request: parsed };
const UNSUPPORTED_RELAY: SiteLoginRequest = {
  channel: "relay",
  request: { ...parsed, perms: [] },
};

const CALLBACK_LINK = `https://app.linky.fit/#${linkauthFragment({ cb: CALLBACK_URL })}`;
const CALLBACK = { channel: "linkauth", login: callbackLogin() } as const;
const NOSTR = { channel: "linkauth", login: nostrLogin() } as const;
const ASSERTION = finalizeEvent(
  { ...callbackLogin().template, created_at: 1_700_000_000 },
  makeIdentity().secretKey,
);

const SHOP_DOMAIN = { ...callbackLogin().domain, callbacks: [] };

const t = (key: string) => key;

describe("useSiteLogin", () => {
  const latest: { current: SiteLoginResult | null } = { current: null };
  const setStatus = vi.fn();
  const navigate = vi.fn<(url: string) => void>();
  const resolve = vi.fn<(text: string) => Promise<ResolveLinkauthResult>>();
  const fetchDomain = vi.fn<(origin: string) => Promise<FetchDomainResult>>();

  function Harness(): null {
    const result = useSiteLogin({
      fetchDomain,
      navigate,
      resolve,
      setStatus,
      t,
    });
    useEffect(() => {
      latest.current = result;
    });
    return null;
  }

  const request = async (login: SiteLoginRequest) => {
    await act(async () => {
      await latest.current?.requestSiteLoginConfirmation(login);
    });
  };
  const confirm = async (login: SiteLoginRequest) => {
    await request(login);
    await act(async () => {
      await latest.current?.confirmSiteLogin();
    });
  };
  const requestLink = async (text: string) => {
    await act(async () => {
      await latest.current?.requestLinkauthLogin(text);
    });
  };
  /** Starts resolving without waiting for the site's answer. */
  const startLink = async (text: string) => {
    await act(async () => {
      void latest.current?.requestLinkauthLogin(text);
    });
  };
  const deferredResolution = () => {
    let settle: (result: ResolveLinkauthResult) => void = () => undefined;
    resolve.mockReturnValue(
      new Promise((resolvePromise) => {
        settle = resolvePromise;
      }),
    );
    return (result: ResolveLinkauthResult) => act(async () => settle(result));
  };
  /** Starts a relay request without waiting for the origin's document. */
  const startRequest = async (login: SiteLoginRequest) => {
    await act(async () => {
      void latest.current?.requestSiteLoginConfirmation(login);
    });
  };
  const deferredDomain = () => {
    let settle: (result: FetchDomainResult) => void = () => undefined;
    fetchDomain.mockReturnValue(
      new Promise((resolvePromise) => {
        settle = resolvePromise;
      }),
    );
    return (result: FetchDomainResult) => act(async () => settle(result));
  };
  const confirmCurrent = async () => {
    await act(async () => {
      await latest.current?.confirmSiteLogin();
    });
  };
  const pending = () => latest.current?.pendingSiteLoginConfirmation;
  const close = async () => {
    await act(async () => {
      latest.current?.closeSiteLoginConfirmation();
    });
  };
  const tags = () => reportAppLogMock.mock.calls.map(([row]) => row.tag);

  beforeEach(() => {
    vi.useFakeTimers();
    fetchDomain.mockResolvedValue({ ok: false, reason: "unreachable" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    latest.current = null;
  });

  describe("over relays", () => {
    it("keeps the dialog in its done state instead of a toast and closes it on a timer", async () => {
      logInMock.mockResolvedValue(
        Exit.succeed(
          new NostrConnectLoginReceipt({
            clientPubkey: RELAY.request.clientPubkey,
            signedKind: 24139,
            authorizedDevice: null,
          }),
        ),
      );
      const rendered = await renderIntoDocument(<Harness />);

      await confirm(RELAY);

      expect(logInMock).toHaveBeenCalledExactlyOnceWith(RELAY.request);
      expect(latest.current?.pendingSiteLoginConfirmation).toBe(RELAY);
      expect(latest.current?.siteLoginIsDone).toBe(true);
      expect(latest.current?.siteLoginIsBusy).toBe(false);
      expect(setStatus).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(tags()).toEqual([
        "nostrConnectLogin.requested",
        "nostrConnectLogin.approved",
      ]);

      await close();
      expect(latest.current?.pendingSiteLoginConfirmation).toBe(RELAY);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2400);
      });
      expect(latest.current?.siteLoginIsDone).toBe(false);
      expect(latest.current?.pendingSiteLoginConfirmation).toBeNull();

      await rendered.unmount();
    });

    it.each([
      [new NostrConnectTimedOut(), "siteLoginTimedOut"],
      [
        new NostrConnectRequestRefused({
          method: "sign_event",
          reason: "kind 1 is not a login",
        }),
        "siteLoginRefused",
      ],
      [{ _tag: "LinkstrNotConfigured" }, "siteLoginUnavailable"],
      [{ _tag: "SomethingNew" }, "siteLoginFailed"],
    ])(
      "reports %o through the status toast and keeps the dialog",
      async (error, key) => {
        logInMock.mockResolvedValue(Exit.fail(error));
        const rendered = await renderIntoDocument(<Harness />);

        await confirm(RELAY);

        expect(latest.current?.siteLoginIsDone).toBe(false);
        expect(latest.current?.siteLoginIsBusy).toBe(false);
        expect(latest.current?.pendingSiteLoginConfirmation).toBe(RELAY);
        expect(setStatus).toHaveBeenCalledWith(`errorPrefix: ${key}`);
        expect(tags()).toContain("nostrConnectLogin.failed");

        await rendered.unmount();
      },
    );

    it("closes a request the user cancels without contacting the site", async () => {
      const rendered = await renderIntoDocument(<Harness />);

      await request(RELAY);
      await close();

      expect(latest.current?.pendingSiteLoginConfirmation).toBeNull();
      expect(logInMock).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();

      await rendered.unmount();
    });

    it("offers a login to an origin without a domain document as unverified", async () => {
      const rendered = await renderIntoDocument(<Harness />);

      await request(RELAY);

      expect(fetchDomain).toHaveBeenCalledExactlyOnceWith(
        "https://example.com",
      );
      expect(pending()).toBe(RELAY);
      expect(tags()).toEqual(["nostrConnectLogin.requested"]);
      expect(reportAppLogMock.mock.calls[0]?.[0].payload).toMatchObject({
        domainDocument: "unreachable",
      });

      await rendered.unmount();
    });

    it("refuses a login to an origin that publishes a domain document", async () => {
      const answer = deferredDomain();
      const rendered = await renderIntoDocument(<Harness />);

      await startRequest(RELAY);
      expect(pending()).toEqual({
        channel: "checking",
        origin: "https://example.com",
      });

      await answer({ ok: true, domain: SHOP_DOMAIN });

      expect(pending()).toEqual({
        channel: "refused",
        origin: "https://example.com",
        reason: "linkauth-available",
      });
      await confirmCurrent();
      expect(logInMock).not.toHaveBeenCalled();
      expect(tags()).toEqual(["nostrConnectLogin.refused"]);
      expect(reportAppLogMock.mock.calls[0]?.[0].links).toEqual({
        pubkey: RELAY.request.clientPubkey,
      });
      expect(JSON.stringify(reportAppLogMock.mock.calls)).not.toContain(
        RELAY.request.secret,
      );

      await rendered.unmount();
    });

    it("drops the check when the user closes the dialog meanwhile", async () => {
      const answer = deferredDomain();
      const rendered = await renderIntoDocument(<Harness />);

      await startRequest(RELAY);
      await close();
      await answer({ ok: true, domain: SHOP_DOMAIN });

      expect(pending()).toBeNull();
      expect(tags()).toEqual([]);

      await rendered.unmount();
    });

    it("does not approve a request that is not a supported login", async () => {
      const rendered = await renderIntoDocument(<Harness />);

      await confirm(UNSUPPORTED_RELAY);

      expect(fetchDomain).not.toHaveBeenCalled();
      expect(logInMock).not.toHaveBeenCalled();
      expect(latest.current?.siteLoginIsDone).toBe(false);

      await rendered.unmount();
    });
  });

  describe("resolving a #linkauth link", () => {
    it("checks the origin first, then offers the verified login", async () => {
      const answer = deferredResolution();
      const rendered = await renderIntoDocument(<Harness />);

      await startLink(CALLBACK_LINK);
      expect(pending()).toEqual({ channel: "checking", origin: SHOP });
      expect(resolve).toHaveBeenCalledExactlyOnceWith(CALLBACK_LINK);

      await answer({ ok: true, login: callbackLogin() });

      expect(pending()).toEqual(CALLBACK);
      expect(tags()).toEqual([
        "linkauthLogin.resolved",
        "linkauthLogin.requested",
      ]);
      expect(reportAppLogMock.mock.calls[0]?.[0].payload).toEqual({
        origin: SHOP,
        outcome: "verified",
        name: "Shop",
        relays: 1,
        delivery: "callback",
      });

      await rendered.unmount();
    });

    it("drops the result when the user closes the dialog while checking", async () => {
      const answer = deferredResolution();
      const rendered = await renderIntoDocument(<Harness />);

      await startLink(CALLBACK_LINK);
      await close();
      await answer({ ok: true, login: callbackLogin() });

      expect(pending()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      expect(tags()).toEqual([]);

      await rendered.unmount();
    });

    it.each([
      [
        "unverified-domain",
        {
          ok: false,
          reason: "unverified-domain",
          detail: "unreachable",
        } as const,
      ],
      [
        "callback-not-listed",
        { ok: false, reason: "callback-not-listed" } as const,
      ],
      ["malformed-link", { ok: false, reason: "malformed-link" } as const],
    ])("refuses %s without any way to approve", async (reason, result) => {
      resolve.mockResolvedValue(result);
      const rendered = await renderIntoDocument(<Harness />);

      await requestLink(CALLBACK_LINK);

      expect(pending()).toEqual({ channel: "refused", origin: SHOP, reason });
      await confirmCurrent();
      expect(signMock).not.toHaveBeenCalled();
      expect(deliverMock).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(latest.current?.siteLoginIsDone).toBe(false);
      expect(tags()).toEqual(["linkauthLogin.resolved"]);
      expect(reportAppLogMock.mock.calls[0]?.[0].payload).toMatchObject({
        origin: SHOP,
        outcome: reason,
      });

      await close();
      expect(pending()).toBeNull();
      expect(navigate).not.toHaveBeenCalled();

      await rendered.unmount();
    });

    it("refuses a link without an origin as malformed", async () => {
      resolve.mockResolvedValue({ ok: false, reason: "malformed-link" });
      const rendered = await renderIntoDocument(<Harness />);

      await requestLink("https://app.linky.fit/#linkauth?o=nonsense");

      expect(pending()).toEqual({
        channel: "refused",
        origin: null,
        reason: "malformed-link",
      });

      await rendered.unmount();
    });

    it("ignores text that is not a linkauth link", async () => {
      const rendered = await renderIntoDocument(<Harness />);

      await requestLink("https://example.com/");

      expect(resolve).not.toHaveBeenCalled();
      expect(pending()).toBeNull();

      await rendered.unmount();
    });
  });

  describe("through a callback", () => {
    it("signs the login template and sends the browser back with the result", async () => {
      signMock.mockResolvedValue(Exit.succeed(ASSERTION));
      const rendered = await renderIntoDocument(<Harness />);

      await confirm(CALLBACK);

      expect(signMock).toHaveBeenCalledExactlyOnceWith(
        callbackLogin().template,
      );
      expect(logInMock).not.toHaveBeenCalled();
      expect(deliverMock).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        buildCallbackUrl(CALLBACK_URL, ASSERTION),
      );
      expect(latest.current?.siteLoginIsDone).toBe(true);
      expect(setStatus).not.toHaveBeenCalled();
      expect(tags()).toEqual([
        "linkauthLogin.requested",
        "linkauthLogin.approved",
      ]);

      await rendered.unmount();
    });

    it("sends the browser back as denied when the user cancels, without signing", async () => {
      const rendered = await renderIntoDocument(<Harness />);

      await request(CALLBACK);
      await close();

      expect(signMock).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        buildCallbackUrl(CALLBACK_URL, "denied"),
      );
      expect(pending()).toBeNull();
      expect(tags()).toEqual([
        "linkauthLogin.requested",
        "linkauthLogin.denied",
      ]);

      await rendered.unmount();
    });

    it("keeps the dialog and does not navigate when signing fails", async () => {
      signMock.mockResolvedValue(Exit.fail({ _tag: "LinkstrNotConfigured" }));
      const rendered = await renderIntoDocument(<Harness />);

      await confirm(CALLBACK);

      expect(navigate).not.toHaveBeenCalled();
      expect(pending()).toBe(CALLBACK);
      expect(setStatus).toHaveBeenCalledWith(
        "errorPrefix: siteLoginUnavailable",
      );
      expect(tags()).toContain("linkauthLogin.failed");

      await rendered.unmount();
    });

    it("keeps the signed event out of the inspector", async () => {
      signMock.mockResolvedValue(Exit.succeed(ASSERTION));
      const rendered = await renderIntoDocument(<Harness />);

      await confirm(CALLBACK);

      const rows = JSON.stringify(reportAppLogMock.mock.calls);
      expect(rows).not.toContain(ASSERTION.sig);
      expect(rows).toContain(NONCE);

      await rendered.unmount();
    });
  });

  describe("over the site's relays", () => {
    const sent = {
      wrapId: "w".repeat(64),
      results: [
        { relay: "wss://relay.shop.example", accepted: true, detail: null },
      ],
    };

    it("signs, publishes the wrap to the document's relays and shows done", async () => {
      signMock.mockResolvedValue(Exit.succeed(ASSERTION));
      deliverMock.mockResolvedValue(Exit.succeed(sent));
      const rendered = await renderIntoDocument(<Harness />);

      await confirm(NOSTR);

      expect(deliverMock).toHaveBeenCalledExactlyOnceWith({
        assertion: ASSERTION,
        pubkey: SITE_PUBKEY,
        relays: SITE_RELAYS,
      });
      expect(navigate).not.toHaveBeenCalled();
      expect(latest.current?.siteLoginIsDone).toBe(true);
      expect(setStatus).not.toHaveBeenCalled();
      expect(tags()).toEqual([
        "linkauthLogin.requested",
        "linkauthLogin.approved",
      ]);
      const approved = reportAppLogMock.mock.calls[1]?.[0];
      expect(approved?.links).toMatchObject({
        linkauthNonce: NONCE,
        wrap: sent.wrapId,
      });
      expect(approved?.payload).toMatchObject({ delivery: "nostr" });
      expect(JSON.stringify(reportAppLogMock.mock.calls)).not.toContain(
        ASSERTION.sig,
      );

      await rendered.unmount();
    });

    it("sends nothing when the user cancels", async () => {
      const rendered = await renderIntoDocument(<Harness />);

      await request(NOSTR);
      await close();

      expect(signMock).not.toHaveBeenCalled();
      expect(deliverMock).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
      expect(pending()).toBeNull();
      expect(tags()).toEqual([
        "linkauthLogin.requested",
        "linkauthLogin.denied",
      ]);

      await rendered.unmount();
    });

    it("keeps the dialog open on a toast when no relay accepts, and lets the user retry", async () => {
      signMock.mockResolvedValue(Exit.succeed(ASSERTION));
      deliverMock.mockResolvedValueOnce(
        Exit.fail({ _tag: "SiteLoginNotDelivered", results: [] }),
      );
      const rendered = await renderIntoDocument(<Harness />);

      await confirm(NOSTR);

      expect(latest.current?.siteLoginIsDone).toBe(false);
      expect(latest.current?.siteLoginIsBusy).toBe(false);
      expect(pending()).toBe(NOSTR);
      expect(setStatus).toHaveBeenCalledWith(
        "errorPrefix: siteLoginUnreachable",
      );
      expect(tags()).toContain("linkauthLogin.failed");

      deliverMock.mockResolvedValueOnce(Exit.succeed(sent));
      await confirmCurrent();

      expect(deliverMock).toHaveBeenCalledTimes(2);
      expect(latest.current?.siteLoginIsDone).toBe(true);

      await rendered.unmount();
    });
  });
});
