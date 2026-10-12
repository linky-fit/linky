import {
  Avatar,
  Button,
  Card,
  ListRow,
  Row,
  Section,
  Stack,
  Switch,
  Text,
  TextField,
  Toast,
  ToastStack,
  type IconName,
} from "@linky-fit/ui";
import { ChatScreen, Message } from "./chat";
import { DemoBody, DemoTabBar, DemoTopBar } from "./chrome";
import { fill } from "./fill";
import { Arrive, FlowScenes, Tap } from "./flow";
import { ContactsScreen, type Conversation } from "./home";
import { noop } from "./noop";
import { avatarUri } from "./people";
import { useFlow } from "./playback";

// In time order, as `useFlow` plays them.
const blockCues = {
  tapContact: 900,
  chat: 1200,
  tapEdit: 2400,
  edit: 2700,
  tapDelete: 3900,
  deleted: 4200,
  tapBlock: 5500,
  blocked: 5800,
  tapSettings: 7000,
  settings: 7300,
  tapBlocked: 8300,
  blockedList: 8600,
};

const spammer = "Max Profit";

const spam: Conversation = {
  person: spammer,
  preview: "Last chance!!! 💰💰💰",
  time: "07:12 PM",
  unread: true,
};

/** A toast with a touch on action `tapped`; its buttons take no children, so the touch sits on matching invisible ones above. */
function TappedToast({
  title,
  actions,
  tapped,
}: {
  title: string;
  actions: readonly string[];
  tapped?: string | undefined;
}) {
  return (
    <ToastStack>
      <Arrive>
        <Stack position="relative">
          <Toast
            title={title}
            actions={actions.map((label) => ({ label, onPress: noop }))}
          />
          <Row
            {...fill}
            gap="$md"
            paddingHorizontal="$md"
            paddingVertical="$sm"
            pointerEvents="none"
          >
            <Stack flex={1} />
            {actions.map((label) => (
              <Tap key={label} on={label === tapped}>
                <Stack opacity={0}>
                  <Button size="sm" variant="ghost" onPress={noop}>
                    {label}
                  </Button>
                </Stack>
              </Tap>
            ))}
          </Row>
        </Stack>
      </Arrive>
    </ToastStack>
  );
}

function EditScene({ tapDelete }: { tapDelete: boolean }) {
  return (
    <>
      <DemoTopBar
        title="Edit contact"
        leading="ChevronLeft"
        trailing="Trash2"
        tapTrailing={tapDelete}
      />
      <DemoBody paddingTop="$xxl">
        <Card gap="$lg">
          <Stack gap="$md">
            <TextField
              label="Name"
              placeholder={spammer}
              value=""
              onChangeText={noop}
            />
            <TextField
              label="Identifier"
              value="npub1rvf6u32av7l40y4kd2ht7q3wqeguzqluw6p52ex85h09d4pq49gq4c93hw"
              onChangeText={noop}
            />
            <TextField
              label="Lightning address"
              placeholder="max@sats-x100.com"
              value=""
              onChangeText={noop}
            />
            <TextField
              label="Group"
              placeholder="e.g. Friends"
              value=""
              onChangeText={noop}
            />
          </Stack>
          <Row>
            <Button variant="secondary" icon="Ban" onPress={noop}>
              Block
            </Button>
          </Row>
        </Card>
      </DemoBody>
    </>
  );
}

interface SettingsRow {
  icon: IconName;
  title: string;
  value?: string;
  toggle?: boolean;
}

// The General section of the web app's Settings page, in its order.
const generalSettings: SettingsRow[] = [
  { icon: "Languages", title: "Language" },
  { icon: "Palette", title: "Appearance", value: "Automatic" },
  { icon: "Bitcoin", title: "Units" },
  { icon: "Compass", title: "Tutorial" },
  { icon: "MessageCircle", title: "Feedback" },
  { icon: "Bell", title: "Notifications", toggle: true },
  { icon: "CheckCheck", title: "Send read receipts", toggle: true },
  { icon: "Ban", title: "Blocked" },
  { icon: "Smartphone", title: "Tilt to show profile", toggle: false },
];

function SettingsScene({ tapBlocked }: { tapBlocked: boolean }) {
  return (
    <>
      <DemoTopBar title="Settings" />
      <DemoBody paddingTop="$lg">
        <Section title="General">
          {generalSettings.map(({ icon, title, value, toggle }) => (
            <Tap key={title} on={title === "Blocked" && tapBlocked}>
              <ListRow
                icon={icon}
                title={title}
                value={value}
                {...(toggle === undefined
                  ? { onPress: noop }
                  : {
                      trailing: (
                        <Switch
                          accessibilityLabel={title}
                          value={toggle}
                          onValueChange={noop}
                        />
                      ),
                    })}
              />
            </Tap>
          ))}
        </Section>
      </DemoBody>
      <DemoTabBar active="settings" />
    </>
  );
}

function BlockedScene() {
  return (
    <>
      <DemoTopBar title="Blocked" leading="ChevronLeft" />
      <DemoBody paddingTop="$lg" gap="$lg">
        <Text color="$colorMuted">
          Messages from blocked people don't reach you on any of your devices.
          Unblocking lets new messages through; earlier ones don't come back.
        </Text>
        <ListRow
          title={spammer}
          leading={<Avatar name={spammer} uri={avatarUri(spammer)} />}
          trailing={
            <Button size="sm" variant="secondary" onPress={noop}>
              Unblock
            </Button>
          }
        />
      </DemoBody>
    </>
  );
}

/** Dave deletes a contact who sends him spam, blocks him from the toast and finds him in Settings > Blocked. */
export function ContactBlockScreen() {
  const at = useFlow(blockCues);
  const current = [
    at("chat"),
    at("edit"),
    at("deleted"),
    at("settings"),
    at("blockedList"),
  ].filter(Boolean).length;
  return (
    <FlowScenes
      current={current}
      scenes={[
        {
          node: (
            <ContactsScreen
              latest={spam}
              tapped={at("tapContact") ? spammer : undefined}
            />
          ),
        },
        {
          node: (
            <ChatScreen contact={spammer} tapEdit={at("tapEdit")}>
              <Message>🚀 Turn 10,000 sat into 1 BTC in 24 hours!</Message>
              <Message>Only 3 spots left. Reply YES</Message>
              <Message>Last chance!!! 💰💰💰</Message>
            </ChatScreen>
          ),
          enter: "push",
        },
        { node: <EditScene tapDelete={at("tapDelete")} />, enter: "push" },
        {
          node: (
            <ContactsScreen tapTab={at("tapSettings") ? "settings" : undefined}>
              {at("blocked") ? (
                <TappedToast
                  key="blocked"
                  title="Contact blocked."
                  actions={["Undo"]}
                />
              ) : (
                <TappedToast
                  key="deleted"
                  title="Contact deleted."
                  actions={["Undo", "Block"]}
                  tapped={at("tapBlock") ? "Block" : undefined}
                />
              )}
            </ContactsScreen>
          ),
          enter: "back",
        },
        { node: <SettingsScene tapBlocked={at("tapBlocked")} /> },
        { node: <BlockedScene />, enter: "push" },
      ]}
    />
  );
}
