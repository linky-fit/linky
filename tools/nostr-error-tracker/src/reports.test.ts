import { describe, expect, it } from "vitest";
import {
  deduplicateReports,
  filterReports,
  groupReports,
  parseReport,
  sortVersions,
  type ErrorReport,
  type ReportFilters,
} from "./reports";

const metadata = {
  wrapId: "wrap-1",
  rumorId: "rumor-1",
  senderPubkey: "ephemeral-sender",
  relay: "wss://relay.example",
};
const payload = {
  v: 1,
  id: "report-1",
  createdAtSec: 1_780_000_000,
  direction: "out",
  status: "error",
  method: "lightning_invoice",
  phase: "melt",
  mint: "https://mint.example",
  amountBucket: "lte_1000",
  feeBucket: null,
  errorCode: "mint_failed",
  errorDetail: "Mint rejected the request",
  appVersion: "26.9.5",
  appHost: "linky.fit",
  devicePlatform: "android",
  appRuntime: "native",
};
function report(overrides: Partial<ErrorReport> = {}): ErrorReport {
  const parsed = parseReport(JSON.stringify(payload), metadata);
  if (!parsed) throw new Error("Invalid test fixture");
  return { ...parsed, ...overrides };
}
const filters: ReportFilters = {
  search: "",
  versions: [],
  platform: "",
  runtime: "",
  host: "",
  mint: "",
  since: null,
  until: null,
};

describe("parseReport", () => {
  it("retains the complete report, Nostr metadata and unmodified raw payload", () => {
    const content = JSON.stringify({
      ...payload,
      futureContext: { attempts: 3 },
    });
    expect(parseReport(content, metadata)).toEqual({
      ...metadata,
      id: payload.id,
      createdAtSec: payload.createdAtSec,
      direction: "out",
      status: "error",
      method: payload.method,
      phase: payload.phase,
      mint: payload.mint,
      amountBucket: payload.amountBucket,
      feeBucket: null,
      errorCode: payload.errorCode,
      errorDetail: payload.errorDetail,
      appVersion: payload.appVersion,
      appHost: payload.appHost,
      devicePlatform: payload.devicePlatform,
      appRuntime: payload.appRuntime,
      rawContent: content,
    });
  });

  it.each(["ok", "declined"])("excludes %s outcomes", (status) => {
    expect(
      parseReport(JSON.stringify({ ...payload, status }), metadata),
    ).toBeNull();
  });

  it.each([
    "not json",
    "null",
    "[]",
    JSON.stringify({ ...payload, v: 2 }),
    JSON.stringify({ ...payload, id: " " }),
    JSON.stringify({ ...payload, createdAtSec: 0 }),
    JSON.stringify({ ...payload, errorCode: { message: "failure" } }),
    JSON.stringify({ ...payload, direction: "sideways" }),
  ])("rejects malformed report %s", (content) => {
    expect(parseReport(content, metadata)).toBeNull();
  });

  it("accepts old errors without environment or error text", () => {
    expect(
      parseReport(
        JSON.stringify({
          id: "legacy",
          createdAtSec: payload.createdAtSec,
          direction: "in",
          status: "error",
          method: "cashu_receive",
          phase: "receive",
        }),
        metadata,
      ),
    ).toMatchObject({
      id: "legacy",
      appVersion: null,
      appHost: null,
      devicePlatform: null,
      appRuntime: null,
      errorCode: null,
      errorDetail: null,
    });
  });

  it.each([
    ["android", "android", "native"],
    ["ios", "iphone", "native"],
    ["web", "unknown", "web"],
  ])("maps legacy %s platform", (platform, devicePlatform, appRuntime) => {
    expect(
      parseReport(
        JSON.stringify({
          ...payload,
          devicePlatform: undefined,
          appRuntime: undefined,
          platform,
        }),
        metadata,
      ),
    ).toMatchObject({ devicePlatform, appRuntime });
  });

  it("prefers explicit environment fields over legacy platform", () => {
    expect(
      parseReport(JSON.stringify({ ...payload, platform: "web" }), metadata),
    ).toMatchObject({ devicePlatform: "android", appRuntime: "native" });
  });
});

