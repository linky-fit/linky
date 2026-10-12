import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, Heading, Paragraph } from "../../prose";

export function Body() {
  return (
    <>
      <Heading>Delete a message for both sides</Heading>
      <Paragraph>
        Until now you could only edit a message after sending it. Now you can
        delete it too. Long-press it or tap the three dots to open its menu, and
        pick Delete. The text and its reactions disappear on both phones, and
        both of you keep a "Message deleted" placeholder in its place. It works
        the same way as in Signal.
      </Paragraph>

      <Heading>React with any emoji</Heading>
      <Paragraph>
        The reaction row isn't limited to six emojis anymore. You can pick any
        emoji from the full list.
      </Paragraph>
      <DemoFigure
        screen="message-actions"
        caption="Dave meant to send a message to his mom, but sent it to Mia. No problem, he just deletes it!"
      />

      <Heading>Delete and block contacts</Heading>
      <Paragraph>
        Instead of archiving a contact, you can now remove it from Linky. Just
        tap the trash icon in the top bar. The conversation disappears, and if
        that person writes to you again, the contact comes back with the whole
        history.
      </Paragraph>
      <Paragraph>
        You can also block spam in Linky. A blocked profile can't write to you,
        and nothing they send gets stored or shown.
      </Paragraph>
      <DemoFigure
        screen="contact-block"
        caption="Dave deletes a contact who keeps sending him spam, blocks him from the toast and finds him under Settings > Blocked."
      />
      <Paragraph>
        You can unblock blocked contacts in Settings. Blocks sync between your
        devices automatically.
      </Paragraph>

      <Heading>Notifications on Android without Google</Heading>
      <Paragraph>
        The Android app delivered notifications through Firebase, which needs
        Google Play Services. On GrapheneOS and other phones without them,
        turning notifications on simply failed. That also meant no proxy
        payments on those phones, because proxy payments need notifications.
      </Paragraph>
      <Paragraph>
        Where Play Services are missing, Linky now uses UnifiedPush. Install a
        UnifiedPush app such as <TextLink href="https://ntfy.sh">ntfy</TextLink>
        , then turn on Notifications in Settings. If no such app is installed,
        Linky tells you to get one. Phones with Play Services keep working as
        before.
      </Paragraph>

      <Heading>Restore with one paste</Heading>
      <Paragraph>
        A nicer way to restore your account from SLIP-39. It's mostly a cosmetic
        change, but it can come in handy. You can of course still paste the seed
        from your device's clipboard.
      </Paragraph>
      <DemoFigure
        screen="restore-paste"
        caption="Dave restores his account on a new phone by pasting his backup."
      />
      <Paragraph>
        If you know your recovery seed by heart (OK, wow 😅), or type it by hand
        for some other reason, Linky now completes the words for you from the
        SLIP-39 word list.
      </Paragraph>

      <Heading>Replay the tutorial</Heading>
      <Paragraph>
        Settings has a new Tutorial page. It lists the getting-started steps,
        and you can replay any of them, even the ones you've already done. Handy
        when you forget where something is, or when you show Linky to a friend.
      </Paragraph>
      <DemoFigure
        screen="tutorial-replay"
        caption="Dave opens Settings > Tutorial and replays how to pay a contact."
      />

      <Heading>Also in this release</Heading>
      <BulletList
        items={[
          <>
            Settings has a new Nostr identity page under Security. It shows the
            identity you use, with its profile, lightning address and npub, and
            copies the npub or nsec. A custom identity you pasted stays attached
            to the device, so you can switch between it and the one created in
            Linky.
          </>,
          <>
            The ₿ unit now shows bitcoin, like 0.00123456 ₿, instead of sats
            with a bitcoin sign. The keypad takes up to eight decimal places.
            Decimals on the keypad are on by default. You can turn them off in
            Settings &gt; Units.
          </>,
          <>
            Tap a token in a chat to switch the unit it's shown in, the same way
            you tap the wallet balance.
          </>,
          <>
            Add contact starts with a Scan contact QR button. A lightning
            address you type can be saved right away, and you can paste a
            linky.fit/p/ profile link into the search.
          </>,
          <>
            Share profile opens a sheet where you copy your profile link or
            npub, or open your phone's share menu. The QR code on the Profile
            tab holds your plain npub again, so other Nostr apps can read it.
          </>,
          <>
            Linky can receive P2PK Cashu tokens locked to your npub. Before, it
            failed them.
          </>,
          <>
            The Android app gets web updates without waiting for a Google Play
            release. It downloads a signed update and switches to it on the next
            fresh start or when you tap the update banner, never in the middle
            of a payment.
          </>,
          <>
            Linky no longer deletes old messages on its own. Before, it trimmed
            long histories on every device.
          </>,
          <>
            A proxy payment offer shows whether the bank transfer is in CZK, EUR
            or BRL, right next to the amount.
          </>,
          <>
            In the Android and iOS apps the status bar stays readable in light
            mode, and an open chat redraws less, which long conversations
            notice.
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
        production relays, mints and sync servers as the release. Everything in
        this post ran there first.
      </Paragraph>
      <Paragraph>Expect rough edges. When you hit one, tell us.</Paragraph>
    </>
  );
}
