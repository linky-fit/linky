import {
  Amount,
  Button,
  Card,
  Icon,
  IconButton,
  Notice,
  Pill,
  QRCode,
  Row,
  SegmentedControl,
  Spinner,
  Stack,
  Text,
  TopBar,
} from "@linky-fit/ui";
import { useEffect, useState } from "react";
import { copy } from "../../copy";
import { bitcoinQrValue, prepareBitcoinLeg } from "../bitcoin";
import { DemoScreen, DetailRows, Page } from "../chrome";
import { czk } from "../labels";
import { formatCrowns, formatWhole, halereToSats } from "../money";
import { demoAccount, demoSpd } from "../qr";
import { useDemo } from "../store";
import type { DemoPayment } from "../store";

const t = copy.demo;

const COPIED_MS = 2_000;

export type Leg = "bank" | "bitcoin";

function BankLeg({ payment }: { payment: DemoPayment }) {
  return (
    <>
      <Stack alignItems="center" gap="$lg">
        <QRCode
          badge="Landmark"
          accessibilityLabel={t.payment.bankQr(czk(payment.amountHalere))}
          value={demoSpd(payment.amountHalere, payment.vs, t.shopName)}
        />
        <Amount
          value={formatCrowns(payment.amountHalere)}
          unit={t.czk}
          size="md"
        />
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

/** Asks for the payment's Bitcoin leg once the rate is known, until it has one. */
const useBitcoinLeg = (payment: DemoPayment) => {
  const { czkPerBtc, attachBitcoin } = useDemo();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const missing = payment.bitcoin === null;
  useEffect(() => {
    if (!missing || czkPerBtc === null) return;
    const controller = new AbortController();
    prepareBitcoinLeg(
      halereToSats(payment.amountHalere, czkPerBtc),
      payment.id,
      controller.signal,
    )
      .then((leg) => attachBitcoin(payment.id, leg))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [
    missing,
    czkPerBtc,
    payment.id,
    payment.amountHalere,
    attachBitcoin,
    attempt,
  ]);
  return {
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((count) => count + 1);
    },
  };
};

function Preparing() {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      gap="$md"
      minHeight="$device"
    >
      <Spinner size="lg" />
      <Text color="$colorMuted">{t.payment.preparing}</Text>
    </Stack>
  );
}

/** A real, payable Bitcoin QR code: a Lightning invoice and a Cashu request for the support account. */
function BitcoinLeg({ payment }: { payment: DemoPayment }) {
  const { czkPerBtc, rateFailed, refreshRate } = useDemo();
  const { failed, retry } = useBitcoinLeg(payment);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const leg = payment.bitcoin;

  if (leg === null && czkPerBtc === null) {
    return rateFailed ? (
      <Notice
        tone="danger"
        title={t.payment.rateUnavailable}
        description={t.payment.unavailableHint}
        action={{ label: t.payment.retry, onPress: refreshRate }}
      />
    ) : (
      <Preparing />
    );
  }
  if (failed) {
    return (
      <Notice
        tone="danger"
        title={t.payment.unavailable}
        description={t.payment.unavailableHint}
        action={{ label: t.payment.retry, onPress: retry }}
      />
    );
  }
  if (leg === null) return <Preparing />;

  const link = bitcoinQrValue(leg);
  return (
    <>
      <Stack alignItems="center">
        <QRCode
          accessibilityLabel={t.payment.bitcoinQr(czk(payment.amountHalere))}
          value={link}
        />
      </Stack>
      <Stack alignItems="center" gap="$md">
        <Amount
          value={formatCrowns(payment.amountHalere)}
          unit={t.czk}
          caption={t.satAmount(formatWhole(leg.sats))}
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
      </Stack>
    </>
  );
}

/** An open payment as the app shows it: the way to pay, its QR code and what the merchant can do. */
export function OpenPaymentView({
  payment,
  leg,
  onLegChange,
  onMarkPaid,
  onCancel,
  onClose,
}: {
  payment: DemoPayment;
  leg: Leg;
  onLegChange: (leg: Leg) => void;
  onMarkPaid: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  return (
    <DemoScreen>
      <TopBar
        title={t.payment.title}
        leading={
          <IconButton icon="X" accessibilityLabel={t.close} onPress={onClose} />
        }
      />
      <Page>
        <SegmentedControl
          accessibilityLabel={t.payment.method}
          value={leg}
          onValueChange={onLegChange}
          options={[
            { value: "bank", label: t.payment.bank },
            { value: "bitcoin", label: t.payment.bitcoin },
          ]}
        />
        {leg === "bank" ? (
          <BankLeg payment={payment} />
        ) : (
          <BitcoinLeg payment={payment} />
        )}
        <Stack gap="$sm">
          <Button icon="Check" minHeight="$controlLg" onPress={onMarkPaid}>
            {t.payment.markPaid}
          </Button>
          <Button variant="ghost" onPress={onCancel}>
            {t.payment.cancel}
          </Button>
        </Stack>
      </Page>
    </DemoScreen>
  );
}

/** The live payment: a bank QR, or a Bitcoin QR, both for real; the merchant confirms either, and the terminal takes over. */
export function PaymentMock({
  paymentId,
  onPaid,
  onClose,
}: {
  paymentId: string;
  onPaid: (payment: DemoPayment) => void;
  onClose: () => void;
}) {
  const { payments, settle, cancel } = useDemo();
  const payment = payments.find(({ id }) => id === paymentId);
  const [leg, setLeg] = useState<Leg>("bank");
  const pending = payment?.status === "pending";
  const paid = payment?.status === "paid";

  useEffect(() => {
    if (paid && payment) onPaid(payment);
  }, [paid, payment, onPaid]);

  if (!payment || !pending) return null;
  return (
    <OpenPaymentView
      payment={payment}
      leg={leg}
      onLegChange={setLeg}
      onMarkPaid={() =>
        settle(paymentId, { method: leg === "bank" ? "bank" : "lightning" })
      }
      onCancel={() => {
        cancel(paymentId);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
