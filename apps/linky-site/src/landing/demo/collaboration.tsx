import {
  ActionTile,
  AvatarGroup,
  Avatar,
  Button,
  Divider,
  IconButton,
  ListRow,
  Row,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextField,
} from "@linky-fit/ui";
import { DemoBody, DemoTabBar, DemoTopBar } from "./chrome";
import { fill } from "./fill";
import { Arrive, FlowScenes, Tap } from "./flow";
import { ContactsScreen } from "./home";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";
import { useCues, useFlow } from "./playback";

type Hub = "Bank transfer" | "Cash" | "Goods and services";

/** The Collaboration tab with a touch on the tile labelled `tapped`. */
function CollaborationScene({ tapped }: { tapped?: Hub | undefined }) {
  const tile = (
    label: Hub,
    icon: "QrCode" | "Banknote" | "Package",
    caption: string,
    inRow = true,
  ) => (
    <Tap on={label === tapped} flex={inRow ? 1 : undefined}>
      <ActionTile
        flexGrow={1}
        icon={icon}
        label={label}
        caption={caption}
        onPress={noop}
      />
    </Tap>
  );
  return (
    <>
      <DemoTopBar title="Collaboration" trailing="ScanLine" />
      <DemoBody paddingTop="$lg" gap="$xxxl">
        <Text color="$colorMuted">
          Everyone is good at something. Bitcoin pays for all of it.
        </Text>
        <Stack gap="$md">
          <Row gap="$md" alignItems="stretch">
            {tile("Bank transfer", "QrCode", "5 contacts pay")}
            {tile("Cash", "Banknote", "3 contacts exchange")}
          </Row>
          {tile("Goods and services", "Package", "3 listings", false)}
        </Stack>
      </DemoBody>
      <DemoTabBar active="collaboration" />
    </>
  );
}

function PeopleRow({ people }: { people: readonly Person[] }) {
  return (
    <Row>
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
  );
}

type CashChoice = "offer" | "none" | "want";

const cashChoices: { value: CashChoice; label: string; hint: string }[] = [
  {
    value: "offer",
    label: "Offering cash",
    hint: "Contacts see that you have cash and want bitcoin for it.",
  },
  {
    value: "none",
    label: "Nothing now",
    hint: "You show nothing to your contacts for now.",
  },
  {
    value: "want",
    label: "Looking for cash",
    hint: "Contacts see that you look for cash in exchange for bitcoin.",
  },
];

function CashScene({
  tapped,
  choice,
}: {
  tapped?: CashChoice | undefined;
  choice: CashChoice;
}) {
  return (
    <>
      <DemoTopBar title="Cash" leading="ChevronLeft" />
      <DemoBody paddingTop="$lg" gap="$xxxl">
        <Text color="$colorMuted">
          Bitcoin is best exchanged directly with friends.
        </Text>
        <Stack gap="$sm">
          <Stack position="relative">
            <SegmentedControl
              accessibilityLabel="Cash"
              value={choice}
              options={cashChoices.map(({ value, label }) => ({
                value,
                label,
              }))}
              onValueChange={noop}
            />
            {/* The segments take no children, so the touch sits on a matching row above them. */}
            <Row {...fill} gap="$none" pointerEvents="none">
              {cashChoices.map(({ value }) => (
                <Tap key={value} on={value === tapped} flex={1} />
              ))}
            </Row>
          </Stack>
          <Text variant="caption" color="$colorMuted">
            {cashChoices.find(({ value }) => value === choice)?.hint}
          </Text>
        </Stack>
        <Stack gap="$sm">
          <Text variant="title">Offer cash</Text>
          <PeopleRow people={["Tomas Berg", "Lena Fox"]} />
        </Stack>
        <Stack gap="$sm">
          <Text variant="title">Look for cash</Text>
          <PeopleRow people={["Sofia Lane"]} />
        </Stack>
        <Divider />
        <Stack gap="$sm">
          <Text variant="title">Nearby</Text>
          <ListRow
            icon="Radio"
            title="Beacon"
            description="Broadcasting to 12 contacts"
            trailing={
              <Switch accessibilityLabel="Beacon" value onValueChange={noop} />
            }
          />
        </Stack>
      </DemoBody>
    </>
  );
}

// In time order, as `useFlow` plays them.
const cashCues = {
  tapTab: 900,
  hub: 1200,
  tapCash: 2300,
  cash: 2600,
  tapWant: 3900,
  want: 4100,
};

/** Dave needs cash for a trip: he opens Collaboration > Cash, says he looks for cash and sees who offers it. */
export function CashIntentScreen() {
  const at = useFlow(cashCues);
  const current = [at("hub"), at("cash")].filter(Boolean).length;
  return (
    <FlowScenes
      current={current}
      scenes={[
        {
          node: (
            <ContactsScreen
              tapTab={at("tapTab") ? "collaboration" : undefined}
            />
          ),
        },
        {
          node: (
            <CollaborationScene tapped={at("tapCash") ? "Cash" : undefined} />
          ),
        },
        {
          node: (
            <CashScene
              tapped={at("tapWant") ? "want" : undefined}
              choice={at("want") ? "want" : "none"}
            />
          ),
          enter: "push",
        },
      ]}
    />
  );
}

interface Listing {
  title: string;
  unit: string;
  price: string;
}

