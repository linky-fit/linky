import { describe, expect, it, vi } from "vitest";
import {
  loadProfilePicture,
  loadSharedProfile,
  renderProfilePage,
  resolveProfilePubkey,
} from "./_profilePage";

const relayProfile = vi.hoisted(() => ({ picture: "" }));
vi.mock("nostr-tools/pool", () => ({
  SimplePool: class {
    get = async (_relays: string[], filter: { kinds: number[] }) =>
      filter.kinds.includes(0)
        ? { content: JSON.stringify(relayProfile), tags: [] }
        : null;
    destroy = () => {};
  },
}));

const NPUB = "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";
const TEMPLATE =
  "<html><head><title>Linky</title></head><body><div id=root></div></body></html>";
const EMPTY = { lightningAddress: null, status: null };
const PAGE_URL = `https://linky.fit/p/${NPUB}`;
const JPEG_DATA_URL = "data:image/jpeg;base64,/9j/4AAQ";

describe("resolveProfilePubkey", () => {
  it("decodes an npub in any case without a lookup", async () => {
    const pubkey =
      "b5aebd498819f6ba9eb5875277ca9293884d25a42be06870cbadd2c3873fa94b";
    expect(await resolveProfilePubkey(NPUB)).toBe(pubkey);
    expect(await resolveProfilePubkey(NPUB.toUpperCase())).toBe(pubkey);
  });

  it("rejects an invalid npub and a malformed name", async () => {
    expect(await resolveProfilePubkey(`${NPUB.slice(0, -1)}x`)).toBeNull();
    expect(await resolveProfilePubkey("no spaces")).toBeNull();
  });
});

describe("profile picture", () => {
  it("keeps a photo stored as a data URL and serves its bytes", async () => {
    relayProfile.picture = JPEG_DATA_URL;
    expect((await loadSharedProfile(NPUB))?.picture).toBe(JPEG_DATA_URL);
    expect(await loadProfilePicture(NPUB)).toEqual({
      contentType: "image/jpeg",
      bytes: Buffer.from("/9j/4AAQ", "base64"),
    });
  });

  it("drops a picture the page can't show safely", async () => {
    relayProfile.picture = "http://example.com/me.jpg";
    expect((await loadSharedProfile(NPUB))?.picture).toBeNull();
    relayProfile.picture = "data:text/html;base64,PHNjcmlwdD4=";
    expect((await loadSharedProfile(NPUB))?.picture).toBeNull();
    expect(await loadProfilePicture(NPUB)).toBeNull();
  });
});

describe("renderProfilePage", () => {
  it("escapes profile text in the preview tags and the embedded data", () => {
    const html = renderProfilePage(
      TEMPLATE,
      {
        ...EMPTY,
        npub: NPUB,
        name: 'Eve "</script><script>alert(1)</script>',
        picture: null,
        about: null,
      },
      PAGE_URL,
    );
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain(
      "<title>Eve &quot;&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; on Linky</title>",
    );
    expect(html).toContain('"npub":"npub1');
    expect(html).toContain("\\u003c/script>");
  });

  it("swaps a generated SVG avatar for its PNG", () => {
    const html = renderProfilePage(
      TEMPLATE,
      {
        ...EMPTY,
        npub: NPUB,
        name: "Dave",
        picture: "https://api.dicebear.com/9.x/lorelei/svg?seed=dave",
        about: "Builder",
      },
      PAGE_URL,
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://api.dicebear.com/9.x/lorelei/png?seed=dave" />',
    );
    expect(html).toContain(
      '<meta property="og:description" content="Builder" />',
    );
  });

  it("points the preview at the served picture for a data-URL photo", () => {
    const html = renderProfilePage(
      TEMPLATE,
      {
        ...EMPTY,
        npub: NPUB,
        name: "Dave",
        picture: JPEG_DATA_URL,
        about: null,
      },
      PAGE_URL,
    );
    expect(html).toContain(
      `<meta property="og:image" content="${PAGE_URL}/picture" />`,
    );
    expect(html).toContain(`"picture":"${JPEG_DATA_URL}"`);
  });

  it("keeps replacement patterns in profile text literal", () => {
    const html = renderProfilePage(
      TEMPLATE,
      {
        ...EMPTY,
        npub: NPUB,
        name: "$& $'",
        picture: null,
        about: null,
      },
      PAGE_URL,
    );
    expect(html).toContain("<title>$&amp; $&#39; on Linky</title>");
  });

  it("renders the not-found page with null data", () => {
    const html = renderProfilePage(TEMPLATE, null, PAGE_URL);
    expect(html).toContain("<title>Linky</title>");
    expect(html).toContain(
      '<script id="shared-profile" type="application/json">null</script>',
    );
  });
});
