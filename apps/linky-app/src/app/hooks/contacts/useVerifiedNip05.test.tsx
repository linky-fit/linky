// @vitest-environment jsdom
import { encodeNpub } from "@linky-fit/linkstr";
import { makeIdentity } from "@linky-fit/linkstr/testing";
import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../../../testUtils/renderIntoDocument";
import { useVerifiedNip05 } from "./useVerifiedNip05";

const ownerKey = makeIdentity().pubkey;
const owner = encodeNpub(ownerKey);
const other = encodeNpub(makeIdentity().pubkey);

const fetchMock = vi.fn(async (url: URL) => {
  const name = url.searchParams.get("name");
  return new Response(JSON.stringify({ names: { [name ?? ""]: ownerKey } }), {
    status: 200,
  });
});
vi.stubGlobal("fetch", fetchMock);

const renderVerified = async (npub: string, nip05: string) => {
  const seen: { value?: string | null } = {};
  const Probe = () => {
    const value = useVerifiedNip05(npub, nip05);
    React.useEffect(() => {
      seen.value = value;
    });
    return null;
  };
  const view = await renderIntoDocument(<Probe />);
  await act(async () => {});
  return { seen, unmount: view.unmount };
};

describe("useVerifiedNip05", () => {
  it("confirms a claim with the claimed domain's nostr.json, only for the npub it names", async () => {
    const verified = await renderVerified(owner, "nvk@primal.net");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://primal.net/.well-known/nostr.json?name=nvk",
    );
    expect(verified.seen.value).toBe("nvk@primal.net");
    await verified.unmount();

    const impostor = await renderVerified(other, "nvk@primal.net");
    expect(impostor.seen.value).toBeNull();
    await impostor.unmount();
  });

  it("never asks linky.fit about its unverifiable npub addresses", async () => {
    fetchMock.mockClear();
    const { seen, unmount } = await renderVerified(owner, `${owner}@linky.fit`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(seen.value).toBeNull();
    await unmount();
  });
});
