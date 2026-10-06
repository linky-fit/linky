import {
  Avatar,
  BrandMark,
  Button,
  DaySeparator,
  Divider,
  Icon,
  IconButton,
  LinkPreview,
  ListRow,
  MessageBubble,
  MessageComposerFrame,
  Pill,
  QRCode,
  RichTextInput,
  Row,
  Stack,
  Text,
  TopBar,
} from "@linky-fit/ui";
import { size } from "@linky-fit/ui/tokens";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Message } from "./chat";
import { DemoBody, DemoTabBar, DemoTopBar } from "./chrome";
import { fill } from "./fill";
import { FlowScenes, Tap } from "./flow";
import { noop } from "./noop";
import { avatarUri, type Person } from "./people";
import { useFlow } from "./playback";
import "./chatPay.css";
import "./profileShare.css";

const profileLink = "https://linky.fit/p/dave";

const dave = {
  lightningAddress: "dave@linky.fit",
  status: "Climbing on Thursdays 🧗",
  about: "Builder. Pays for lunch in sats.",
  currencies: ["CZK", "EUR"],
};

// Mirrors the link-preview tags api/_profilePage.ts renders for chat apps.
function ProfileLinkPreview() {
  return (
    <LinkPreview
      site="linky.fit"
      faviconUri="/icon.svg"
      title="Dave on Linky"
      description={dave.about}
      imageUri={avatarUri("Dave")}
      href={profileLink}
    />
  );
}

function Arrive({ children }: { children: ReactNode }) {
  return <Stack className="chat-pay-arrive">{children}</Stack>;
}

/** A chat in Signal, the messenger the profile link travels through. */
function SignalChat({
  contact,
  children,
  composer,
}: {
  contact: Person;
  children: ReactNode;
  composer?: ReactNode;
}) {
  return (
    <>
      <TopBar
        leading={
          <IconButton
            icon="ChevronLeft"
            size="sm"
            accessibilityLabel="Back"
            onPress={noop}
          />
        }
        content={
          <Row gap="$sm">
            <Avatar name={contact} uri={avatarUri(contact)} size="sm" />
            <Text variant="label" bold color="$colorSubtle">
              {contact}
            </Text>
          </Row>
        }
        trailing={
          <Stack
            width="$iconXl"
            height="$iconXl"
            borderRadius="$control"
            alignItems="center"
            justifyContent="center"
            style={{ backgroundColor: "#3B45FD" }}
          >
            <img
              src="/brands/signal.svg"
              alt="Signal"
              width={size.icon}
              height={size.icon}
            />
          </Stack>
        }
      />
      <DemoBody gap="$sm" paddingTop="$lg">
        <DaySeparator label="Today" />
        {children}
      </DemoBody>
      <Stack paddingHorizontal="$xl" paddingBottom="$xxl" gap="$sm">
        {composer}
      </Stack>
    </>
  );
}

function SignalComposer({
  draft,
  tapSend = false,
}: {
  draft: string;
  tapSend?: boolean;
}) {
  return (
    <Row gap="$sm" alignItems="center">
      <Stack
        flex={1}
        minHeight="$controlLg"
        justifyContent="center"
        paddingHorizontal="$lg"
        borderRadius="$pill"
        borderWidth={1}
        borderColor="$borderColor"
        backgroundColor="$surface"
      >
        <Text color={draft ? "$color" : "$colorMuted"} numberOfLines={1}>
          {draft || "Signal message"}
        </Text>
      </Stack>
      <Tap on={tapSend}>
        <IconButton
          icon="Send"
          variant={draft ? "primary" : "secondary"}
          accessibilityLabel="Send"
          onPress={noop}
        />
      </Tap>
    </Row>
  );
}

// In time order, as `useFlow` plays them.
const shareCues = {
  tapShare: 1400,
  sheet: 1700,
  tapSignal: 3300,
  signal: 3600,
  tapSend: 5200,
  sent: 5500,
};

const shareApps = [
  { name: "Signal", slug: "signal", color: "#3B45FD" },
  { name: "WhatsApp", slug: "whatsapp", color: "#25D366" },
  { name: "Telegram", slug: "telegram", color: "#26A5E4" },
  { name: "Messenger", slug: "messenger", color: "#0866FF" },
];

