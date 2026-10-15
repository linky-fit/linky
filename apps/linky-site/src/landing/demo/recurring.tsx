import {
  Amount,
  Avatar,
  Button,
  Card,
  IconButton,
  ListRow,
  Pill,
  Row,
  Section,
  SegmentedControl,
  Stack,
  Text,
  TextField,
  type KeypadKey,
} from "@linky-fit/ui";
import { space } from "@linky-fit/ui/tokens";
import type { ReactNode } from "react";
import { DemoBody, DemoTopBar } from "./chrome";
import { fill } from "./fill";
import { FlowScenes, Tap, TappedKeypad } from "./flow";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";
import { useCues, useFlow } from "./playback";
import "./recurring.css";

// In time order, as `useFlow` plays them.
const cues = {
  tapNew: 900,
  form: 1200,
  tapMia: 2200,
  picked: 2500,
  key8: 3100,
  key0: 3450,
  key00: 3800,
  key000: 4150,
  tapNote: 4700,
  scroll: 5900,
  tapWeekly: 7000,
  tapSave: 7900,
  back: 8600,
};

type Cue = keyof typeof cues;

/** Whether a cue of the flow has passed. */
type At = (cue: Cue) => boolean;

const amountKeys: { cue: Cue; key: KeypadKey }[] = [
  { cue: "key8", key: "8" },
  { cue: "key0", key: "0" },
  { cue: "key00", key: "0" },
  { cue: "key000", key: "0" },
];
const typedAmounts = ["0", "8", "80", "800", "8,000"];

const note = "Climbing";
const noteTicks = Array.from(
  note,
  (_, index) => cues.tapNote + 300 + index * 90,
);

const topup = "Topup via invoice";

interface Payment {
  who: Person | typeof topup;
  note?: string;
  date: string;
  pill?: string;
  amount: string;
  incoming?: boolean;
}

const scheduled: Payment[] = [
  {
    who: "Mom",
    note: "Pocket money",
    date: "10/04/2026, 09:00 AM",
    pill: "monthly",
    amount: "50,000 sat",
  },
  {
    who: "Lena Fox",
    note: "Rent share",
    date: "11/01/2026, 08:00 AM",
    pill: "monthly",
    amount: "21,000 sat",
  },
];

const climbing: Payment = {
  who: "Mia Novak",
  note,
  date: "10/03/2026, 08:00 PM",
  pill: "weekly",
  amount: "8,000 sat",
};

const history: Payment[] = [
  {
    who: "Eva Lind",
    note: "Dinner 🍝",
    date: "10/03/2026, 07:12 PM",
    amount: "20,999 sat",
    incoming: true,
  },
  {
    who: "Sam Ortiz",
    note: "Coffee next week",
    date: "10/02/2026, 10:41 AM",
    amount: "5,000 sat",
  },
  {
    who: "Lena Fox",
    note: "Rent share",
    date: "10/01/2026, 08:00 AM",
    pill: "Recurring payment",
    amount: "21,000 sat",
  },
  {
    who: topup,
    date: "09/30/2026, 06:41 PM",
    amount: "420,000 sat",
    incoming: true,
  },
];

const payableContacts: Person[] = [
  "Alex Rivers",
  "Ben Ellis",
  "Eva Lind",
  "Jan Kral",
  "Lena Fox",
  "Mia Novak",
  "Mom",
  "Sam Ortiz",
  "Sofia Lane",
];

function PaymentRow({ who, note, date, pill, amount, incoming }: Payment) {
  return (
    <ListRow
      leading={
        who === topup ? (
          <Avatar name={who} fallback="⚡️" />
        ) : (
          <Avatar name={who} uri={avatarUri(who)} />
        )
      }
      title={who}
      description={
        <Stack gap="$xxs">
          {note ? (
            <Text variant="caption" color="$colorSubtle" numberOfLines={1}>
              {note}
            </Text>
          ) : null}
          <Row gap="$sm" flexWrap="wrap" alignItems="center">
            <Text variant="caption" color="$colorMuted">
              {date}
            </Text>
            {pill ? <Pill size="sm" tone="neutral" label={pill} /> : null}
          </Row>
        </Stack>
      }
      trailing={
        <Text
          variant="label"
          bold
          color={incoming ? "$accentText" : "$dangerText"}
        >
          {amount}
        </Text>
      }
      chevron={false}
    />
  );
}

function AddedRow(payment: Payment) {
  return (
    <Stack className="recurring-added" position="relative">
      <Stack
        className="recurring-highlight"
        position="absolute"
        top="$none"
        bottom="$none"
        left={-space.md}
        right={-space.md}
        borderRadius="$control"
        backgroundColor="$accentSoft"
      />
      <PaymentRow {...payment} />
    </Stack>
  );
}

function TransactionsScene({
  tapNew = false,
  added,
}: {
  tapNew?: boolean;
  added?: Payment;
}) {
  return (
    <>
      <DemoTopBar
        title="Transactions"
        leading="ChevronLeft"
        trailing="EyeOff"
      />
      <DemoBody paddingTop="$sm">
        <Section title="Scheduled">
          <Stack gap="$xs">
            {added ? <AddedRow {...added} /> : null}
            {scheduled.map((payment) => (
              <PaymentRow key={payment.date} {...payment} />
            ))}
          </Stack>
        </Section>
        <Section title="History">
          <Stack gap="$xs">
            {history.map((payment) => (
              <PaymentRow key={payment.date} {...payment} />
            ))}
          </Stack>
        </Section>
        <Tap on={tapNew} position="absolute" right="$xl" bottom="$xxxl">
          <IconButton
            icon="Repeat"
            accessibilityLabel="Set up recurring payment"
            variant="primary"
            size="lg"
            onPress={noop}
          />
        </Tap>
      </DemoBody>
    </>
  );
}

