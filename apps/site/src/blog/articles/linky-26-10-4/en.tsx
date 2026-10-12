import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, Heading, Paragraph } from "../../prose";

export function Body() {
  return (
    <>
      <Paragraph>
        Linky 26.10.4 is out. Most of it is about deciding what stays in your
        Linky: which messages stay in a chat, who stays in your contacts and who
        can write to you at all. I'll start there, then cover notifications on
        Android phones without Google, the new restore screen and the rest of
        the release.
      </Paragraph>

      <Heading>Delete a message for both sides</Heading>
      <Paragraph>
        Until now you could only edit a message after sending it. Now the
        message menu has Delete. Long-press a message on the phone, or use the
        three dots next to it on a computer, and tap Delete. The text and its
        reactions disappear on both phones, and both of you keep a "Message
        deleted" placeholder in its place, so the conversation still reads in
        order.
      </Paragraph>
      <Paragraph>
        It works on any message in the conversation, photos and files included,
        and on the other person's messages too. Tokens, payment requests and
        proxy payment offers have no Delete. The other person needs 26.10.4 as
        well. An older version keeps showing the message.
      </Paragraph>

      <Heading>React with any emoji</Heading>
      <Paragraph>
        The reaction row in the same menu had six emojis. Next to them is now a
        plus button that opens the full emoji list, grouped into tabs the way
        your keyboard groups them. Whatever you pick shows up under the message
        like any other reaction.
      </Paragraph>
      <DemoFigure
        screen="message-actions"
        caption="Dave reacts to Mia's message with an emoji from the full list, then deletes a message meant for his mom."
      />

      <Heading>Delete and block contacts</Heading>
      <Paragraph>
        Contacts used to go to an archive, a second list that hardly anyone
        opened. Now you delete them. Open the contact's edit page and tap the
        trash icon in the top bar. The contact disappears right away and a toast
        offers Undo. The conversation isn't lost. If that person writes to you
        again, the contact comes back with the whole history.
      </Paragraph>
      <Paragraph>
        That's what you want for someone you just stopped talking to, but not
        for spam. So the same toast also offers Block, and the edit page has a
        Block button that deletes and blocks in one step. Linky then ignores
        everything that person sends. Nothing gets stored or shown, and no
        message brings them back.
      </Paragraph>
      <DemoFigure
        screen="contact-block"
        caption="Dave deletes a contact who keeps sending him spam, blocks him from the toast and finds him under Settings > Blocked."
      />
      <Paragraph>
        Settings has a new Blocked page with everyone you blocked and an Unblock
        button for each. Blocks and unblocks sync to all your devices and take
        effect on the others right away. After an unblock, new messages get
        through.
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
        Restoring an account used to mean typing all 20 words of your recovery
        seed into one text field. Password managers couldn't fill it, and a typo
        was hard to find. The restore screen now has a Paste from clipboard
        button that takes the whole backup at once. It fills all 20 fields and
        continues by itself.
      </Paragraph>
      <DemoFigure
        screen="restore-paste"
        caption="Dave restores his account on a new phone by pasting his backup."
      />
      <Paragraph>
        If you have the words on paper, type them into the 20 fields one by one.
        Linky checks each word against the SLIP-39 word list, marks the ones it
        doesn't know and suggests words as you type. Words 3 and 4 of a Linky
        backup are always "academic". That's not a typo. A password manager that
        saved your backup for app.linky.fit can also fill the first field, and
        Linky spreads the words over the rest.
      </Paragraph>

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
            Settings &gt; Tutorial lists the getting-started steps and replays
            any of them, even ones you already finished.
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
      <Paragraph>
        Nightly shares accounts with the current release. Restore your recovery
        seed there, now with one paste, and it joins your account as one more
        device. It lives on its own address, so it keeps its own local storage.
        Settings &gt; Advanced shows which nightly version you're on.
      </Paragraph>
      <Paragraph>Expect rough edges. When you hit one, tell us.</Paragraph>

      <Heading>Try it</Heading>
      <Paragraph>
        Linky runs in the browser at{" "}
        <TextLink href="https://app.linky.fit">app.linky.fit</TextLink>, and
        it's also on Google Play and Zapstore. Long-press a message, tap the
        plus and pick an emoji the old row didn't have.
      </Paragraph>
    </>
  );
}
