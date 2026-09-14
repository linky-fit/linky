import type { FC } from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import { UNCLAIMED_TOKEN_AUTO_RETURN_OPTIONS } from "../app/lib/unclaimedTokenAutoReturn";

export const AdvancedTokenAutoReturnPage: FC = () => {
  const { unclaimedTokenAutoReturnHours, setUnclaimedTokenAutoReturnHours } =
    useAdvancedSettingsContext();
  const { t } = useAppShellCore();

  return (
    <section className="panel">
      <p className="muted settings-hint">{t("unclaimedTokenAutoReturnHint")}</p>
      {UNCLAIMED_TOKEN_AUTO_RETURN_OPTIONS.map((option) => {
        const isSelected = unclaimedTokenAutoReturnHours === option.hours;
        return (
          <button
            type="button"
            className={`settings-row settings-link language-option${isSelected ? " is-selected" : ""}`}
            key={option.hours}
            aria-pressed={isSelected}
            onClick={() => setUnclaimedTokenAutoReturnHours(option.hours)}
          >
            <span className="settings-left">
              <span className="settings-label">{t(option.labelKey)}</span>
            </span>
          </button>
        );
      })}
    </section>
  );
};
