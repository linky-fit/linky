import { describe, expect, it } from "vitest";
import {
  issueKey,
  issueStatus,
  latestResolutions,
  resolveIssue,
} from "./issueState";

describe("issue resolutions", () => {
  const issue = { id: '["mint_failed","cashu_chat","swap",""]', lastSeen: 100 };

  it("reopens only for occurrences later than the resolution, not late delivery", () => {
    const resolution = resolveIssue(issue, 200_500);
    expect(issueStatus(issue, undefined)).toBe("open");
    expect(issueStatus(issue, resolution)).toBe("solved");
    expect(issueStatus({ lastSeen: 200 }, resolution)).toBe("solved");
    expect(issueStatus({ lastSeen: 201 }, resolution)).toBe("reoccurred");
    expect(issueStatus({ lastSeen: 150 }, resolution)).toBe("solved");
  });

  it("covers known clock-skewed reports when solving", () => {
    const future = { ...issue, lastSeen: 500 };
    const resolution = resolveIssue(future, 200_000);
    expect(issueStatus(future, resolution)).toBe("solved");
    expect(issueStatus({ lastSeen: 501 }, resolution)).toBe("reoccurred");
  });

  it("merges resolutions independently of arrival order and supports solving again", () => {
    const first = resolveIssue(issue, 200_000);
    const next = resolveIssue({ ...issue, lastSeen: 300 }, 400_000);
    for (const rows of [
      [first, next],
      [next, first],
      [next, next, first],
    ]) {
      const latest = latestResolutions(rows).get(issueKey(issue.id));
      expect(latest).toEqual(next);
      expect(issueStatus({ lastSeen: 300 }, latest)).toBe("solved");
      expect(issueStatus({ lastSeen: 401 }, latest)).toBe("reoccurred");
    }
  });

  it("stores only a stable hash and resolution times", () => {
    const resolution = resolveIssue(issue, 200_000);
    expect(resolution).toEqual({
      issueKey: issueKey(issue.id),
      solvedAtMs: 200_000,
      cutoffSec: 200,
    });
    expect(resolution.issueKey).toMatch(/^[0-9a-f]{64}$/);
    expect(issueKey(issue.id)).not.toBe(issueKey(`${issue.id}different`));
    expect(JSON.stringify(resolution)).not.toContain("mint_failed");
  });
});
