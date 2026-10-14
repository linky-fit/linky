import {
  Amount,
  Button,
  Card,
  IconButton,
  ListRow,
  Notice,
  Row,
  Section,
  Stack,
  Text,
  TextField,
} from "@linky-fit/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { copy } from "../../copy";
import { DemoScreen, DemoSheet, DetailRows, Page } from "../chrome";
import { walletActivity } from "../labels";
import type { Activity } from "../labels";
import {
  formatCrowns,
  formatDateTime,
  formatWhole,
  satsToHalere,
} from "../money";
import { quoteWithdrawal, useDemo } from "../store";
import type { WithdrawalKind, WithdrawalQuote } from "../store";

const t = copy.demo;

/** What paste and the scanner fill in: the demo touches neither the clipboard nor the camera. */
const demoTargets: Record<WithdrawalKind, string> = {
  linky: "npub1q8demo0majitel0kavarna0linky",
  lightning: "kavarna@example.com",
};

const isTarget = (kind: WithdrawalKind, text: string) =>
  kind === "linky"
    ? /n(pub|profile)1[a-z0-9]+/u.test(text)
    : /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(text.trim());

/** A typed amount of whole sats; `undefined` when empty, `null` when not a positive integer. */
const parseSats = (text: string) => {
  const digits = text.replace(/\s/gu, "");
  if (digits === "") return undefined;
  return /^\d{1,15}$/u.test(digits) && Number(digits) > 0
    ? Number(digits)
    : null;
};

const shorten = (text: string) =>
  text.length > 24 ? `${text.slice(0, 14)}…${text.slice(-8)}` : text;

type Step =
  | { kind: "choose" }
  | { kind: "form"; choice: WithdrawalKind }
  | { kind: "review"; quote: WithdrawalQuote }
  | { kind: "done"; quote: WithdrawalQuote };

const choiceTitles: Record<WithdrawalKind, string> = {
  linky: t.withdraw.chooseLinky,
  lightning: t.withdraw.chooseLightning,
};

const sats = (value: number) => t.satAmount(formatWhole(value));

