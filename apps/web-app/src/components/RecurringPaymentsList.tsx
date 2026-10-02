import {
  recurringAmountSat,
  recurringOrderState,
} from "@linky-fit/recurring-payment";
import {
  EmptyState,
  ListRow,
  opacity,
  Pill,
  Row,
  Stack,
  Text,
} from "@linky-fit/ui";
import type { FC } from "react";
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
import { describeRecurringInterval } from "../app/lib/recurringPaymentDisplay";
import { navigateTo } from "../hooks/useRouting";
import { normalizeLocale } from "../utils/formatting";
import { nowSeconds } from "../utils/time";
import { RecurringContactAvatar } from "./RecurringContactAvatar";

/** Every recurring payment with its interval pill, amount, and next due date. */
export const RecurringPaymentsList: FC = () => {
  const { mintBalanceSat } = useRecurringPaymentsContext();
  const { displayCurrency, fiatRates, formatDisplayedAmountParts, lang, t } =
    useAppShellCore();
  const orders = useRecurringPaymentOrders();
  const contacts = useRecurringContactSummaries();
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
  if (orders.length === 0) {
    return <EmptyState title={t("recurringEmpty")} />;
  }
  const nowSec = nowSeconds();

  return (
    <Stack gap="$xs">
      {orders.map((order) => {
        const state = recurringOrderState(order, nowSec);
        const amountSat = recurringAmountSat(order.amount, fiatRates);
        const underfunded =
          state === "active" &&
          amountSat !== null &&
          mintBalanceSat(order.mintUrl) < amountSat;
        const secondaryAmount = recurringAmountSecondaryText(
          order.amount,
          fiatRates,
          lang,
          t,
        );
        return (
          <Stack
            key={order.id}
            testID="recurring-order-card"
            opacity={state === "active" ? 1 : opacity.disabled}
          >
            <ListRow
              leading={
                <RecurringContactAvatar
                  contact={contacts.get(order.contactId)}
                />
              }
              title={recurringRecipientLabel(order, contacts)}
              description={
                <Row gap="$sm" flexWrap="wrap" alignItems="center">
                  <Text variant="caption" color="$colorMuted">
                    {state === "paused"
                      ? t("recurringStatusPaused")
                      : dateFormatter.format(
                          new Date(order.schedule.nextDueAtSec * 1000),
                        )}
                  </Text>
                  <Pill
                    size="sm"
                    tone="neutral"
                    label={describeRecurringInterval(
                      order.schedule.interval,
                      t,
                    )}
                  />
                  {underfunded ? (
                    <Text
                      variant="caption"
                      color="$warningText"
                      testID="recurring-underfunded-hint"
                    >
                      {t("recurringInsufficientFundsHint")}
                    </Text>
                  ) : null}
                </Row>
              }
              trailing={
                <Stack alignItems="flex-end" gap="$xxs">
                  <Text variant="label" bold color="$dangerText">
                    {formatRecurringAmountText(order.amount, {
                      displayCurrency,
                      fiatRates,
                      formatSat: formatDisplayedAmountParts,
                      lang,
                    })}
                  </Text>
                  {secondaryAmount ? (
                    <Text variant="caption" color="$colorMuted">
                      {secondaryAmount}
                    </Text>
                  ) : null}
                </Stack>
              }
              chevron={false}
              onPress={() =>
                navigateTo({ route: "recurringPayment", id: order.id })
              }
            />
          </Stack>
        );
      })}
    </Stack>
  );
};
