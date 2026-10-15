import {
  BrandHero,
  Button,
  IconButton,
  Row,
  Stack,
  Text,
  TextField,
  TopBar,
} from "@linky-fit/ui";
import { DemoTopBar } from "./chrome";
import { FlowScenes, Tap } from "./flow";
import { ContactsScreen } from "./home";
import { noop } from "./noop";
import { useCues, useFlow } from "./playback";
import "./restorePaste.css";

// In time order, as `useFlow` plays them.
const restoreCues = {
  tapReturn: 1000,
  restore: 1300,
  tapPaste: 2700,
  pasted: 3000,
  submit: 3800,
  scroll: 3900,
  app: 6000,
};

// The first SLIP-39 test vector: valid words, and words 3 and 4 are "academic" like in every Linky backup.
const backup =
  "duckling enlarge academic academic agency result length solution fridge kidney coal piece deal husband erode duke ajar critical decision keyboard".split(
    " ",
  );

// Pasting fills every field at once; the demo fans the words out so the eye can follow.
const wordTicks = backup.map((_, index) => restoreCues.pasted + index * 40);

function WelcomeScene({ tapReturn }: { tapReturn: boolean }) {
  return (
    <>
      <TopBar
        trailing={
          <Row gap="$xs">
            <IconButton
              icon="Languages"
              size="sm"
              accessibilityLabel="Language"
              onPress={noop}
            />
            <IconButton
              icon="Monitor"
              size="sm"
              accessibilityLabel="Appearance"
              onPress={noop}
            />
          </Row>
        }
      />
      <Stack
        flex={1}
        justifyContent="center"
        alignItems="center"
        gap="$huge"
        paddingHorizontal="$xl"
      >
        <BrandHero />
        <Stack gap="$xs">
          <Text variant="display" textAlign="center">
            Linky
          </Text>
          <Text color="$colorMuted" textAlign="center">
            Start building your bitcoin network.
          </Text>
        </Stack>
      </Stack>
      <Stack gap="$sm" paddingHorizontal="$xl" paddingBottom="$huge">
        <Button onPress={noop}>Create a profile</Button>
        <Tap on={tapReturn}>
          <Button variant="secondary" onPress={noop}>
            I already have a profile
          </Button>
        </Tap>
        <Text variant="caption" color="$colorMuted" textAlign="center">
          No phone number or e-mail needed.
        </Text>
      </Stack>
    </>
  );
}

function RestoreScene({
  filled,
  tapPaste,
  submitting,
  scrolled,
}: {
  filled: number;
  tapPaste: boolean;
  submitting: boolean;
  scrolled: boolean;
}) {
  return (
    <>
      <DemoTopBar leading="ChevronLeft" trailing="Settings" />
      <Stack flex={1} position="relative" overflow="hidden">
        <Stack
          className={`restore-form ${scrolled ? "restore-form-end" : ""}`}
          position="absolute"
          left="$none"
          right="$none"
          gap="$xl"
          paddingHorizontal="$xl"
          paddingVertical="$xxl"
        >
          <Stack gap="$xs">
            <Text variant="heading" textAlign="center">
              Welcome back
            </Text>
            <Text color="$colorMuted" textAlign="center">
              Enter your 20 SLIP-39 words. You can type them manually or paste
              them here.
            </Text>
          </Stack>
          <Stack gap="$sm">
            <Tap on={tapPaste}>
              <Button variant="secondary" icon="ClipboardPaste" onPress={noop}>
                Paste from clipboard
              </Button>
            </Tap>
            <Text variant="caption" color="$colorMuted" textAlign="center">
              Or type the words one by one.
            </Text>
          </Stack>
          <Stack gap="$sm">
            <Row flexWrap="wrap" gap="$sm">
              {backup.map((word, index) => (
                <Stack key={index} flexBasis="40%" flexGrow={1}>
                  <TextField
                    label={`Word ${index + 1}`}
                    hideLabel
                    value={index < filled ? word : ""}
                    onChangeText={noop}
                    trailing={String(index + 1)}
                  />
                </Stack>
              ))}
            </Row>
            <Text variant="caption" color="$colorMuted">
              {filled}/20 words
            </Text>
            <Text variant="caption" color="$colorMuted">
              Words 3 and 4 of a Linky backup are always “academic”, so that is
              not a typo.
            </Text>
          </Stack>
        </Stack>
      </Stack>
      <Stack paddingHorizontal="$xl" paddingTop="$xs" paddingBottom="$huge">
        <Button
          disabled={filled < backup.length}
          loading={submitting}
          onPress={noop}
        >
          Continue
        </Button>
      </Stack>
    </>
  );
}

/** Dave restores his account on a new phone by pasting the 20-word backup in one tap. */
export function RestorePasteScreen() {
  const at = useFlow(restoreCues);
  const filled = useCues(wordTicks);
  return (
    <FlowScenes
      current={[at("restore"), at("app")].filter(Boolean).length}
      scenes={[
        { node: <WelcomeScene tapReturn={at("tapReturn")} /> },
        {
          node: (
            <RestoreScene
              filled={filled}
              tapPaste={at("tapPaste")}
              submitting={at("submit")}
              scrolled={at("scroll")}
            />
          ),
          enter: "push",
        },
        { node: <ContactsScreen />, enter: "modal" },
      ]}
    />
  );
}
