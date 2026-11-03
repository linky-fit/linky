import type { CashIntent } from "@linky-fit/linkstr";
import React from "react";
import { reportAppLog } from "../../devtools/inspector/appLog";
import { runWrite, type WriteOutcome } from "../lib/storeWrite";
import { useSetting, useSettingsRepository } from "./useLinksync";

/** The synced cash intent: offering cash for bitcoin, wanting it, or neither (`null`). */
export const useCashIntent = () => {
  const settingsRepository = useSettingsRepository();
  const cashIntent = useSetting("cashIntent");

  const setCashIntent = React.useCallback(
    (intent: CashIntent | null): Promise<WriteOutcome> => {
      reportAppLog({
        tag: "listings.cashIntentSet",
        summary: `Cash intent set to ${intent ?? "none"}`,
        payload: { cashIntent: intent },
      });
      return runWrite(
        intent === null
          ? settingsRepository.remove("cashIntent")
          : settingsRepository.set("cashIntent", intent),
      );
    },
    [settingsRepository],
  );

  return { cashIntent, setCashIntent };
};
