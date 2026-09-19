import { ChevronRight, Repeat } from "lucide-react";
import type { FC } from "react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentOrders } from "../app/hooks/payments/useRecurringPaymentOrders";
import { recurringOrderState } from "../app/lib/recurringPaymentDisplay";
import { navigateTo } from "../hooks/useRouting";
import { normalizeLocale } from "../utils/formatting";
import { nowSeconds } from "../utils/time";

/**
 * One entry above the transaction history: a count and the next due time,
 * or an invitation to set one up. The payments themselves live on their own
 * page so they never mix with payments that already happened.
 */
export const RecurringPaymentsSummaryRow: FC = () => {
  const { lang, t } = useAppShellCore();
  const orders = useRecurringPaymentOrders();
  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(normalizeLocale(lang), {
        day: "numeric",
        month: "numeric",
      }),
    [lang],
  );
  const now = nowSeconds();
  const active = orders.filter(
    (order) => recurringOrderState(order, now) === "active",
  );
  const nextDueAtSec = active[0]?.schedule.nextDueAtSec ?? null;

  const subtitle =
    orders.length === 0
      ? null
      : active.length === 0
        ? t("recurringSummaryNoneActive")
        : [
            t("recurringSummaryActive").replace(
              "{count}",
              String(active.length),
            ),
            nextDueAtSec === null
              ? null
              : t("recurringSummaryNext").replace(
                  "{date}",
                  dateFormatter.format(new Date(nextDueAtSec * 1000)),
                ),
          ]
            .filter(Boolean)
            .join(" · ");

  return (
    <button
      type="button"
      className="recurring-summary-row"
      onClick={() =>
        navigateTo(
          orders.length === 0
            ? { route: "recurringPaymentNew" }
            : { route: "recurringPayments" },
        )
      }
    >
      <span className="recurring-summary-icon" aria-hidden="true">
        <Repeat size={18} />
      </span>
      <span className="recurring-summary-text">
        <span className="recurring-summary-title">
          {orders.length === 0
            ? t("recurringSave")
            : t("recurringPaymentsTitle")}
        </span>
        {subtitle ? (
          <span className="recurring-summary-subtitle">{subtitle}</span>
        ) : null}
      </span>
      <ChevronRight
        size={18}
        aria-hidden="true"
        className="recurring-summary-chevron"
      />
    </button>
  );
};
