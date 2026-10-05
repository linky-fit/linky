import { act } from "react";
import { describe, expect, it } from "vitest";
import { render } from "../test/render";
import { EdgeStatus, Progress, StatusLine } from "./feedback";

const progressbar = async (element: React.ReactElement) => {
  const bar = (await render(element)).querySelector("[role=progressbar]");
  return [
    bar?.getAttribute("aria-valuenow"),
    bar?.getAttribute("aria-valuemax"),
  ];
};

describe("Progress", () => {
  it("reports its value and max", async () => {
    expect(
      await progressbar(
        <Progress value={3} max={6} segments={6} accessibilityLabel="Steps" />,
      ),
    ).toEqual(["3", "6"]);
  });

  it("clamps the value to the range", async () => {
    expect(
      await progressbar(<Progress value={1.4} accessibilityLabel="Done" />),
    ).toEqual(["1", "1"]);
  });
});

describe("StatusLine", () => {
  it("announces its label and shows a spinner only while busy", async () => {
    const idle = await render(<StatusLine label="Waiting" />);
    expect(idle.querySelector("[role=status]")?.textContent).toBe("Waiting");
    expect(idle.querySelector("[role=progressbar]")).toBeNull();
    const busy = await render(<StatusLine label="Waiting" busy />);
    expect(busy.querySelector("[role=progressbar]")).not.toBeNull();
  });
});

describe("EdgeStatus", () => {
  it("opens its details on press and closes on the next press", async () => {
    const view = await render(
      <EdgeStatus
        tone="warning"
        label="Syncing"
        items={[
          { label: "Scanning Nostr", tone: "warning", busy: true },
          { label: "Evolu synced", tone: "accent" },
        ]}
      />,
    );
    const tab = view.querySelector<HTMLElement>("[aria-label=Syncing]");
    expect(view.querySelector("[role=status]")).toBeNull();
    await act(async () => tab?.click());
    expect(tab?.getAttribute("aria-expanded")).toBe("true");
    expect(view.querySelector("[role=status]")?.textContent).toBe(
      "Scanning NostrEvolu synced",
    );
    await act(async () => tab?.click());
    expect(view.querySelector("[role=status]")).toBeNull();
  });
});
