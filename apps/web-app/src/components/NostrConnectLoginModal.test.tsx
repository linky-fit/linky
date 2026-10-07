import { describe, expect, it } from "vitest";
import {
  DEVICE_AUTHORIZATION_PERMISSION,
  NostrConnectRequest,
  RelayUrl,
} from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { NostrConnectLoginModal } from "./NostrConnectLoginModal";

const t = (key: string) => key;

const requestWith = (perms: Array<string>) =>
  new NostrConnectRequest({
    clientPubkey: makeIdentity().pubkey,
    relays: [RelayUrl.make("wss://relay.test")],
    secret: "s",
    perms,
    name: "Platit prosím",
    url: null,
    image: null,
  });

const renderModal = (perms: Array<string>) =>
  renderIntoDocument(
    <NostrConnectLoginModal
      identity={{ name: "Dave", npub: null, picture: null }}
      onClose={() => undefined}
      onConfirm={() => Promise.resolve()}
      phase="confirm"
      request={requestWith(perms)}
      t={t}
    />,
  );

describe("NostrConnectLoginModal", () => {
  it("announces the device link and names it on the button when the site asks for it", async () => {
    const view = await renderModal([DEVICE_AUTHORIZATION_PERMISSION]);
    expect(document.body.textContent).toContain("nostrConnectLoginLinksDevice");
    expect(document.body.textContent).toContain(
      "nostrConnectLoginConfirmDevice",
    );
    await view.unmount();
  });

  it("stays a plain login otherwise", async () => {
    const view = await renderModal(["sign_event:27235"]);
    expect(document.body.textContent).not.toContain(
      "nostrConnectLoginLinksDevice",
    );
    expect(document.body.textContent).toContain("nostrConnectLoginConfirm");
    await view.unmount();
  });
});
