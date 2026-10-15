import { createIdFromString } from "@linky-fit/linksync";
import { describe, expect, it } from "vitest";
import {
  getDesktopActiveContactId,
  getDesktopRouteSection,
  isDesktopSectionEntryRoute,
  isDesktopSectionRoot,
} from "./desktopRouteSection";

describe("desktopRouteSection", () => {
  it("keeps token management in settings", () => {
    expect(getDesktopRouteSection({ kind: "cashuTokens" })).toBe("settings");
    expect(getDesktopRouteSection({ kind: "cashuTokenNew" })).toBe("settings");
    expect(getDesktopRouteSection({ kind: "cashuTokenEmit" })).toBe("settings");
  });

  it("keeps Keryx companies in settings", () => {
    const id = createIdFromString<"KeryxSubscription">("company-1");
    expect(getDesktopRouteSection({ kind: "keryxCompanyNew" })).toBe(
      "settings",
    );
    expect(isDesktopSectionEntryRoute({ kind: "keryxCompanies" })).toBe(true);
    expect(isDesktopSectionEntryRoute({ kind: "keryxCompany", id })).toBe(
      false,
    );
    expect(
      isDesktopSectionEntryRoute({ kind: "keryxAnnouncement", id, key: "a" }),
    ).toBe(false);
  });

  it("only expands the section roots across the detail area", () => {
    expect(isDesktopSectionRoot({ kind: "contacts" })).toBe(true);
    expect(isDesktopSectionRoot({ kind: "wallet" })).toBe(true);
    expect(isDesktopSectionRoot({ kind: "settings" })).toBe(true);
    expect(isDesktopSectionRoot({ kind: "topup" })).toBe(false);
  });

  it("marks direct section children as closeable entries", () => {
    expect(isDesktopSectionEntryRoute({ kind: "chat", id: "chat-1" })).toBe(
      true,
    );
    expect(isDesktopSectionEntryRoute({ kind: "topup" })).toBe(true);
    expect(isDesktopSectionEntryRoute({ kind: "cashuTokens" })).toBe(true);
    expect(isDesktopSectionEntryRoute({ kind: "cashuTokenNew" })).toBe(false);
  });

  it("identifies the active contact for chat-derived detail routes", () => {
    expect(getDesktopActiveContactId({ kind: "chat", id: "chat-1" })).toBe(
      "chat-1",
    );
    expect(
      getDesktopActiveContactId({
        kind: "bankPaymentOffer",
        chatId: "chat-2",
        offerId: "offer-1",
      }),
    ).toBe("chat-2");
    expect(getDesktopActiveContactId({ kind: "contacts" })).toBeNull();
  });
});
