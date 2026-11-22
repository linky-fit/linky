import { BulletList, TextLink } from "@linky-fit/ui";
import { DemoFigure, FigureRow, Heading, Paragraph, Term } from "../../prose";

export function Body() {
  return (
    <>
      <Paragraph>
        Linky 26.11.5 is out. The app and website now speak Slovak, on-chain
        transfers run non-stop, and payments from long-used wallets are roughly
        twice as fast.
      </Paragraph>

      <Heading>Linky speaks Slovak</Heading>
      <Paragraph>
        Until now, anyone opening Linky on a Slovak phone got English. In
        26.11.5, both the app and linky.fit speak Slovak. A Slovak browser picks
        it automatically, or you can switch in <Term>Settings</Term> under{" "}
        <Term>Language</Term> by picking <Term>Slovenčina</Term>.
      </Paragraph>
      <Paragraph>
        New Slovak accounts start with EUR as their display currency, format
        dates and numbers the Slovak way, and search emojis with Slovak words in
        reactions and after a colon in messages.
      </Paragraph>

      <Heading>On-chain transfers run non-stop</Heading>
      <Paragraph>
        You can move bitcoin between Linky and an on-chain wallet anytime
        through <Term>Send to on-chain wallet</Term> and{" "}
        <Term>Receive from on-chain wallet</Term>. Until now the service was
        occasionally unavailable, which gave people a good reason to forget
        about it. It now runs non-stop. If you have been meaning to move sats to
        cold storage, or bring bitcoin from an on-chain wallet into Linky, give
        it a try.
      </Paragraph>
      <Paragraph>
        On-chain sends are easier to follow too. The transfer screen shows your
        payout address and an <Term>Open address in browser</Term> button that
        opens it in the block explorer. Once the payout lands on chain, opening
        that link checks the blockchain and marks your transfer completed right
        away.
      </Paragraph>
      <FigureRow>
        <DemoFigure
          screen="slovak-language"
          caption="Switching Language to Slovenčina translates the whole app and formats amounts in EUR."
        />
        <DemoFigure
          screen="onchain-send"
          caption="Dave sends 100,000 sat to an on-chain wallet, opens the payout address in the explorer, and sees the transfer mark itself completed."
        />
      </FigureRow>

      <Heading>Faster payments and steadier sync</Heading>
      <Paragraph>
        Your wallet should now feel noticeably faster even when it holds a lot
        of Cashu tokens. Payments from a heavily used wallet run roughly twice
        as fast as before.
      </Paragraph>
      <Paragraph>
        Syncing across devices is steadier too. Messages, contacts, listings and
        payment history stay aligned across your phone and computer without you
        touching a setting. Your existing data moves over on its own the first
        time you open 26.11.5. If you run Linky on more than one device, update
        all of them so they stay in sync.
      </Paragraph>

      <Heading>Also fixed in this release</Heading>
      <BulletList
        items={[
          <>
            A pending Lightning payment flips to paid seconds after it settles,
            without restarting the app.
          </>,
          <>Received tokens show as received instead of flashing as invalid.</>,
          <>
            Messages sent right after one another keep the order you sent them
            in.
          </>,
          <>
            Payment history shows the full fee on Lightning payments and marks a
            payment request paid as soon as the full amount arrives.
          </>,
          <>
            Searching for a contact by a verified address hides impostor
            profiles that claim the same address.
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
