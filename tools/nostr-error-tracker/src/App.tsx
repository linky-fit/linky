import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { loginWithSecret } from "./auth";
import {
  rememberSessionSeed,
  restoreSavedSession,
  clearSavedSession,
} from "./auth";
import {
  createTrackerStore,
  useIssueResolutions,
  EVOLU_SERVERS,
} from "./issueStore";
import type { TrackerStore } from "./issueStore";
import { reloadPage } from "./navigation";
import {
  issueKey,
  issueStatus,
  latestResolutions,
  resolveIssue,
} from "./issueState";
import type { IssueResolution, IssueStatus } from "./issueState";
import type { TrackerSession } from "./auth";
import { DEFAULT_RELAYS, fetchReports } from "./inbox";
import type { InboxProgress, InboxResult } from "./inbox";
import { filterReports, groupReports, sortVersions } from "./reports";
import { getDateRange } from "./dateRange";
import type { ErrorIssue, ErrorReport } from "./reports";
import { emptyFilters, isPeriod, isSort, useUrlFilters } from "./urlFilters";

const formatDate = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString();
const label = (value: string) => value.replaceAll("_", " ");
const known = (value: string | null) => value || "Not reported";
const shortKey = (value: string) => `${value.slice(0, 12)}…${value.slice(-6)}`;

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        L
      </span>
      <span>
        linky<span className="brand-subtitle">error tracker</span>
      </span>
    </div>
  );
}

interface LoginProps {
  onLogin: (session: TrackerSession) => void;
}

function Login({ onLogin }: LoginProps) {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginGeneration = useRef(0);
  useEffect(() => {
    const invalidate = () => {
      loginGeneration.current++;
    };
    const cancel = () => {
      invalidate();
      setSecret("");
      setBusy(false);
      setError(null);
    };
    window.addEventListener("pagehide", cancel);
    return () => {
      invalidate();
      window.removeEventListener("pagehide", cancel);
    };
  }, []);
  const connect = async () => {
    const generation = ++loginGeneration.current;
    setBusy(true);
    setError(null);
    try {
      const session = await loginWithSecret(secret);
      if (generation !== loginGeneration.current) {
        session.dispose();
        return;
      }
      try {
        rememberSessionSeed(secret);
      } catch (cause) {
        session.dispose();
        throw cause;
      }
      setSecret("");
      onLogin(session);
    } catch (cause) {
      if (generation === loginGeneration.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not sign in. Please try again.",
        );
    } finally {
      if (generation === loginGeneration.current) setBusy(false);
    }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void connect();
  };
  return (
    <main className="login-page">
      <div className="login-top">
        <Brand />
        <span className="local-badge">Local workspace</span>
      </div>
      <section className="login-card">
        <span className="eyebrow">LINKY / OBSERVABILITY</span>
        <h1>
          Find the story
          <br />
          behind an error.
        </h1>
        <p className="login-description">
          Sign in to the Nostr account that receives Linky reports. Decrypt its
          inbox and inspect errors across releases and devices.
        </p>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="secret">
            Linky recovery phrase
          </label>
          <input
            id="secret"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="20-word recovery phrase"
            required
            disabled={busy}
          />
          <p className="field-help">
            Use the collector account’s 20-word Linky seed.
          </p>
          <button
            className="button dark full"
            disabled={busy || !secret.trim()}
          >
            {busy ? "Connecting…" : "Open error inbox"}
          </button>
        </form>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <p className="privacy-note">
          Your recovery seed is saved in this browser until you sign out. Solved
          issues sync privately through Evolu using the same seed.
        </p>
      </section>
      <p className="login-footer">
        Existing Linky telemetry · Decrypted in your browser
      </p>
    </main>
  );
}

