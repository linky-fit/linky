import { BulletList, Text, TextLink, VideoEmbed } from "@linky-fit/ui";
import { Figure, Heading, Paragraph } from "../../prose";
import { proxyPaymentsVideo, pubPhoto, walletPhoto } from "./media";

export function Body() {
  return (
    <>
      <Paragraph>
        For many years, I’ve been trying to figure out how to get bitcoin into
        people’s hands. Even long-time bitcoiners often don’t want to pay with
        bitcoin. At best, they slowly accumulate it, and they don’t really feel
        like they’re missing anything. They buy it on exchanges, pay fees,
        expose their personal information, and need a third party’s blessing for
        every transaction.
      </Paragraph>
      <Paragraph>
        I sometimes hear people say that bitcoin doesn’t need anyone and that,
        on the contrary, we need bitcoin. I see it a little differently. To me,
        bitcoin is something like a living organism. I consider its creation to
        be an event almost as rare as the emergence of life itself. But for
        bitcoin to truly live and serve us as better money, I believe it needs
        users.
      </Paragraph>
      <Paragraph>
        With every transaction, a new connection is created or an existing one
        is strengthened. Users gradually get better at securing their bitcoin,
        demand better tools, and bitcoin becomes more resilient.
      </Paragraph>
      <Paragraph>
        That’s why I don’t think adoption is some kind of optional bonus.{" "}
        <Text bold>
          Adoption is a fundamental condition for bitcoin to actually be useful.
        </Text>
      </Paragraph>

      <Heading>I tried various approaches</Heading>
      <Paragraph>
        I liked the idea of{" "}
        <TextLink href="https://stacker.news/items/85702">
          bringing bitcoin directly into Signal
        </TextLink>
        , for example. But Signal still hasn’t added bitcoin support, and I’m
        afraid there simply isn’t enough incentive for them to do so anytime
        soon.
      </Paragraph>
      <Paragraph>
        Years ago, I also created{" "}
        <TextLink href="https://stacker.news/items/117623">
          an app that allowed people to load bitcoin onto an NFC card
        </TextLink>{" "}
        and pass it around much like cash. Technically, it worked. But there
        wasn’t enough interest. It was a nice project, but it didn’t solve a
        real problem for people.
      </Paragraph>
      <Paragraph>
        Later, I also looked into{" "}
        <TextLink href="https://stacker.news/items/210830">
          why even bitcoiners themselves often don’t want to pay with bitcoin
        </TextLink>
        .
      </Paragraph>

      <Heading>It’s not enough to let merchants accept bitcoin</Heading>
      <Paragraph>
        In the meantime, I onboarded dozens of businesses and bitcoiners
        locally.
      </Paragraph>
      <Paragraph>
        Most of them were just isolated points on a map. A business started
        accepting bitcoin, but nobody actually paid with it. Eventually, the
        merchant forgot how to accept a bitcoin payment or what to do with the
        bitcoin they received.
      </Paragraph>
      <Paragraph>
        It wasn’t until about a year ago that I managed to partially break
        through this problem.
      </Paragraph>
      <Paragraph>
        I onboarded{" "}
        <TextLink href="https://stacker.news/items/1584550">
          another business
        </TextLink>{" "}
        simply because we went there regularly. And to this day, every week we
        come there in a changing group of people, with everyone paying in
        bitcoin.
      </Paragraph>
      <Figure
        {...pubPhoto}
        alt="The landlord of the Zlaté sele pub with a schnitzel and a beer"
      />
      <Paragraph>
        The pub owner didn’t want bitcoin at all in the beginning. What matters
        to him is us as customers who come to his pub because of bitcoin. In the
        end, a merchant will accept pretty much any form of payment. What’s more
        important is finding people who are willing to pay with bitcoin.
      </Paragraph>
      <Paragraph>
        Here, we use bitcoin also as a filter for finding interesting people.
        Anyone willing to pay with bitcoin is kind of open-minded, and it’s a
        pleasure to get to know them over a regular lunch.
      </Paragraph>

      <Heading>I don’t want to depend on a single app again</Heading>
      <Paragraph>
        Over the years, I’ve recommended various wallets and tools to people.
        Some of them eventually disappeared.
      </Paragraph>
      <Paragraph>
        The custodial version of Wallet of Satoshi, which was the most popular
        one, stopped working. Alza, the largest retailer in the Czech Republic
        and one of the first major merchants to accept bitcoin, started
        requiring additional administrative steps when paying with bitcoin.
        Qerko, which allowed bitcoin payments at around 1,000 businesses,
        removed bitcoin support.
      </Paragraph>
      <Paragraph>
        At first, this was pretty discouraging. It was the end of 2025, and at
        the same time the price of bitcoin dropped significantly. I had to
        figure out what to do with the dozens of people I had introduced to a
        particular app, which was now no longer going to work for them.
      </Paragraph>
      <Paragraph>
        I felt a little trapped. With every app, there was a risk that I would
        have to repeat the whole migration process again at any time.
      </Paragraph>
      <Paragraph>
        But in January 2026, it also seemed to me that AI models had improved
        significantly, so I decided to try building my own wallet. One that I
        had been carrying around in my head for years.
      </Paragraph>

      <Heading>Linky</Heading>
      <Paragraph>
        Linky is a bitcoin wallet and, at the same time, a communication layer
        for the people you want to use bitcoin with.
      </Paragraph>
      <Paragraph>
        You can add your contacts, send them messages and bitcoin. You can pay
        any Lightning invoice. You can load bitcoin in the form of Cashu tokens
        onto an NFC card or send it to someone in a message — even to someone
        who doesn’t use Linky at all.
      </Paragraph>
      <Figure {...walletPhoto} alt="The Linky wallet on a phone" />
      <Paragraph>
        But I’m also trying to build a certain degree of antifragility into it.
      </Paragraph>
      <Paragraph>
        From the beginning, I’ve been building Linky so that the app doesn’t
        depend on a particular operator. There are already other instances
        running on different domains. If my instance stopped working tomorrow,
        the network wouldn’t necessarily have to disappear with it.
      </Paragraph>
      <Paragraph>
        We achieve this through a combination of three decentralized
        technologies:
      </Paragraph>
      <BulletList
        items={[
          <>
            <Text bold>Cashu</Text> for bitcoin,
          </>,
          <>
            <Text bold>Nostr</Text> for communication,
          </>,
          <>
            <Text bold>Evolu</Text> for data storage.
          </>,
        ]}
      />
      <Paragraph>
        We use several other interesting technologies as well, but I don’t want
        to get into the technical details here. There are now six other
        developers working on Linky. One of them is a close friend of mine who
        has been improving the app very intensively, primarily on the technical
        side.
      </Paragraph>
      <Paragraph>
        What started as a funny vibecoded app is gradually becoming a serious
        project.
      </Paragraph>
      <Paragraph>
        Around 250 people are currently testing Linky in the local group, and
        several hundred more users are using it.
      </Paragraph>

      <Heading>Individuals</Heading>
      <Paragraph>People use Linky because they like it.</Paragraph>
      <Paragraph>
        Thanks to its simplicity and steadily increasing reliability, it is
        gradually becoming the primary bitcoin wallet for many people.
      </Paragraph>
      <Paragraph>
        <Text bold>
          However, most people still don’t actually need a lightning wallet.
        </Text>{" "}
        😢
      </Paragraph>
      <Paragraph>
        You can build a great wallet. You can onboard merchants. You can explain
        the benefits of bitcoin to people. But if they have no reason to use
        bitcoin, all of those things will remain just flashes of activity.
      </Paragraph>

      <Heading>Proxy payments</Heading>
      <Paragraph>
        Recently, however, we managed to create a feature that I think can at
        least partially solve this problem. We call it{" "}
        <Text bold>proxy payments</Text>.
      </Paragraph>
      <Paragraph>
        In the Czech Republic, people increasingly use QR codes for bank
        transfers. You can find them in online shops as well as physical stores.
      </Paragraph>
      <Paragraph>
        For users, this is still somewhat less convenient than paying by card,
        but merchants love it because they don’t have to pay card-network fees.
      </Paragraph>
      <Paragraph>
        Today, I can pay with bitcoin at any of these businesses. No fees and no
        KYC.
      </Paragraph>
      <Paragraph>
        I scan the payment QR code using Linky - just as if I were paying a
        lightning invoice. Linky offers me the option to send the payment
        request to my contacts.
      </Paragraph>
      <Paragraph>I select several friends and send them the offer.</Paragraph>
      <Paragraph>
        Whoever accepts it first receives the payment details from the QR code.
        They pay the merchant from their bank account, and I send them sats in
        return.
      </Paragraph>
      <VideoEmbed src={proxyPaymentsVideo} title="Proxy payments in Linky" />

      <Heading>Is it worth the effort?</Heading>
      <Paragraph>
        Maybe this sounds like a pointless detour. Why would I ask someone else
        to pay by bank transfer on my behalf when I could simply pay myself?
      </Paragraph>
      <Paragraph>
        For me, it’s useful because I don’t have to hold fiat that is losing
        value.
      </Paragraph>
      <Paragraph>
        For my friends, it’s useful because they don’t have to use an exchange,
        pay fees, or expose their personal information. They acquire bitcoin in
        an interactive way — usually in small amounts.
      </Paragraph>
      <Paragraph>
        As a side benefit for everyone, there is the more abstract fact that you
        are building the bitcoin network and thereby helping ensure that you’ll
        be able to use bitcoin in the future as well.
      </Paragraph>
      <Paragraph>
        To use proxy payments comfortably, you need roughly two or three people.
        Most payments are completed within two minutes. It’s not as direct or
        fast as paying by card, but it works surprisingly well.
      </Paragraph>
      <Paragraph>Linky is showing people new ways to use bitcoin.</Paragraph>
      <Paragraph>
        <Text bold>
          Come help us test and build our shared bitcoin network. 🙏
        </Text>
      </Paragraph>
    </>
  );
}
