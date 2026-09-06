import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ErrorIssue } from "./reports";

export interface IssueResolution {
  issueKey: string;
  solvedAtMs: number;
  cutoffSec: number;
}

export type IssueStatus = "open" | "solved" | "reoccurred";

export const issueKey = (id: string): string =>
  bytesToHex(sha256(new TextEncoder().encode(id)));

export const latestResolutions = (
  rows: readonly IssueResolution[],
): ReadonlyMap<string, IssueResolution> => {
  const latest = new Map<string, IssueResolution>();
  for (const row of rows) {
    const previous = latest.get(row.issueKey);
    if (
      !previous ||
      row.cutoffSec > previous.cutoffSec ||
      (row.cutoffSec === previous.cutoffSec &&
        row.solvedAtMs > previous.solvedAtMs)
    )
      latest.set(row.issueKey, row);
  }
  return latest;
};

export const issueStatus = (
  issue: Pick<ErrorIssue, "lastSeen">,
  resolution: IssueResolution | undefined,
): IssueStatus =>
  !resolution
    ? "open"
    : issue.lastSeen > resolution.cutoffSec
      ? "reoccurred"
      : "solved";

export const resolveIssue = (
  issue: Pick<ErrorIssue, "id" | "lastSeen">,
  nowMs = Date.now(),
): IssueResolution => ({
  issueKey: issueKey(issue.id),
  solvedAtMs: nowMs,
  cutoffSec: Math.max(Math.floor(nowMs / 1000), issue.lastSeen),
});