interface SelectFilterProps {
  name: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
}
function SelectFilter({ name, value, values, onChange }: SelectFilterProps) {
  const options = [...new Set([...values, ...(value ? [value] : [])])].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }),
  );
  return (
    <label className="select-filter">
      <span>{name}</span>
      <select
        aria-label={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "unknown" ? "Unknown" : option}
          </option>
        ))}
      </select>
    </label>
  );
}

interface VersionFilterProps {
  values: readonly string[];
  selected: readonly string[];
  onChange: (versions: string[]) => void;
}

function VersionFilter({ values, selected, onChange }: VersionFilterProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        menu.current &&
        event.target instanceof Node &&
        !menu.current.contains(event.target)
      )
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <details
      className="version-filter"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary>
        <span>Versions</span>
        <strong>
          {selected.length === 0 ? "All" : `${selected.length} selected`}
        </strong>
      </summary>
      <div className="version-options">
        <button className="text-button" onClick={() => onChange([])}>
          All versions
        </button>
        <div className="version-checkboxes">
          {sortVersions([...values, ...selected]).map((version) => (
            <label key={version}>
              <input
                type="checkbox"
                aria-label={`Version ${version}`}
                checked={selected.includes(version)}
                onChange={() =>
                  onChange(
                    selected.includes(version)
                      ? selected.filter((value) => value !== version)
                      : [...selected, version],
                  )
                }
              />
              {version === "unknown" ? "Unknown" : version}
            </label>
          ))}
        </div>
        {values.length === 0 && (
          <p className="small muted">No versions reported yet.</p>
        )}
      </div>
    </details>
  );
}

interface ActivityProps {
  reports: readonly ErrorReport[];
}
function Activity({ reports }: ActivityProps) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, index) => {
    const start = new Date(today);
    start.setDate(start.getDate() - 13 + index);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return {
      start,
      count: reports.filter(
        (report) =>
          report.createdAtSec * 1000 >= start.getTime() &&
          report.createdAtSec * 1000 < end.getTime(),
      ).length,
    };
  });
  const maximum = Math.max(1, ...days.map((day) => day.count));
  return (
    <div className="activity">
      <span>Reports / last 14 days</span>
      <div
        className="activity-bars"
        role="img"
        aria-label={days
          .map(
            (day) => `${day.start.toLocaleDateString()}: ${day.count} errors`,
          )
          .join(", ")}
      >
        {days.map((day) => (
          <div
            key={day.start.getTime()}
            className={day.count ? "activity-bar" : "activity-bar empty"}
            style={{ height: `${Math.max(4, (day.count / maximum) * 100)}%` }}
            title={`${day.start.toLocaleDateString()}: ${day.count} errors`}
          />
        ))}
      </div>
    </div>
  );
}

