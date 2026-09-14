import type { I18nKey } from "../../i18n";

/** Selectable waits before an unclaimed issued token returns by itself; 0 = off. */
export const UNCLAIMED_TOKEN_AUTO_RETURN_OPTIONS: ReadonlyArray<{
  hours: number;
  labelKey: I18nKey;
}> = [
  { hours: 0, labelKey: "unclaimedTokenAutoReturnOff" },
  { hours: 1, labelKey: "autoReturnOption1h" },
  { hours: 6, labelKey: "autoReturnOption6h" },
  { hours: 24, labelKey: "autoReturnOption24h" },
  { hours: 72, labelKey: "autoReturnOption3d" },
  { hours: 168, labelKey: "autoReturnOption7d" },
];

export const unclaimedTokenAutoReturnLabelKey = (hours: number): I18nKey =>
  UNCLAIMED_TOKEN_AUTO_RETURN_OPTIONS.find((option) => option.hours === hours)
    ?.labelKey ?? "autoReturnOption24h";

/** Unix seconds at which an issued send created at `createdAt` returns; null when off. */
export const unclaimedTokenAutoReturnAt = (
  createdAt: number,
  hours: number,
): number | null => (hours > 0 ? createdAt + hours * 3600 : null);