/** The app's withdraw sheet: Linky or Lightning, the recipient, a review of amount and fee, then send. */
function WithdrawSheet({ onClose }: { onClose: () => void }) {
  const { balanceSats, withdraw } = useDemo();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [target, setTarget] = useState("");
  const [amountText, setAmountText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [insufficient, setInsufficient] = useState(false);

  const toForm = (choice: WithdrawalKind) => {
    setInsufficient(false);
    setStep({ kind: "form", choice });
  };

  const body = () => {
    switch (step.kind) {
      case "choose":
        return (
          <Card backgroundColor="$neutralSoft" paddingVertical="$sm" gap="$xs">
            <ListRow
              icon="Send"
              title={t.withdraw.chooseLinky}
              description={t.withdraw.chooseLinkyDescription}
              onPress={() => toForm("linky")}
            />
            <ListRow
              icon="Zap"
              title={t.withdraw.chooseLightning}
              description={t.withdraw.chooseLightningDescription}
              onPress={() => toForm("lightning")}
            />
          </Card>
        );
      case "form": {
        const { choice } = step;
        const linky = choice === "linky";
        const amount = parseSats(amountText);
        const targetError =
          submitted && !isTarget(choice, target)
            ? linky
              ? t.withdraw.linkyRecipientInvalid
              : t.withdraw.lightningTargetInvalid
            : undefined;
        const available = t.withdraw.available(formatWhole(balanceSats));
        const review = () => {
          setSubmitted(true);
          if (!isTarget(choice, target) || amount === null) return;
          const quote = quoteWithdrawal(choice, target, balanceSats, amount);
          setInsufficient(quote === "insufficient");
          if (quote !== "insufficient") setStep({ kind: "review", quote });
        };
        const fillDemoTarget = () => setTarget(demoTargets[choice]);
        return (
          <Stack gap="$lg">
            <TextField
              label={
                linky ? t.withdraw.linkyRecipient : t.withdraw.lightningTarget
              }
              placeholder={
                linky
                  ? t.withdraw.linkyRecipientPlaceholder
                  : t.withdraw.lightningTargetPlaceholder
              }
              hint={linky ? t.withdraw.linkyRecipientHint : undefined}
              error={targetError}
              value={target}
              onChangeText={setTarget}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              spellCheck={false}
              trailing={
                <Row gap="$xs">
                  <IconButton
                    icon="ClipboardPaste"
                    size="sm"
                    accessibilityLabel={t.withdraw.paste}
                    onPress={fillDemoTarget}
                  />
                  <IconButton
                    icon="ScanLine"
                    size="sm"
                    accessibilityLabel={t.withdraw.scan}
                    onPress={fillDemoTarget}
                  />
                </Row>
              }
            />
            <TextField
              label={t.withdraw.amount}
              placeholder={formatWhole(balanceSats)}
              value={amountText}
              onChangeText={setAmountText}
              inputMode="numeric"
              trailing={t.sat}
              error={
                submitted && amount === null
                  ? t.withdraw.amountInvalid
                  : undefined
              }
              hint={
                amount === undefined || amount === null
                  ? `${t.withdraw.amountWhole} · ${available}`
                  : `${t.approxCzk(formatCrowns(satsToHalere(amount)))} · ${available}`
              }
            />
            <Stack gap="$sm">
              <Button onPress={review}>{t.withdraw.review}</Button>
              <Button
                variant="ghost"
                onPress={() => {
                  setSubmitted(false);
                  setStep({ kind: "choose" });
                }}
              >
                {t.back}
              </Button>
            </Stack>
          </Stack>
        );
      }
      case "review": {
        const { quote } = step;
        return (
          <Stack gap="$lg">
            <Card backgroundColor="$neutralSoft">
              <DetailRows
                details={[
                  { label: t.withdraw.to, value: shorten(quote.target) },
                  {
                    label: t.withdraw.receives,
                    value: `${sats(quote.amountSats)} (${t.approxCzk(
                      formatCrowns(satsToHalere(quote.amountSats)),
                    )})`,
                  },
                  { label: t.withdraw.fee, value: sats(quote.feeSats) },
                  { label: t.withdraw.total, value: sats(quote.totalSats) },
                ]}
              />
            </Card>
            <Stack gap="$sm">
              <Button
                icon={quote.kind === "linky" ? "Send" : "Zap"}
                onPress={() => {
                  withdraw(quote);
                  setStep({ kind: "done", quote });
                }}
              >
                {t.withdraw.submit}
              </Button>
              <Button variant="ghost" onPress={() => toForm(quote.kind)}>
                {t.back}
              </Button>
            </Stack>
          </Stack>
        );
      }
      case "done": {
        const { quote } = step;
        const amount = formatWhole(quote.amountSats);
        return (
          <Stack gap="$lg">
            <Notice
              tone="accent"
              title={t.withdraw.sentTitle}
              description={
                quote.kind === "linky"
                  ? t.withdraw.linkySentDetail(amount)
                  : t.withdraw.sentDetail(amount)
              }
            />
            <Button onPress={onClose}>{t.done}</Button>
          </Stack>
        );
      }
    }
  };

  return (
    <DemoSheet
      open
      onClose={onClose}
      title={
        step.kind === "form"
          ? choiceTitles[step.choice]
          : step.kind === "review"
            ? choiceTitles[step.quote.kind]
            : t.withdraw.title
      }
    >
      <Stack gap="$lg" paddingTop="$sm">
        {insufficient ? (
          <Notice tone="danger" title={t.withdraw.insufficient} />
        ) : null}
        {body()}
      </Stack>
    </DemoSheet>
  );
}

function ActivityRow({ item }: { item: Activity }) {
  const row = t.wallet.row(formatDateTime(item.at), item.label);
  const amount = formatWhole(item.sats);
  return (
    <ListRow
      icon={item.icon}
      title={
        item.direction === "in" ? t.wallet.in(amount) : t.wallet.out(amount)
      }
      description={
        item.feeSats > 0 ? t.wallet.rowFee(row, formatWhole(item.feeSats)) : row
      }
      chevron={false}
    />
  );
}

/** The wallet, like the app's: the balance, a withdraw button and what moved. */
export function WalletMock({ tabBar }: { tabBar: ReactNode }) {
  const { balanceSats, payments, withdrawals } = useDemo();
  const [withdrawing, setWithdrawing] = useState(false);
  return (
    <DemoScreen
      tabBar={tabBar}
      overlay={
        withdrawing ? (
          <WithdrawSheet onClose={() => setWithdrawing(false)} />
        ) : null
      }
    >
      <Page title={t.sections.wallet}>
        <Card alignItems="center" gap="$md" paddingVertical="$xxl">
          <Text variant="label" color="$colorMuted">
            {t.wallet.balance}
          </Text>
          <Amount
            value={formatWhole(balanceSats)}
            unit={t.sat}
            caption={t.approxCzk(formatCrowns(satsToHalere(balanceSats)))}
          />
        </Card>
        <Button
          icon="ArrowUpRight"
          minHeight="$controlLg"
          disabled={balanceSats === 0}
          onPress={() => setWithdrawing(true)}
        >
          {t.wallet.withdraw}
        </Button>
        <Section title={t.wallet.activity}>
          <Card paddingVertical="$sm" gap="$none">
            {walletActivity(payments, withdrawals).map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </Card>
        </Section>
      </Page>
    </DemoScreen>
  );
}