function ShareSheet({ tapSignal }: { tapSignal: boolean }) {
  return (
    <Stack {...fill} zIndex="$overlay" justifyContent="flex-end">
      <Stack
        className="profile-share-backdrop"
        {...fill}
        backgroundColor="$colorStrong"
      />
      <Stack
        className="profile-share-sheet"
        gap="$lg"
        padding="$xl"
        paddingBottom="$huge"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        backgroundColor="$surface"
      >
        <Row gap="$md" alignItems="center">
          <Avatar name="Dave" uri={avatarUri("Dave")} size="md" />
          <Stack flex={1} gap="$xxs">
            <Text variant="label" bold>
              Dave on Linky
            </Text>
            <Text variant="caption" color="$colorMuted">
              linky.fit/p/dave
            </Text>
          </Stack>
          <IconButton
            icon="X"
            size="sm"
            accessibilityLabel="Close"
            onPress={noop}
          />
        </Row>
        <Divider />
        <Row justifyContent="space-between">
          {shareApps.map(({ name, slug, color }) => (
            <Stack key={slug} alignItems="center" gap="$xs">
              <Tap on={slug === "signal" && tapSignal}>
                <Stack
                  width="$controlLg"
                  height="$controlLg"
                  borderRadius="$card"
                  alignItems="center"
                  justifyContent="center"
                  style={{ backgroundColor: color }}
                >
                  <img
                    src={`/brands/${slug}.svg`}
                    alt=""
                    width={size.iconLg}
                    height={size.iconLg}
                  />
                </Stack>
              </Tap>
              <Text variant="caption">{name}</Text>
            </Stack>
          ))}
        </Row>
        <Stack gap="$xs">
          <ListRow
            leading={<Icon name="Copy" size="md" />}
            title="Copy"
            chevron={false}
          />
          <ListRow
            leading={<Icon name="QrCode" size="md" />}
            title="Show QR code"
            chevron={false}
          />
        </Stack>
      </Stack>
    </Stack>
  );
}

function ProfileScene({
  tapShare,
  sheet,
  tapSignal,
}: {
  tapShare: boolean;
  sheet: boolean;
  tapSignal: boolean;
}) {
  return (
    <>
      <DemoTopBar title="Profile" trailing="Pencil" />
      <DemoBody alignItems="center" gap="$sm" paddingTop="$lg">
        <Avatar name="Dave" uri={avatarUri("Dave")} size="lg" />
        <Text variant="display" textAlign="center">
          Dave
        </Text>
        <QRCode value={profileLink} accessibilityLabel="Copy" badge="Copy" />
        <Tap on={tapShare}>
          <Button variant="secondary" size="sm" icon="Share2" onPress={noop}>
            Share profile
          </Button>
        </Tap>
        <Button variant="ghost" size="sm" icon="Copy" onPress={noop}>
          {dave.lightningAddress}
        </Button>
        <Text color="$colorMuted" textAlign="center">
          {dave.status}
        </Text>
      </DemoBody>
      <DemoTabBar active="profile" />
      {sheet ? <ShareSheet tapSignal={tapSignal} /> : null}
    </>
  );
}

/** Dave shares his profile link from the Profile tab to Mia in Signal. */
export function ProfileShareScreen() {
  const at = useFlow(shareCues);
  return (
    <FlowScenes
      current={at("signal") ? 1 : 0}
      scenes={[
        {
          node: (
            <ProfileScene
              tapShare={at("tapShare")}
              sheet={at("sheet")}
              tapSignal={at("tapSignal")}
            />
          ),
        },
        {
          node: (
            <SignalChat
              contact="Mia Novak"
              composer={
                at("sent") ? (
                  <SignalComposer draft="" />
                ) : (
                  <>
                    <Arrive>
                      <ProfileLinkPreview />
                    </Arrive>
                    <SignalComposer
                      draft={profileLink}
                      tapSend={at("tapSend")}
                    />
                  </>
                )
              }
            >
              <Message>Climbing on Thursday? 🧗</Message>
              <Message outgoing>Sure! Add me on Linky, it’s easier</Message>
              {at("sent") ? (
                <Arrive>
                  <MessageBubble direction="outgoing">
                    <ProfileLinkPreview />
                    <Text color="$accentText">{profileLink}</Text>
                  </MessageBubble>
                </Arrive>
              ) : null}
            </SignalChat>
          ),
          enter: "push",
        },
      ]}
    />
  );
}

// In time order, as `useFlow` plays them.
const openCues = {
  tapPreview: 1500,
  page: 1800,
  tapOpen: 4300,
  linky: 4600,
  tapSend: 6400,
  sent: 6700,
  reply: 8000,
};

