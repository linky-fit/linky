import { Button, Card, Notice, Sheet, Stack, TextField } from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy";
import {
  exchangeRequestMessage,
  pledgeRepaidCzk,
  satsToCzk,
  type CzkAmount,
  type Pledge,
} from "../domain";
import { formatCzk } from "../format";
import type { ResolvedContact } from "../services/contacts";
import {
  useAppServices,
  usePayerProfile,
  usePledgerName,
  useWithdrawals,
} from "../services/react";
import { readCashForm } from "./cashForm";
import { ContactField } from "./ContactField";
import { useContactLookup } from "./contactState";
import { DetailRows } from "./DetailRows";

/** Who is asked unless the merchant names someone else. */
export const DEFAULT_CASH_CONTACT = "hynek@linky.fit";

type Step =
  | { readonly kind: "form" }
  /** The wallet does not hold the amount: the contact can hand it over as a pledge. */
  | {
      readonly kind: "offer";
      readonly contact: ResolvedContact;
      readonly amountCzk: CzkAmount;
    }
  | { readonly kind: "requested" }
  | { readonly kind: "pledged"; readonly pledge: Pledge };

/**
 * Cash from a Linky contact: name them and an amount. When the wallet is
 * worth that much, they get a request to exchange it for cash. When it is
 * not, the amount can be taken as a pledge instead: they hand the cash
 * over and every bitcoin payment goes to them until it is repaid. With a
 * pledge open, shows how it stands.
 */
