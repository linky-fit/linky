import {
  Divider,
  EmojiCatalog,
  EmojiPicker,
  Icon,
  ListRow,
  Row,
  Stack,
  Text,
  type EmojiCatalogGroup,
  type IconName,
} from "@linky-fit/ui";
import { ChatScreen, Message } from "./chat";
import { fill } from "./fill";
import { DemoSheet, Tap } from "./flow";
import { noop } from "./noop";
import { useFlow } from "./playback";

// In time order, as `useFlow` plays them.
const actionCues = {
  holdMia: 900,
  miaMenu: 1600,
  tapMore: 2700,
  catalog: 3000,
  tapEmoji: 4200,
  reacted: 4500,
  holdOwn: 5600,
  ownMenu: 6300,
  tapDelete: 7400,
  deleted: 7700,
};

// The web app's quick reactions and the start of its first catalog tab (apps/linky-app/src/app/lib/reactionEmojis.ts).
const quickReactions = ["❤️", "👍", "👎", "😂", "😮", "😢"];
const smileys = Array.from(
  "😀😃😄😁😆😅🤣😂🙂🙃🫠😉😊😇🥰😍🤩😘😗😚😙🥲😋😛😜🤪😝🤑🤗🤭🫢🫣🤫🤔🫡🤐🤨😐😑😶🫥😏😒🙄😬🤥😌😔😪",
);
const pickedEmoji = "🤩";

const emojiGroups: EmojiCatalogGroup[] = [
  { key: "smileys", label: "Smileys & People", icon: "Smile", emojis: smileys },
  ...(
    [
      ["Animals & Nature", "PawPrint"],
      ["Food & Drink", "Pizza"],
      ["Activities", "Volleyball"],
      ["Travel & Places", "Car"],
      ["Objects", "Lightbulb"],
      ["Symbols", "Hash"],
      ["Flags", "Flag"],
    ] as const
  ).map(([label, icon]) => ({ key: label, label, icon, emojis: [] })),
];

/** A touch on emoji `index` of a picker's grid; the picker's buttons take no children, so it sits on a matching grid above. */
function EmojiTouch({ index, top = false }: { index: number; top?: boolean }) {
  return (
    <Stack {...fill} gap="$sm" pointerEvents="none">
      {/* The catalog's tab row sits above its grid. */}
      {top ? <Stack height="$controlSm" /> : null}
      <Row flexWrap="wrap" gap="$xs">
        {Array.from({ length: index + 1 }, (_, slot) => (
          <Tap
            key={slot}
            on={slot === index}
            width="$control"
            height="$control"
          />
        ))}
      </Row>
    </Stack>
  );
}

interface MenuAction {
  icon: IconName;
  label: string;
}

const reply: MenuAction = { icon: "Reply", label: "Reply" };
const edit: MenuAction = { icon: "Pencil", label: "Edit" };
const copy: MenuAction = { icon: "Copy", label: "Copy" };
const remove: MenuAction = { icon: "Trash2", label: "Delete" };

/** The message menu: reactions on top, then the actions, as MessageActionsMenu lays them out. */
function MessageMenu({
  actions,
  closing,
  tapMore = false,
  catalog = false,
  tapEmoji = false,
  tapped,
}: {
  actions: readonly MenuAction[];
  closing: boolean;
  tapMore?: boolean;
  catalog?: boolean;
  tapEmoji?: boolean;
  tapped?: MenuAction | undefined;
}) {
  return (
    <DemoSheet closing={closing}>
      <Stack position="relative">
        {catalog ? (
          <>
            <EmojiCatalog
              accessibilityLabel="React"
              groups={emojiGroups}
              onSelect={noop}
            />
            {tapEmoji ? (
              <EmojiTouch index={smileys.indexOf(pickedEmoji)} top />
            ) : null}
          </>
        ) : (
          <>
            <EmojiPicker
              accessibilityLabel="React"
              emojis={quickReactions}
              onSelect={noop}
              more={{ label: "More emojis", onPress: noop }}
            />
            {tapMore ? <EmojiTouch index={quickReactions.length} /> : null}
          </>
        )}
      </Stack>
      <Divider />
      {actions.map((action) => (
        <Tap key={action.label} on={action === tapped}>
          <ListRow
            icon={action.icon}
            title={action.label}
            chevron={false}
            onPress={noop}
          />
        </Tap>
      ))}
    </DemoSheet>
  );
}

function DeletedMessage() {
  return (
    <Row gap="$xs" alignItems="center">
      <Icon name="Trash2" size="sm" color="$colorMuted" />
      <Text color="$colorMuted" fontStyle="italic">
        Message deleted
      </Text>
    </Row>
  );
}

/** Dave reacts to Mia's message with an emoji from the full list, then deletes a message he sent to the wrong chat. */
export function MessageActionsScreen() {
  const at = useFlow(actionCues);
  return (
    <>
      <ChatScreen contact="Mia Novak">
        <Message outgoing>Free this weekend?</Message>
        <Message reaction={at("reacted") ? pickedEmoji : undefined}>
          <Tap on={at("holdMia")} hold>
            <Text>
              Picnic by the lake on Saturday? I’ll bring the guitar 🎸
            </Text>
          </Tap>
        </Message>
        <Message outgoing>
          <Tap on={at("holdOwn")} hold>
            {at("deleted") ? (
              <DeletedMessage />
            ) : (
              <Text>Love you too, Mom 💛</Text>
            )}
          </Tap>
        </Message>
      </ChatScreen>
      {at("miaMenu") && !at("ownMenu") ? (
        <MessageMenu
          actions={[reply, copy, remove]}
          closing={at("reacted")}
          tapMore={at("tapMore")}
          catalog={at("catalog")}
          tapEmoji={at("tapEmoji")}
        />
      ) : null}
      {at("ownMenu") ? (
        <MessageMenu
          actions={[reply, edit, copy, remove]}
          closing={at("deleted")}
          tapped={at("tapDelete") ? remove : undefined}
        />
      ) : null}
    </>
  );
}
