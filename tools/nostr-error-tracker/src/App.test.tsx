// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import App from "./App";
import {
  loginWithSecret,
  restoreSavedSession,
  rememberSessionSeed,
  clearSavedSession,
} from "./auth";
import { createSlip39Share } from "@linky/identity";
import { Effect } from "effect";
import { createTrackerStore } from "./issueStore";
import type { IssueResolution } from "./issueState";
import { reloadPage } from "./navigation";
import type { TrackerSession } from "./auth";
import { fetchReports } from "./inbox";
import { parseReport } from "./reports";

vi.mock("./auth", () => ({
  loginWithSecret: vi.fn(),
  restoreSavedSession: vi.fn(),
  rememberSessionSeed: vi.fn(),
  clearSavedSession: vi.fn(),
}));
vi.mock("./inbox", () => ({
  DEFAULT_RELAYS: ["ws://localhost:7777"],
  fetchReports: vi.fn(),
}));

const resolutionStore = vi.hoisted(() => {
  let rows: readonly IssueResolution[] = [];
  const listeners = new Set<() => void>();
  const solve = vi.fn<(resolution: IssueResolution) => Promise<void>>();
  return {
    solve,
    reset: () => {
      rows = [];
      listeners.clear();
    },
    add: (resolution: IssueResolution) => {
      rows = [...rows, resolution];
      listeners.forEach((notify) => notify());
    },
    snapshot: () => rows,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
});
vi.mock("./issueStore", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    EVOLU_SERVERS: ["ws://localhost:4001"],
    createTrackerStore: vi.fn(() => ({})),
    useIssueResolutions: function useMockIssueResolutions() {
      const resolutions = useSyncExternalStore(
        resolutionStore.subscribe,
        resolutionStore.snapshot,
      );
      return {
        resolutions,
        ready: true,
        error: null,
        solve: resolutionStore.solve,
      };
    },
  };
});
vi.mock("./navigation", () => ({ reloadPage: vi.fn() }));

let recoverySeed: string;
let ownerMnemonic: TrackerSession["ownerMnemonic"];
beforeAll(async () => {
  recoverySeed = await Effect.runPromise(createSlip39Share());
  const actualAuth = await vi.importActual<typeof import("./auth")>("./auth");
  const derived = await actualAuth.loginWithSecret(recoverySeed);
  ownerMnemonic = derived.ownerMnemonic;
  derived.dispose();
});

const markup = '<img src="invalid" onerror="alert(1)"> mint rejected swap';
const fixture = (overrides: Record<string, string | number | null>) => {
  const value = {
    v: 1,
    id: "new-report",
    createdAtSec: 1_770_000_200,
    direction: "out",
    status: "error",
    method: "cashu_chat",
    phase: "swap",
    errorCode: "mint_failed",
    errorDetail: markup,
    appVersion: "26.9.7",
    devicePlatform: "android",
    appRuntime: "native",
    appHost: "app.linky.fit",
    mint: "https://mint.example",
    ...overrides,
  };
  return parseReport(JSON.stringify(value), {
    wrapId: `wrap-${value.id}`,
    rumorId: `rumor-${value.id}`,
    senderPubkey: "ephemeral-sender",
    relay: "ws://localhost:7777",
  });
};

let container: HTMLDivElement;
let root: Root;
let session: TrackerSession;

