import type { RelayDotState } from "../app/hooks/useRelayHealth";
import { navigateTo } from "../hooks/useRouting";

interface NostrRelayRowProps {
  detail: string | null;
  label: string | null;
  state: RelayDotState;
  url: string;
}

export function NostrRelayRow({
  detail,
  label,
  state,
  url,
}: NostrRelayRowProps) {
  return (
    <button
      type="button"
      className="settings-row settings-link"
      onClick={() => navigateTo({ route: "nostrRelay", id: url })}
    >
      <div className="settings-left">
        <span className="relay-cell">
          <span className="relay-url">{url}</span>
          {label ? <span className="relay-detail">{label}</span> : null}
          {detail ? <span className="relay-detail">{detail}</span> : null}
        </span>
      </div>
      <div className="settings-right">
        <span
          className={`status-dot ${state}`}
          aria-label={state}
          title={state}
        />
        <span className="settings-chevron" aria-hidden="true">
          &gt;
        </span>
      </div>
    </button>
  );
}