function BrowserScene({ tapOpen }: { tapOpen: boolean }) {
  return (
    <>
      <Stack paddingHorizontal="$xl" paddingVertical="$sm">
        <Row
          gap="$xs"
          justifyContent="center"
          minHeight="$control"
          borderRadius="$pill"
          backgroundColor="$neutralSoft"
        >
          <Icon name="Lock" size="sm" color="$colorMuted" />
          <Text variant="label">linky.fit/p/dave</Text>
        </Row>
      </Stack>
      <Row paddingHorizontal="$xl" paddingVertical="$md" gap="$sm">
        <BrandMark size="iconXl" />
        <Text variant="title" bold color="$colorStrong">
          Linky
        </Text>
      </Row>
      <DemoBody alignItems="center" gap="$xxl" paddingTop="$xxl">
        <Stack alignItems="center" gap="$md">
          <Avatar name="Dave" uri={avatarUri("Dave")} size="lg" />
          <Stack alignItems="center" gap="$xs">
            <Text variant="display" color="$colorStrong">
              Dave
            </Text>
            <Row gap="$xs">
              <Icon name="Zap" size="sm" color="$colorMuted" />
              <Text variant="label" color="$colorMuted">
                {dave.lightningAddress}
              </Text>
            </Row>
          </Stack>
          <Text variant="title" textAlign="center">
            {dave.status}
          </Text>
          <Row gap="$sm" justifyContent="center">
            <Text variant="label" color="$colorMuted">
              Provides
            </Text>
            {dave.currencies.map((currency) => (
              <Pill key={currency} label={currency} tone="accent" size="sm" />
            ))}
          </Row>
        </Stack>
        <Text color="$colorMuted" textAlign="center">
          {dave.about}
        </Text>
        <Tap on={tapOpen} alignSelf="stretch">
          <Button icon="MessageCircle" onPress={noop}>
            Open in Linky
          </Button>
        </Tap>
      </DemoBody>
    </>
  );
}

function LinkyComposer({
  draft,
  tapSend,
}: {
  draft: string;
  tapSend: boolean;
}) {
  const input = useRef<HTMLDivElement>(null);
  // RichTextInput is a contentEditable host whose content the caller writes.
  useLayoutEffect(() => {
    if (input.current) input.current.textContent = draft;
  }, [draft]);
  return (
    <Stack paddingBottom="$xl">
      <MessageComposerFrame
        footer={
          <Row gap="$sm">
            <Button flex={1} variant="secondary" icon="Request" onPress={noop}>
              Request
            </Button>
            <Button
              flex={1}
              variant="secondary"
              icon="HandCoins"
              onPress={noop}
            >
              Pay
            </Button>
          </Row>
        }
      >
        <RichTextInput
          ref={input}
          placeholder="Message"
          empty={draft === ""}
          trailing={
            <Tap on={tapSend}>
              <IconButton
                icon={draft ? "Send" : "Images"}
                variant={draft ? "primary" : "secondary"}
                size="sm"
                accessibilityLabel="Send"
                onPress={noop}
              />
            </Tap>
          }
        />
      </MessageComposerFrame>
    </Stack>
  );
}

/** Mia opens Dave's profile link and Linky greets him in a new conversation. */
export function ProfileOpenScreen() {
  const at = useFlow(openCues);
  return (
    <FlowScenes
      current={[at("page"), at("linky")].filter(Boolean).length}
      scenes={[
        {
          node: (
            <SignalChat contact="Dave" composer={<SignalComposer draft="" />}>
              <Message outgoing>Climbing on Thursday? 🧗</Message>
              <Message>Sure! Add me on Linky, it’s easier</Message>
              <Tap on={at("tapPreview")}>
                <MessageBubble direction="incoming">
                  <ProfileLinkPreview />
                  <Text color="$accentText">{profileLink}</Text>
                </MessageBubble>
              </Tap>
            </SignalChat>
          ),
        },
        { node: <BrowserScene tapOpen={at("tapOpen")} />, enter: "push" },
        {
          node: (
            <>
              <DemoTopBar
                contact="Dave"
                leading="ChevronLeft"
                trailing="Pencil"
              />
              <DemoBody gap="$sm" paddingTop="$lg">
                <DaySeparator label="Today" />
                {at("sent") ? (
                  <Arrive>
                    <Message outgoing time="06:42 PM">
                      Hi 👋
                    </Message>
                  </Arrive>
                ) : null}
                {at("reply") ? (
                  <Arrive>
                    <Message time="06:42 PM">
                      Hey Mia! See you Thursday 🧗
                    </Message>
                  </Arrive>
                ) : null}
              </DemoBody>
              <LinkyComposer
                draft={at("sent") ? "" : "Hi 👋"}
                tapSend={at("tapSend")}
              />
            </>
          ),
          enter: "push",
        },
      ]}
    />
  );
}
