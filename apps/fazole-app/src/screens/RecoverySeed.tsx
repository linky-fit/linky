import { Button, Card, Notice, Stack, Text, type Tone } from "@linky-fit/ui";
import { useState } from "react";
import { copy } from "../copy";
import { copyText } from "../platform/clipboard";
import { saveRecoverySeedToPasswordManager } from "../platform/passwordManager";
import { useAppServices } from "../services/react";

type Feedback = "copied" | "copyFailed" | "saved" | "unsupported" | "failed";

const feedbackNotices: Record<Feedback, { title: string; tone: Tone }> = {
  copied: { title: copy.recoverySeed.copied, tone: "accent" },
  copyFailed: { title: copy.recoverySeed.copyFailed, tone: "danger" },
  saved: { title: copy.recoverySeed.saveRequested, tone: "info" },
  unsupported: { title: copy.recoverySeed.saveUnavailable, tone: "warning" },
  failed: { title: copy.recoverySeed.saveFailed, tone: "danger" },
};

const MASK = "•••••";

/** The recovery seed, masked until revealed, to save to a password manager or copy. */
export function RecoverySeed({
  shopName,
}: {
  readonly shopName: string | null;
}) {
  const { account } = useAppServices();
  const [visible, setVisible] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const words = account.recoverySeed.trim().split(/\s+/u);
  const notice = feedback ? feedbackNotices[feedback] : null;

  return (
    <Stack gap="$lg">
      <Text color="$colorMuted">{copy.recoverySeed.description}</Text>
      <Card backgroundColor="$neutralSoft" testID="recovery-seed">
        <Text mono color="$colorStrong">
          {visible ? words.join(" ") : words.map(() => MASK).join(" ")}
        </Text>
      </Card>
      <Stack gap="$sm">
        <Button
          testID="recovery-seed-toggle"
          variant="secondary"
          icon={visible ? "EyeOff" : "Eye"}
          onPress={() => setVisible((current) => !current)}
        >
          {visible ? copy.recoverySeed.hide : copy.recoverySeed.show}
        </Button>
        <Button
          variant="secondary"
          icon="Copy"
          onPress={async () =>
            setFeedback(
              (await copyText(account.recoverySeed)) ? "copied" : "copyFailed",
            )
          }
        >
          {copy.recoverySeed.copy}
        </Button>
        <Button
          variant="secondary"
          icon="ShieldCheck"
          onPress={async () =>
            setFeedback(
              await saveRecoverySeedToPasswordManager(account, shopName),
            )
          }
        >
          {copy.recoverySeed.save}
        </Button>
      </Stack>
      {notice ? <Notice tone={notice.tone} title={notice.title} /> : null}
      <Notice tone="warning" title={copy.recoverySeed.warning} />
    </Stack>
  );
}
