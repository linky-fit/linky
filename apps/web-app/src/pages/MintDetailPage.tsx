import { sqliteTrue } from "@evolu/common";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import { navigateTo } from "../hooks/useRouting";
import { LOCAL_MINT_INFO_STORAGE_KEY_PREFIX } from "../utils/constants";
import { normalizeLocale } from "../utils/formatting";
import { extractPpk, normalizeMintUrl } from "../utils/mint";
import { safeLocalStorageSetJson } from "../utils/storage";

const isPpkSearchInput = (
  value: unknown,
): value is Parameters<typeof extractPpk>[0] => {
  if (value === null) return true;
  if (Array.isArray(value)) return true;
  const valueType = typeof value;
  return (
    valueType === "string" ||
    valueType === "number" ||
    valueType === "boolean" ||
    valueType === "bigint" ||
    valueType === "symbol" ||
    valueType === "object"
  );
};

export function MintDetailPage() {
  const {
    appOwnerIdRef,
    getMintRuntime,
    mintInfoByUrl,
    pendingMintDeleteUrl,
    refreshMintInfo,
    setMintInfoAll,
    setPendingMintDeleteUrl,
    setStatus,
  } = useMintSettingsContext();
  const { lang, route, t } = useAppShellCore();
  const mintUrl = route.kind === "mint" ? route.mintUrl : "";

  const cleaned = normalizeMintUrl(mintUrl);
  const row = mintInfoByUrl.get(cleaned) ?? null;

  if (!row) {
    return (
      <section className="panel">
        <p className="muted">{t("mintNotFound")}</p>
      </section>
    );
  }

  const feesJson = (row.feesJson ?? "").trim();

  const runtime = getMintRuntime(cleaned);
  const lastCheckedAtSec = runtime?.lastCheckedAtSec ?? 0;
  const latencyMs = runtime?.latencyMs ?? null;

  const ppk = (() => {
    if (!feesJson) return null;
    try {
      const parsed: unknown = JSON.parse(feesJson);
      if (!isPpkSearchInput(parsed)) return null;
      const found = extractPpk(parsed);
      if (typeof found === "number" && Number.isFinite(found)) {
        return found;
      }
      return null;
    } catch {
      return null;
    }
  })();

  return (
    <section className="panel">
      <div>
        <div className="settings-row">
          <div className="settings-left">
            <span className="settings-icon" aria-hidden="true">
              🔗
            </span>
            <span className="settings-label">{t("mintUrl")}</span>
          </div>
          <div className="settings-right">
            <span className="relay-url">{cleaned}</span>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-left">
            <span className="settings-icon" aria-hidden="true">
              💸
            </span>
            <span className="settings-label">{t("mintFees")}</span>
          </div>
          <div className="settings-right">
            {ppk !== null ? (
              <span className="relay-url">ppk: {ppk}</span>
            ) : feesJson ? (
              <span className="relay-url">{feesJson}</span>
            ) : (
              <span className="muted">{t("unknown")}</span>
            )}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-left">
            <span className="settings-icon" aria-hidden="true">
              ⏱
            </span>
            <span className="settings-label">Latency</span>
          </div>
          <div className="settings-right">
            {latencyMs !== null ? (
              <span className="relay-url">{latencyMs} ms</span>
            ) : (
              <span className="muted">{t("unknown")}</span>
            )}
          </div>
        </div>

        <div className="settings-row">
          <button
            type="button"
            className="btn-wide secondary"
            onClick={() => {
              void refreshMintInfo(cleaned);
            }}
          >
            {t("mintRefresh")}
          </button>
        </div>

        <div className="settings-row">
          <button
            type="button"
            className={
              pendingMintDeleteUrl === cleaned ? "btn-wide danger" : "btn-wide"
            }
            onClick={() => {
              if (pendingMintDeleteUrl === cleaned) {
                const ownerId = appOwnerIdRef.current;
                if (ownerId) {
                  setMintInfoAll((prev) => {
                    const next = prev.map((mintInfoRow) => {
                      const url = normalizeMintUrl(mintInfoRow.url);
                      if (url !== cleaned) return mintInfoRow;
                      return {
                        ...mintInfoRow,
                        isDeleted: sqliteTrue,
                      };
                    });
                    safeLocalStorageSetJson(
                      `${LOCAL_MINT_INFO_STORAGE_KEY_PREFIX}.${ownerId}`,
                      next,
                    );
                    return next;
                  });
                }

                setPendingMintDeleteUrl(null);
                navigateTo({ route: "mints" });
                return;
              }
              setStatus(t("deleteArmedHint"));
              setPendingMintDeleteUrl(cleaned);
            }}
          >
            {t("mintDelete")}
          </button>
        </div>

        {lastCheckedAtSec ? (
          <p className="muted settings-error-note">
            {t("mintLastChecked")}:{" "}
            {new Date(lastCheckedAtSec * 1000).toLocaleString(
              normalizeLocale(lang),
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
}
