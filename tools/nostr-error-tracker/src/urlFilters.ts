import { Schema } from "effect";
import { useMemo, useSyncExternalStore } from "react";
import { getDateRange } from "./dateRange";
import type { ReportFilters } from "./reports";

const Period = Schema.Literal("all", "1", "7", "30", "90", "custom");
const Sort = Schema.Literal("recent", "frequent");
export const isPeriod = Schema.is(Period);
export const isSort = Schema.is(Sort);

export interface FilterView {
  filters: ReportFilters;
  period: typeof Period.Type;
  fromDate: string;
  toDate: string;
  showSolved: boolean;
  sort: typeof Sort.Type;
}

export const emptyFilters: ReportFilters = {
  search: "",
  versions: [],
  platform: "",
  runtime: "",
  host: "",
  mint: "",
  since: null,
  until: null,
};

const validDate = (value: string | null): string =>
  value && !getDateRange(value, "").error ? value : "";

export const readFilterView = (search: string): FilterView => {
  const params = new URLSearchParams(search);
  const fromDate = validDate(params.get("from"));
  const toDate = validDate(params.get("to"));
  const period = Schema.decodeUnknownOption(Period)(params.get("period"));
  const sort = Schema.decodeUnknownOption(Sort)(params.get("sort"));
  return {
    filters: {
      ...emptyFilters,
      search: params.get("q") ?? "",
      versions: [...new Set(params.getAll("version").filter(Boolean))],
      platform: params.get("platform") ?? "",
      runtime: params.get("runtime") ?? "",
      host: params.get("host") ?? "",
      mint: params.get("mint") ?? "",
    },
    period:
      period._tag === "Some"
        ? period.value
        : fromDate || toDate
          ? "custom"
          : "all",
    fromDate,
    toDate,
    showSolved: params.get("solved") === "1",
    sort: sort._tag === "Some" ? sort.value : "recent",
  };
};

export const writeFilterView = (search: string, view: FilterView): string => {
  const params = new URLSearchParams(search);
  const values = {
    q: view.filters.search,
    platform: view.filters.platform,
    runtime: view.filters.runtime,
    host: view.filters.host,
    mint: view.filters.mint,
    period: view.period === "all" ? "" : view.period,
    from: view.period === "custom" ? view.fromDate : "",
    to: view.period === "custom" ? view.toDate : "",
    solved: view.showSolved ? "1" : "",
    sort: view.sort === "recent" ? "" : view.sort,
  };
  for (const [key, value] of Object.entries(values)) {
    params.delete(key);
    if (value) params.set(key, value);
  }
  params.delete("version");
  for (const version of new Set(view.filters.versions)) {
    if (version) params.append("version", version);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
};

const changeEvent = "linky:tracker-filters";
const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  window.addEventListener(changeEvent, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(changeEvent, notify);
  };
};
const getSnapshot = () => window.location.search;

export const useUrlFilters = () => {
  const search = useSyncExternalStore(subscribe, getSnapshot);
  const view = useMemo(() => readFilterView(search), [search]);
  const updateView = (patch: Partial<FilterView>, replace = false) => {
    const url = new URL(window.location.href);
    const next = writeFilterView(url.search, {
      ...readFilterView(url.search),
      ...patch,
    });
    if (next === url.search) return;
    url.search = next;
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    window.dispatchEvent(new Event(changeEvent));
  };
  return { ...view, updateView };
};
