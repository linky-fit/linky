import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, Heading, Paragraph } from "../../prose";

export function Body() {
  return (
    <>
      <Paragraph>
        Linky 26.10.3 came out on October 5. The main thing in it is profile
        sharing, so most of this post is about that. The rest of the changes are
        further down.
      </Paragraph>

      <Heading>A link instead of an npub</Heading>
      <Paragraph>
        Until now, if you wanted someone to add you in Linky, you sent them your
        npub or showed them a QR code. An npub is a long string of characters,
        and to someone who doesn't use Linky yet it means nothing.
      </Paragraph>
      <Paragraph>
        Now every Linky user has a profile page. If you claimed a lightning
        address on linky.fit, your profile link ends with that name, like
        linky.fit/p/dave. Without a claimed name, the link uses your npub.
      </Paragraph>
      <Paragraph>
        To share it, open the Profile tab and tap Share profile. Your phone's
        share sheet opens and you pick where to send the link. Desktop browsers
        that can't share copy it to the clipboard instead.
      </Paragraph>
      <DemoFigure
        screen="profile-share"
        caption="Dave sends his profile link to Mia from the Profile tab."
      />
      <Paragraph>
        Signal, WhatsApp, Telegram and other chat apps turn the link into a
        preview with your name, picture and bio. The person sees who it's from
        before they tap anything.
      </Paragraph>

      <Heading>What the other person sees</Heading>
      <Paragraph>
        The page shows your name and picture, your lightning address and status,
        the currencies you provide for proxy payments, and your bio. Below that
        is an Open in Linky button.
      </Paragraph>
      <Paragraph>
        Open in Linky saves you as a contact and opens your conversation with
        "Hi 👋" already typed. They tap send and you hear back. That's the whole
        flow.
      </Paragraph>
      <DemoFigure
        screen="profile-open"
        caption="Mia opens the link, taps Open in Linky and says hi to Dave."
      />
      <Paragraph>
        If they don't have a Linky account yet, the link waits while they create
        one or restore an old one, then opens the conversation. If you're
        already in their contacts, it opens the conversation you already have
        and doesn't add you a second time.
      </Paragraph>

      <Heading>The QR code holds the link too</Heading>
      <Paragraph>
        The QR code on the Profile tab now contains your profile link. Point any
        phone camera at it and your profile page opens, so the person across the
        table doesn't need Linky to see who you are. The Linky scanner still
        reads it as a contact, and when you're already saved it finds the
        existing contact.
      </Paragraph>

      <Heading>Also in this release</Heading>
      <BulletList
        items={[
          <>
            Log into websites with your Nostr identity. Scan or open a
            nostrconnect:// link and confirm.
          </>,
          <>
            You can follow company announcements (Keryx) from Settings. This one
            is experimental and only shows up after you turn on experimental
            features.
          </>,
          <>
            Messages from a contact you saved twice now stay in one
            conversation.
          </>,
          <>
            Fixed profile editing with a custom identity, and the wallet buttons
            on small screens.
          </>,
        ]}
      />

      <Heading>Want features earlier? Try nightly</Heading>
      <Paragraph>
        If you don't want to wait for a release, use nightly at{" "}
        <TextLink href="https://nightly.app.linky.fit">
          nightly.app.linky.fit
        </TextLink>
        . It deploys every change we merge to main and talks to the same
        production relays, mints and sync servers as the release.
      </Paragraph>
      <Paragraph>
        Nightly shares accounts with the current release. Restore your recovery
        seed there and it joins your account as one more device. It lives on its
        own address, so it keeps its own local storage. Settings &gt; Advanced
        shows which nightly version you're on.
      </Paragraph>
      <Paragraph>Expect rough edges. When you hit one, tell us.</Paragraph>

      <Heading>Try it</Heading>
      <Paragraph>
        Linky runs in the browser at{" "}
        <TextLink href="https://app.linky.fit">app.linky.fit</TextLink>, and
        it's also on Google Play and Zapstore. Send your profile link to someone
        who isn't on Linky yet and wait for their "Hi 👋".
      </Paragraph>
    </>
  );
}
