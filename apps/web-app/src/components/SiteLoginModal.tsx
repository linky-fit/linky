import {
  Avatar,
  Button,
  Card,
  Dialog,
  Icon,
  Pill,
  Row,
  Spinner,
  Stack,
  Text,
  enterScale,
} from "@linky-fit/ui";
import React from "react";
import type { I18nKey, Translate } from "../i18n";
import {
  describeSiteLogin,
  type PendingSiteLogin,
  type SiteLoginRefusal,
  type SiteLoginRequest,
} from "../siteLogin";
import { formatShortNpub } from "../utils/formatting";
import { LoginIconRing } from "./LoginIconRing";

export type SiteLoginPhase = "confirm" | "busy" | "done";

export interface SiteLoginIdentity {
  name: string | null;
  npub: string | null;
  picture: string | null;
}

interface SiteLoginModalProps {
  identity: SiteLoginIdentity;
  login: PendingSiteLogin;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  phase: SiteLoginPhase;
  t: Translate;
}

const pop = { opacity: 0, scale: enterScale.pop } as const;
const ignoreDismiss = () => {};

const REFUSAL_COPY: Record<
  SiteLoginRefusal,
  { title: I18nKey; hint: I18nKey }
> = {
  "unverified-domain": {
    title: "siteLoginCannotVerify",
    hint: "siteLoginCannotVerifyHint",
  },
  "callback-not-listed": {
    title: "siteLoginCallbackNotListed",
    hint: "siteLoginCallbackNotListedHint",
  },
  "malformed-link": {
    title: "siteLoginInvalidLink",
    hint: "siteLoginInvalidLinkHint",
  },
  "linkauth-available": {
    title: "siteLoginSupportsLinky",
    hint: "siteLoginSupportsLinkyHint",
  },
};

const withSite = (text: string, site: string | null): string =>
  text.replaceAll("{site}", site ?? "");

/**
 * One dialog for a site login. It leads with the origin the login is bound
 * to. A `#linkauth` site is checked first, then shown with a Verified marker on
 * the origin and, below it, the name and logo from its own domain document
 * labelled as the site's claim: any origin can publish any name. A link that
 * cannot be verified, or a relay request to a site that supports Linky login,
 * gets only an explanation and a Close button. Any other relay request marks
 * the origin unverified. The approval names the identity the site will see.
 * The padlock pops open once the login is sent. A request Linky would not
 * sign has no origin and no approve button. Tapping outside does nothing, so
 * the user either confirms or cancels.
 */
export function SiteLoginModal({
  identity,
  login,
  onClose,
  onConfirm,
  phase,
  t,
}: SiteLoginModalProps): React.ReactElement {
  if (login.channel === "checking") {
    const title = withSite(t("siteLoginChecking"), login.origin);
    return (
      <Shell
        title={title}
        actions={
          <Button variant="secondary" onPress={onClose}>
            {t("payCancel")}
          </Button>
        }
      >
        <Stack key="checking" alignItems="center" gap="$sm">
          <Stack marginBottom="$sm">
            <LoginIconRing icon="KeyRound" />
          </Stack>
          <Text variant="heading" textAlign="center" role="status">
            {title}
          </Text>
          <Spinner accessibilityLabel={t("siteLoginChecking")} />
          <Text variant="caption" color="$colorMuted" textAlign="center">
            {t("siteLoginCheckingHint")}
          </Text>
        </Stack>
      </Shell>
    );
  }
  if (login.channel === "refused") {
    const copy = REFUSAL_COPY[login.reason];
    const title = withSite(t(copy.title), login.origin);
    return (
      <Shell
        title={title}
        actions={
          <Button variant="secondary" onPress={onClose}>
            {t("close")}
          </Button>
        }
      >
        <Refusal title={title} hint={withSite(t(copy.hint), login.origin)} />
      </Shell>
    );
  }
  return (
    <ApprovalDialog
      identity={identity}
      login={login}
      onClose={onClose}
      onConfirm={onConfirm}
      phase={phase}
      t={t}
    />
  );
}

function Shell({
  actions,
  children,
  title,
}: {
  actions: React.ReactNode;
  children: React.ReactNode;
  title: string;
}): React.ReactElement {
  return (
    <Dialog
      open
      onOpenChange={ignoreDismiss}
      title={title}
      hideTitle
      actions={actions}
    >
      {children}
    </Dialog>
  );
}

function Refusal({
  hint,
  title,
}: {
  hint: string;
  title: string;
}): React.ReactElement {
  return (
    <Stack key="refused" alignItems="center" gap="$sm">
      <Stack marginBottom="$sm">
        <LoginIconRing icon="ShieldAlert" />
      </Stack>
      <Text variant="heading" textAlign="center">
        {title}
      </Text>
      <Text variant="caption" color="$colorMuted" textAlign="center">
        {hint}
      </Text>
    </Stack>
  );
}

