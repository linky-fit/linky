import {
  Amount,
  Button,
  Card,
  Icon,
  IconButton,
  Pill,
  QRCode,
  Row,
  SegmentedControl,
  Spinner,
  Stack,
  SuccessOverlay,
  Text,
  TopBar,
} from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../../copy";
import { DemoScreen, DetailRows, Page } from "../chrome";
import { czk } from "../labels";
import {
  DEMO_CZK_PER_BTC,
  formatCrowns,
  formatTime,
  formatWhole,
  halereToSats,
} from "../money";
import { demoAccount, demoBip321, demoInvoice, demoSpd } from "../qr";
import { livePayer, useDemo } from "../store";
import type { DemoPayment } from "../store";

const t = copy.demo;

/** How long the demo waits before a Bitcoin payment "arrives". */
export const BITCOIN_ARRIVES_AFTER_MS = 4_500;
/** How long the paid confirmation stays before the terminal returns, like the app's. */
const PAID_DISMISS_MS = 3_000;
const COPIED_MS = 2_000;

type Leg = "bank" | "bitcoin";

function DemoDataPill() {
  return (
    <Row justifyContent="center">
      <Pill
        size="sm"
        tone="warning"
        label={t.demoData}
        leading={<Icon name="TriangleAlert" size="sm" color="$warningText" />}
      />
    </Row>
  );
}

function BankLeg({ payment }: { payment: DemoPayment }) {
  return (
    <>
      <Stack alignItems="center" gap="$lg">
        <QRCode
          badge="Landmark"
          accessibilityLabel={t.payment.bankQr(czk(payment.amountHalere))}
          value={demoSpd(payment.amountHalere, payment.vs)}
        />
        <Amount
          value={formatCrowns(payment.amountHalere)}
          unit={t.czk}
          size="md"
        />
        <DemoDataPill />
      </Stack>
      <Card>
        <DetailRows
          details={[
            { label: t.payment.vs, value: payment.vs },
            { label: t.payment.account, value: demoAccount.display },
            { label: t.payment.recipient, value: t.shopName },
          ]}
        />
      </Card>
    </>
  );
}

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

function BitcoinLeg({
  payment,
  lightningOnly,
  onLightningOnlyChange,
}: {
  payment: DemoPayment;
  lightningOnly: boolean;
  onLightningOnlyChange: (lightningOnly: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const satsValue = halereToSats(payment.amountHalere);
  const sats = t.satAmount(formatWhole(satsValue));
  const invoice = demoInvoice(satsValue);
  const link = lightningOnly ? invoice : demoBip321(satsValue);
  return (
    <>
      <Stack alignItems="center">
        <QRCode
          accessibilityLabel={t.payment.bitcoinQr(czk(payment.amountHalere))}
          // Uppercase fits QR's alphanumeric mode, like the app's.
          value={lightningOnly ? invoice.toUpperCase() : link}
        />
      </Stack>
      <SegmentedControl
        accessibilityLabel={t.payment.qrKind}
        value={lightningOnly ? "lightning" : "combined"}
        onValueChange={(kind) => onLightningOnlyChange(kind === "lightning")}
        options={[
          { value: "combined", label: t.payment.qrCombined },
          { value: "lightning", label: t.payment.qrLightning },
        ]}
      />
      <Stack alignItems="center" gap="$md">
        <Amount
          value={formatCrowns(payment.amountHalere)}
          unit={t.czk}
          caption={sats}
          size="md"
        />
        <Row justifyContent="center" flexWrap="wrap" gap="$sm">
          {copied ? (
            <Pill
              label={t.payment.copied}
              leading={<Icon name="Check" size="sm" color="$accentText" />}
            />
          ) : (
            <Pill
              tone="warning"
              label={t.payment.waiting}
              leading={<Spinner color="$warningText" />}
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            icon="Copy"
            onPress={async () => setCopied(await copyToClipboard(link))}
          >
            {t.payment.copyLink}
          </Button>
        </Row>
        <Text variant="caption" color="$accentText" textAlign="center">
          {t.payment.autoPay}
        </Text>
        <DemoDataPill />
      </Stack>
      <Card>
        <DetailRows
          details={[
            { label: t.payment.sats, value: sats },
            {
              label: t.payment.rate,
              value: t.payment.rateValue(formatWhole(DEMO_CZK_PER_BTC)),
            },
            { label: t.payment.recipient, value: t.shopName },
          ]}
        />
        <Text variant="caption" color="$colorMuted">
          {t.payment.bitcoinHint}
        </Text>
      </Card>
    </>
  );
}

/** The customer-facing payment, like the app's: a bank QR, or a Bitcoin QR that the demo pays by itself. */
export function PaymentMock({
  paymentId,
  onDone,
}: {
  paymentId: string;
  onDone: () => void;
}) {
  const { payments, settle, cancel } = useDemo();
  const payment = payments.find(({ id }) => id === paymentId);
  const [leg, setLeg] = useState<Leg>("bank");
  const [lightningOnly, setLightningOnly] = useState(false);
  const pending = payment?.status === "pending";
  const paid = payment?.status === "paid";

  useEffect(() => {
    if (leg !== "bitcoin" || !pending) return;
    const timer = setTimeout(
      () =>
        settle(
          paymentId,
          lightningOnly
            ? { method: "lightning" }
            : { method: "cashu", payer: livePayer },
        ),
      BITCOIN_ARRIVES_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [leg, lightningOnly, pending, paymentId, settle]);

  useEffect(() => {
    if (!paid) return;
    const timer = setTimeout(onDone, PAID_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [paid, onDone]);

  if (!payment) return null;
  return (
    <DemoScreen
      overlay={
        payment.status === "paid" ? (
          <SuccessOverlay
            contained
            title={t.payment.paidTitle}
            amount={formatCrowns(payment.amountHalere)}
            unit={t.czk}
            direction="in"
            avatar={payment.payer ?? undefined}
            detail={t.payment.paidDetail(
              payment.method === null ? "" : t.methods[payment.method],
              formatTime(payment.paidAt ?? payment.createdAt),
            )}
            onDismiss={onDone}
          />
        ) : null
      }
    >
      <TopBar
        title={t.payment.title}
        leading={
          <IconButton icon="X" accessibilityLabel={t.close} onPress={onDone} />
        }
      />
      <Page>
        <SegmentedControl
          accessibilityLabel={t.payment.method}
          value={leg}
          onValueChange={setLeg}
          options={[
            { value: "bank", label: t.payment.bank },
            { value: "bitcoin", label: t.payment.bitcoin },
          ]}
        />
        {leg === "bank" ? (
          <BankLeg payment={payment} />
        ) : (
          <BitcoinLeg
            payment={payment}
            lightningOnly={lightningOnly}
            onLightningOnlyChange={setLightningOnly}
          />
        )}
        {pending ? (
          <Stack gap="$sm">
            {leg === "bank" ? (
              <Button
                icon="Check"
                minHeight="$controlLg"
                onPress={() => settle(paymentId, { method: "bank" })}
              >
                {t.payment.markPaid}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onPress={() => {
                cancel(paymentId);
                onDone();
              }}
            >
              {t.payment.cancel}
            </Button>
          </Stack>
        ) : null}
      </Page>
    </DemoScreen>
  );
}
