import { Schema } from "effect";

export const PAYMENT_TELEMETRY_KIND = 24134;

export interface ReportMetadata {
  wrapId: string;
  rumorId: string;
  senderPubkey: string;
  relay: string;
}

export interface ErrorReport extends ReportMetadata {
  id: string;
  createdAtSec: number;
  direction: "in" | "out";
  status: "error";
  method: string;
  phase: string;
  mint: string | null;
  amountBucket: string | null;
  feeBucket: string | null;
  errorCode: string | null;
  errorDetail: string | null;
  appVersion: string | null;
  appHost: string | null;
  devicePlatform: string | null;
  appRuntime: string | null;
  rawContent: string;
}

export interface ErrorIssue {
  id: string;
  code: string;
  method: string;
  phase: string;
  reports: ErrorReport[];
  firstSeen: number;
  lastSeen: number;
}

export interface ReportFilters {
  search: string;
  versions: readonly string[];
  platform: string;
  runtime: string;
  host: string;
  mint: string;
  since: number | null;
  until: number | null;
}

const optionalText = Schema.optional(Schema.NullOr(Schema.String));
const nonemptyText = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0),
);
const reportSchema = Schema.Struct({
  v: Schema.optional(Schema.Literal(1)),
  id: nonemptyText,
  createdAtSec: Schema.Number.pipe(Schema.finite(), Schema.positive()),
  direction: Schema.Literal("in", "out"),
  status: Schema.Literal("error"),
  method: nonemptyText,
  phase: nonemptyText,
  mint: optionalText,
  amountBucket: optionalText,
  feeBucket: optionalText,
  errorCode: optionalText,
  errorDetail: optionalText,
  appVersion: optionalText,
  appHost: optionalText,
  devicePlatform: optionalText,
  appRuntime: optionalText,
  platform: optionalText,
});
const decodeReport = Schema.decodeUnknownOption(Schema.parseJson(reportSchema));
const textOrNull = (value: string | null | undefined): string | null =>
  value?.trim() || null;

export function parseReport(
  content: string,
  metadata: ReportMetadata,
): ErrorReport | null {
  const decoded = decodeReport(content);
  if (decoded._tag === "None") return null;
  const value = decoded.value;
  const legacyDevice =
    value.platform === "android"
      ? "android"
      : value.platform === "ios"
        ? "iphone"
        : value.platform === "web"
          ? "unknown"
          : null;
  const legacyRuntime =
    value.platform === "web"
      ? "web"
      : value.platform === "android" || value.platform === "ios"
        ? "native"
        : null;

  return {
    ...metadata,
    id: value.id,
    createdAtSec: Math.trunc(value.createdAtSec),
    direction: value.direction,
    status: value.status,
    method: value.method,
    phase: value.phase,
    mint: textOrNull(value.mint),
    amountBucket: textOrNull(value.amountBucket),
    feeBucket: textOrNull(value.feeBucket),
    errorCode: textOrNull(value.errorCode),
    errorDetail: value.errorDetail ?? null,
    appVersion: textOrNull(value.appVersion),
    appHost: textOrNull(value.appHost),
    devicePlatform:
      value.devicePlatform === undefined
        ? legacyDevice
        : textOrNull(value.devicePlatform),
    appRuntime:
      value.appRuntime === undefined
        ? legacyRuntime
        : textOrNull(value.appRuntime),
    rawContent: content,
  };
}

function newestFirst(a: ErrorReport, b: ErrorReport): number {
  return (
    b.createdAtSec - a.createdAtSec ||
    a.id.localeCompare(b.id) ||
    a.wrapId.localeCompare(b.wrapId)
  );
}

export function deduplicateReports(
  reports: readonly ErrorReport[],
): ErrorReport[] {
  const unique = new Map<string, ErrorReport>();
  for (const report of [...reports].sort(newestFirst)) {
    if (!unique.has(report.id)) unique.set(report.id, report);
  }
  return [...unique.values()];
}

export function groupReports(reports: readonly ErrorReport[]): ErrorIssue[] {
  const groups = new Map<string, ErrorIssue>();
  for (const report of deduplicateReports(reports)) {
    const code = report.errorCode ?? "unknown";
    const detail =
      code === "unknown"
        ? report.errorDetail?.trim().replace(/\s+/gu, " ") || null
        : null;
    const id = JSON.stringify([code, report.method, report.phase, detail]);
    const existing = groups.get(id);
    if (existing) {
      existing.reports.push(report);
      existing.firstSeen = Math.min(existing.firstSeen, report.createdAtSec);
    } else {
      groups.set(id, {
        id,
        code,
        method: report.method,
        phase: report.phase,
        reports: [report],
        firstSeen: report.createdAtSec,
        lastSeen: report.createdAtSec,
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.lastSeen - a.lastSeen || a.id.localeCompare(b.id),
  );
}

export function filterReports(
  reports: readonly ErrorReport[],
  filters: ReportFilters,
): ErrorReport[] {
  const search = filters.search.trim().toLowerCase();
  return reports.filter((report) => {
    if (
      filters.versions.length > 0 &&
      !filters.versions.includes(report.appVersion || "unknown")
    )
      return false;
    if (
      filters.platform &&
      (report.devicePlatform || "unknown") !== filters.platform
    )
      return false;
    if (filters.runtime && (report.appRuntime || "unknown") !== filters.runtime)
      return false;
    if (filters.host && (report.appHost || "unknown") !== filters.host)
      return false;
    if (filters.mint && (report.mint || "unknown") !== filters.mint)
      return false;
    if (filters.since !== null && report.createdAtSec < filters.since)
      return false;
    if (filters.until !== null && report.createdAtSec >= filters.until)
      return false;
    return (
      !search ||
      [
        report.errorCode,
        report.errorDetail,
        report.method,
        report.phase,
        report.appHost,
        report.mint,
        report.appVersion,
      ].some((value) => value?.toLowerCase().includes(search))
    );
  });
}

export function sortVersions(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => {
    if (a === "unknown") return b === "unknown" ? 0 : 1;
    if (b === "unknown") return -1;
    return b.localeCompare(a, undefined, { numeric: true });
  });
}
