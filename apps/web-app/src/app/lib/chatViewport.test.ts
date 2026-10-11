// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  captureChatViewportAnchor,
  restoreChatViewportAnchor,
} from "./chatViewport";

const setClientHeight = (element: HTMLElement, height: number): void => {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: height,
  });
};

const setScrollHeight = (element: HTMLElement, height: number): void => {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: height,
  });
};

describe("chat viewport anchor", () => {
  it("keeps the same content at the bottom when the viewport shrinks", () => {
    const messages = document.createElement("div");
    messages.scrollTop = 640;
    setClientHeight(messages, 400);
    setScrollHeight(messages, 1_600);

    const anchor = captureChatViewportAnchor(messages);

    setClientHeight(messages, 160);
    restoreChatViewportAnchor(messages, anchor);

    expect(messages.scrollTop).toBe(880);
    expect(messages.scrollTop + messages.clientHeight).toBe(1_040);
  });

  it("keeps a chat at the end when the viewport shrinks", () => {
    const messages = document.createElement("div");
    messages.scrollTop = 1_200;
    setClientHeight(messages, 400);
    setScrollHeight(messages, 1_600);

    const anchor = captureChatViewportAnchor(messages);

    setClientHeight(messages, 160);
    restoreChatViewportAnchor(messages, anchor);

    expect(messages.scrollTop).toBe(1_440);
  });

  it("clamps a short chat to its reachable end", () => {
    const messages = document.createElement("div");
    setClientHeight(messages, 600);
    setScrollHeight(messages, 600);

    const anchor = captureChatViewportAnchor(messages);

    setClientHeight(messages, 260);
    setScrollHeight(messages, 360);
    restoreChatViewportAnchor(messages, anchor);

    expect(messages.scrollTop).toBe(100);
    expect(messages.scrollTop + messages.clientHeight).toBe(
      messages.scrollHeight,
    );
  });
});
