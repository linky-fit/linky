import {
  DEVICE_AUTHORIZATION_PERMISSION,
  NostrConnectRequest,
  RelayUrl,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PendingSiteLogin, SiteLoginRequest } from "../siteLogin";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { callbackLogin, nostrLogin } from "../testUtils/siteLoginFixtures";
import { SiteLoginModal, type SiteLoginPhase } from "./SiteLoginModal";

const t = (key: string) => key;

const relayLogin = (
  perms: Array<string>,
  url: string | null = "https://shop.example/login",
): SiteLoginRequest => ({
  channel: "relay",
  request: new NostrConnectRequest({
    clientPubkey: makeIdentity().pubkey,
    relays: [RelayUrl.make("wss://relay.test")],
    secret: "s",
    perms,
    name: "Platit prosím",
    url,
    image: null,
  }),
});

const verifiedCallback: SiteLoginRequest = {
  channel: "linkauth",
  login: callbackLogin(),
};
const verifiedNostr: SiteLoginRequest = {
  channel: "linkauth",
  login: nostrLogin(),
};

const renderModal = (
  login: PendingSiteLogin,
  options: {
    phase?: SiteLoginPhase;
    onClose?: () => void;
    onConfirm?: () => Promise<void>;
  } = {},
) =>
  renderIntoDocument(
    <SiteLoginModal
      identity={{ name: "Dave", npub: null, picture: null }}
      login={login}
      onClose={options.onClose ?? (() => undefined)}
      onConfirm={options.onConfirm ?? (() => Promise.resolve())}
      phase={options.phase ?? "confirm"}
      t={t}
    />,
  );

const buttonLabelled = (label: string) =>
  Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === label,
  );

describe("SiteLoginModal", () => {
  it.each([
    ["a callback login", verifiedCallback],
    ["a cross-device login", verifiedNostr],
  ])(
    "leads with the origin of %s, marks it verified, labels the name as the site's claim and says what approving gives and reveals",
    async (_name, login) => {
      const view = await renderModal(login);

      expect(document.body.textContent).toContain("https://shop.example");
      expect(document.body.textContent).toContain("siteLoginTo");
      expect(document.body.textContent).toContain("Shop");
      expect(document.body.textContent).toContain("siteLoginVerified");
      expect(document.body.textContent).toContain("siteLoginNameClaim");
      expect(document.body.textContent).not.toContain("siteLoginUnverified");
      const text = document.body.textContent ?? "";
      expect(text.indexOf("https://shop.example")).toBeLessThan(
        text.indexOf("siteLoginVerified"),
      );
      expect(text.indexOf("siteLoginVerified")).toBeLessThan(
        text.indexOf("Shop"),
      );
      expect(text.indexOf("Shop")).toBeLessThan(
        text.indexOf("siteLoginNameClaim"),
      );
      expect(document.body.textContent).toContain("siteLoginShares");
      expect(document.body.textContent).toContain("siteLoginRevealsProfile");
      expect(buttonLabelled("siteLoginConfirm")).toBeDefined();
      await view.unmount();
    },
  );

  it("tells the user to approve a cross-device login only if they started it on the site", async () => {
    const view = await renderModal(verifiedNostr);

    expect(document.body.textContent).toContain("siteLoginCheckAddress");
    expect(document.body.textContent).not.toContain("siteLoginStartedHere");
    await view.unmount();
  });

  it("adds no started-here warning to a same-device login", async () => {
    const view = await renderModal(verifiedCallback);

    expect(document.body.textContent).not.toContain("siteLoginCheckAddress");
    expect(document.body.textContent).not.toContain("siteLoginStartedHere");
    await view.unmount();
  });

  it("keeps a foreign signer's relay request unverified with its warning", async () => {
    const view = await renderModal(relayLogin(["sign_event:24139"]));

    expect(document.body.textContent).toContain("https://shop.example");
    expect(document.body.textContent).toContain("Platit prosím");
    expect(document.body.textContent).toContain("siteLoginUnverified");
    expect(document.body.textContent).not.toContain("siteLoginVerified");
    expect(document.body.textContent).toContain("siteLoginStartedHere");
    expect(document.body.textContent).toContain("siteLoginRevealsProfile");
    await view.unmount();
  });

  it("shows only a cancel button while the site is being checked", async () => {
    const onClose = vi.fn();
    const view = await renderModal(
      { channel: "checking", origin: "https://shop.example" },
      { onClose },
    );

    expect(document.body.textContent).toContain("siteLoginChecking");
    expect(buttonLabelled("siteLoginConfirm")).toBeUndefined();
    await act(async () => buttonLabelled("payCancel")?.click());
    expect(onClose).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it.each([
    ["unverified-domain", "siteLoginCannotVerifyHint"],
    ["callback-not-listed", "siteLoginCallbackNotListedHint"],
    ["malformed-link", "siteLoginInvalidLinkHint"],
    ["linkauth-available", "siteLoginSupportsLinkyHint"],
  ] as const)("explains %s and offers only Close", async (reason, hint) => {
    const onClose = vi.fn();
    const view = await renderModal(
      { channel: "refused", origin: "https://shop.example", reason },
      { onClose },
    );

    expect(document.body.textContent).toContain(hint);
    expect(document.querySelectorAll("button")).toHaveLength(1);
    await act(async () => buttonLabelled("close")?.click());
    expect(onClose).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("confirms and cancels through the buttons", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn(() => Promise.resolve());
    const view = await renderModal(verifiedCallback, { onClose, onConfirm });

    await act(async () => buttonLabelled("siteLoginConfirm")?.click());
    expect(onConfirm).toHaveBeenCalledOnce();
    await act(async () => buttonLabelled("payCancel")?.click());
    expect(onClose).toHaveBeenCalledOnce();
    await view.unmount();
  });

  it("announces the device link and names it on the button when the site asks for it", async () => {
    const view = await renderModal(
      relayLogin(["sign_event:24139", DEVICE_AUTHORIZATION_PERMISSION]),
    );
    expect(document.body.textContent).toContain("siteLoginLinksDevice");
    expect(buttonLabelled("siteLoginConfirmDevice")).toBeDefined();
    await view.unmount();
  });

  it("stays a plain login otherwise", async () => {
    const view = await renderModal(relayLogin(["sign_event:24139"]));
    expect(document.body.textContent).not.toContain("siteLoginLinksDevice");
    expect(buttonLabelled("siteLoginConfirm")).toBeDefined();
    await view.unmount();
  });

  it.each([
    ["no url", relayLogin(["sign_event:24139"], null)],
    ["no login permission", relayLogin(["sign_event:27235"])],
  ])(
    "says a relay request with %s is unsupported and offers no approval",
    async (_name, login) => {
      const view = await renderModal(login);

      expect(document.body.textContent).toContain("siteLoginUnsupportedHint");
      expect(document.body.textContent).not.toContain(
        "siteLoginRevealsProfile",
      );
      expect(buttonLabelled("siteLoginConfirm")).toBeUndefined();
      expect(buttonLabelled("siteLoginConfirmDevice")).toBeUndefined();
      expect(buttonLabelled("close")).toBeDefined();
      await view.unmount();
    },
  );

  it.each([
    ["a callback login", verifiedCallback, "siteLoginDoneReturning"],
    ["a cross-device login", verifiedNostr, "siteLoginDoneOtherDevice"],
  ])(
    "shows the done state of %s without buttons",
    async (_name, login, hint) => {
      const view = await renderModal(login, { phase: "done" });

      expect(document.body.textContent).toContain(hint);
      expect(document.querySelectorAll("button")).toHaveLength(0);
      await view.unmount();
    },
  );
});
