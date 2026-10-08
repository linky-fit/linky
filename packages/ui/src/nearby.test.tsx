import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/render";
import { NearbyAvatar, NearbyBanner, NearbyRow } from "./nearby";

describe("NearbyAvatar", () => {
  it("shows the trade badge and names it for assistive technology", async () => {
    const button = (
      await render(
        <NearbyAvatar
          name="Alex Rivers"
          label="Alex"
          trade="buy"
          badgeLabel="Buys BTC"
          onPress={() => {}}
        />,
      )
    ).querySelector("button");
    expect(button?.textContent).toContain("Buys BTC");
    expect(button?.textContent).toContain("Alex");
    expect(button?.getAttribute("aria-label")).toBe("Alex Rivers, Buys BTC");
  });

  it("shows no badge without a trade", async () => {
    const button = (
      await render(<NearbyAvatar name="Alex Rivers" onPress={() => {}} />)
    ).querySelector("button");
    expect(button?.textContent).toBe("AR");
    expect(button?.getAttribute("aria-label")).toBe("Alex Rivers");
  });

  it("calls onPress", async () => {
    const onPress = vi.fn();
    const button = (
      await render(<NearbyAvatar name="Alex" isSelf onPress={onPress} />)
    ).querySelector("button");
    await act(async () => button?.click());
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe("NearbyRow", () => {
  it("renders its avatars in a labelled group", async () => {
    const group = (
      await render(
        <NearbyRow accessibilityLabel="Nearby">
          <NearbyAvatar name="Alex" onPress={() => {}} />
          <NearbyAvatar name="Bea" onPress={() => {}} />
        </NearbyRow>,
      )
    ).querySelector("[role=group]");
    expect(group?.getAttribute("aria-label")).toBe("Nearby");
    expect(group?.querySelectorAll("button")).toHaveLength(2);
  });
});

describe("NearbyBanner", () => {
  it("is a status line without onPress", async () => {
    const container = await render(<NearbyBanner label="Nearby" />);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[role=status]")?.textContent).toBe(
      "Nearby",
    );
  });

  it("calls onPress", async () => {
    const onPress = vi.fn();
    const button = (
      await render(<NearbyBanner label="Nearby, buys BTC" onPress={onPress} />)
    ).querySelector("button");
    expect(button?.textContent).toBe("Nearby, buys BTC");
    await act(async () => button?.click());
    expect(onPress).toHaveBeenCalledOnce();
  });
});