describe("groupReports", () => {
  it("groups a known error across environments while retaining each occurrence", () => {
    const earlier = report();
    const later = report({
      id: "report-2",
      appVersion: "26.9.6",
      appHost: "localhost:5173",
      devicePlatform: "mac",
      appRuntime: "web",
      createdAtSec: payload.createdAtSec + 60,
    });
    const groups = groupReports([earlier, later]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      firstSeen: earlier.createdAtSec,
      lastSeen: later.createdAtSec,
      reports: [later, earlier],
    });
    expect(groupReports([later])[0]?.id).toBe(groups[0]?.id);
  });

  it("keeps unknown errors with different details or phases separate", () => {
    const reports = [
      report({ id: "1", errorCode: null, errorDetail: "Cannot decode token" }),
      report({
        id: "2",
        errorCode: "unknown",
        errorDetail: "Cannot decode token",
      }),
      report({ id: "3", errorCode: null, errorDetail: "Invalid keyset" }),
      report({
        id: "4",
        phase: "swap",
        errorCode: null,
        errorDetail: "Invalid keyset",
      }),
    ];
    const groups = groupReports(reports);
    expect(groups).toHaveLength(3);
    expect(groups.find((group) => group.reports.length === 2)?.code).toBe(
      "unknown",
    );
  });

  it("counts retried gift wraps once without collapsing repeated legitimate failures", () => {
    const first = report();
    const retry = report({
      wrapId: "wrap-2",
      senderPubkey: "another-sender",
      relay: "wss://another.example",
    });
    const separateFailure = report({ id: "report-2" });
    expect(deduplicateReports([retry, first, separateFailure])).toHaveLength(2);
    expect(
      groupReports([retry, first, separateFailure])[0]?.reports,
    ).toHaveLength(2);
  });
});

describe("filterReports", () => {
  const current = report();
  const other = report({
    id: "2",
    appVersion: "26.9.4",
    devicePlatform: "mac",
    appRuntime: "web",
    appHost: "localhost:5173",
    mint: "https://other.example",
    createdAtSec: payload.createdAtSec - 100,
  });

  it.each([
    { versions: ["26.9.5"] },
    { platform: "android" },
    { runtime: "native" },
    { host: "linky.fit" },
    { mint: "https://mint.example" },
    { since: payload.createdAtSec },
    { search: "LINKY.FIT" },
  ])("filters by %j", (selection) => {
    expect(
      filterReports([other, current], { ...filters, ...selection }),
    ).toEqual([current]);
  });

  it.each([null, "", "unknown"])(
    "matches missing metadata %j with Unknown filters",
    (missing) => {
      const legacy = report({
        id: "legacy",
        appVersion: missing,
        devicePlatform: missing,
        appRuntime: missing,
        appHost: missing,
        mint: missing,
      });
      expect(
        filterReports([current, legacy], { ...filters, versions: ["unknown"] }),
      ).toEqual([legacy]);
      for (const key of ["platform", "runtime", "host", "mint"]) {
        expect(
          filterReports([current, legacy], { ...filters, [key]: "unknown" }),
        ).toEqual([legacy]);
      }
    },
  );

  it("combines filters and searches error detail case-insensitively", () => {
    expect(
      filterReports([other, current], {
        ...filters,
        search: " REJECTED ",
        platform: "android",
      }),
    ).toEqual([current]);
    expect(
      filterReports([other, current], {
        ...filters,
        platform: "android",
        runtime: "web",
      }),
    ).toEqual([]);
  });
});

describe("version and date selection", () => {
  it("sorts releases numerically, newest first, with Unknown last", () => {
    expect(
      sortVersions([
        "26.9.9",
        "unknown",
        "26.10.1",
        "26.9.10",
        "27.1.1",
        "26.9.9",
      ]),
    ).toEqual(["27.1.1", "26.10.1", "26.9.10", "26.9.9", "unknown"]);
  });

  it("combines selected versions with an inclusive start and exclusive end", () => {
    const reports = [
      report({ id: "start", appVersion: "26.9.5", createdAtSec: 100 }),
      report({ id: "second", appVersion: "26.9.6", createdAtSec: 199 }),
      report({ id: "other", appVersion: "26.9.7", createdAtSec: 150 }),
      report({ id: "end", appVersion: "26.9.5", createdAtSec: 200 }),
      report({ id: "before", appVersion: "26.9.6", createdAtSec: 99 }),
    ];
    expect(
      filterReports(reports, {
        ...filters,
        versions: ["26.9.5", "26.9.6"],
        since: 100,
        until: 200,
      }).map((item) => item.id),
    ).toEqual(["start", "second"]);
    expect(filterReports(reports, filters)).toHaveLength(5);
  });
});
