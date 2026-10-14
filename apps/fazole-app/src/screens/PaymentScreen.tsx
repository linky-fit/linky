import {
  Amount,
  Button,
  Card,
  EmptyState,
  Icon,
  IconButton,
  Notice,
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
import { copy } from "../copy";
import {
  buildBitcoinPaymentUri,
  buildSpd,
  formatCzechIban,
  type Payment,
  type ShopProfile,
} from "../domain";
import { formatCzkValue, formatTime, formatWhole, shortNpub } from "../format";
import { copyText } from "../platform/clipboard";
import { navigateTo } from "../platform/hashRoute";
import type { BitcoinRequestFailure } from "../services/bitcoinPayments";
import { useAppServices, usePayerProfile, usePayment } from "../services/react";
import { DetailRows } from "./DetailRows";
import { Page, WithTopBar } from "./Page";
import { statusTones } from "./paymentLabels";

const toTerminal = () => navigateTo("terminal");

/** How long the paid confirmation stays before the terminal returns. */
const PAID_DISMISS_MS = 3_000;
const COPIED_MS = 2_000;

type Leg = "bank" | "bitcoin";

/** The customer-facing payment: an SPD QR for the bank, a BIP-321 QR for Lightning and Cashu. */
export function PaymentScreen({
  paymentId,
  shop,
}: {
  readonly paymentId: string;
  readonly shop: ShopProfile;
}) {
  const payment = usePayment(paymentId);
  return (
    <WithTopBar
      topBar={
        <TopBar
          title={copy.payment.title}
          leading={
            <IconButton
              testID="payment-close"
              icon="X"
              accessibilityLabel={copy.close}
              onPress={toTerminal}
            />
          }
        />
      }
    >
      {payment === undefined ? null : payment === null ? (
        <Page centered>
          <EmptyState
            icon="CircleAlert"
            title={copy.payment.notFound}
            description={copy.payment.notFoundDescription}
            action={
              <Button onPress={toTerminal}>
                {copy.payment.backToTerminal}
              </Button>
            }
          />
        </Page>
      ) : (
        <PaymentBody payment={payment} shop={shop} />
      )}
    </WithTopBar>
  );
}

function PaymentBody({
  payment,
  shop,
}: {
  readonly payment: Payment;
  readonly shop: ShopProfile;
}) {
  // The confirmation celebrates a payment that settles while it is on screen.
  const [openedSettled] = useState(payment.status !== "pending");
  const celebrating = payment.status === "paid" && !openedSettled;
  const payer = usePayerProfile(payment.payerPubkey);
  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(toTerminal, PAID_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [celebrating]);

  if (celebrating) {
    return (
      <Page>
        <SuccessOverlay
          title={copy.payment.paidTitle}
          amount={formatCzkValue(payment.amountCzk)}
          unit={copy.czk}
          direction="in"
          avatar={
            payment.payerPubkey === null
              ? undefined
              : {
                  // The overlay prints the name under the avatar and takes its initials from it.
                  name: payer?.name ?? shortNpub(payment.payerPubkey),
                  uri: payer?.picture ?? undefined,
                }
          }
          detail={copy.payment.paidDetail(
            payment.method === null ? "" : copy.methods[payment.method],
            formatTime(payment.paidAtSec ?? payment.createdAtSec),
          )}
          onDismiss={toTerminal}
        />
      </Page>
    );
  }
  return payment.status === "pending" ? (
    <OpenPayment payment={payment} shop={shop} />
  ) : (
    <SettledPayment payment={payment} />
  );
}

function OpenPayment({
  payment,
  shop,
}: {
  readonly payment: Payment;
  readonly shop: ShopProfile;
}) {
  const { payments } = useAppServices();
  // A shop without a bank account, or a payment reopened with its Bitcoin leg, opens on Bitcoin.
  const [leg, setLeg] = useState<Leg>(() =>
    shop.iban !== null && payment.bitcoin === null ? "bank" : "bitcoin",
  );
  const cancel = async () => {
    await payments.cancel(payment.id);
    toTerminal();
  };
  return (
    <Page testID="payment-screen">
      <SegmentedControl
        accessibilityLabel={copy.payment.method}
        value={leg}
        onValueChange={setLeg}
        options={[
          { value: "bank", label: copy.payment.bank },
          { value: "bitcoin", label: copy.payment.bitcoin },
        ]}
      />
      {leg === "bank" ? (
        <BankLeg payment={payment} shop={shop} />
      ) : (
        <BitcoinLeg payment={payment} shop={shop} />
      )}
      <Stack gap="$sm">
        {leg === "bank" && shop.iban !== null ? (
          <Button
            testID="payment-mark-paid"
            icon="Check"
            minHeight="$controlLg"
            onPress={() => void payments.markPaid(payment.id)}
          >
            {copy.payment.markPaid}
          </Button>
        ) : null}
        <Button
          testID="payment-cancel"
          variant="ghost"
          onPress={() => void cancel()}
        >
          {copy.payment.cancel}
        </Button>
      </Stack>
    </Page>
  );
}

function BankLeg({
  payment,
  shop,
}: {
  readonly payment: Payment;
  readonly shop: ShopProfile;
}) {
  const amount = formatCzkValue(payment.amountCzk);
  if (shop.iban === null) {
    return (
      <Stack gap="$lg">
        <Amount value={amount} unit={copy.czk} size="md" />
        <Notice
          tone="accent"
          icon="Landmark"
          title={copy.payment.noAccountTitle}
          description={copy.payment.noAccountDescription}
          action={{
            label: copy.payment.openSettings,
            onPress: () => navigateTo("settings"),
          }}
        />
      </Stack>
    );
  }
  return (
    <>
      <Stack alignItems="center" gap="$lg">
        <QRCode
          testID="payment-bank-qr"
          badge="Landmark"
          accessibilityLabel={copy.payment.bankQr(copy.czkAmount(amount))}
          value={buildSpd({
            iban: shop.iban,
            amount: payment.amountCzk,
            variableSymbol: payment.vs,
            message: shop.name,
          })}
        />
        <Amount value={amount} unit={copy.czk} size="md" />
      </Stack>
      <Card>
        <DetailRows
          details={[
            { label: copy.payment.vs, value: payment.vs },
            { label: copy.payment.account, value: formatCzechIban(shop.iban) },
            { label: copy.payment.recipient, value: shop.name },
          ]}
        />
      </Card>
    </>
  );
}

const failureTitles = {
  "rate-unavailable": copy.payment.rateUnavailable,
  "mint-unreachable": copy.payment.mintUnreachable,
} as const;

/** Asks for the payment's Bitcoin leg while it has no live one, e.g. after its Lightning quote expired. */
const useBitcoinRequest = (payment: Payment) => {
  const { payments } = useAppServices();
  const [failure, setFailure] = useState<BitcoinRequestFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const missing = payment.bitcoin?.quoteId == null;
  useEffect(() => {
    if (!missing) return;
    let current = true;
    void payments.requestBitcoin(payment.id).then((result) => {
      if (current) setFailure(result);
    });
    return () => {
      current = false;
    };
  }, [payments, missing, attempt, payment.id]);
  return {
    failure: missing ? failure : null,
    retry: () => {
      setFailure(null);
      setAttempt((count) => count + 1);
    },
  };
};

function BitcoinLeg({
  payment,
  shop,
}: {
  readonly payment: Payment;
  readonly shop: ShopProfile;
}) {
  const { failure, retry } = useBitcoinRequest(payment);
  const [lightningOnly, setLightningOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const amount = formatCzkValue(payment.amountCzk);
  const leg = payment.bitcoin;

  if (failure?.reason === "below-minimum") {
    return (
      <Notice
        title={copy.payment.minimum(
          copy.czkAmount(formatCzkValue(failure.minimumCzk)),
        )}
        description={copy.payment.minimumHint}
      />
    );
  }
  if (failure) {
    return (
      <Notice
        tone="danger"
        title={failureTitles[failure.reason]}
        description={copy.payment.unavailableHint}
        action={{ label: copy.retry, onPress: retry }}
      />
    );
  }
  if (leg === null || leg.invoice === null) {
    return (
      <Stack
        alignItems="center"
        justifyContent="center"
        gap="$md"
        minHeight="$device"
        testID="payment-bitcoin-preparing"
      >
        <Spinner size="lg" />
        <Text color="$colorMuted">{copy.payment.preparing}</Text>
      </Stack>
    );
  }
  const { invoice } = leg;
  const uri = buildBitcoinPaymentUri(invoice, leg.paymentRequest);
  const sats = copy.satAmount(formatWhole(leg.sats));
  const copyLink = async () => {
    if (await copyText(lightningOnly ? invoice : uri)) setCopied(true);
  };
  return (
    <>
      <QRCode
        testID="payment-bitcoin-qr"
        accessibilityLabel={copy.payment.bitcoinQr(copy.czkAmount(amount))}
        // Uppercase fits QR's alphanumeric mode, a coarser code for weak cameras.
        value={lightningOnly ? invoice.toUpperCase() : uri}
      />
      <SegmentedControl
        accessibilityLabel={copy.payment.qrKind}
        value={lightningOnly ? "lightning" : "combined"}
        onValueChange={(kind) => setLightningOnly(kind === "lightning")}
        options={[
          { value: "combined", label: copy.payment.qrCombined },
          { value: "lightning", label: copy.payment.qrLightning },
        ]}
      />
      <Stack alignItems="center" gap="$md">
        <Amount value={amount} unit={copy.czk} caption={sats} size="md" />
        <Row justifyContent="center" flexWrap="wrap" gap="$sm">
          {copied ? (
            <Pill
              label={copy.payment.copied}
              leading={<Icon name="Check" size="sm" color="$accentText" />}
            />
          ) : (
            <Pill
              testID="payment-waiting"
              tone="warning"
              label={copy.payment.waiting}
              leading={<Spinner color="$warningText" />}
            />
          )}
          <Button
            testID="payment-copy"
            size="sm"
            variant="ghost"
            icon="Copy"
            onPress={() => void copyLink()}
          >
            {copy.payment.copyLink}
          </Button>
        </Row>
      </Stack>
      <Card>
        <DetailRows
          details={[
            { label: copy.payment.sats, value: sats },
            {
              label: copy.payment.rate,
              value: copy.payment.rateValue(formatWhole(leg.czkPerBtc)),
            },
            { label: copy.payment.recipient, value: shop.name },
          ]}
        />
        <Text variant="caption" color="$colorMuted">
          {copy.payment.bitcoinHint}
        </Text>
      </Card>
    </>
  );
}

function SettledPayment({ payment }: { readonly payment: Payment }) {
  return (
    <Page testID="payment-settled">
      <Stack alignItems="center" gap="$md" paddingVertical="$xl">
        <Amount value={formatCzkValue(payment.amountCzk)} unit={copy.czk} />
        <Pill
          tone={statusTones[payment.status]}
          label={copy.statuses[payment.status]}
        />
      </Stack>
      <Notice title={copy.payment.closed} />
      <Button variant="secondary" onPress={toTerminal}>
        {copy.payment.backToTerminal}
      </Button>
    </Page>
  );
}