function NewRecurringTopBar() {
  return <DemoTopBar title="New recurring payment" leading="ChevronLeft" />;
}

function PickerScene({ tapMia }: { tapMia: boolean }) {
  return (
    <>
      <NewRecurringTopBar />
      <DemoBody paddingTop="$lg">
        <TextField
          label="Who to pay"
          placeholder="Search contacts"
          value=""
          onChangeText={noop}
        />
        <Stack gap="$xs">
          {payableContacts.map((person) => (
            <Tap key={person} on={person === "Mia Novak" && tapMia}>
              <ListRow
                leading={<Avatar name={person} uri={avatarUri(person)} />}
                title={person}
                onPress={noop}
              />
            </Tap>
          ))}
        </Stack>
      </DemoBody>
    </>
  );
}

function FormScene({ at, typed }: { at: At; typed: number }) {
  const tap = (cue: Cue) => at(cue) && !at("back");
  const presses = amountKeys.filter(({ cue }) => at(cue)).length;
  const weekly = at("tapWeekly");
  return (
    <>
      <NewRecurringTopBar />
      <Stack flex={1} position="relative" overflow="hidden">
        <Stack
          className={`recurring-form ${at("scroll") ? "recurring-form-end" : ""}`}
          position="absolute"
          left="$none"
          right="$none"
          gap="$lg"
          paddingHorizontal="$xl"
          paddingTop="$lg"
          paddingBottom="$huge"
        >
          <Row gap="$md" alignItems="center">
            <Avatar name="Mia Novak" uri={avatarUri("Mia Novak")} size="md" />
            <Stack flex={1} gap="$xxs" alignItems="flex-start">
              <Text variant="title" numberOfLines={1}>
                Mia Novak
              </Text>
              <Button variant="ghost" size="sm" onPress={noop}>
                Change recipient
              </Button>
            </Stack>
          </Row>
          <Card>
            <Amount value={typedAmounts[presses]} unit="sat" size="lg" />
          </Card>
          <Tap on={tap("tapNote")}>
            <TextField
              label="Note"
              hideLabel
              placeholder="Add a note"
              value={note.slice(0, typed)}
              onChangeText={noop}
              textAlign="center"
            />
          </Tap>
          <TappedKeypad
            pressedKey={
              at("tapNote") ? undefined : amountKeys[presses - 1]?.key
            }
            press={presses}
            clearLabel="Clear form"
          />
          <Stack gap="$xs">
            <Text variant="label">How often</Text>
            <Stack position="relative">
              <SegmentedControl
                accessibilityLabel="How often"
                value={weekly ? "week" : "month"}
                options={[
                  { value: "day", label: "Daily" },
                  { value: "week", label: "Weekly" },
                  { value: "month", label: "Monthly" },
                ]}
                onValueChange={noop}
              />
              <Row {...fill} padding="$xs" gap="$xs">
                <Stack flex={1} />
                <Tap on={tap("tapWeekly")} flex={1} />
                <Stack flex={1} />
              </Row>
            </Stack>
          </Stack>
          <TextField
            label="First payment"
            value="10/03/2026, 08:00 PM"
            onChangeText={noop}
            hint={`Next payment ${weekly ? "10/10/2026" : "11/03/2026"}, 08:00 PM`}
          />
          <ListRow title="Paid from" value="mint.linky.fit" />
          <Text variant="caption" color="$colorMuted">
            Any of your devices running Linky sends the payment, also in the
            background. You are notified a minute ahead; with the app open you
            see a countdown and can pay right away or cancel.
          </Text>
          <Tap on={tap("tapSave")}>
            <Button
              icon="Repeat"
              disabled={presses === 0}
              loading={at("tapSave")}
              onPress={noop}
            >
              Set up recurring payment
            </Button>
          </Tap>
        </Stack>
      </Stack>
    </>
  );
}

/** Navigates back to `children`, sliding the page `from` off over it. */
function PoppedBack({
  from,
  children,
}: {
  from: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <Stack className="recurring-pop-under" {...fill}>
        {children}
      </Stack>
      <Stack
        className="recurring-pop-out"
        {...fill}
        backgroundColor="$background"
      >
        {from}
      </Stack>
    </>
  );
}

/** Transactions with two recurring payments, then setting up a third one. */
export function RecurringListScreen() {
  const at = useFlow(cues);
  const form = <FormScene at={at} typed={useCues(noteTicks)} />;
  return (
    <FlowScenes
      current={[at("form"), at("back")].filter(Boolean).length}
      scenes={[
        { node: <TransactionsScene tapNew={at("tapNew")} /> },
        {
          node: at("picked") ? form : <PickerScene tapMia={at("tapMia")} />,
          enter: "push",
        },
        {
          node: (
            <PoppedBack from={form}>
              <TransactionsScene added={climbing} />
            </PoppedBack>
          ),
        },
      ]}
    />
  );
}