const button = (text: string) => {
  const found = [...container.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
};
const select = (name: string) => {
  const found = container.querySelector(`select[aria-label="${name}"]`);
  if (!(found instanceof HTMLSelectElement)) {
    throw new Error(`Select not found: ${name}`);
  }
  return found;
};
const choose = async (name: string, value: string) => {
  await act(async () => {
    const element = select(name);
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
};
const toggleVersion = async (version: string) => {
  const checkbox = container.querySelector(
    `input[aria-label="Version ${version}"]`,
  );
  if (!(checkbox instanceof HTMLInputElement))
    throw new Error("Version not found");
  await act(async () => checkbox.click());
};
const enterDate = async (name: string, value: string) => {
  const input = container.querySelector(`input[aria-label="${name}"]`);
  if (!(input instanceof HTMLInputElement))
    throw new Error("Date input not found");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Input setter not found");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const localDate = (seconds: number) => {
  const date = new Date(seconds * 1000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const detail = (name: string) => {
  const term = [...container.querySelectorAll(".event-fields dt")].find(
    (element) => element.textContent === name,
  );
  if (!term) throw new Error(`Detail not found: ${name}`);
  return term.nextElementSibling?.textContent;
};
const signIn = async () => {
  const input = container.querySelector("#secret");
  if (!(input instanceof HTMLInputElement)) throw new Error("No secret input");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("No input value setter");
    setter.call(input, recoverySeed);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Open error inbox").click());
};

const remount = async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App />));
};
const showSolved = async () => {
  const label = [...container.querySelectorAll("label")].find((element) =>
    element.textContent?.includes("Show solved issues"),
  );
  const checkbox = label?.querySelector("input");
  if (!(checkbox instanceof HTMLInputElement))
    throw new Error("Show solved control not found");
  await act(async () => checkbox.click());
};

beforeEach(async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.mocked(rememberSessionSeed).mockReset();
  vi.mocked(clearSavedSession).mockReset();
  resolutionStore.reset();
  resolutionStore.solve.mockImplementation(async (resolution) => {
    resolutionStore.add(resolution);
  });
  vi.mocked(restoreSavedSession).mockResolvedValue(null);
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  window.sessionStorage.clear();
  session = {
    pubkey: "collector-pubkey",
    npub: "npub1-local-collector",
    ownerMnemonic,
    decrypt: vi.fn<TrackerSession["decrypt"]>().mockResolvedValue(""),
    dispose: vi.fn(),
  };
  vi.mocked(loginWithSecret).mockResolvedValue(session);
  const parsed = [
    fixture({}),
    fixture({
      id: "old-report",
      createdAtSec: 1_770_000_100 - 86400,
      appVersion: "26.9.6",
      devicePlatform: "iphone",
      appRuntime: "pwa",
      appHost: "preview.example",
    }),
    fixture({
      id: "legacy-report",
      createdAtSec: 1_770_000_000,
      errorCode: "timeout",
      errorDetail: "Legacy timeout",
      appVersion: null,
      devicePlatform: null,
      appRuntime: null,
      appHost: null,
      mint: null,
    }),
    fixture({ id: "successful-report", status: "ok" }),
  ];
  vi.mocked(fetchReports).mockResolvedValue({
    reports: parsed.filter((report) => report !== null),
    scanned: 4,
    ignored: 1,
    relays: [
      { url: "ws://localhost:7777", scanned: 4, complete: true, error: null },
    ],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<App />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("error inbox workflow", () => {
  it("loads presets after login, writes selections, and responds to history navigation", async () => {
    window.history.replaceState(
      null,
      "",
      "/?version=26.9.6&period=7&platform=iphone&sort=frequent&solved=1#inbox",
    );
    vi.spyOn(Date, "now").mockReturnValue((1_770_000_200 + 3600) * 1000);
    await signIn();
    expect(select("Time period").value).toBe("7");
    expect(select("Platform").value).toBe("iphone");
    expect(select("Sort issues").value).toBe("frequent");
    expect(detail("Version")).toBe("26.9.6");
    expect(
      container.querySelector<HTMLInputElement>(".issue-visibility input")
        ?.checked,
    ).toBe(true);
    await toggleVersion("26.9.7");
    expect(
      new URLSearchParams(window.location.search).getAll("version"),
    ).toEqual(["26.9.6", "26.9.7"]);
    expect(window.location.hash).toBe("#inbox");
    await choose("Time period", "custom");
    await enterDate("From date", localDate(1_770_000_200));
    expect(new URLSearchParams(window.location.search).get("from")).toBe(
      localDate(1_770_000_200),
    );
    await act(async () => {
      window.history.replaceState(null, "", "/?version=unknown&period=all");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(select("Time period").value).toBe("all");
    expect(select("Platform").value).toBe("");
    expect(detail("Version")).toBe("Not reported");
    await act(async () => button("Clear filters").click());
    expect(window.location.search).toBe("");
  });

  it("shows preset filter values even when no received report contains them", async () => {
    window.history.replaceState(null, "", "/?version=99.1.1&platform=missing");
    await signIn();
    expect(select("Platform").value).toBe("missing");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Version 99.1.1"]',
      )?.checked,
    ).toBe(true);
    expect(container.querySelectorAll(".issue-row")).toHaveLength(0);
  });
  it("cancels saved-session restoration when navigating away", async () => {
    await act(async () => root.unmount());
    let finish: ((value: TrackerSession) => void) | undefined;
    vi.mocked(restoreSavedSession).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    root = createRoot(container);
    await act(async () => root.render(<App />));
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    await act(async () => finish?.(session));
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(container.querySelector(".issue-row")).toBeNull();
    expect(createTrackerStore).not.toHaveBeenCalled();
  });
  it("does not restore a pending sign-in after navigating away", async () => {
    let finish: ((value: TrackerSession) => void) | undefined;
    vi.mocked(loginWithSecret).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await signIn();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await act(async () => {
      finish?.(session);
    });
    expect(container.querySelector(".issue-row")).toBeNull();
    expect(session.dispose).toHaveBeenCalled();
    expect(rememberSessionSeed).not.toHaveBeenCalled();
    const input = container.querySelector("#secret");
    if (!(input instanceof HTMLInputElement))
      throw new Error("No secret input");
    expect(input.value).toBe("");
  });
  it("groups existing errors and preserves each occurrence's environment and literal message", async () => {
    await signIn();

    expect(loginWithSecret).toHaveBeenCalledWith(recoverySeed);
    expect(rememberSessionSeed).toHaveBeenCalledWith(recoverySeed);
    expect(createTrackerStore).toHaveBeenCalledWith(ownerMnemonic);
    expect(container.querySelector("#secret")).toBeNull();
    expect(container.querySelectorAll(".issue-row")).toHaveLength(2);
    expect(select("Occurrence").options).toHaveLength(2);
    expect(detail("Version")).toBe("26.9.7");
    expect(detail("Platform")).toBe("android");
    expect(detail("App host")).toBe("app.linky.fit");
    expect(container.querySelector(".error-message pre")?.textContent).toBe(
      markup,
    );
    expect(container.querySelector("img")).toBeNull();

    await choose("Occurrence", "old-report");
    expect(detail("Version")).toBe("26.9.6");
    expect(detail("Platform")).toBe("iphone");
    expect(detail("Runtime")).toBe("pwa");
    expect(detail("App host")).toBe("preview.example");
    expect(container.textContent).not.toContain("successful-report");
  });

  it("filters occurrences by release and includes reports with missing metadata under Unknown", async () => {
    await signIn();
    await toggleVersion("26.9.6");
    expect(container.querySelectorAll(".issue-row")).toHaveLength(1);
    expect(select("Occurrence").options).toHaveLength(1);
    expect(detail("Version")).toBe("26.9.6");

    await act(async () => button("Clear filters").click());
    await toggleVersion("unknown");
    for (const name of ["Platform", "Runtime", "Host", "Mint"]) {
      expect(
        [...select(name).options].some((option) => option.text === "Unknown"),
      ).toBe(true);
      await choose(name, "unknown");
    }
    expect(container.querySelectorAll(".issue-row")).toHaveLength(1);
    expect(select("Occurrence").value).toBe("legacy-report");
    expect(detail("Version")).toBe("Not reported");
    expect(detail("Platform")).toBe("Not reported");
  });

  it("selects multiple versions in descending order and combines dates with them", async () => {
    vi.spyOn(Date, "now").mockReturnValue((1_770_000_200 + 3600) * 1000);
    await signIn();
    expect(
      [...container.querySelectorAll(".version-checkboxes input")].map(
        (input) => input.getAttribute("aria-label"),
      ),
    ).toEqual(["Version 26.9.7", "Version 26.9.6", "Version unknown"]);
    await toggleVersion("26.9.7");
    await toggleVersion("26.9.6");
    expect(select("Occurrence").options).toHaveLength(2);
    await choose("Time period", "1");
    expect(select("Occurrence").options).toHaveLength(1);
    expect(detail("Version")).toBe("26.9.7");
    await choose("Time period", "7");
    expect(select("Occurrence").options).toHaveLength(2);
    await choose("Time period", "custom");
    const oldDay = localDate(1_770_000_100 - 86400);
    await enterDate("From date", oldDay);
    await enterDate("To date", oldDay);
    expect(select("Occurrence").options).toHaveLength(1);
    expect(detail("Version")).toBe("26.9.6");
    await enterDate("From date", localDate(1_770_000_200));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelectorAll(".issue-row")).toHaveLength(0);
    await act(async () => button("Clear filters").click());
    expect(select("Time period").value).toBe("all");
    expect(
      container.querySelectorAll(".version-checkboxes input:checked"),
    ).toHaveLength(0);
    expect(container.querySelectorAll(".issue-row")).toHaveLength(2);
  });

  it("removes the saved seed, disposes the session and clears the view on sign out", async () => {
    await signIn();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    await act(async () => button("Sign out").click());

    expect(clearSavedSession).toHaveBeenCalledOnce();
    expect(reloadPage).toHaveBeenCalledOnce();
    expect(session.dispose).toHaveBeenCalledOnce();
    const input = container.querySelector("#secret");
    if (!(input instanceof HTMLInputElement))
      throw new Error("No secret input");
    expect(input.value).toBe("");
    expect(container.querySelector(".issue-row")).toBeNull();
    expect(container.textContent).not.toContain(markup);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("restores a saved seed session and its solved issue state on reload", async () => {
    await signIn();
    await act(async () => button("Mark as solved").click());
    expect(container.querySelectorAll(".issue-row")).toHaveLength(1);
    const restored = { ...session, dispose: vi.fn() };
    vi.mocked(restoreSavedSession).mockResolvedValueOnce(restored);
    await remount();
    expect(container.querySelector("#secret")).toBeNull();
    expect(container.querySelectorAll(".issue-row")).toHaveLength(1);
    expect(container.querySelector(".issue-row")?.textContent).toContain(
      "timeout",
    );
    expect(createTrackerStore).toHaveBeenLastCalledWith(ownerMnemonic);
    expect(loginWithSecret).toHaveBeenCalledOnce();
    await showSolved();
    expect(container.querySelectorAll(".issue-row")).toHaveLength(2);
    expect(container.querySelector(".issue-row .solved")).not.toBeNull();
  });

  it("hides a solved issue by default and shows all issues with Show solved", async () => {
    await signIn();
    await act(async () => button("Mark as solved").click());
    expect(resolutionStore.solve).toHaveBeenCalledOnce();
    expect(container.querySelectorAll(".issue-row")).toHaveLength(1);
    expect(container.querySelector(".issue-row")?.textContent).toContain(
      "timeout",
    );
    await showSolved();
    expect(container.querySelectorAll(".issue-row")).toHaveLength(2);
    expect(container.querySelector(".issue-row .solved")).not.toBeNull();
    expect(button("Solved").disabled).toBe(true);
  });

  it("shows a newer occurrence as reoccurred after refresh", async () => {
    const solvedAtSec = 1_770_000_300;
    vi.spyOn(Date, "now").mockReturnValue(solvedAtSec * 1000);
    await signIn();
    await act(async () => button("Mark as solved").click());
    expect(container.querySelectorAll(".issue-row")).toHaveLength(1);
    const original = await vi.mocked(fetchReports).mock.results[0]?.value;
    if (!original) throw new Error("Inbox fixture missing");
    const recurrence = fixture({
      id: "recurring-report",
      createdAtSec: solvedAtSec + 1,
    });
    if (!recurrence) throw new Error("Recurring fixture missing");
    vi.mocked(fetchReports).mockResolvedValueOnce({
      ...original,
      reports: [...original.reports, recurrence],
    });
    await act(async () => button("Refresh inbox").click());
    expect(container.querySelectorAll(".issue-row")).toHaveLength(2);
    expect(container.querySelector(".issue-row .reoccurred")?.textContent).toBe(
      "reoccurred",
    );
    expect(select("Occurrence").value).toBe("recurring-report");
    expect(resolutionStore.solve).toHaveBeenCalledOnce();
  });

  it("solves the whole issue when an older version is selected", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_770_000_150 * 1000);
    await signIn();
    await toggleVersion("26.9.6");
    expect(detail("Version")).toBe("26.9.6");
    await act(async () => button("Mark as solved").click());
    expect(resolutionStore.solve).toHaveBeenCalledWith(
      expect.objectContaining({ cutoffSec: 1_770_000_200 }),
    );
    expect(container.querySelectorAll(".issue-row")).toHaveLength(0);
    await act(async () => button("Clear filters").click());
    expect(container.querySelectorAll(".issue-row")).toHaveLength(1);
    expect(container.querySelector(".issue-row")?.textContent).toContain(
      "timeout",
    );
  });

  it("keeps an issue open and displays a failed resolution save", async () => {
    resolutionStore.solve.mockRejectedValueOnce(
      new Error("synthetic storage failure"),
    );
    await signIn();
    await act(async () => button("Mark as solved").click());
    expect(container.querySelectorAll(".issue-row")).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save the solved issue",
    );
    expect(button("Mark as solved").disabled).toBe(false);
    expect(resolutionStore.snapshot()).toHaveLength(0);
  });

  it("keeps the login form visible if the seed cannot be saved", async () => {
    vi.mocked(rememberSessionSeed).mockImplementationOnce(() => {
      throw new Error("Could not save your login.");
    });
    await signIn();
    expect(container.querySelector("#secret")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not save your login",
    );
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(createTrackerStore).not.toHaveBeenCalled();
  });

  it("retains the workspace if removing the saved seed fails", async () => {
    vi.mocked(clearSavedSession).mockImplementationOnce(() => {
      throw new Error("Storage blocked.");
    });
    await signIn();
    await act(async () => button("Sign out").click());
    expect(container.querySelectorAll(".issue-row")).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not remove the saved seed",
    );
    expect(reloadPage).not.toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();
  });
});
