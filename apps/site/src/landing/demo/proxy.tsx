import {
  Amount,
  Avatar,
  Button,
  ListRow,
  Pill,
  Progress,
  Row,
  Stack,
  Text,
  type Tone,
} from "@linky-fit/ui";
import { DemoBody, DemoTopBar } from "./chrome";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";

const steps = [
  { label: "Offer", done: true },
  { label: "Matched", done: true },
  { label: "Fiat payment", done: false },
  { label: "Bitcoin settlement", done: false },
];

const recipients: { person: Person; status: string; tone: Tone }[] = [
  { person: "Alex Rivers", status: "Details sent", tone: "info" },
  { person: "Mia Novak", status: "Accepted by someone else", tone: "neutral" },
  { person: "Tomas Berg", status: "Accepted by someone else", tone: "neutral" },
];

export function ProxyOfferScreen() {
  return (
    <>
      <DemoTopBar title="Proxy payment" leading="X" />
      <DemoBody paddingTop="$huge" gap="$lg">
        <Stack alignItems="center" gap="$sm">
          <Amount value="21,000" unit="sat" size="md" />
          <Stack gap="$xs" width="100%">
            <Progress
              accessibilityLabel="Progress"
              segments={steps.length}
              value={steps.filter((step) => step.done).length}
              max={steps.length}
            />
            <Row gap="$xs" alignItems="flex-start">
              {steps.map(({ label, done }) => (
                <Text
                  key={label}
                  flex={1}
                  variant="caption"
                  bold
                  textAlign="center"
                  color={done ? "$colorSubtle" : "$colorMuted"}
                >
                  {label}
                </Text>
              ))}
            </Row>
          </Stack>
          <Row gap="$xs" justifyContent="center">
            <Text bold color="$colorSubtle">
              4:56 remaining
            </Text>
            <Button size="sm" variant="secondary" onPress={noop}>
              +1 min
            </Button>
          </Row>
          <Text color="$colorMuted" textAlign="center">
            Alex Rivers has already accepted the offer.
          </Text>
        </Stack>
        <Stack gap="$xs">
          {recipients.map(({ person, status, tone }) => (
            <ListRow
              key={person}
              leading={<Avatar name={person} uri={avatarUri(person)} />}
              title={person}
              trailing={
                <Stack>
                  <Pill size="sm" label={status} tone={tone} />
                </Stack>
              }
            />
          ))}
        </Stack>
        <Button variant="secondary" icon="X" onPress={noop}>
          Cancel offer
        </Button>
      </DemoBody>
    </>
  );
}
