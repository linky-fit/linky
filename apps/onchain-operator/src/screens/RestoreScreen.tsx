import {
  Form,
  IconButton,
  Stack,
  SubmitButton,
  Text,
  TextField,
} from "@linky-fit/ui";
import { Result } from "effect";
import { useState } from "react";
import { copy } from "../copy/en";
import { pasteText } from "../platform/clipboard";
import { useDevice } from "../services/react";
import { looksLikeRecoverySeed } from "../storage/account";
import { Page } from "./Page";

/** Sign-in from a Linky recovery seed; a pasted or autofilled seed restores at once. */
export function RestoreScreen() {
  const device = useDevice();
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const restore = async (text: string) => {
    if (restoring) return;
    setRestoring(true);
    setError(null);
    const restored = await device.restoreAccount(text);
    if (Result.isFailure(restored)) {
      setError(copy.restore.invalid);
      setRestoring(false);
    }
  };
  /** Restores right away when a whole seed arrives at once, e.g. a paste or an autofill. */
  const change = (text: string) => {
    const arrivedWhole = text.length - seed.length > 1;
    setSeed(text);
    setError(null);
    if (arrivedWhole && looksLikeRecoverySeed(text)) void restore(text);
  };
  const paste = async () => {
    const text = await pasteText();
    if (text === null) setError(copy.restore.pasteFailed);
    else change(text);
  };

  return (
    <Page testID="restore-screen" centered>
      <Stack gap="$sm">
        <Text variant="heading" role="heading">
          {copy.restore.title}
        </Text>
        <Text color="$colorMuted">{copy.restore.description}</Text>
      </Stack>
      <Form onSubmit={() => void restore(seed)} gap="$xl">
        <TextField
          testID="restore-seed"
          label={copy.restore.field}
          name="password"
          type="password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoFocus
          value={seed}
          onChangeText={change}
          error={error ?? undefined}
          trailing={
            <IconButton
              testID="restore-paste"
              icon="ClipboardPaste"
              size="sm"
              accessibilityLabel={copy.restore.paste}
              onPress={() => void paste()}
            />
          }
        />
        <SubmitButton
          testID="restore-submit"
          icon="RefreshCcw"
          loading={restoring}
          disabled={!looksLikeRecoverySeed(seed)}
        >
          {copy.restore.submit}
        </SubmitButton>
      </Form>
    </Page>
  );
}
