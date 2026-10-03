import {
  Amount,
  Avatar,
  AvatarGroup,
  Button,
  Divider,
  ListRow,
  OptionTile,
  Pill,
  Progress,
  Row,
  SuccessOverlay,
  Stack,
  Stepper,
  Switch,
  Text,
  type Tone,
} from "@linky-fit/ui";
import { border } from "@linky-fit/ui/tokens";
import type { ComponentProps, ComponentType } from "react";
import { DemoBody, DemoTabBar, DemoTopBar } from "./chrome";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";
import { useCues } from "./playback";
import { ScanScene } from "./proxyScan";
import "./proxyFlow.css";

// In time order: `useCues` reports how many have passed.
const cues = {
  tapScan: 900,
  scan: 1200,
  locked: 2300,
  bank: 2900,
  tapAlex: 3600,
  tapMia: 4050,
  tapTomas: 4500,
  tapAsk: 5200,
  offer: 5600,
  accepted: 6600,
  othersTaken: 7000,
  detailsSent: 7600,
  bankPaid: 8600,
  tapSettle: 9500,
  sending: 9800,
  sent: 11000,
  dismissed: 12600,
  closed: 12900,
};

type Cue = keyof typeof cues;

const cueOrder = Object.keys(cues);
const cueTimes = Object.values(cues);

/** Whether a cue of the flow has passed. */
type At = (cue: Cue) => boolean;

/** A press target that shows a touch when `on` turns true. */
function Tap({
  on,
  children,
  ...props
}: { on: boolean } & ComponentProps<typeof Stack>) {
  return (
    <Stack position="relative" className={on ? "proxy-press" : ""} {...props}>
      {children}
      {on ? (
        <Stack
          className="proxy-tap"
          width="$controlLg"
          height="$controlLg"
          borderRadius="$pill"
          borderWidth={border.emphasis}
          borderColor="$surface"
          backgroundColor="$colorMuted"
        />
      ) : null}
    </Stack>
  );
}

const payers: { currency: string; people: Person[] }[] = [
  { currency: "CZK", people: ["Alex Rivers", "Mia Novak", "Tomas Berg"] },
  { currency: "EUR", people: ["Sofia Lane", "Jan Kral"] },
];

function HubScene({ at }: { at: At }) {
  return (
    <>
      <DemoTopBar title="Proxy payments" />
      <DemoBody paddingTop="$lg" gap="$xxxl">
        <Stack gap="$sm">
          <Text variant="heading">
            A friend pays the transfer. You pay them in bitcoin.
          </Text>
          <Text color="$colorMuted">
            Scan the QR code of a bank transfer. A few of your friends get the
            offer, the first to accept pays it from their bank, and you send
            them sats.
          </Text>
        </Stack>
        <Row gap="$sm">
          <Tap on={at("tapScan")} flex={1}>
            <Button
              icon="ScanLine"
              flexDirection="column"
              paddingVertical="$xl"
              onPress={noop}
            >
              Scan QR
            </Button>
          </Tap>
          <Button
            icon="PencilLine"
            variant="secondary"
            flex={1}
            flexDirection="column"
            paddingVertical="$xl"
            onPress={noop}
          >
            Enter manually
          </Button>
        </Row>
        <Stack gap="$sm">
          <Text variant="title">Who can pay for you</Text>
          {payers.map(({ currency, people }) => (
            <Row key={currency}>
              <Stack>
                <Pill label={currency} size="sm" />
              </Stack>
              <AvatarGroup
                people={people.map((name) => ({ name, uri: avatarUri(name) }))}
              />
              <Text
                variant="label"
                color="$colorMuted"
                numberOfLines={1}
                flexShrink={1}
              >
                {people.join(", ")}
              </Text>
            </Row>
          ))}
        </Stack>
        <Divider />
        <Stack gap="$sm">
          <Text variant="title">Earn bitcoin</Text>
          <ListRow
            leading={
              <Stack minWidth="$control">
                <Pill label="CZK" size="sm" />
              </Stack>
            }
            title="Payments in CZK"
            trailing={
              <Switch
                accessibilityLabel="Payments in CZK"
                value
                onValueChange={noop}
              />
            }
          />
        </Stack>
      </DemoBody>
      <DemoTabBar active="proxy" />
    </>
  );
}

