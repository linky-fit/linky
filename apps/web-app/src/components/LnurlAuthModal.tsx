import { Button, Dialog, Stack, Text, enterScale } from "@linky-fit/ui";
import React from "react";
import type { I18nKey, Translate } from "../i18n";
import type { LnurlAuthAction, LnurlAuthPreview } from "../lnurlAuth";
import { LoginIconRing } from "./LoginIconRing";

const DONE_TITLE_KEY_BY_ACTION: Record<LnurlAuthAction, I18nKey> = {
  auth: "lnurlAuthDoneAuth",
  link: "lnurlAuthDoneLink",
  login: "lnurlAuthDoneLogin",
  register: "lnurlAuthDoneRegister",
};

export type LnurlAuthPhase = "confirm" | "busy" | "done";

interface LnurlAuthModalProps {
  confirmation: LnurlAuthPreview;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  phase: LnurlAuthPhase;
  t: Translate;
}

const pop = { opacity: 0, scale: enterScale.pop } as const;
const ignoreDismiss = () => {};

/**
 * One dialog for the whole login: it names the domain and asks for consent,
 * shows the request in flight, and then pops the padlock open once the domain
 * confirmed. Tapping outside does nothing — the user either confirms or
 * cancels.
 */
export function LnurlAuthModal({
  confirmation,
  onClose,
  onConfirm,
  phase,
  t,
}: LnurlAuthModalProps): React.ReactElement {
  const isDone = phase === "done";
  const isBusy = phase === "busy";
  const title = isDone
    ? t(DONE_TITLE_KEY_BY_ACTION[confirmation.action])
    : confirmation.domain;

  return (
    <Dialog
      open
      onOpenChange={ignoreDismiss}
      title={title}
      hideTitle
      actions={
        isDone ? null : (
          <>
            <Button loading={isBusy} onPress={() => void onConfirm()}>
              {t("lnurlAuthConfirm")}
            </Button>
            <Button variant="secondary" disabled={isBusy} onPress={onClose}>
              {t("payCancel")}
            </Button>
          </>
        )
      }
    >
      <Stack
        key={isDone ? "done" : "pending"}
        alignItems="center"
        gap="$sm"
        transition="slow"
        enterStyle={isDone ? pop : null}
      >
        <Stack marginBottom="$sm">
          <LoginIconRing icon={isDone ? "LockOpen" : "Lock"} />
        </Stack>
        {isDone ? (
          <>
            <Text
              variant="heading"
              textAlign="center"
              role="status"
              aria-live="assertive"
            >
              {title}
            </Text>
            <Text bold color="$accentText" textAlign="center">
              {confirmation.domain}
            </Text>
            <Text variant="caption" color="$colorMuted" textAlign="center">
              {t("lnurlAuthDoneHint")}
            </Text>
          </>
        ) : (
          <Text bold textAlign="center">
            {title}
          </Text>
        )}
      </Stack>
    </Dialog>
  );
}