const offered: (Listing & { person: Person })[] = [
  {
    person: "Mia Novak",
    title: "Eggs from the garden",
    unit: "per 10",
    price: "1,500 sat",
  },
  {
    person: "Sofia Lane",
    title: "Sourdough bread",
    unit: "per loaf",
    price: "~4,600 sat",
  },
];

const wanted: (Listing & { person: Person })[] = [
  {
    person: "Ben Ellis",
    title: "Help moving a sofa",
    unit: "per job",
    price: "20,000 sat",
  },
];

const daves: Listing = {
  title: "Bike repair",
  unit: "per hour",
  price: "10,000 sat",
};

function PeerListings({
  title,
  listings,
}: {
  title: string;
  listings: typeof offered;
}) {
  return (
    <Stack gap="$sm">
      <Text variant="title">{title}</Text>
      {listings.map(({ person, title, unit, price }) => (
        <ListRow
          key={title}
          leading={<Avatar name={person} uri={avatarUri(person)} size="md" />}
          title={title}
          description={`${person.split(" ")[0]} · ${unit}`}
          trailing={
            <Text variant="label" bold>
              {price}
            </Text>
          }
          chevron={false}
          onPress={noop}
        />
      ))}
    </Stack>
  );
}

function ListingsScene({
  tapAdd = false,
  mine = false,
}: {
  tapAdd?: boolean;
  mine?: boolean;
}) {
  return (
    <>
      <DemoTopBar title="Goods and services" leading="ChevronLeft" />
      <DemoBody paddingTop="$lg" gap="$xxl" position="relative">
        <Text color="$colorMuted">What your contacts offer and look for.</Text>
        <PeerListings title="Offered" listings={offered} />
        <PeerListings title="Wanted" listings={wanted} />
        {mine ? (
          <Arrive>
            <Stack gap="$sm">
              <Text variant="title">Your listings</Text>
              <ListRow
                title={daves.title}
                description={`Offering · ${daves.unit}`}
                trailing={
                  <Text variant="label" bold>
                    {daves.price}
                  </Text>
                }
                onPress={noop}
              />
            </Stack>
          </Arrive>
        ) : null}
        <Text variant="label" fontWeight="$regular" color="$colorMuted">
          Only contacts who also saved you see your listings.
        </Text>
        <Stack position="absolute" right="$xl" bottom="$xxxl">
          <Tap on={tapAdd}>
            <IconButton
              icon="Plus"
              variant="primary"
              size="lg"
              accessibilityLabel="Add a listing"
              onPress={noop}
            />
          </Tap>
        </Stack>
      </DemoBody>
    </>
  );
}

const typingTicks = (text: string, start: number, step = 60) =>
  Array.from(text, (_, index) => start + index * step);

// Ms after the form mounts.
const titleTicks = typingTicks(daves.title, 500);
const priceTicks = typingTicks("10000", 1500, 180);
const unitTicks = typingTicks(daves.unit, 2700);

function useTyped(text: string, ticks: readonly number[]) {
  return Array.from(text).slice(0, useCues(ticks)).join("");
}

function ListingFormScene({ tapAdd }: { tapAdd: boolean }) {
  const title = useTyped(daves.title, titleTicks);
  const price = useTyped("10000", priceTicks);
  const unit = useTyped(daves.unit, unitTicks);
  return (
    <>
      <DemoTopBar title="Add a listing" leading="ChevronLeft" />
      <DemoBody paddingTop="$lg" gap="$lg">
        <SegmentedControl
          accessibilityLabel="Listing"
          value="offer"
          options={[
            { value: "offer", label: "Offering" },
            { value: "want", label: "Looking for" },
          ]}
          onValueChange={noop}
        />
        <TextField
          label="Title"
          hideLabel
          placeholder="E.g. Eggs from the garden or Babysitting"
          value={title}
          onChangeText={noop}
        />
        <Row gap="$sm" alignItems="flex-start">
          <Stack flex={1} minWidth={0}>
            <TextField
              label="Price"
              hideLabel
              placeholder="Price"
              value={price}
              onChangeText={noop}
              trailing={
                <Button variant="ghost" size="sm" onPress={noop}>
                  sat
                </Button>
              }
            />
          </Stack>
          <Stack flex={1} minWidth={0}>
            <TextField
              label="Unit"
              hideLabel
              placeholder="per hour, per kg…"
              value={unit}
              onChangeText={noop}
            />
          </Stack>
        </Row>
        <Tap on={tapAdd}>
          <Button icon="Check" disabled={unit.length === 0} onPress={noop}>
            Add
          </Button>
        </Tap>
      </DemoBody>
    </>
  );
}

// In time order, as `useFlow` plays them; the form types for 3.2 s after it mounts.
const listingCues = {
  tapTile: 900,
  listings: 1200,
  tapAdd: 2500,
  form: 2800,
  tapSave: 6600,
  saved: 6900,
};

/** Dave sees what his contacts offer and want, then offers bike repairs priced in sats per hour. */
export function ListingsScreen() {
  const at = useFlow(listingCues);
  const current = [at("listings"), at("form"), at("saved")].filter(
    Boolean,
  ).length;
  return (
    <FlowScenes
      current={current}
      scenes={[
        {
          node: (
            <CollaborationScene
              tapped={at("tapTile") ? "Goods and services" : undefined}
            />
          ),
        },
        { node: <ListingsScene tapAdd={at("tapAdd")} />, enter: "push" },
        { node: <ListingFormScene tapAdd={at("tapSave")} />, enter: "push" },
        { node: <ListingsScene mine />, enter: "back" },
      ]}
    />
  );
}
