import {
  Avatar,
  IconButton,
  ListRow,
  Pill,
  Row,
  Section,
  Stack,
  Text,
} from "@linky-fit/ui";
import { DemoBody, DemoTopBar } from "./chrome";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";

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
    who: "Mia Novak",
    note: "Climbing",
    date: "10/06/2026, 06:00 PM",
    pill: "weekly",
    amount: "8,000 sat",
  },
  {
    who: "Lena Fox",
    note: "Rent share",
    date: "11/01/2026, 08:00 AM",
    pill: "monthly",
    amount: "21,000 sat",
  },
];

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

export function RecurringListScreen() {
  return (
    <>
      <DemoTopBar
        title="Transactions"
        leading="ChevronLeft"
        trailing="EyeOff"
      />
      <DemoBody paddingTop="$xxxl" gap="$none">
        <Stack paddingTop="$sm">
          <Section title="Scheduled">
            <Stack gap="$xs">
              {scheduled.map((payment) => (
                <PaymentRow key={payment.who} {...payment} />
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
        </Stack>
        <Stack position="absolute" right="$xl" bottom="$xxxl">
          <IconButton
            icon="Repeat"
            accessibilityLabel="New recurring payment"
            variant="primary"
            size="lg"
            onPress={noop}
          />
        </Stack>
      </DemoBody>
    </>
  );
}