interface DetailsProps {
  issue: ErrorIssue;
  status: IssueStatus;
  resolution: IssueResolution | undefined;
  canSolve: boolean;
  onSolve: () => void;
}
function IssueDetails({
  issue,
  status,
  resolution,
  canSolve,
  onSolve,
}: DetailsProps) {
  const [occurrenceId, setOccurrenceId] = useState("");
  const report =
    issue.reports.find((item) => item.id === occurrenceId) ?? issue.reports[0];
  if (!report) return null;
  const distribution = (getValue: (item: ErrorReport) => string | null) => {
    const counts = new Map<string, number>();
    for (const item of issue.reports) {
      const value = known(getValue(item));
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  };
  const fields = [
    ["Version", known(report.appVersion)],
    ["Platform", known(report.devicePlatform)],
    ["Runtime", known(report.appRuntime)],
    ["App host", known(report.appHost)],
    ["Method", report.method],
    ["Phase", report.phase],
    ["Direction", report.direction === "in" ? "Incoming" : "Outgoing"],
    ["Mint", known(report.mint)],
    ["Amount bucket", known(report.amountBucket)],
    ["Fee bucket", known(report.feeBucket)],
  ];
  return (
    <aside className="issue-details" aria-label="Issue details">
      <div className="details-heading">
        <span className="eyebrow">ISSUE DETAILS</span>
        <span className={`issue-status ${status}`}>{label(status)}</span>
      </div>
      <h2>{label(issue.code)}</h2>
      <p className="muted">
        {label(issue.method)} <span aria-hidden="true">/</span>{" "}
        {label(issue.phase)}
      </p>
      <div className="resolution-actions">
        <button
          className="button primary"
          disabled={!canSolve || status === "solved"}
          onClick={onSolve}
        >
          {status === "solved" ? "Solved" : "Mark as solved"}
        </button>
        {resolution && (
          <p className="small muted">
            {status === "reoccurred"
              ? "Reoccurred after resolution on "
              : "Solved on "}
            {new Date(resolution.solvedAtMs).toLocaleString()}
          </p>
        )}
      </div>
      <div className="issue-dates">
        <div>
          <span>First seen</span>
          <strong>{formatDate(issue.firstSeen)}</strong>
        </div>
        <div>
          <span>Last seen</span>
          <strong>{formatDate(issue.lastSeen)}</strong>
        </div>
      </div>
      <div className="breakdowns">
        {[
          { title: "Versions", get: (item: ErrorReport) => item.appVersion },
          {
            title: "Platforms",
            get: (item: ErrorReport) => item.devicePlatform,
          },
          { title: "App hosts", get: (item: ErrorReport) => item.appHost },
        ].map(({ title, get }) => (
          <div key={title}>
            <h3>{title}</h3>
            <div className="tag-list">
              {distribution(get).map(([value, count]) => (
                <span className="tag" key={value}>
                  {value}
                  <b>{count}</b>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="occurrence-heading">
        <h3>
          Occurrences{" "}
          <span className="count-label">{issue.reports.length}</span>
        </h3>
        <span className="muted small">Newest first</span>
      </div>
      <select
        className="occurrence-select"
        aria-label="Occurrence"
        value={report.id}
        onChange={(event) => setOccurrenceId(event.target.value)}
      >
        {issue.reports.map((item) => (
          <option key={item.id} value={item.id}>
            {formatDate(item.createdAtSec)} · {known(item.appVersion)} ·{" "}
            {known(item.devicePlatform)} · {shortKey(item.id)}
          </option>
        ))}
      </select>
      <div className="error-message">
        <span className="field-label">Reported error</span>
        <pre>
          {report.errorDetail ||
            "No error message was attached to this report."}
        </pre>
      </div>
      <dl className="event-fields">
        {fields.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <details className="raw-details">
        <summary>Report identifiers</summary>
        <dl className="identifiers">
          <dt>Report ID</dt>
          <dd>{report.id}</dd>
          <dt>Rumor ID</dt>
          <dd>{report.rumorId}</dd>
          <dt>Gift-wrap ID</dt>
          <dd>{report.wrapId}</dd>
          <dt>Ephemeral sender</dt>
          <dd>{report.senderPubkey}</dd>
          <dt>Retrieved from</dt>
          <dd>{report.relay}</dd>
        </dl>
      </details>
      <details className="raw-details">
        <summary>Original report payload</summary>
        <pre>{report.rawContent}</pre>
      </details>
      <p className="detail-footnote">
        Legacy reports may contain sensitive text. Missing metadata was not
        recorded by that client. First and last seen refer to the current
        filters.
      </p>
    </aside>
  );
}

interface DashboardProps {
  session: TrackerSession;
  onLogout: () => void;
}
function Workspace({ session, onLogout }: DashboardProps) {
  const [store] = useState(() => {
    try {
      return createTrackerStore(session.ownerMnemonic);
    } catch {
      return null;
    }
  });
  if (!store)
    return (
      <main className="login-page">
        <Brand />
        <p role="alert">
          Could not open your issue database. Sign out and try again.
        </p>
        <button className="button" onClick={onLogout}>
          Sign out
        </button>
      </main>
    );
  return <Dashboard session={session} onLogout={onLogout} store={store} />;
}

interface StoredDashboardProps extends DashboardProps {
  store: TrackerStore;
}
function Dashboard({ session, onLogout, store }: StoredDashboardProps) {
  const {
    resolutions,
    ready,
    error: databaseError,
    solve,
  } = useIssueResolutions(store);
  const { filters, period, fromDate, toDate, showSolved, sort, updateView } =
    useUrlFilters();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const solved = useMemo(() => latestResolutions(resolutions), [resolutions]);
  const [result, setResult] = useState<InboxResult | null>(null);
  const [progress, setProgress] = useState<InboxProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [relayText, setRelayText] = useState(DEFAULT_RELAYS.join("\n"));
  const [showRelays, setShowRelays] = useState(false);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const updateTime = () => setNowSec(Math.floor(Date.now() / 1000));
    window.addEventListener("popstate", updateTime);
    return () => window.removeEventListener("popstate", updateTime);
  }, []);
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(
    async (relays: readonly string[]) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setLoading(true);
      setLoadError(null);
      setProgress(null);
      setNowSec(Math.floor(Date.now() / 1000));
      try {
        const next = await fetchReports(session, {
          relays,
          signal: current.signal,
          onProgress: (value) => {
            if (!current.signal.aborted) setProgress(value);
          },
        });
        if (!current.signal.aborted) setResult(next);
      } catch (cause) {
        if (!current.signal.aborted)
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "Could not retrieve reports.",
          );
      } finally {
        if (!current.signal.aborted) setLoading(false);
      }
    },
    [session],
  );
  useEffect(() => {
    void refresh(DEFAULT_RELAYS);
    return () => controller.current?.abort();
  }, [refresh]);
  const reports = result?.reports ?? [];
  const dateRange =
    period === "custom"
      ? getDateRange(fromDate, toDate)
      : {
          since: period === "all" ? null : nowSec - Number(period) * 86400,
          until: null,
          error: null,
        };
  const filtered = dateRange.error
    ? []
    : filterReports(reports, {
        ...filters,
        since: dateRange.since,
        until: dateRange.until,
      });
  const allIssues = useMemo(
    () => groupReports(result?.reports ?? []),
    [result],
  );
  const statuses = new Map(
    allIssues.map((issue) => [
      issue.id,
      issueStatus(issue, solved.get(issueKey(issue.id))),
    ]),
  );
  const issues = groupReports(filtered)
    .filter((issue) => showSolved || statuses.get(issue.id) !== "solved")
    .sort((a, b) =>
      sort === "frequent"
        ? b.reports.length - a.reports.length || b.lastSeen - a.lastSeen
        : b.lastSeen - a.lastSeen,
    );
  const markSolved = async (id: string) => {
    const issue = allIssues.find((item) => item.id === id);
    if (!issue || !ready || saving || databaseError) return;
    setSaving(true);
    setSaveError(null);
    try {
      await solve(resolveIssue(issue));
    } catch {
      setSaveError("Could not save the solved issue. Reload and try again.");
    } finally {
      setSaving(false);
    }
  };
  const selected =
    issues.find((issue) => issue.id === selectedIssueId) ?? issues[0];
  const visibleReports = issues.flatMap((issue) => issue.reports);
  const versions = [
    ...new Set(
      visibleReports
        .map((report) => report.appVersion)
        .filter((version) => version !== null),
    ),
  ];
  const failedRelays = result?.relays.filter((relay) => !relay.complete) ?? [];
  const hasFilters =
    period !== "all" ||
    filters.versions.length > 0 ||
    [
      filters.search,
      filters.platform,
      filters.runtime,
      filters.host,
      filters.mint,
    ].some(Boolean);
  const clearFilters = () => {
    updateView({
      filters: emptyFilters,
      period: "all",
      fromDate: "",
      toDate: "",
    });
  };
  const changeFilter = (
    key: "search" | "platform" | "runtime" | "host" | "mint",
    value: string,
  ) => updateView({ filters: { ...filters, [key]: value } }, key === "search");
  const stop = () => {
    controller.current?.abort();
    setLoading(false);
    setLoadError(
      "Scan stopped. Previously loaded results are kept; the unfinished scan was not applied.",
    );
  };
  return (
    <main className="dashboard">
      <header className="topbar">
        <div className="breadcrumb">
          Linky <span>/</span> Error tracker
        </div>
        <div className="account">
          <span title={session.npub}>{shortKey(session.npub)}</span>
          <button
            className="button subtle"
            onClick={() => {
              controller.current?.abort();
              onLogout();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="page-content">
        <div className="page-title">
          <div>
            <span className="eyebrow">ERROR MONITORING</span>
            <h1>
              Issues <span className="pill">Existing reports</span>
            </h1>
            <p>Errors across your releases, devices, and deployments.</p>
          </div>
          <div className="page-actions">
            <button
              className="button"
              aria-expanded={showRelays}
              onClick={() => setShowRelays(!showRelays)}
            >
              Relays
            </button>
            {loading ? (
              <button className="button" onClick={stop}>
                Stop scan
              </button>
            ) : (
              <button
                className="button primary"
                onClick={() =>
                  void refresh(relayText.split(/[\s,]+/).filter(Boolean))
                }
              >
                Refresh inbox
              </button>
            )}
          </div>
        </div>
        {showRelays && (
          <section className="relay-panel">
            <label className="field-label" htmlFor="relays">
              Relay URLs
            </label>
            <textarea
              id="relays"
              rows={3}
              value={relayText}
              onChange={(event) => setRelayText(event.target.value)}
            />
            <p className="small muted">
              One URL per line. Your account’s advertised relays are included
              automatically. Refresh to apply.
            </p>
            <p className="small muted">
              Evolu sync: {EVOLU_SERVERS.join(", ")}. Changes are saved locally
              and sync when connected.
            </p>
            {result && (
              <ul className="relay-results">
                {result.relays.map((relay) => (
                  <li key={relay.url}>
                    <span
                      className={
                        relay.complete
                          ? "status-dot good"
                          : "status-dot warning"
                      }
                    />
                    <code>{relay.url}</code>
                    <span>{relay.scanned} wraps</span>
                    <span>
                      {relay.complete
                        ? "Scan complete"
                        : relay.error || "Incomplete"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {!ready && !databaseError && (
          <div className="notice progress" role="status">
            Loading solved issues…
          </div>
        )}
        {(databaseError || saveError) && (
          <div className="notice error" role="alert">
            {databaseError || saveError}
          </div>
        )}
        {loading && (
          <div className="notice progress" role="status">
            <span className="spinner" />
            Scanning relay history
            {progress
              ? ` · ${progress.scanned.toLocaleString()} wraps · ${progress.errors.toLocaleString()} error reports`
              : "…"}
            {progress && (
              <span className="progress-relay">{progress.relay}</span>
            )}
          </div>
        )}
        {loadError && (
          <div className="notice error" role="alert">
            {loadError}
          </div>
        )}
        {failedRelays.length > 0 && (
          <div className="notice warning" role="status">
            Results may be incomplete. {failedRelays.length} relay scan
            {failedRelays.length === 1 ? "" : "s"} did not finish.{" "}
            <button className="text-button" onClick={() => setShowRelays(true)}>
              View relay status
            </button>
          </div>
        )}
        <section className="overview" aria-label="Error overview">
          <div className="metric">
            <span>Issues</span>
            <strong>{issues.length.toLocaleString()}</strong>
          </div>
          <div className="metric">
            <span>Error reports</span>
            <strong>{visibleReports.length.toLocaleString()}</strong>
          </div>
          <div className="metric">
            <span>Affected versions</span>
            <strong>{versions.length.toLocaleString()}</strong>
          </div>
          <Activity reports={visibleReports} />
        </section>
        <section className="filters" aria-label="Filter errors">
          <div className="search-row">
            <input
              aria-label="Search errors"
              type="search"
              placeholder="Search errors, messages, operations…"
              value={filters.search}
              onChange={(event) => changeFilter("search", event.target.value)}
            />
            <select
              aria-label="Time period"
              value={period}
              onChange={(event) => {
                const value = event.target.value;
                if (isPeriod(value)) updateView({ period: value });
                setNowSec(Math.floor(Date.now() / 1000));
              }}
            >
              <option value="all">All available history</option>
              <option value="1">Last 1 day</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="custom">Custom date range</option>
            </select>
          </div>
          {period === "custom" && (
            <div className="date-range">
              <label>
                From
                <input
                  type="date"
                  aria-label="From date"
                  value={fromDate}
                  max={toDate || undefined}
                  aria-describedby="date-range-hint"
                  onChange={(event) =>
                    updateView({ fromDate: event.target.value })
                  }
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  aria-label="To date"
                  value={toDate}
                  min={fromDate || undefined}
                  aria-describedby="date-range-hint"
                  onChange={(event) =>
                    updateView({ toDate: event.target.value })
                  }
                />
              </label>
              <p
                id="date-range-hint"
                className={dateRange.error ? "date-error" : "muted"}
                role={dateRange.error ? "alert" : undefined}
              >
                {dateRange.error ||
                  "Local time. Includes the whole end date; either date can be left empty."}
              </p>
            </div>
          )}
          <div className="filter-row">
            <VersionFilter
              selected={filters.versions}
              values={reports.map((report) => report.appVersion || "unknown")}
              onChange={(versions) =>
                updateView({ filters: { ...filters, versions } })
              }
            />
            <SelectFilter
              name="Platform"
              value={filters.platform}
              values={reports.map(
                (report) => report.devicePlatform || "unknown",
              )}
              onChange={(value) => changeFilter("platform", value)}
            />
            <SelectFilter
              name="Runtime"
              value={filters.runtime}
              values={reports.map((report) => report.appRuntime || "unknown")}
              onChange={(value) => changeFilter("runtime", value)}
            />
            <SelectFilter
              name="Host"
              value={filters.host}
              values={reports.map((report) => report.appHost || "unknown")}
              onChange={(value) => changeFilter("host", value)}
            />
            <SelectFilter
              name="Mint"
              value={filters.mint}
              values={reports.map((report) => report.mint || "unknown")}
              onChange={(value) => changeFilter("mint", value)}
            />
            {hasFilters && (
              <button className="text-button" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </section>
        <div className="issue-visibility">
          <label>
            <input
              type="checkbox"
              checked={showSolved}
              onChange={(event) =>
                updateView({ showSolved: event.target.checked })
              }
            />{" "}
            Show solved issues
          </label>
          <span className="small muted">
            {saving
              ? "Saving resolution…"
              : "Resolutions apply across all versions and dates."}
          </span>
        </div>
        <div className="issue-workspace">
          <section className="issue-list" aria-label="Issues">
            <div className="list-heading">
              <h2>
                {issues.length} issue{issues.length === 1 ? "" : "s"}
              </h2>
              <select
                aria-label="Sort issues"
                value={sort}
                onChange={(event) => {
                  const value = event.target.value;
                  if (isSort(value)) updateView({ sort: value });
                }}
              >
                <option value="recent">Last seen</option>
                <option value="frequent">Most frequent</option>
              </select>
            </div>
            {issues.length === 0 ? (
              <div className="empty-state">
                <span className="empty-symbol" aria-hidden="true">
                  ◎
                </span>
                <h2>
                  {loading
                    ? "Reading your error inbox"
                    : hasFilters
                      ? "No matching errors"
                      : allIssues.length > 0 && !showSolved
                        ? "All issues are solved"
                        : "No error reports found"}
                </h2>
                <p>
                  {loading
                    ? "Reports will appear when the scan completes."
                    : hasFilters
                      ? "Try another version, platform, or search term."
                      : allIssues.length > 0 && !showSolved
                        ? "Turn on Show solved issues to view resolved reports."
                        : "Only error outcomes are shown. Check that you signed into the collector account and that its relays still retain the reports."}
                </p>
                {hasFilters && (
                  <button className="button" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              issues.map((issue) => {
                const latest = issue.reports[0];
                return (
                  <button
                    key={issue.id}
                    className={`issue-row${selected?.id === issue.id ? " selected" : ""}`}
                    aria-pressed={selected?.id === issue.id}
                    onClick={() => setSelectedIssueId(issue.id)}
                  >
                    <span className="issue-severity" aria-hidden="true">
                      !
                    </span>
                    <span className="issue-copy">
                      <span className="issue-code">{label(issue.code)}</span>
                      {statuses.get(issue.id) !== "open" && (
                        <span
                          className={`issue-status ${statuses.get(issue.id)}`}
                        >
                          {label(statuses.get(issue.id) ?? "open")}
                        </span>
                      )}
                      <span className="issue-preview">
                        {latest?.errorDetail || "No error message reported"}
                      </span>
                      <span className="issue-meta">
                        <span>{label(issue.method)}</span>
                        <span>{label(issue.phase)}</span>
                        <span>{latest?.appVersion || "Unknown version"}</span>
                      </span>
                      <span className="issue-last-seen">
                        Last seen {formatDate(issue.lastSeen)}
                      </span>
                    </span>
                    <span className="issue-occurrences">
                      <strong>{issue.reports.length}</strong>
                      <span>events</span>
                    </span>
                  </button>
                );
              })
            )}
          </section>
          {selected ? (
            <IssueDetails
              key={selected.id}
              issue={selected}
              status={statuses.get(selected.id) ?? "open"}
              resolution={solved.get(issueKey(selected.id))}
              canSolve={ready && !saving && !databaseError}
              onSolve={() => void markSolved(selected.id)}
            />
          ) : (
            <aside className="details-placeholder">
              <span aria-hidden="true">↖</span>
              <p>Select an issue to inspect its reports.</p>
            </aside>
          )}
        </div>
        <footer className="dashboard-footer">
          <span>
            {result
              ? `${result.scanned.toLocaleString()} gift wraps scanned · ${result.ignored.toLocaleString()} non-error or unreadable wraps skipped`
              : "Waiting for relay history"}
          </span>
          <span>Event counts, not failure rates</span>
        </footer>
      </div>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<TrackerSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    window.addEventListener("pagehide", cancel);
    void restoreSavedSession()
      .then((saved) => {
        if (cancelled) saved?.dispose();
        else setSession(saved);
      })
      .catch(() => {
        if (!cancelled)
          setSessionError(
            "Could not restore your saved session. Sign in again.",
          );
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancel();
      window.removeEventListener("pagehide", cancel);
    };
  }, []);
  useEffect(() => {
    const clear = () => {
      session?.dispose();
      setSession(null);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) reloadPage();
    };
    window.addEventListener("pagehide", clear);
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("pageshow", restore);
      session?.dispose();
    };
  }, [session]);
  if (restoring)
    return (
      <main className="login-page">
        <Brand />
        <p role="status">Restoring your workspace…</p>
      </main>
    );
  return (
    <>
      {sessionError && (
        <p className="notice error" role="alert">
          {sessionError}
        </p>
      )}
      {session ? (
        <Workspace
          session={session}
          onLogout={() => {
            try {
              clearSavedSession();
              setSession(null);
              reloadPage();
            } catch {
              setSessionError(
                "Could not remove the saved seed. Allow browser storage and try signing out again.",
              );
            }
          }}
        />
      ) : (
        <Login
          onLogin={(next) => {
            setSessionError(null);
            setSession(next);
          }}
        />
      )}
    </>
  );
}
