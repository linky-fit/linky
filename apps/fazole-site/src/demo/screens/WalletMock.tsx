import {
  Amount,
  Button,
  Card,
  IconButton,
  ListRow,
  Notice,
  Pressable,
  Row,
  Stack,
  TextField,
} from "@linky-fit/ui";
import { useState } from "react";
import type { ReactNode } from "react";
import { copy } from "../../copy";
import { DemoScreen, DemoSheet, DetailRows, Page } from "../chrome";
import { formatCrowns, formatWhole, satsToHalere } from "../money";
import { quoteWithdrawal, useDemo } from "../store";
import type { WithdrawalKind, WithdrawalQuote } from "../store";

const t = copy.demo;

/** Who is asked for cash unless the merchant names someone else, like the app's default. */
const DEFAULT_CASH_CONTACT = "hynek@linky.fit";

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

/** A typed amount of crowns, `null` when it is not a positive number. */
const parseCrowns = (text: string): number | null => {
  const normalized = text.replace(/\s/gu, "").replace(",", ".");
  const value = Number(normalized);
  return normalized !== "" && Number.isFinite(value) && value > 0
    ? value
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
function WithdrawSheet({
  czkPerBtc,
  onClose,
}: {
  czkPerBtc: number | null;
  onClose: () => void;
}) {
  const { balanceSats, withdraw } = useDemo();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [target, setTarget] = useState("");
  const [amountText, setAmountText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [insufficient, setInsufficient] = useState(false);
  const approx = (value: number) =>
    czkPerBtc === null
      ? null
      : t.approxCzk(formatCrowns(satsToHalere(value, czkPerBtc)));

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
        const typedApprox =
          amount === undefined || amount === null ? null : approx(amount);
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
                typedApprox === null
                  ? `${t.withdraw.amountWhole} · ${available}`
                  : `${typedApprox} · ${available}`
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
        const receives = approx(quote.amountSats);
        return (
          <Stack gap="$lg">
            <Card backgroundColor="$neutralSoft">
              <DetailRows
                details={[
                  { label: t.withdraw.to, value: shorten(quote.target) },
                  {
                    label: t.withdraw.receives,
                    value:
                      receives === null
                        ? sats(quote.amountSats)
                        : `${sats(quote.amountSats)} (${receives})`,
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

/** The app's cash sheet: a Linky contact and an amount, who then gets a request to exchange the bitcoin for cash. */
function CashSheet({
  czkPerBtc,
  onClose,
}: {
  czkPerBtc: number | null;
  onClose: () => void;
}) {
  const [contact, setContact] = useState(DEFAULT_CASH_CONTACT);
  const [amountText, setAmountText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [requested, setRequested] = useState(false);
  const amount = parseCrowns(amountText);
  const request = () => {
    setSubmitted(true);
    if (amount !== null && contact.trim() !== "") setRequested(true);
  };
  return (
    <DemoSheet open onClose={onClose} title={t.cash.title}>
      <Stack gap="$lg" paddingTop="$sm">
        {requested ? (
          <>
            <Notice tone="accent" title={t.cash.requested} />
            <Button onPress={onClose}>{t.done}</Button>
          </>
        ) : (
          <>
            {czkPerBtc === null ? (
              <Notice tone="warning" title={t.wallet.rateUnavailable} />
            ) : null}
            <TextField
              label={t.cash.contact}
              placeholder={t.cash.contactPlaceholder}
              value={contact}
              onChangeText={setContact}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              spellCheck={false}
            />
            <TextField
              label={t.cash.amount}
              value={amountText}
              onChangeText={setAmountText}
              inputMode="decimal"
              trailing={t.czk}
              error={
                submitted && amount === null ? t.cash.amountInvalid : undefined
              }
            />
            <Button icon="Banknote" onPress={request}>
              {t.cash.continue}
            </Button>
          </>
        )}
      </Stack>
    </DemoSheet>
  );
}

/** The wallet, like the app's: the balance in crowns (a tap shows sats), withdrawing, and cash from a contact. */
export function WalletMock({ tabBar }: { tabBar: ReactNode }) {
  const { balanceSats, czkPerBtc, rateFailed } = useDemo();
  const [sheet, setSheet] = useState<"withdraw" | "cash" | null>(null);
  // Starts in CZK on every visit, so a merchant never lands on sats unexpectedly.
  const [showSats, setShowSats] = useState(false);
  const czk = showSats ? null : czkPerBtc;
  const balance = (
    <Amount
      value={
        czk === null
          ? formatWhole(balanceSats)
          : formatWhole(Math.round(satsToHalere(balanceSats, czk) / 100))
      }
      unit={czk === null ? t.sat : t.czk}
      caption={rateFailed ? t.wallet.rateUnavailable : undefined}
    />
  );
  return (
    <DemoScreen
      tabBar={tabBar}
      overlay={
        sheet === "withdraw" ? (
          <WithdrawSheet czkPerBtc={czkPerBtc} onClose={() => setSheet(null)} />
        ) : sheet === "cash" ? (
          <CashSheet czkPerBtc={czkPerBtc} onClose={() => setSheet(null)} />
        ) : null
      }
    >
      <Page title={t.sections.wallet}>
        <Stack alignItems="center" paddingVertical="$xxl">
          {czkPerBtc === null ? (
            balance
          ) : (
            <Pressable
              tooltip={t.wallet.switchUnit}
              alignSelf="center"
              onPress={() => setShowSats((current) => !current)}
            >
              {balance}
            </Pressable>
          )}
        </Stack>
        <Button
          icon="ArrowUpRight"
          minHeight="$controlLg"
          disabled={balanceSats === 0}
          onPress={() => setSheet("withdraw")}
        >
          {t.wallet.withdraw}
        </Button>
        <Button
          variant="secondary"
          icon="Banknote"
          minHeight="$controlLg"
          onPress={() => setSheet("cash")}
        >
          {t.wallet.cash}
        </Button>
      </Page>
    </DemoScreen>
  );
}
