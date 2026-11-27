import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ListingImage } from "./ListingImage";

describe("ListingImage", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:photo"),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the load failure instead of an empty frame for a photo that does not decode", async () => {
    const photo = new File(["jpeg"], "photo.jpg", { type: "image/jpeg" });
    const { container } = await renderIntoDocument(
      <ListingImage source={photo} label="Photo" t={(key) => key} />,
    );
    const image = container.querySelector("img");
    if (!image) throw new Error("no image");

    await act(async () => {
      image.dispatchEvent(new Event("error"));
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("chatImageLoadFailed");
  });
});
