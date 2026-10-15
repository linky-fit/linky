import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { ChatAttachmentPreview } from "./ChatAttachmentPreview";

const image = new File(["image"], "photo.png", { type: "image/png" });
const pdf = new File(["%PDF"], "invoice.pdf", { type: "application/pdf" });

const render = (files: File[], onRemove = vi.fn(), onAdd = vi.fn()) =>
  renderIntoDocument(
    <ChatAttachmentPreview
      accessibilityLabel="Attachments"
      addLabel="Add image or PDF"
      disabled={false}
      files={files}
      onAdd={onAdd}
      onRemove={onRemove}
      removeLabel="Remove attachment"
    />,
  );

describe("ChatAttachmentPreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders one tile per file and reports which one to remove", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:preview");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const onRemove = vi.fn();
    const onAdd = vi.fn();

    const rendered = await render([image, pdf], onRemove, onAdd);

    expect(createObjectUrl).toHaveBeenCalledExactlyOnceWith(image);
    const images = rendered.container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]?.src).toBe("blob:preview");
    expect(rendered.container.textContent).toContain("invoice.pdf");

    await act(async () => {
      rendered.container
        .querySelector<HTMLButtonElement>(
          "[aria-label='Remove attachment: invoice.pdf']",
        )
        ?.click();
      rendered.container
        .querySelector<HTMLButtonElement>("[aria-label='Add image or PDF']")
        ?.click();
    });
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(pdf);
    expect(onAdd).toHaveBeenCalledOnce();

    await rendered.rerender(
      <ChatAttachmentPreview
        accessibilityLabel="Attachments"
        addLabel="Add image or PDF"
        disabled={false}
        files={[pdf]}
        onAdd={() => undefined}
        onRemove={() => undefined}
        removeLabel="Remove attachment"
      />,
    );
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:preview");
    await rendered.unmount();
  });

  it("keeps the image thumbnail when another file is removed", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:preview");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    const rendered = await render([image, pdf]);
    await rendered.rerender(
      <ChatAttachmentPreview
        accessibilityLabel="Attachments"
        addLabel="Add image or PDF"
        disabled={false}
        files={[image]}
        onAdd={() => undefined}
        onRemove={() => undefined}
        removeLabel="Remove attachment"
      />,
    );

    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(
      rendered.container.querySelectorAll("[aria-label^='Remove attachment:']"),
    ).toHaveLength(1);

    await rendered.unmount();
  });
});
