import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ChatAttachmentPreview } from "./ChatAttachmentPreview";

describe("ChatAttachmentPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows an image thumbnail and revokes its object url on unmount", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:preview");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const file = new File(["image"], "photo.png", { type: "image/png" });
    const onRemove = vi.fn();

    const rendered = await renderIntoDocument(
      <ChatAttachmentPreview
        file={file}
        onRemove={onRemove}
        removeLabel="Remove attachment"
      />,
    );

    expect(createObjectUrl).toHaveBeenCalledWith(file);
    expect(rendered.container.querySelector("img")?.src).toBe("blob:preview");
    expect(rendered.container.textContent).toContain("photo.png");
    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>("[aria-label='Remove attachment']")
        ?.click();
    });
    expect(onRemove).toHaveBeenCalledOnce();

    await rendered.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:preview");
  });

  it("shows a file placeholder for a pdf without creating an object url", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL");
    const file = new File(["%PDF"], "invoice.pdf", {
      type: "application/pdf",
    });

    const rendered = await renderIntoDocument(
      <ChatAttachmentPreview
        file={file}
        onRemove={() => undefined}
        removeLabel="Remove attachment"
      />,
    );

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(rendered.container.querySelector("img")).toBeNull();
    expect(rendered.container.querySelector("svg")).not.toBeNull();
    expect(rendered.container.textContent).toContain("invoice.pdf");

    await rendered.unmount();
  });
});
