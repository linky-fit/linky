import type { ContactId, RecurringPaymentId } from "@linky-fit/linksync";
import {
  SUPPORTER_TIER_AMOUNTS,
  SUPPORTER_TIERS,
  supporterTierForAmount,
  type SupporterTier,
} from "@linky-fit/supporter";
import {
  Button,
  ListRow,
  Notice,
  Section,
  Stack,
  SupporterBadge,
  Switch,
  Text,
  TextField,
} from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRecurringPaymentsContext } from "../app/context/RecurringPaymentsContext";
import { useSupporterContext } from "../app/context/SupporterContext";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import { useRecurringPaymentOrders } from "../app/hooks/payments/useRecurringPaymentOrders";
import { useSupporterAwardRecords } from "../app/hooks/useLinksync";
import {
  supporterRecurringPayment,
  SUPPORTER_TIER_LABEL_KEYS,
  supporterPaymentMints,
  supporterThemesFor,
} from "../app/lib/supporter";
import { SupporterBadgeDisplayOptions } from "../components/SupporterBadgeDisplayOptions";
import { reportAppLog } from "../devtools/inspector/appLog";
import { navigateTo } from "../hooks/useRouting";
import { formatInteger } from "../utils/formatting";
import { formatMintHost } from "../utils/mint";
import { nowSeconds } from "../utils/time";

const readAmountSat = (text: string): number => {
  const amount = Number.parseInt(text, 10);
  return amount > 0 ? amount : 0;
};

interface SupporterDonatePageProps {
  /** Linky Bot's contact, which receives the payment. */
  contactId: ContactId;
}

/**
 * Pays Linky Bot once or monthly, always on Cashu from one accepted mint.
 * It never moves funds between mints: without a mint that covers the amount
 * it points to the mints screen.
 */
