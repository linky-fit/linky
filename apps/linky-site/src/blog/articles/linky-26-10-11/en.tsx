import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, FigureRow, Heading, Paragraph, Term } from "../../prose";

export function Body() {
  return (
    <>
      <Paragraph>
        Linky started with chats and payments between friends. With proxy
        payments your friends could already pay a bank transfer for you and take
        sats in return. This release goes further: the{" "}
        <Term>Proxy payments</Term> tab in the bottom bar is now{" "}
        <Term>Collaboration</Term>, and it holds three ways to help each other
        for bitcoin.
      </Paragraph>
      <BulletList
        items={[
          <>
            <Term>Bank transfer</Term>: a friend pays a bank transfer for you
            and you send them sats. Proxy payments work the same as before, they
            just moved one level down.
          </>,
          <>
            <Term>Cash</Term>: tell your contacts whether you have cash to spare
            or need some.
          </>,
          <>
            <Term>Goods and services</Term>: offer what you make or do, see what
            your contacts offer and what they look for.
          </>,
        ]}
      />
      <Paragraph>
        Each tile counts what your contacts have going on there: how many of
        them pay bank transfers, how many exchange cash and how many listings
        they have.
      </Paragraph>

      <Heading>Cash</Heading>
      <Paragraph>
        The best way to get bitcoin is still straight from a friend, for cash.
        The hard part is knowing who has cash on them and who is looking for it.
        On the Cash page you pick <Term>Offering cash</Term>,{" "}
        <Term>Nothing now</Term> or <Term>Looking for cash</Term>. Below it you
        see which of your contacts offer cash and which look for it.
      </Paragraph>
      <Paragraph>
        Your choice also rides on the beacon. With the beacon on, contacts
        around you see that you buy or sell bitcoin, at the top of Contacts and
        in your conversation. Since 26.10.10 the beacon is available to
        everyone, no experimental switch needed.
      </Paragraph>

      <Heading>Goods and services</Heading>
      <Paragraph>
        Eggs from the garden, sourdough, babysitting, help with moving. Many of
        us already trade like this with friends; now it has a place in Linky.
        Tap the plus button, choose <Term>Offering</Term> or{" "}
        <Term>Looking for</Term>, write a title, a price and a unit such as "per
        hour" or "per kg", and add it.
      </Paragraph>
      <Paragraph>
        You set the price in the unit you have on, sats included, and tapping
        the unit next to the price switches it. Your contacts see the price in
        their own unit. When it was converted from another currency, it carries
        a tilde. Tap a contact's listing and you're in your chat with them.
      </Paragraph>
      <FigureRow>
        <DemoFigure
          screen="cash-intent"
          caption="Dave needs cash for a trip. He says he's looking for cash and sees that Tomas and Lena offer it."
        />
        <DemoFigure
          screen="listings"
          caption="Dave browses what his contacts offer and want, then offers bike repairs for 10,000 sat per hour."
        />
      </FigureRow>

      <Heading>Only between people who saved each other</Heading>
      <Paragraph>
        Your cash choice and your listings reach only the contacts who saved you
        too. Linky publishes them to Nostr encrypted, so that only your contacts
        can open them. A stranger who finds your npub reads nothing, and there
        is no public catalogue: everyone sees only what their own contacts
        offer.
      </Paragraph>

      <Heading>The scanner is always top right</Heading>
      <Paragraph>
        Every main tab now has the scanner in the same top-right corner. On
        Profile and Contacts it reads a contact's QR code, on Wallet,
        Collaboration and Settings it reads payments too. What used to sit there
        moved to the left: the pencil on Profile, the search on Contacts and
        unfinished on-chain transfers on Wallet.
      </Paragraph>

      <Heading>Also in this release</Heading>
      <BulletList
        items={[
          <>
            Sending from a wallet with a long history is fast again. A sent
            payment shows up right away, without waiting for its bookkeeping.
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
