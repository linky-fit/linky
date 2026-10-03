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
import { useCues } from "./playback";

const steps = ["Offer", "Matched", "Fiat payment", "Bitcoin settlement"];

interface Status {
  label: string;
  tone: Tone;
}

const offered: Status = { label: "Offered", tone: "warning" };
const taken: Status = { label: "Accepted by someone else", tone: "neutral" };

// Offer sent, Alex accepts, the others learn, Alex gets the payment details.
const offerCues = [300, 1000, 1500, 2100];

const recipients: { person: Person; statuses: Status[] }[] = [
  {
    person: "Alex Rivers",
    statuses: [
      offered,
      offered,
      { label: "Accepted", tone: "accent" },
      { label: "Accepted", tone: "accent" },
      { label: "Details sent", tone: "info" },
    ],
  },
  { person: "Mia Novak", statuses: [offered, offered, offered, taken, taken] },
  { person: "Tomas Berg", statuses: [offered, offered, offered, taken, taken] },
];

export function ProxyOfferScreen() {
  const passed = useCues(offerCues);
  const done = Math.min(passed, 2);
  const accepted = passed > 1;
  return (
    <>
      <DemoTopBar title="Proxy payment" leading="X" />
      <DemoBody paddingTop="$huge" gap="$lg">
        <Stack alignItems="center" gap="$sm">
          <Amount value="21,000" unit="sat" size="md" />
          <Stack className="demo-progress" gap="$xs" width="100%">
            <Progress
              accessibilityLabel="Progress"
              segments={steps.length}
              value={done}
              max={steps.length}
            />
            <Row gap="$xs" alignItems="flex-start">
              {steps.map((label, index) => (
                <Text
                  key={label}
                  flex={1}
                  variant="caption"
                  bold
                  textAlign="center"
                  color={index < done ? "$colorSubtle" : "$colorMuted"}
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
          <Text
            key={String(accepted)}
            className={accepted ? "demo-in" : ""}
            color="$colorMuted"
            textAlign="center"
          >
            {accepted
              ? "Alex Rivers has already accepted the offer."
              : "Waiting for a contact to accept."}
          </Text>
        </Stack>
        <Stack gap="$xs">
          {recipients.map(({ person, statuses }) => {
            const { label, tone } = statuses[passed] ?? offered;
            return (
              <ListRow
                key={person}
                leading={<Avatar name={person} uri={avatarUri(person)} />}
                title={person}
                trailing={
                  <Stack key={label} className="demo-pop">
                    <Pill size="sm" label={label} tone={tone} />
                  </Stack>
                }
              />
            );
          })}
        </Stack>
        <Button variant="secondary" icon="X" onPress={noop}>
          Cancel offer
        </Button>
      </DemoBody>
    </>
  );
}