const bankRows = [
  { title: "Recipient", value: "Boulder Bar" },
  { title: "Amount", value: "1,250 CZK" },
  { title: "Variable symbol", value: "20261003" },
  { title: "Message", value: "Climbing pass" },
];

const offerContacts: { person: Person; tap?: Cue }[] = [
  { person: "Alex Rivers", tap: "tapAlex" },
  { person: "Mia Novak", tap: "tapMia" },
  { person: "Tomas Berg", tap: "tapTomas" },
  { person: "Eva Lind" },
  { person: "Jan Kral" },
  { person: "Sofia Lane" },
];

function askLabel(count: number) {
  if (count === 0) return "No contact to offer this to";
  return count === 1 ? "Ask 1 contact to pay" : `Ask ${count} contacts to pay`;
}

function BankScene({ at }: { at: At }) {
  const picked = offerContacts.filter(({ tap }) => tap && at(tap));
  return (
    <>
      <DemoTopBar
        title="Bank payment"
        leading="ChevronLeft"
        trailing="Pencil"
      />
      <DemoBody paddingTop="$lg" gap="$lg">
        <Amount value="21,000" unit="sat" size="md" />
        <Stack gap="$xs">
          {bankRows.map((row) => (
            <ListRow key={row.title} {...row} />
          ))}
        </Stack>
        <Tap on={at("tapAsk")}>
          <Button
            disabled={picked.length === 0}
            loading={at("tapAsk")}
            onPress={noop}
          >
            {askLabel(picked.length)}
          </Button>
        </Tap>
        <Row gap="$sm">
          <Text variant="caption" flex={1}>
            Delay between offer recipients
          </Text>
          <Stepper
            accessibilityLabel="Delay between offer recipients"
            decreaseLabel="Decrease delay"
            increaseLabel="Increase delay"
            min={0}
            max={30}
            step={5}
            value={0}
            valueText="0 s"
            onValueChange={noop}
          />
        </Row>
        <Row gap="$xs" flexWrap="wrap" alignItems="stretch">
          {offerContacts.map(({ person, tap }) => {
            const order = picked.findIndex((pick) => pick.person === person);
            return (
              <Tap
                key={person}
                on={tap !== undefined && at(tap)}
                flex={1}
                minWidth="$hero"
              >
                <OptionTile
                  label={person}
                  selected={order !== -1}
                  onPress={noop}
                  flexGrow={1}
                  leading={
                    <Stack
                      position="relative"
                      paddingHorizontal="$sm"
                      paddingBottom="$xs"
                    >
                      <Avatar name={person} uri={avatarUri(person)} size="sm" />
                      {order === -1 ? null : (
                        <Text
                          position="absolute"
                          right="$none"
                          bottom="$none"
                          minWidth="$iconSm"
                          paddingHorizontal="$xxs"
                          borderRadius="$pill"
                          overflow="hidden"
                          backgroundColor="$accent"
                          color="$onAccent"
                          variant="caption"
                          bold
                          textAlign="center"
                        >
                          {order + 1}
                        </Text>
                      )}
                    </Stack>
                  }
                />
              </Tap>
            );
          })}
        </Row>
      </DemoBody>
    </>
  );
}

const steps = ["Offer", "Matched", "Fiat payment", "Bitcoin settlement"];

interface Status {
  label: string;
  tone: Tone;
}

function alexStatus(at: At): Status {
  if (at("sent")) return { label: "Done", tone: "accent" };
  if (at("bankPaid")) return { label: "Paid by bank", tone: "accent" };
  if (at("detailsSent")) return { label: "Details sent", tone: "info" };
  if (at("accepted")) return { label: "Accepted", tone: "accent" };
  return { label: "Offered", tone: "warning" };
}

const otherStatus = (at: At): Status =>
  at("othersTaken")
    ? { label: "Accepted by someone else", tone: "neutral" }
    : { label: "Offered", tone: "warning" };

const countdownTicks = Array.from({ length: 10 }, (_, index) => index * 1000);

