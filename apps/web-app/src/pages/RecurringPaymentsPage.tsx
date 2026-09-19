import { Repeat } from "lucide-react";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { RecurringPaymentsList } from "../components/RecurringPaymentsList";
import { navigateTo } from "../hooks/useRouting";

export function RecurringPaymentsPage(): React.ReactElement {
  const { t } = useAppShellCore();
  return (
    <section className="panel panel-plain recurring-payments-page">
      <div className="actions recurring-list-actions">
        <button
          type="button"
          className="btn-wide"
          onClick={() => navigateTo({ route: "recurringPaymentNew" })}
        >
          <span className="btn-label-with-icon">
            <span className="btn-label-icon" aria-hidden="true">
              <Repeat size={18} />
            </span>
            <span>{t("recurringSave")}</span>
          </span>
        </button>
      </div>
      <RecurringPaymentsList />
      <p className="muted recurring-hint">{t("recurringOnlyWhileOpen")}</p>
    </section>
  );
}