export function SupporterDonatePage({
  contactId,
}: SupporterDonatePageProps): React.ReactElement {
  const { cashuIsBusy, lang, t } = useAppShellCore();
  const { allowTestMints } = useMintSettingsContext();
  const { createRecurringPayment, payNow } = useRecurringPaymentsContext();
  const { mintBalances, payContactFromMint } = useSupporterContext();
  const hasAwards = useSupporterAwardRecords().length > 0;
  const runningOrder = supporterRecurringPayment(
    useRecurringPaymentOrders(),
    contactId,
  );

  const [amountText, setAmountText] = React.useState(
    String(SUPPORTER_TIER_AMOUNTS.bronze),
  );
  const [pickedMint, setPickedMint] = React.useState<string | null>(null);
  const [monthly, setMonthly] = React.useState(true);
  const [isPaying, setIsPaying] = React.useState(false);
  const [donated, setDonated] = React.useState(false);
  const [createdOrderId, setCreatedOrderId] =
    React.useState<RecurringPaymentId | null>(null);
  const monthlyOrderId = createdOrderId ?? runningOrder?.id ?? null;
  const blockedByMonthly = monthly && monthlyOrderId !== null;

  const amountSat = readAmountSat(amountText);
  const tier = supporterTierForAmount(amountSat);
  const mints = supporterPaymentMints(mintBalances, amountSat, allowTestMints);
  const mint =
    mints.find((candidate) => candidate.mint === pickedMint)?.mint ??
    mints[0]?.mint ??
    null;
  const formatSat = (amount: number) => `${formatInteger(amount, lang)} sat`;
  const tierLabel = (value: SupporterTier) =>
    t(SUPPORTER_TIER_LABEL_KEYS[value]);

  /** The order alone sets the donation up: the scheduler retries a first run `payNow` could not pay. */
  const payMonthly = async (fromMint: string): Promise<void> => {
    const id = await createRecurringPayment({
      amount: { amount: amountSat, unit: "sat" },
      contactId,
      firstDueAtSec: nowSeconds(),
      interval: { unit: "month", count: 1 },
      mintUrl: fromMint,
      note: null,
    });
    if (id === null) return;
    setCreatedOrderId(id);
    await payNow(id);
  };

  const donate = async (): Promise<void> => {
    if (mint === null || amountSat <= 0 || blockedByMonthly) return;
    reportAppLog({
      tag: "supporter.donateStarted",
      summary: `${monthly ? "monthly" : "single"} donation of ${amountSat} sat started`,
      links: { contact: contactId },
      payload: { amountSat, mint, monthly, tier },
    });
    setIsPaying(true);
    try {
      if (monthly) await payMonthly(mint);
      else if (await payContactFromMint({ amountSat, contactId, mint }))
        setDonated(true);
    } finally {
      setIsPaying(false);
    }
  };

  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{t("donateIntro")}</Text>

      <Section title={t("donateTiers")}>
        {SUPPORTER_TIERS.map((option) => (
          <ListRow
            key={option}
            leading={<SupporterBadge kind={option} />}
            title={tierLabel(option)}
            description={t("donateTierPerks").replace(
              "{themes}",
              supporterThemesFor(option).map(tierLabel).join(", "),
            )}
            value={formatSat(SUPPORTER_TIER_AMOUNTS[option])}
            selected={amountSat === SUPPORTER_TIER_AMOUNTS[option]}
            chevron={false}
            onPress={() =>
              setAmountText(String(SUPPORTER_TIER_AMOUNTS[option]))
            }
          />
        ))}
      </Section>

      <TextField
        label={t("donateCustomAmount")}
        inputMode="numeric"
        value={amountText}
        onChangeText={(text) => setAmountText(text.replace(/\D/g, ""))}
        trailing="sat"
        hint={
          tier === null
            ? t("donateBelowBronze")
            : t("donateReachesTier").replace("{tier}", tierLabel(tier))
        }
      />

      <Section title={t("donateMint")}>
        {mints.length === 0 ? (
          <Notice
            tone="warning"
            title={t("donateNoMint")}
            action={{
              label: t("mints"),
              onPress: () => navigateTo({ route: "mints" }),
            }}
          />
        ) : (
          mints.map((candidate) => (
            <ListRow
              key={candidate.mint}
              icon="Landmark"
              title={formatMintHost(candidate.mint)}
              value={formatSat(candidate.amount)}
              selected={candidate.mint === mint}
              chevron={false}
              onPress={() => setPickedMint(candidate.mint)}
            />
          ))
        )}
      </Section>

      <ListRow
        icon="Repeat"
        title={t("donateMonthly")}
        description={t("donateMonthlyHint")}
        trailing={
          <Switch
            accessibilityLabel={t("donateMonthly")}
            value={monthly}
            onValueChange={setMonthly}
          />
        }
      />
      {monthly && monthlyOrderId !== null ? (
        <Notice
          tone="accent"
          title={t(
            createdOrderId === null
              ? "donateMonthlyRunning"
              : "donateMonthlySetUp",
          )}
          action={{
            label: t("donateShowMonthly"),
            onPress: () =>
              navigateTo({ route: "recurringPayment", id: monthlyOrderId }),
          }}
        />
      ) : monthly ? (
        <Text variant="caption" color="$colorMuted">
          {t("recurringOnlyWhileOpen")}
        </Text>
      ) : null}

      <Button
        icon="HeartHandshake"
        loading={isPaying}
        disabled={
          mint === null ||
          amountSat <= 0 ||
          blockedByMonthly ||
          cashuIsBusy ||
          isPaying
        }
        onPress={() => void donate()}
      >
        {monthly ? t("donateConfirmMonthly") : t("donateConfirmOnce")}
      </Button>

      {donated ? <Notice tone="accent" title={t("donateThanks")} /> : null}

      {donated || createdOrderId !== null || hasAwards ? (
        <Section title={t("supporterBadgeDisplay")}>
          <SupporterBadgeDisplayOptions />
        </Section>
      ) : null}
    </Stack>
  );
}