export function CashSheet({
  open,
  onOpenChange,
  shopName,
  sats,
  czkPerBtc,
  current,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly shopName: string | null;
  /** The wallet's sats. */
  readonly sats: number;
  readonly czkPerBtc: number | null;
  /** The open pledge and what is still owed; `null` while there is none. */
  readonly current: {
    readonly pledge: Pledge;
    readonly remainingCzk: CzkAmount;
  } | null;
}) {
  const { cashRequests, pledges } = useAppServices();
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [contactText, setContactText] = useState(DEFAULT_CASH_CONTACT);
  const [amountText, setAmountText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"request" | "pledge" | null>(null);
  // Looked up only while open: the sheet sits closed in the wallet with its default filled in.
  const contactState = useContactLookup(open ? contactText : "");
  const availableCzk = czkPerBtc === null ? null : satsToCzk(sats, czkPerBtc);

  const close = () => {
    onOpenChange(false);
    setStep({ kind: "form" });
    setContactText(DEFAULT_CASH_CONTACT);
    setAmountText("");
    setSubmitted(false);
    setFailed(null);
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setFailed(null);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  const body = () => {
    if (current !== null && step.kind !== "pledged") {
      return <PledgeStatus {...current} onClose={close} />;
    }
    switch (step.kind) {
      case "form": {
        const form = readCashForm(contactState, amountText, submitted);
        const proceed = () =>
          run(async () => {
            setSubmitted(true);
            const { contact, amountCzk } = form;
            if (contact === null || amountCzk === null || availableCzk === null)
              return;
            if (availableCzk < amountCzk) {
              setStep({ kind: "offer", contact, amountCzk });
              return;
            }
            try {
              await cashRequests.send(
                contact.pubkey,
                exchangeRequestMessage(shopName, amountCzk),
              );
              setStep({ kind: "requested" });
            } catch (error) {
              console.warn("[fazole] exchange request not sent", error);
              setFailed("request");
            }
          });
        return (
          <Stack gap="$lg" testID="cash-form">
            {failed === "request" ? (
              <Notice tone="danger" title={copy.cash.requestFailed} />
            ) : availableCzk === null ? (
              <Notice tone="warning" title={copy.wallet.rateUnavailable} />
            ) : null}
            <ContactField
              testID="cash-contact"
              value={contactText}
              onChangeText={setContactText}
              state={contactState}
              error={form.contactError}
            />
            <TextField
              testID="cash-amount"
              label={copy.cash.amount}
              placeholder="100"
              value={amountText}
              onChangeText={setAmountText}
              inputMode="decimal"
              trailing={copy.czk}
              error={form.amountError}
            />
            <Button
              testID="cash-continue"
              loading={busy}
              disabled={
                contactState.kind === "resolving" || availableCzk === null
              }
              onPress={() => void proceed()}
            >
              {copy.cash.continue}
            </Button>
          </Stack>
        );
      }
      case "offer": {
        const { contact, amountCzk } = step;
        const create = () =>
          run(async () => {
            try {
              const pledge = await pledges.open(contact, amountCzk);
              setStep({ kind: "pledged", pledge });
            } catch (error) {
              console.warn("[fazole] pledge not opened", error);
              setFailed("pledge");
            }
          });
        return (
          <PledgeOffer
            contact={contact}
            amountCzk={amountCzk}
            availableCzk={availableCzk ?? undefined}
            busy={busy}
            failed={failed === "pledge"}
            onCreate={() => void create()}
            onBack={() => {
              setFailed(null);
              setStep({ kind: "form" });
            }}
          />
        );
      }
      case "requested":
        return (
          <Stack gap="$lg" testID="cash-requested">
            <Notice tone="accent" title={copy.cash.requested} />
            <Button testID="cash-close" onPress={close}>
              {copy.done}
            </Button>
          </Stack>
        );
      case "pledged":
        return <PledgeOpened pledge={step.pledge} onClose={close} />;
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={
        current !== null || step.kind !== "form"
          ? copy.pledge.title
          : copy.cash.title
      }
    >
      <Stack gap="$lg" paddingTop="$sm" testID="cash-sheet">
        {body()}
      </Stack>
    </Sheet>
  );
}

function PledgeOffer({
  contact,
  amountCzk,
  availableCzk,
  busy,
  failed,
  onCreate,
  onBack,
}: {
  readonly contact: ResolvedContact;
  readonly amountCzk: CzkAmount;
  readonly availableCzk: CzkAmount | undefined;
  readonly busy: boolean;
  readonly failed: boolean;
  readonly onCreate: () => void;
  readonly onBack: () => void;
}) {
  const name =
    usePayerProfile(contact.pubkey)?.name ?? contact.address ?? contact.pubkey;
  return (
    <Stack gap="$lg" testID="cash-offer">
      {failed ? <Notice tone="danger" title={copy.pledge.failed} /> : null}
      <Notice
        tone="info"
        icon="HandCoins"
        title={copy.cash.offerTitle(formatCzk(amountCzk), name)}
        description={copy.cash.offerDetail(
          name,
          availableCzk === undefined ? null : formatCzk(availableCzk),
        )}
      />
      <Stack gap="$sm">
        <Button
          testID="cash-create-pledge"
          icon="HandCoins"
          loading={busy}
          onPress={onCreate}
        >
          {copy.cash.createPledge}
        </Button>
        <Button variant="ghost" disabled={busy} onPress={onBack}>
          {copy.back}
        </Button>
      </Stack>
    </Stack>
  );
}

function PledgeOpened({
  pledge,
  onClose,
}: {
  readonly pledge: Pledge;
  readonly onClose: () => void;
}) {
  const name = usePledgerName(pledge);
  return (
    <Stack gap="$lg" testID="pledge-done">
      <Notice
        tone="accent"
        title={copy.pledge.openedTitle(formatCzk(pledge.amountCzk), name)}
        description={copy.pledge.openedDetail}
      />
      <Button testID="pledge-close" onPress={onClose}>
        {copy.done}
      </Button>
    </Stack>
  );
}

function PledgeStatus({
  pledge,
  remainingCzk,
  onClose,
}: {
  readonly pledge: Pledge;
  readonly remainingCzk: CzkAmount;
  readonly onClose: () => void;
}) {
  const name = usePledgerName(pledge);
  const repaid = pledgeRepaidCzk(pledge, useWithdrawals());
  return (
    <Stack gap="$lg" testID="pledge-status">
      <Card backgroundColor="$neutralSoft">
        <DetailRows
          details={[
            { label: copy.pledge.to, value: name },
            { label: copy.pledge.taken, value: formatCzk(pledge.amountCzk) },
            { label: copy.pledge.repaid, value: formatCzk(repaid) },
            { label: copy.pledge.remaining, value: formatCzk(remainingCzk) },
          ]}
        />
      </Card>
      {remainingCzk === 0 ? (
        <Notice tone="info" title={copy.pledge.settling} />
      ) : null}
      <Button testID="pledge-close" onPress={onClose}>
        {copy.close}
      </Button>
    </Stack>
  );
}
