import {
  linkauthLinks,
  type LinkauthLinksOptions,
} from "@linky-fit/linkauth/client";
import {
  Button,
  Card,
  LoadingState,
  ListRow,
  Notice,
  QRCode,
  Stack,
  Switch,
  Text,
} from "@linky-fit/ui";
import { nip19 } from "nostr-tools";
import { useEffect, useState, type ReactNode } from "react";
import { copyTextToClipboard } from "../clipboard";
import { SiteLayout } from "../SiteLayout";
import { useSiteLocale } from "../useSiteLocale";
import { callbackUrl, signerAppUrl } from "./config";
import { useDemoAuth, type DemoAuthState } from "./useDemoAuth";

const docsUrl =
  "https://github.com/linky-fit/linky/tree/main/packages/linkauth/docs";

const failureCopy = {
  denied: { title: "Login denied", description: "You declined in Linky." },
  timeout: {
    title: "Nobody answered",
    description: "No signer approved the login in time.",
  },
  error: {
    title: "Login failed",
    description: "The login could not be verified. Nothing was changed.",
  },
} as const;

function PageCard({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  return (
    <Card
      outlined
      testID={testID}
      gap="$lg"
      padding="$xxl"
      $compact={{ padding: "$lg" }}
    >
      {children}
    </Card>
  );
}

function CopyLinkButton({ value, testID }: { value: string; testID: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <Button
      testID={testID}
      variant="secondary"
      size="sm"
      onPress={() => {
        void copyTextToClipboard(value).then(setCopied);
      }}
    >
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

function OtherSigner({
  uri,
  onOpen,
}: {
  uri: string | null;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Stack gap="$md">
      <Button
        testID="demo-auth-other-signer"
        variant="ghost"
        size="sm"
        alignSelf="flex-start"
        onPress={() => {
          if (!open) onOpen();
          setOpen(!open);
        }}
      >
        Use another Nostr signer
      </Button>
      {open && (
        <>
          <Text color="$colorMuted">
            Other signers cannot verify this site, so they cannot tell you who
            is asking. Approve only if you started this login here.
          </Text>
          {uri === null ? (
            <LoadingState label="Connecting to relays" />
          ) : (
            <Stack alignItems="flex-start" gap="$sm">
              <CopyLinkButton value={uri} testID="demo-auth-copy-uri" />
              <Text
                testID="demo-auth-uri-link"
                render={<a href={uri} />}
                variant="label"
                color="$colorMuted"
              >
                Open in a signer on this device
              </Text>
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}

function LoginOptions({
  nonce,
  signerApp,
  uri,
  connectOtherSigner,
}: {
  nonce: string;
  signerApp: NonNullable<LinkauthLinksOptions["signerApp"]>;
  uri: string | null;
  connectOtherSigner: () => void;
}) {
  const { openUrl, qrUrl } = linkauthLinks({
    audience: location.origin,
    nonce,
    callbackUrl,
    signerApp,
    ...(signerAppUrl ? { signerAppUrl } : {}),
  });
  return (
    <Stack gap="$lg" testID="demo-auth-login">
      <Button
        testID="demo-auth-open-linky"
        render={<a href={openUrl} />}
        role="link"
      >
        Log in with Linky
      </Button>
      <Text color="$colorMuted">Scan with Linky on your phone</Text>
      <QRCode
        testID="demo-auth-qr"
        value={qrUrl}
        accessibilityLabel="Login QR code"
      />
      <Text color="$colorMuted">
        Any page can show a login code. Approve it only if you pressed Log in on
        this page yourself.
      </Text>
      <Stack alignItems="center">
        <CopyLinkButton value={qrUrl} testID="demo-auth-copy-link" />
      </Stack>
      <OtherSigner uri={uri} onOpen={connectOtherSigner} />
    </Stack>
  );
}

function LoggedIn({
  pubkey,
  onLogOut,
}: {
  pubkey: string;
  onLogOut: () => void;
}) {
  return (
    <Stack gap="$lg" testID="demo-auth-logged-in">
      <Text color="$colorMuted">Logged in as</Text>
      <Text testID="demo-auth-npub" wordWrap="break-word">
        {nip19.npubEncode(pubkey)}
      </Text>
      <Button testID="demo-auth-logout" variant="secondary" onPress={onLogOut}>
        Log out
      </Button>
    </Stack>
  );
}

function StateView({
  state,
  signerApp,
  retry,
  logOut,
}: {
  state: DemoAuthState;
  signerApp: NonNullable<LinkauthLinksOptions["signerApp"]>;
  retry: () => void;
  logOut: () => void;
}) {
  switch (state.status) {
    case "starting":
      return (
        <Stack testID="demo-auth-starting">
          <LoadingState label="Preparing login" />
        </Stack>
      );
    case "verifying":
      return (
        <Stack testID="demo-auth-verifying">
          <LoadingState label="Verifying" />
        </Stack>
      );
    case "waiting":
      return (
        <LoginOptions
          nonce={state.nonce}
          signerApp={signerApp}
          uri={state.uri}
          connectOtherSigner={state.connectOtherSigner}
        />
      );
    case "notConfigured":
      return (
        <Stack testID="demo-auth-not-configured">
          <Notice
            tone="warning"
            title="Demo is not configured"
            description="This deployment has no receiving key (LINKY_DEMO_AUTH_SECRET_KEY), so logins cannot be accepted."
          />
        </Stack>
      );
    case "loggedIn":
      return <LoggedIn pubkey={state.pubkey} onLogOut={logOut} />;
    case "denied":
    case "timeout":
    case "error":
      return (
        <Stack gap="$lg" testID={`demo-auth-${state.status}`}>
          <Notice tone="danger" {...failureCopy[state.status]} />
          <Button testID="demo-auth-retry" onPress={retry}>
            Try again
          </Button>
        </Stack>
      );
  }
}

function DemoAuthPage() {
  const [locale, setLocale] = useSiteLocale();
  const [nightly, setNightly] = useState(true);
  const { state, retry, logOut } = useDemoAuth();

  return (
    <SiteLayout locale={locale} onLocaleChange={setLocale}>
      <Stack
        width="100%"
        maxWidth="$contentWidth"
        alignSelf="center"
        gap="$xxl"
        paddingVertical="$xxl"
      >
        <Stack gap="$sm">
          <Text eyebrow>Demo</Text>
          <Text
            variant="display"
            color="$colorStrong"
            role="heading"
            aria-level={1}
          >
            Log in with Linky
          </Text>
          <Text color="$colorMuted">
            A reference integration of Log in with Linky: sign in to a website
            with your Nostr key, no password.
          </Text>
        </Stack>
        <PageCard testID="demo-auth-card">
          {state.status === "waiting" && (
            <ListRow
              title="Use nightly"
              description={nightly ? "Latest build" : "Released app"}
              trailing={
                <Switch
                  accessibilityLabel="Use nightly"
                  value={nightly}
                  onValueChange={setNightly}
                />
              }
            />
          )}
          <StateView
            state={state}
            signerApp={nightly ? "nightly" : "production"}
            retry={retry}
            logOut={logOut}
          />
        </PageCard>
        <PageCard>
          <Text variant="title" color="$colorStrong">
            How it works
          </Text>
          <Text color="$colorMuted">
            This page asks its server for a one-time nonce. Linky signs one
            event bound to this site and that nonce, and the server verifies it.
            The site learns only your public key: no email, no other signature,
            and nothing that works anywhere else.
          </Text>
          <Text color="$colorMuted">
            This is a demo. It keeps no server session: your key stays in this
            tab&apos;s session storage until you log out. It keeps the nonce in
            a cookie, so finishing the login in a browser with different
            cookies, such as an installed home-screen app, fails with
            &quot;Login failed&quot; and you try again. A real site keeps the
            nonce in its own session store.
          </Text>
          <Text color="$colorMuted">
            Linky trusts this site because it publishes a verified domain
            document at /.well-known/linkauth.json: its name, the key QR logins
            are delivered to, and the one page a same-device login may return
            to. A QR login is not tied to the browser that shows it, so a
            malicious page could show you a code from a real attempt. Approve
            only logins you started here yourself.
          </Text>
          <Text render={<a href={docsUrl} />} color="$accent">
            Read the linkauth docs
          </Text>
        </PageCard>
      </Stack>
    </SiteLayout>
  );
}

export default DemoAuthPage;
