import { BulletList } from "@linky-fit/ui";
import {
  AsideFigure,
  DemoFigure,
  FigureRow,
  Heading,
  Paragraph,
  ScreenshotFigure,
  Term,
} from "../../prose";
import { shots } from "./media";

export function Body() {
  return (
    <>
      <Paragraph>
        Install WhatsApp or Signal and within seconds you have dozens of
        contacts, matched by phone number. Linky deliberately cannot do that. We
        do not want your phone number, your e-mail or any ID. A Linky account
        comes from keys your phone generates on its own.
      </Paragraph>
      <Paragraph>
        That has one rather unpleasant downside. After installing, your Contacts
        tab is empty and the app has no idea who you actually know. So in Linky
        we put a lot of work into making it as easy as possible to find the
        person standing next to you or the one you already chat with elsewhere.
        Here is an overview of every way that works in Linky today.
      </Paragraph>

      <Heading>1. QR code</Heading>
      <Paragraph>
        The classic, and it works on every phone and on the web. Every Linky
        user has their QR code in the Profile tab. The other person taps the
        button with the person and the plus in Contacts, then{" "}
        <Term>Scan contact QR</Term>, and points the camera at it. Or the other
        way round: you scan theirs.
      </Paragraph>
      <Paragraph>
        When you are not in the same place, send a link instead of the QR code.
        The <Term>Share profile</Term> button creates a linky.fit/p/… address
        you can send in any messenger. Whoever opens it sees your name and
        avatar and adds you with the <Term>Open in Linky</Term> button.
      </Paragraph>
      <FigureRow>
        <ScreenshotFigure
          shot={shots.profile}
          alt="The Profile tab with an avatar, a name, a QR code and the Share profile button"
          caption="The QR code in the Profile tab. Just show it, the other side scans it."
        />
        <DemoFigure
          screen="profile-open"
          caption="Mia gets a profile link, taps Open in Linky and has Dave in her contacts."
        />
      </FigureRow>

      <Heading>2. New users</Heading>
      <AsideFigure
        shot={shots.contactNew}
        alt="The Add contact page with the Scan contact QR button, the search field and two new users under Suggestions"
        caption="Suggestions at the bottom of Add contact: Linky users who joined in the last hour."
      >
        <Paragraph>
          The situation we see most often: a friend next to you has just
          installed Linky and you want to send them their first sats. That is
          why the bottom of the <Term>Add contact</Term> page shows, under
          suggestions, the accounts created in the last hour with a{" "}
          <Term>New</Term> badge. Usually that friend is among them. Tap them
          and you are done.
        </Paragraph>
        <Paragraph>
          Keep in mind that everyone picks their own name and avatar. Before you
          send a new contact anything, make sure they really are who you think.
          Only add people you know in person.
        </Paragraph>
      </AsideFigure>

      <Heading>3. Search by registered name</Heading>
      <Paragraph>
        On the <Term>Add contact</Term> page there is a search field under the
        QR button. The most reliable search is by the Linky name a person has
        registered. When Alice reserved the address alice@linky.fit in her
        profile, typing “alice” is enough and Linky finds her. You register a
        name in the Profile tab through the pencil and{" "}
        <Term>Reserve address</Term>, paid in sats from your wallet. A verified
        name from another app on the Nostr network, in the form name@domain.com,
        works the same way.
      </Paragraph>
      <Paragraph>The same field also takes:</Paragraph>
      <BulletList
        items={[
          <>
            <b>A name or nickname.</b> Linky searches the profiles on the Nostr
            network it runs on. It often finds several people with the same
            name; you tell the right one by the avatar, and if not, ask.
          </>,
          <>
            <b>An npub</b>, the long string starting with npub1. It is the
            public identifier of an account, something the other person can send
            you. The icon on the right pastes it from the clipboard.
          </>,
          <>
            <b>The Lightning address</b> of someone without Linky. You will not
            chat, but you can send them money.
          </>,
        ]}
      />
      <ScreenshotFigure
        shot={shots.contactSearch}
        alt="The Add contact page with search results for the name hynek; the first result has the address hynek@linky.fit"
        caption="Searching by name. The registered Linky name comes first in the list."
      />

      <Heading>4. People nearby</Heading>
      <Paragraph>
        The <Term>Beacon</Term> is for rooms with several Linky users in them, a
        meetup for instance. Over Bluetooth your phone announces that you are
        around and listens for the others. While Linky is open, anyone scanning
        nearby sees your npub and can add you. On the <Term>Add contact</Term>{" "}
        page such people show up under suggestions with a <Term>Nearby</Term>{" "}
        badge.
      </Paragraph>
      <Paragraph>
        Contacts who have saved you, and whom you have saved, also see when you
        are close by. You can attach an intent to the beacon,{" "}
        <Term>Buys BTC</Term> or <Term>Sells BTC</Term>. Whoever wants to buy
        sats for cash at the meetup sees at once which of their contacts is
        selling.
      </Paragraph>
      <Paragraph>
        You turn the beacon on in the <Term>Proxy payments</Term> tab, in the{" "}
        <Term>Nearby</Term> section. For now it is an experimental feature of
        the Android app, so you first enable it in <Term>Settings</Term> under{" "}
        <Term>Debug</Term>. It needs Bluetooth and shows a notification while it
        runs, so you know you are broadcasting.
      </Paragraph>
      <FigureRow>
        <ScreenshotFigure
          shot={shots.contactsNearby}
          alt="The Contacts tab with a Nearby section showing the avatars You, Mia with a Sells BTC badge, Dave and Ben"
          caption="Nearby contacts at the top of the Contacts tab. Mia let everyone know she sells bitcoin."
        />
        <ScreenshotFigure
          shot={shots.beacon}
          alt="The Proxy payments tab with the beacon on, broadcasting to three contacts, and Sells BTC selected"
          caption="The beacon in the Proxy payments tab: the switch, the broadcast status and what you want to trade."
        />
      </FigureRow>

      <Heading>5. Sharing contacts and groups in a message</Heading>
      <AsideFigure
        shot={shots.chatContacts}
        alt="A chat with Mia, who sent the Climbers group with three contacts and an Add all button"
        caption="Mia sent the whole Climbers group. The Add all button saves three contacts at once."
        side="left"
      >
        <Paragraph>
          Once you have a few contacts, the most natural path to more leads
          through them. In a chat, type <Term>@</Term> and start writing a name.
          Linky offers your contacts, and the inserted contact shows up in the
          sent message as a pill with an avatar. The recipient taps it and saves
          it.
        </Paragraph>
        <Paragraph>
          The same works for whole groups. If your contacts are sorted into
          groups, say Climbers or Family, typing <Term>@Climbers</Term> inserts
          all of them at once. The other side gets an <Term>Add all</Term>{" "}
          button under the message and can then put the new contacts into a
          group of their own. One person can save the rest of the crowd from
          scanning six QR codes.
        </Paragraph>
      </AsideFigure>

      <Heading>6. NFC card</Heading>
      <Paragraph>
        Another way to hand someone your contact is to touch a card to their
        phone. In the Android app, the Profile tab has a{" "}
        <Term>Write to tag</Term> button. It writes your public identifier, the
        npub, to any NFC tag or card. Whoever then touches the card to a phone
        with Linky gets your profile opened and saves you with one tap. Nothing
        to scan, nothing to type.
      </Paragraph>
      <FigureRow>
        <ScreenshotFigure
          shot={shots.profileNfc}
          alt="The Profile tab with a QR code and the Share profile and Write to tag buttons"
          caption="The Write to tag button in the Profile tab writes your npub to an NFC card."
        />
        <ScreenshotFigure
          shot={shots.nfcModal}
          alt="The Ready to Scan dialog asking to approach an NFC tag"
          caption="After the tap, just hold the tag to the back of the phone."
        />
      </FigureRow>
      <Paragraph>
        Blank NFC tags cost next to nothing and a Linky card fits in your wallet
        next to the bank card. At a meetup you pass it across the table, in a
        shop you touch it to the terminal. The same way you can load sats onto a
        tag, but that is another article.
      </Paragraph>

      <Heading>You do not need hundreds of contacts</Heading>
      <Paragraph>
        An empty list looks like a drawback at first, but it has another side.
        In Linky you do not carry hundreds of people you swapped numbers with
        ten years ago. You only have the ones you added yourself and really
        know. For a wallet that is exactly what you want. You pay people you
        trust, and they pay you.
      </Paragraph>
      <Paragraph>
        A few contacts are enough. The friend you split lunch with, someone from
        the family and one or two people who sell you sats for cash. The network
        then grows on its own: every new contact can send you their contacts and
        groups in a message. And do not be afraid to delete contacts you added
        on a whim and no longer remember who they are. If such a person writes
        to you again, the contact comes back by itself, history included.
      </Paragraph>
      <Paragraph>
        And if you do not know anyone with Linky yet, go to the nearest bitcoin
        meetup or conference. That is where NFC cards, QR codes and beacons are
        thickest, and you will bring your first contacts home in one evening.
        Linky is, in the end, mostly about people; bitcoin is just the way to
        send value between them.
      </Paragraph>
    </>
  );
}
