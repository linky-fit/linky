import { boltCardId, type BoltCard } from "@linky-fit/bolt-card";
import { Nfc } from "lucide-react";
import React, { type FC } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import { useBoltCardArmOnSend } from "../app/hooks/useBoltCardArmOnSend";
import {
  getBoltCardBridgeUrl,
  loadBoltCard,
  normalizeBoltCardBridgeUrl,
  removeBoltCard,
  setBoltCardBridgeUrl,
} from "../app/lib/boltCardStorage";
import { SettingsToggleRow } from "../components/SettingsRows";
import { navigateTo } from "../hooks/useRouting";
import type { I18nKey } from "../i18n";
import { formatMiddleDots } from "../utils/formatting";

// What the user agrees to by switching the card on, in the order it matters.
const INFO_KEYS: readonly I18nKey[] = [
  "boltCardInfoRisk",
  "boltCardInfoAndroid",
  "boltCardInfoSync",
];

export const AdvancedBoltCardPage: FC = () => {
  const { formatDisplayedAmountText, t } = useAppShellCore();
  const { lightningInvoiceAutoPayLimit, pushToast } =
    useAdvancedSettingsContext();
  const { armOnSend, setArmOnSend } = useBoltCardArmOnSend();
  const [bridgeUrl, setBridgeUrlDraft] = React.useState(getBoltCardBridgeUrl);
  // Undefined while the native store answers, null when no card exists yet.
  const [card, setCard] = React.useState<BoltCard | null | undefined>(
    undefined,
  );
  const [resetArmed, setResetArmed] = React.useState(false);
  const bridgeUrlValid = normalizeBoltCardBridgeUrl(bridgeUrl) !== null;
  const autoPayLimit = formatDisplayedAmountText(lightningInvoiceAutoPayLimit);

  React.useEffect(() => {
    let cancelled = false;
    void loadBoltCard().then((loaded) => {
      if (!cancelled) setCard(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const replaceCard = async () => {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    if (await removeBoltCard()) setCard(null);
  };

  return (
    <section className="panel">
      <p className="muted settings-note">{t("boltCardIntro")}</p>
      <SettingsToggleRow
        icon={<Nfc size={18} />}
        label={t("boltCardArmOnSend")}
        checked={armOnSend}
        onChange={(checked) =>
          void setArmOnSend(checked).then((outcome) => {
            if (!outcome.ok) pushToast(outcome.error);
          })
        }
      />

      <h2 className="settings-section-title">{t("boltCardInfoTitle")}</h2>
      <ul className="muted bolt-card-info">
        {INFO_KEYS.map((key) => (
          <li key={key}>{t(key).replace("{amount}", autoPayLimit)}</li>
        ))}
      </ul>

      <h2 className="settings-section-title">{t("boltCardBridgeUrl")}</h2>
      <p className="muted settings-note">{t("boltCardBridgeUrlHint")}</p>
      <input
        id="boltCardBridgeUrl"
        aria-label={t("boltCardBridgeUrl")}
        value={bridgeUrl}
        onChange={(event) => setBridgeUrlDraft(event.target.value)}
        placeholder="https://..."
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      {bridgeUrlValid ? null : (
        <p className="muted">{t("boltCardBridgeUrlInvalid")}</p>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn-wide"
          disabled={!bridgeUrlValid}
          onClick={() => {
            if (setBoltCardBridgeUrl(bridgeUrl)) {
              navigateTo({ route: "advanced" });
            }
          }}
        >
          {t("saveChanges")}
        </button>
      </div>

      <h2 className="settings-section-title">{t("boltCardCurrentCard")}</h2>
      {card === undefined ? null : card === null ? (
        <p className="muted">{t("boltCardNoCard")}</p>
      ) : (
        <>
          <p className="muted">
            {t("boltCardId").replace(
              "{id}",
              formatMiddleDots(boltCardId(card), 24),
            )}
          </p>
          <p className="muted">
            {t("boltCardTaps").replace("{count}", String(card.counter))}
          </p>
          <p className="muted">{t("boltCardReplaceHint")}</p>
          <div className="actions">
            <button
              type="button"
              className="btn-wide secondary"
              onClick={() => void replaceCard()}
            >
              {resetArmed ? t("boltCardReplaceConfirm") : t("boltCardReplace")}
            </button>
          </div>
        </>
      )}
    </section>
  );
};