function ApprovalDialog({
  identity,
  login,
  onClose,
  onConfirm,
  phase,
  t,
}: Omit<SiteLoginModalProps, "login"> & {
  login: SiteLoginRequest;
}): React.ReactElement {
  const isDone = phase === "done";
  const isBusy = phase === "busy";
  const { audience, fromOtherScreen, image, linksDevice, name, verified } =
    describeSiteLogin(login);
  const title = isDone
    ? withSite(t("siteLoginDone"), audience)
    : (audience ?? t("siteLoginUnsupported"));
  const doneHintKey: I18nKey =
    login.channel === "relay"
      ? "siteLoginDoneHint"
      : login.login.delivery.kind === "callback"
        ? "siteLoginDoneReturning"
        : "siteLoginDoneOtherDevice";

  return (
    <Shell
      title={title}
      actions={
        isDone ? null : (
          <>
            {audience === null ? null : (
              <Button loading={isBusy} onPress={() => void onConfirm()}>
                {t(
                  isBusy
                    ? "siteLoginWaiting"
                    : linksDevice
                      ? "siteLoginConfirmDevice"
                      : "siteLoginConfirm",
                )}
              </Button>
            )}
            <Button variant="secondary" disabled={isBusy} onPress={onClose}>
              {t(audience === null ? "close" : "payCancel")}
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
            {t(doneHintKey)}
          </Text>
        </Stack>
      ) : audience === null ? (
        <Refusal title={title} hint={t("siteLoginUnsupportedHint")} />
      ) : (
        <Stack key="confirm" gap="$lg">
          <Stack alignItems="center" gap="$xs">
            <Stack marginBottom="$sm">
              <LoginIconRing icon="KeyRound" image={verified ? image : null} />
            </Stack>
            <Text eyebrow>{t("siteLoginTo")}</Text>
            <Text
              variant="title"
              textAlign="center"
              wordWrap="break-word"
              testID="site-login-origin"
            >
              {audience}
            </Text>
            <Row justifyContent="center" marginTop="$xs">
              <Pill
                size="sm"
                tone={verified ? "accent" : "neutral"}
                leading={
                  <Icon
                    name={verified ? "ShieldCheck" : "ShieldAlert"}
                    size="sm"
                    color={verified ? "$accentText" : "$colorMuted"}
                  />
                }
                label={t(
                  verified ? "siteLoginVerified" : "siteLoginUnverified",
                )}
              />
            </Row>
            {name ? (
              <Stack alignItems="center" marginTop="$sm">
                <Text variant="label" bold textAlign="center">
                  {name}
                </Text>
                <Text variant="caption" color="$colorMuted" textAlign="center">
                  {t("siteLoginNameClaim")}
                </Text>
              </Stack>
            ) : null}
          </Stack>
          <IdentityCard audience={audience} identity={identity} t={t} />
          {linksDevice ? (
            <Row alignItems="flex-start" gap="$sm">
              <Icon name="Smartphone" size="sm" color="$colorMuted" />
              <Text variant="caption" color="$colorMuted" flex={1}>
                {withSite(t("siteLoginLinksDevice"), audience)}
              </Text>
            </Row>
          ) : null}
          <Row alignItems="flex-start" gap="$sm">
            <Icon name="ShieldCheck" size="sm" color="$colorMuted" />
            <Text variant="caption" color="$colorMuted" flex={1}>
              {withSite(t("siteLoginShares"), audience)}
            </Text>
          </Row>
          {fromOtherScreen ? (
            <Row alignItems="flex-start" gap="$sm">
              <Icon name="ShieldAlert" size="sm" color="$colorMuted" />
              <Text variant="caption" color="$colorMuted" flex={1}>
                {withSite(
                  t(
                    verified ? "siteLoginCheckAddress" : "siteLoginStartedHere",
                  ),
                  audience,
                )}
              </Text>
            </Row>
          ) : null}
        </Stack>
      )}
    </Shell>
  );
}

function IdentityCard({
  audience,
  identity,
  t,
}: {
  audience: string;
  identity: SiteLoginIdentity;
  t: Translate;
}): React.ReactElement {
  const shortNpub = identity.npub ? formatShortNpub(identity.npub) : null;
  const name = identity.name ?? shortNpub ?? "?";
  return (
    <Card outlined gap="$sm" padding="$md">
      <Text eyebrow>{t("siteLoginAs")}</Text>
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
      <Text variant="caption" color="$colorMuted">
        {withSite(t("siteLoginRevealsProfile"), audience)}
      </Text>
    </Card>
  );
}
