import { sqliteTrue } from "@linky/linksync";
import { ProfileMetadata } from "@linky/linkstr";
import { describe, expect, it } from "vitest";
import {
  getContactPublicProfile,
  resolveContactProfile,
} from "./contactProfile";

const NPUB = "npub1gcxzte5zlkncx26j68ez60fzkvtkm9e0vrwdcvsjakxf9mu9qewqlfnj5z";

const metadata = (fields: { lud16?: string; name?: string }): ProfileMetadata =>
  new ProfileMetadata(fields);

describe("getContactPublicProfile", () => {
  it("returns empty values without npub or metadata", () => {
    expect(getContactPublicProfile(null, metadata({ name: "A" }))).toEqual({
      lnAddress: "",
      name: "",
    });
    expect(getContactPublicProfile(NPUB, undefined)).toEqual({
      lnAddress: "",
      name: "",
    });
  });

  it("reads name and lightning address from metadata", () => {
    expect(
      getContactPublicProfile(
        NPUB,
        metadata({ lud16: "vitor@vitorpamplona.com", name: "Vitor" }),
      ),
    ).toEqual({ lnAddress: "vitor@vitorpamplona.com", name: "Vitor" });
  });

  it("keeps the synthetic linky.fit lightning address", () => {
    expect(
      getContactPublicProfile(NPUB, metadata({ lud16: `${NPUB}@linky.fit` })),
    ).toEqual({ lnAddress: `${NPUB}@linky.fit`, name: "" });
  });
});

describe("resolveContactProfile", () => {
  it("treats non-overridden row values as the public side", () => {
    const resolved = resolveContactProfile(
      { lnAddress: "vitor@vitorpamplona.com", name: "Vitor", npub: NPUB },
      undefined,
    );
    expect(resolved.localName).toBe("");
    expect(resolved.localLnAddress).toBe("");
    expect(resolved.name).toBe("Vitor");
    expect(resolved.lnAddress).toBe("vitor@vitorpamplona.com");
  });

  it("prefers fresher metadata over the row for non-overridden fields", () => {
    const resolved = resolveContactProfile(
      { lnAddress: "old@ln.example", name: "Old", npub: NPUB },
      metadata({ lud16: "new@ln.example", name: "New" }),
    );
    expect(resolved.name).toBe("New");
    expect(resolved.lnAddress).toBe("new@ln.example");
  });

  it("keeps the row value when metadata lacks the field", () => {
    const resolved = resolveContactProfile(
      { lnAddress: "manual@ln.example", name: "Kept", npub: NPUB },
      metadata({}),
    );
    expect(resolved.name).toBe("Kept");
    expect(resolved.lnAddress).toBe("manual@ln.example");
  });

  it("splits overridden fields into local and metadata-backed public", () => {
    const resolved = resolveContactProfile(
      {
        lnAddress: "custom@ln.example",
        lnAddressSetByUser: sqliteTrue,
        name: "Moje jméno",
        nameSetByUser: sqliteTrue,
        npub: NPUB,
      },
      metadata({ lud16: "vitor@vitorpamplona.com", name: "Vitor" }),
    );
    expect(resolved.hasLocalName).toBe(true);
    expect(resolved.hasLocalLnAddress).toBe(true);
    expect(resolved.localName).toBe("Moje jméno");
    expect(resolved.localLnAddress).toBe("custom@ln.example");
    expect(resolved.name).toBe("Vitor");
    expect(resolved.lnAddress).toBe("vitor@vitorpamplona.com");
  });

  it("returns row values as local for contacts without npub", () => {
    const resolved = resolveContactProfile(
      { lnAddress: "a@b.c", name: "Local" },
      undefined,
    );
    expect(resolved.localName).toBe("Local");
    expect(resolved.localLnAddress).toBe("a@b.c");
    expect(resolved.name).toBe("");
    expect(resolved.lnAddress).toBe("");
  });
});
