import { describe, expect, it } from "vitest";
import { readFilterView, writeFilterView } from "./urlFilters";

describe("filter URLs", () => {
  it("round-trips every filter and encodes special characters", () => {
    const view = readFilterView(
      "?period=custom&from=2026-09-01&to=2026-09-06&solved=1&sort=frequent",
    );
    view.filters = {
      ...view.filters,
      search: "mint & timeout + retry?",
      versions: ["26.9.7", "26.9.6", "unknown"],
      platform: "android",
      runtime: "native",
      host: "app.linky.fit",
      mint: "https://mint.example/path?a=1&b=2",
    };
    expect(readFilterView(writeFilterView("", view))).toEqual(view);
  });

  it("keeps relative periods relative and removes inactive dates", () => {
    const view = readFilterView("?period=7&from=2026-09-01&to=2026-09-06");
    expect(writeFilterView("", view)).toBe("?period=7");
    expect(readFilterView("?period=7").filters.since).toBeNull();
  });

  it("accepts open date ranges and preserves reversed dates for the UI error", () => {
    expect(readFilterView("?from=2026-09-01")).toMatchObject({
      period: "custom",
      fromDate: "2026-09-01",
      toDate: "",
    });
    expect(readFilterView("?to=2026-09-06")).toMatchObject({
      period: "custom",
      fromDate: "",
      toDate: "2026-09-06",
    });
    expect(readFilterView("?from=2026-09-06&to=2026-09-01")).toMatchObject({
      fromDate: "2026-09-06",
      toDate: "2026-09-01",
    });
  });

  it("falls back safely for invalid options and impossible dates", () => {
    expect(
      readFilterView(
        "?period=forever&sort=bad&solved=false&from=2026-02-30&to=bad",
      ),
    ).toEqual(readFilterView(""));
    expect(
      readFilterView("?version=x&version=x&version=&version=y").filters
        .versions,
    ).toEqual(["x", "y"]);
  });

  it("omits defaults and preserves unrelated query parameters", () => {
    expect(
      writeFilterView(
        "?q=old&period=7&version=x&solved=1&from=2026-09-01&sort=frequent&extra=keep",
        readFilterView(""),
      ),
    ).toBe("?extra=keep");
    expect(writeFilterView("", readFilterView(""))).toBe("");
  });
});
