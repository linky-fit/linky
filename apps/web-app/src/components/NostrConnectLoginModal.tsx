import {
  Avatar,
  Button,
  Card,
  Dialog,
  Icon,
  Pill,
  Row,
  Stack,
  Text,
  enterScale,
} from "@linky-fit/ui";
import React from "react";
import type { Translate } from "../i18n";
import {
  describeNostrConnectSite,
  requestsDeviceAuthorization,
  type NostrConnectRequest,
} from "../nostrConnect";
import { formatShortNpub } from "../utils/formatting";
import { LoginIconRing } from "./LoginIconRing";

export type NostrConnectLoginPhase = "confirm" | "busy" | "done";

export interface NostrConnectLoginIdentity {
  name: string | null;
  npub: string | null;
  picture: string | null;
}

interface NostrConnectLoginModalProps {
  identity: NostrConnectLoginIdentity;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  phase: NostrConnectLoginPhase;
  request: NostrConnectRequest;
  t: Translate;
}

const pop = { opacity: 0, scale: enterScale.pop } as const;
const ignoreDismiss = () => {};

/**
 * One dialog for the whole login: it shows the site as it names itself and the
 * identity it will learn, waits for the site while the handshake runs, and
 * pops the padlock open once the login is sent. Tapping outside does nothing,
 * so the user either confirms or cancels.
 */
export function NostrConnectLoginModal({
  identity,
  onClose,
  onConfirm,
  phase,
  request,
  t,
}: NostrConnectLoginModalProps): React.ReactElement {
  const isDone = phase === "done";
  const isBusy = phase === "busy";
  const site = describeNostrConnectSite(request);
  const siteLabel = site.label ?? t("nostrConnectLoginUnknownSite");
  const linksDevice = requestsDeviceAuthorization(request);
  const title = isDone
    ? t("nostrConnectLoginDone").replace("{site}", siteLabel)
    : siteLabel;

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
              {t(
                isBusy
                  ? "nostrConnectLoginWaiting"
                  : linksDevice
                    ? "nostrConnectLoginConfirmDevice"
                    : "nostrConnectLoginConfirm",
              )}
            </Button>
            <Button variant="secondary" disabled={isBusy} onPress={onClose}>
              {t("payCancel")}
            </Button>
          </>
        )
      }
    >
      {isDone ? (
        <Stack
          key="done"
          alignItems="center"
          gap="$sm"
          transition="slow"
          enterStyle={pop}
        >
          <Stack marginBottom="$sm">
            <LoginIconRing icon="LockOpen" />
          </Stack>
          <Text
            variant="heading"
            textAlign="center"
            role="status"
            aria-live="assertive"
          >
            {title}
          </Text>
          <Text variant="caption" color="$colorMuted" textAlign="center">
            {t("nostrConnectLoginDoneHint")}
          </Text>
        </Stack>
      ) : (
        <Stack key="confirm" gap="$lg">
          <Stack alignItems="center" gap="$sm">
            <Stack marginBottom="$sm">
              {request.image ? (
                <Avatar size="lg" name={siteLabel} uri={request.image} />
              ) : (
                <LoginIconRing icon="KeyRound" />
              )}
            </Stack>
            <Text variant="heading" textAlign="center">
              {siteLabel}
            </Text>
            <Row gap="$xs" justifyContent="center">
              {site.host && site.host !== siteLabel ? (
                <Text variant="caption" color="$colorMuted" numberOfLines={1}>
                  {site.host}
                </Text>
              ) : null}
              <Pill
                size="sm"
                tone="neutral"
                label={t("nostrConnectLoginUnverified")}
              />
            </Row>
          </Stack>
          <IdentityCard identity={identity} t={t} />
          {linksDevice ? (
            <Row alignItems="flex-start" gap="$sm">
              <Icon name="Smartphone" size="sm" color="$colorMuted" />
              <Text variant="caption" color="$colorMuted" flex={1}>
                {t("nostrConnectLoginLinksDevice").replaceAll(
                  "{site}",
                  siteLabel,
                )}
              </Text>
            </Row>
          ) : null}
          <Row alignItems="flex-start" gap="$sm">
            <Icon name="ShieldCheck" size="sm" color="$colorMuted" />
            <Text variant="caption" color="$colorMuted" flex={1}>
              {t("nostrConnectLoginShares")}
            </Text>
          </Row>
        </Stack>
      )}
    </Dialog>
  );
}

function IdentityCard({
  identity,
  t,
}: {
  identity: NostrConnectLoginIdentity;
  t: Translate;
}): React.ReactElement {
  const shortNpub = identity.npub ? formatShortNpub(identity.npub) : null;
  const name = identity.name ?? shortNpub ?? "?";
  return (
    <Card outlined gap="$sm" padding="$md">
      <Text eyebrow>{t("nostrConnectLoginAs")}</Text>
      <Row>
        <Avatar name={name} uri={identity.picture ?? undefined} />
        <Stack flex={1} minWidth={0}>
          <Text bold numberOfLines={1}>
            {name}
          </Text>
          {identity.name && shortNpub ? (
            <Text variant="caption" mono color="$colorMuted" numberOfLines={1}>
              {shortNpub}
            </Text>
          ) : null}
        </Stack>
      </Row>
    </Card>
  );
}
