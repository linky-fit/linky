import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderIntoDocument } from "../testUtils/renderIntoDocument";
import { useImageZoom } from "./useImageZoom";

const Harness = ({ onOutsideClick }: { onOutsideClick: () => void }) => {
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const zoom = useImageZoom(stageRef, true);
  return (
    <div onClick={onOutsideClick}>
      <div className="stage" ref={stageRef} {...zoom.handlers}>
        <img alt="" style={zoom.imageStyle} />
      </div>
    </div>
  );
};

const stageRect: DOMRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 400,
  bottom: 400,
  width: 400,
  height: 400,
  toJSON: () => ({}),
};

const setup = async () => {
  const onOutsideClick = vi.fn();
  const rendered = await renderIntoDocument(
    <Harness onOutsideClick={onOutsideClick} />,
  );
  const stage = rendered.container.querySelector<HTMLDivElement>(".stage");
  const image = rendered.container.querySelector("img");
  if (!stage || !image) throw new Error("Missing stage");
  stage.getBoundingClientRect = () => stageRect;
  const pointer = async (
    type: "pointerdown" | "pointermove" | "pointerup",
    pointerId: number,
    x: number,
    y: number,
  ) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId, clientX: x, clientY: y });
    await act(async () => {
      stage.dispatchEvent(event);
    });
  };
  const click = async () => {
    await act(async () => {
      stage.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };
  return { click, image, onOutsideClick, pointer, rendered };
};

describe("useImageZoom", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("scales around the pinch center and swallows the trailing click", async () => {
    const { click, image, onOutsideClick, pointer, rendered } = await setup();

    await pointer("pointerdown", 1, 150, 200);
    await pointer("pointerdown", 2, 250, 200);
    await pointer("pointermove", 2, 350, 200);
    expect(image.style.transform).toBe("translate(50px, 0px) scale(2)");
    expect(image.style.transition).toBe("none");

    await pointer("pointerup", 1, 150, 200);
    await pointer("pointerup", 2, 350, 200);
    expect(image.style.transition).not.toBe("none");
    await click();
    expect(onOutsideClick).not.toHaveBeenCalled();

    await click();
    expect(onOutsideClick).toHaveBeenCalledOnce();

    await rendered.unmount();
  });

  it("pans only while zoomed and never before the pointer really moved", async () => {
    const { image, pointer, rendered } = await setup();

    await pointer("pointerdown", 1, 200, 200);
    await pointer("pointermove", 1, 260, 200);
    await pointer("pointerup", 1, 260, 200);
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");

    await pointer("pointerdown", 1, 200, 200);
    await pointer("pointerup", 1, 200, 200);
    await pointer("pointerdown", 1, 200, 200);
    await pointer("pointerup", 1, 200, 200);
    expect(image.style.transform).toBe("translate(0px, 0px) scale(2.5)");

    await pointer("pointerdown", 1, 200, 200);
    await pointer("pointermove", 1, 202, 200);
    expect(image.style.transform).toBe("translate(0px, 0px) scale(2.5)");
    await pointer("pointermove", 1, 260, 220);
    expect(image.style.transform).toBe("translate(60px, 20px) scale(2.5)");
    await pointer("pointerup", 1, 260, 220);

    await rendered.unmount();
  });

  it("zooms in around a double tap and back out on the next one", async () => {
    const { image, pointer, rendered } = await setup();

    await pointer("pointerdown", 1, 100, 100);
    await pointer("pointerup", 1, 100, 100);
    await pointer("pointerdown", 1, 100, 100);
    await pointer("pointerup", 1, 100, 100);
    expect(image.style.transform).toBe("translate(150px, 150px) scale(2.5)");

    await pointer("pointerdown", 1, 300, 300);
    await pointer("pointerup", 1, 300, 300);
    await pointer("pointerdown", 1, 300, 300);
    await pointer("pointerup", 1, 300, 300);
    expect(image.style.transform).toBe("translate(0px, 0px) scale(1)");

    await rendered.unmount();
  });
});
