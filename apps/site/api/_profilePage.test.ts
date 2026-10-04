import { describe, expect, it } from "vitest";
import { renderProfilePage, resolveProfilePubkey } from "./_profilePage";

const NPUB = "npub1kkht6jvgr8mt4844saf80j5jjwyy6fdy90sxsuxt4hfv8pel499s96jvz8";
const TEMPLATE =
  "<html><head><title>Linky</title></head><body><div id=root></div></body></html>";
const PAGE_URL = `https://linky.fit/p/${NPUB}`;

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

describe("renderProfilePage", () => {
  it("escapes profile text in the preview tags and the embedded data", () => {
    const html = renderProfilePage(
      TEMPLATE,
      {
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
    expect(html).toContain('{"npub":"');
    expect(html).toContain("\\u003c/script>");
  });

  it("swaps a generated SVG avatar for its PNG", () => {
    const html = renderProfilePage(
      TEMPLATE,
      {
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

  it("keeps replacement patterns in profile text literal", () => {
    const html = renderProfilePage(
      TEMPLATE,
      { npub: NPUB, name: "$& $'", picture: null, about: null },
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