function useCountdown(from: number) {
  const left = from - useCues(countdownTicks);
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

function SendingOverlay({ at }: { at: At }) {
  const sent = at("sent");
  return (
    <Stack
      className={at("dismissed") ? "proxy-overlay-out" : "proxy-fade-in"}
      position="absolute"
      zIndex="$overlay"
      top="$none"
      bottom="$none"
      left="$none"
      right="$none"
    >
      <SuccessOverlay
        contained
        title={sent ? "Sent" : "Sending…"}
        amount="21,000"
        unit="sat"
        avatar={{ name: "Alex Rivers", uri: avatarUri("Alex Rivers") }}
        direction="out"
        pending={!sent}
      />
    </Stack>
  );
}

function OfferScene({ at }: { at: At }) {
  const remaining = useCountdown(300);
  const settled = at("sent");
  const done = [true, at("accepted"), at("bankPaid"), settled].filter(
    Boolean,
  ).length;
  const recipients: { person: Person; status: Status }[] = [
    { person: "Alex Rivers", status: alexStatus(at) },
    { person: "Mia Novak", status: otherStatus(at) },
    { person: "Tomas Berg", status: otherStatus(at) },
  ];
  const canSettle = at("bankPaid") && !settled;
  return (
    <>
      <DemoTopBar title="Proxy payment" leading="X" />
      <DemoBody paddingTop="$lg" gap="$lg">
        <Stack alignItems="center" gap="$sm">
          <Amount value="21,000" unit="sat" size="md" />
          <Stack className="proxy-progress" gap="$xs" width="100%">
            <Progress
              accessibilityLabel="Proxy payment progress"
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
          {/* Hidden rather than removed, so the rows below keep their place. */}
          <Row
            gap="$xs"
            justifyContent="center"
            opacity={settled ? 0 : 1}
            transition="base"
          >
            <Text bold color="$colorSubtle">
              {remaining} remaining
            </Text>
            <Button size="sm" variant="secondary" onPress={noop}>
              +1 min
            </Button>
          </Row>
          <Text
            color="$colorMuted"
            textAlign="center"
            opacity={at("accepted") ? 1 : 0}
            transition="base"
          >
            Alex Rivers has already accepted the offer.
          </Text>
        </Stack>
        <Stack gap="$xs">
          {recipients.map(({ person, status }) => (
            <ListRow
              key={person}
              leading={<Avatar name={person} uri={avatarUri(person)} />}
              title={person}
              trailing={
                <Stack>
                  <Pill size="sm" label={status.label} tone={status.tone} />
                </Stack>
              }
            />
          ))}
        </Stack>
        {canSettle ? (
          <Tap on={at("tapSettle")}>
            <Button icon="Check" loading={at("tapSettle")} onPress={noop}>
              Confirm settlement
            </Button>
          </Tap>
        ) : null}
        {settled ? null : (
          <Button variant="secondary" icon="X" onPress={noop}>
            {canSettle ? "Not paid" : "Cancel offer"}
          </Button>
        )}
      </DemoBody>
      {at("sending") && !at("closed") ? <SendingOverlay at={at} /> : null}
    </>
  );
}

function ScanStep({ at }: { at: At }) {
  return <ScanScene locked={at("locked")} />;
}

const scenes: { Scene: ComponentType<{ at: At }>; enter: string }[] = [
  { Scene: HubScene, enter: "" },
  { Scene: ScanStep, enter: "proxy-modal-in" },
  { Scene: BankScene, enter: "proxy-push-in" },
  { Scene: OfferScene, enter: "proxy-push-in" },
];

/** The offerer's whole proxy payment, from scanning the bank QR to paying the payer. */
export function ProxyOfferScreen() {
  const passed = useCues(cueTimes);
  const at: At = (cue) => passed > cueOrder.indexOf(cue);
  const current = [at("scan"), at("bank"), at("offer")].filter(Boolean).length;
  const pushed = scenes[current]?.enter === "proxy-push-in";
  return (
    <Stack flex={1} position="relative" overflow="hidden">
      {scenes.map(({ Scene, enter }, index) =>
        index === current || index === current - 1 ? (
          <Stack
            key={index}
            className={`proxy-scene ${
              index === current ? enter : pushed ? "proxy-push-out" : ""
            }`}
            position="absolute"
            top="$none"
            bottom="$none"
            left="$none"
            right="$none"
            backgroundColor="$background"
          >
            <Scene at={at} />
          </Stack>
        ) : null,
      )}
    </Stack>
  );
}
