import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeNpub, ProfileMetadata } from "@linky/linkstr";
import {
  Registry,
  RegistryContext,
  linkstrConfigAtom,
} from "@linky/linkstr-react";
import { configWith, fakeTransportLayer } from "@linky/linkstr-react/testing";
import { makeIdentity } from "@linky/linkstr/testing";
import { finalizeEvent, type Filter } from "nostr-tools";
import { BluetoothContext } from "../bluetooth/BluetoothContext";
import { emptyBluetoothSnapshot } from "../bluetooth/controller";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { loadCachedProfile, saveCachedProfile } from "../profileCache";
import { formatShortNpub } from "../utils/formatting";
import { ContactNewPage, type ContactSearchResult } from "./ContactNewPage";

describe("ContactNewPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens contact details when a lightning address is prefilled", async () => {
    const { container, root } = await renderIntoDocument(
      <ContactNewPage
        addNewContactFromSearchResult={async () => {}}
        contactSuggestions={[]}
        form={{
          groups: [],
          lnAddress: "alice@example.com",
          name: "",
          npub: "",
        }}
        groupNames={[]}
        handleSaveContact={() => {}}
        isSavingContact={false}
        searchNewContact={async () => ({ kind: "empty" })}
        setForm={() => {}}
        t={(key) => key}
      />,
    );

    const inputs = container.querySelectorAll("input");
    expect(inputs).toHaveLength(3);
    expect(inputs[1]?.value).toBe("alice@example.com");

    await act(async () => root.unmount());
  });

  it("lists search candidates and highlights the verified exact match", async () => {
    vi.useFakeTimers();
    const exact = {
      isExactMatch: true,
      lnAddress: "alice@linky.fit",
      name: "Alice",
      npub: "npub1alice",
      pictureUrl: null,
      query: "alice",
    };
    const similar = {
      isExactMatch: false,
      lnAddress: "",
      name: "Alice Cooper",
      npub: "npub1cooper",
      pictureUrl: null,
      query: "alice",
    };

    const { container, root } = await renderIntoDocument(
      <ContactNewPage
        addNewContactFromSearchResult={async () => {}}
        contactSuggestions={[]}
        form={{ groups: [], lnAddress: "", name: "", npub: "alice" }}
        groupNames={[]}
        handleSaveContact={() => {}}
        isSavingContact={false}
        searchNewContact={async () => ({
          contacts: [exact, similar],
          kind: "found",
        })}
        setForm={() => {}}
        t={(key) => key}
      />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    const rows = container.querySelectorAll(".contact-new-search-result");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classList.contains("is-exact")).toBe(true);
    expect(rows[0]?.textContent).toContain("Alice");
    expect(rows[1]?.classList.contains("is-exact")).toBe(false);
    expect(rows[1]?.textContent).toContain("Alice Cooper");

    await act(async () => root.unmount());
  });

  it.each(["missing", "cached", "fetched", "reconnected"])(
    "adds nearby users with %s Nostr profiles, excluding self and known contacts",
    async (profileSource) => {
      const identities = [makeIdentity(), makeIdentity(), makeIdentity()];
      const peers = identities.map((identity, index) => ({
        pubkey: identity.pubkey,
        npub: encodeNpub(identity.pubkey),
        meshId: String(index),
      }));
      const newcomer = peers[2];
      if (!newcomer) throw new Error("Missing nearby fixture");
      const newcomerIdentity = identities[2];
      if (!newcomerIdentity) throw new Error("Missing nearby identity");
      const name = profileSource === "missing" ? "" : "Nostr Alice";
      const lnAddress = profileSource === "missing" ? "" : "alice@example.com";
      const pictureUrl =
        profileSource === "missing" ? null : "https://example.com/alice.png";
      const registry = Registry.make();
      const releaseConfig = registry.mount(linkstrConfigAtom);
      const fetchedFilters: Filter[] = [];
      const fetchedProfile = finalizeEvent(
        {
          kind: 0,
          tags: [],
          created_at: 2,
          content: JSON.stringify({
            display_name: name,
            lud16: lnAddress,
            picture: pictureUrl,
          }),
        },
        newcomerIdentity.secretKey,
      );
      const storedEvents = profileSource === "fetched" ? [fetchedProfile] : [];
      if (profileSource !== "missing") {
        saveCachedProfile(
          newcomer.npub,
          new ProfileMetadata({
            displayName:
              profileSource === "fetched" || profileSource === "reconnected"
                ? "Old profile"
                : name,
            lud16: lnAddress,
            ...(pictureUrl ? { picture: pictureUrl } : {}),
          }),
          1,
        );
      }
      if (profileSource === "fetched" || profileSource === "reconnected") {
        registry.set(
          linkstrConfigAtom,
          configWith(
            makeIdentity(),
            fakeTransportLayer([], [], storedEvents, fetchedFilters),
          ),
        );
      }
      const add = vi.fn(async () => {});
      const search = vi.fn(
        async (): Promise<ContactSearchResult> => ({ kind: "empty" }),
      );
      const page = (active: boolean) => (
        <RegistryContext.Provider value={registry}>
          <BluetoothContext.Provider
            value={{
              ...emptyBluetoothSnapshot,
              available: true,
              enabled: true,
              state: {
                supported: true,
                powered: true,
                permission: "granted",
                active,
              },
              nearby: [...peers, newcomer],
              nearbyCount: 3,
              setEnabled: async () => {},
              sendMessage: async () => {},
            }}
          >
            <ContactNewPage
              addNewContactFromSearchResult={add}
              contactSuggestions={[]}
              form={{ groups: [], lnAddress: "", name: "", npub: "" }}
              groupNames={[]}
              handleSaveContact={() => {}}
              isSavingContact={false}
              knownNpubs={peers.slice(0, 2).map((peer) => peer.npub)}
              searchNewContact={search}
              setForm={() => {}}
              t={(key) => key}
            />
          </BluetoothContext.Provider>
        </RegistryContext.Provider>
      );
      const rendered = await renderIntoDocument(page(true));
      if (profileSource === "reconnected") {
        expect(
          rendered.container.querySelector(".bluetooth-nearby-users")
            ?.textContent,
        ).toContain("Old profile");
        expect(fetchedFilters).toHaveLength(1);
        await rendered.rerender(page(true));
        expect(fetchedFilters).toHaveLength(1);
        storedEvents.push(fetchedProfile);
        await act(async () => {
          window.dispatchEvent(new Event("online"));
        });
      }
      if (profileSource === "fetched" || profileSource === "reconnected") {
        await act(async () => {
          await expect
            .poll(() => loadCachedProfile(newcomer.npub)?.metadata.displayName)
            .toBe(name);
        });
        expect(fetchedFilters).toHaveLength(
          profileSource === "reconnected" ? 2 : 1,
        );
        expect(fetchedFilters[0]?.authors).toEqual([newcomer.pubkey]);
      }
      const rows = rendered.container.querySelectorAll(
        ".bluetooth-nearby-users .contact-new-suggestion",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.textContent).toContain(
        name || formatShortNpub(newcomer.npub),
      );
      expect(rows[0]?.querySelector("img")?.getAttribute("src") ?? null).toBe(
        pictureUrl,
      );
      await act(async () => rows[0]?.querySelector("button")?.click());
      expect(add).toHaveBeenCalledWith({
        npub: newcomer.npub,
        name,
        lnAddress,
        pictureUrl,
        query: newcomer.npub,
        isExactMatch: true,
      });
      expect(search).not.toHaveBeenCalled();

      await rendered.rerender(page(true));
      const expectedFetches =
        profileSource === "reconnected"
          ? 2
          : profileSource === "fetched"
            ? 1
            : 0;
      expect(fetchedFilters).toHaveLength(expectedFetches);

      await rendered.rerender(page(false));
      expect(
        rendered.container.querySelector(".bluetooth-nearby-users"),
      ).toBeNull();
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      expect(fetchedFilters).toHaveLength(expectedFetches);
      await rendered.unmount();
      releaseConfig();
      registry.dispose();
    },
  );
});
