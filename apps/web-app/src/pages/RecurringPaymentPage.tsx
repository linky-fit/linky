import { recurringOrderState } from "@linky-fit/recurring-payment";
import {
  Amount,
  Button,
  EmptyState,
  ListRow,
  Pill,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import {
  recurringRecipientLabel,
  useRecurringContactSummaries,
  useRecurringPaymentOrders,
} from "../app/hooks/payments/useRecurringPaymentOrders";
import {
  formatRecurringAmountText,
  recurringAmountSecondaryText,
} from "../app/lib/recurringAmount";
import {
  describeRecurringInterval,
  recurringLastRunLabel,
} from "../app/lib/recurringPaymentDisplay";
import { RecurringContactAvatar } from "../components/RecurringContactAvatar";
import { navigateTo } from "../hooks/useRouting";
import { normalizeLocale } from "../utils/formatting";
import { formatMintHost } from "../utils/mint";
import { nowSeconds } from "../utils/time";

interface RecurringPaymentPageProps {
  id: string;
}

export function RecurringPaymentPage({
  id,
}: RecurringPaymentPageProps): React.ReactElement | null {
  const { displayCurrency, fiatRates, formatDisplayedAmountParts, lang, t } =
    useAppShellCore();
  const {
    pendingRecurringPaymentDeleteId,
    requestDeleteRecurringPayment,
    setRecurringPaymentPaused,
  } = useRecurringPaymentsContext();
  const orders = useRecurringPaymentOrders();
  const contacts = useRecurringContactSummaries();
  const order = orders.find((candidate) => candidate.id === id) ?? null;
  const dateFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(normalizeLocale(lang), {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [lang],
  );

  if (order === null) {
    return orders.length === 0 ? null : (
      <EmptyState title={t("recurringNotFound")} />
    );
  }

  const state = recurringOrderState(order, nowSeconds());
  const formatDate = (epochSec: number): string =>
    dateFormatter.format(new Date(epochSec * 1000));
  const lastRun = recurringLastRunLabel(order, t);
  const deleteArmed = pendingRecurringPaymentDeleteId === order.id;
  const amountText = formatRecurringAmountText(order.amount, {
    displayCurrency,
    fiatRates,
    formatSat: formatDisplayedAmountParts,
    lang,
  });
  const secondaryAmount = recurringAmountSecondaryText(
    order.amount,
    fiatRates,
    lang,
    t,
  );

  return (
    <Stack gap="$lg">
      <Stack alignItems="center" gap="$sm">
        <RecurringContactAvatar
          contact={contacts.get(order.contactId)}
          size="lg"
        />
        <Text variant="title" textAlign="center" numberOfLines={1}>
          {recurringRecipientLabel(order, contacts)}
        </Text>
        <Row gap="$sm" alignItems="center">
          <Text variant="label" color="$colorMuted">
            {describeRecurringInterval(order.schedule.interval, t)}
          </Text>
          <Pill
            size="sm"
            tone={state === "active" ? "accent" : "neutral"}
            label={
              state === "paused"
                ? t("recurringStatusPaused")
                : t("recurringStatusActive")
            }
          />
        </Row>
      </Stack>

      <Stack alignItems="center" gap="$xs">
        <Stack testID="recurring-detail-amount">
          <Amount value={amountText} size="md" />
        </Stack>
        {secondaryAmount ? (
          <Text
            variant="caption"
            color="$colorMuted"
            testID="recurring-detail-amount-secondary"
          >
            {secondaryAmount}
          </Text>
        ) : null}
      </Stack>

      <Stack gap="$none">
        {order.note ? (
          <ListRow title={t("paymentNoteLabel")} value={order.note} />
        ) : null}
        {state === "active" ? (
          <ListRow
            title={t("recurringNextRun")}
            value={formatDate(order.schedule.nextDueAtSec)}
          />
        ) : null}
        {order.lastRunAtSec !== null ? (
          <ListRow
            title={t("recurringLastRun")}
            value={`${formatDate(order.lastRunAtSec)}${lastRun ? ` · ${lastRun}` : ""}`}
          />
        ) : null}
        <ListRow
          title={t("recurringRunsCount")}
          value={String(order.schedule.runCount)}
        />
        <ListRow
          title={t("recurringMintLabel")}
          value={formatMintHost(order.mintUrl)}
        />
      </Stack>

      <Stack gap="$sm">
        <Button
          variant="secondary"
          icon={state === "paused" ? "Play" : "Pause"}
          onPress={() =>
            void setRecurringPaymentPaused(order, state !== "paused")
          }
        >
          {state === "paused" ? t("recurringResume") : t("recurringPause")}
        </Button>
        <Button
          variant={deleteArmed ? "danger" : "secondary"}
          icon="Trash2"
          onPress={() => {
            void requestDeleteRecurringPayment(order).then((deleted) => {
              if (deleted) navigateTo({ route: "transactions" });
            });
          }}
        >
          {deleteArmed ? t("deleteArmedHint") : t("delete")}
        </Button>
      </Stack>
      {deleteArmed && order.rail === "cashu" ? (
        <Text variant="caption" color="$colorMuted">
          {t("recurringDeletePreparedStillSent")}
        </Text>
      ) : null}
      <Text variant="caption" color="$colorMuted">
        {t("recurringOnlyWhileOpen")}
      </Text>
    </Stack>
  );
}
