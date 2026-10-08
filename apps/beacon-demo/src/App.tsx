import { Divider, Row, Stack, Text, TextLink } from "@linky-fit/ui";
import type { ReactNode } from "react";
import type { NearbyContact, Trade } from "./trade";
import { Phone } from "./phone";
import {
  AddContactScreen,
  BeaconIntroScreen,
  BeaconOnNotification,
  ChatScreen,
  ContactsScreen,
  NotificationShadeScreen,
  ProxyPaymentsScreen,
  TradeNotification,
  type Candidate,
} from "./screens";

const miaBuys: Trade = "buy";
const daveSells: Trade = "sell";

const nearbyForDave: NearbyContact[] = [
  { person: "Ben Ellis" },
  { person: "Mia Novak", trade: miaBuys },
  { person: "Sofia Lane" },
  { person: "Jan Kral", trade: "sell" },
];

const nearbyForMia: NearbyContact[] = [
  { person: "Tomas Berg" },
  { person: "Dave", trade: daveSells },
  { person: "Lena Fox" },
];

const petra: Candidate = {
  name: "Petra Dvorakova",
  npub: "npub1qy8w…h3k2",
};

const nearbyStrangers: Candidate[] = [
  petra,
  { name: "npub1m4xr…9fzq", npub: "npub1m4xr…9fzq", detail: "No profile" },
];

const newLinkyUsers: Candidate[] = [
  {
    name: "Karel Svoboda",
    npub: "npub1k7dd…2a0x",
    detail: "karel@linky.fit",
  },
  { name: "Hana Mertova", npub: "npub1h4nm…77lc", detail: "hana@linky.fit" },
];

function Explained({ sees, device }: { sees: string; device: string }) {
  return (
    <Row gap="$xxl" flexWrap="wrap" alignItems="flex-start">
      {[
        ["What the user sees", sees],
        ["On the device", device],
      ].map(([title, text]) => (
        <Stack key={title} flex={1} minWidth={280} gap="$xs">
          <Text eyebrow>{title}</Text>
          <Text color="$colorSubtle">{text}</Text>
        </Stack>
      ))}
    </Row>
  );
}

function Chapter({
  id,
  number,
  title,
  sees,
  device,
  children,
}: {
  id: string;
  number: number;
  title: string;
  sees: string;
  device: string;
  children: ReactNode;
}) {
  return (
    <Stack id={id} gap="$xxl" paddingVertical="$huge">
      <Stack gap="$sm">
        <Text variant="caption" bold color="$accentText">
          {String(number)}
        </Text>
        <Text variant="display" color="$colorStrong">
          {title}
        </Text>
      </Stack>
      <Explained sees={sees} device={device} />
      <Row
        gap="$xxxl"
        flexWrap="wrap"
        justifyContent="center"
        alignItems="flex-start"
      >
        {children}
      </Row>
    </Stack>
  );
}

function Journey({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children: ReactNode;
}) {
  return (
    <Stack gap="$lg">
      <Stack gap="$xs" maxWidth="$contentWidth">
        <Text variant="title" color="$colorStrong">
          {title}
        </Text>
        <Text color="$colorSubtle">{text}</Text>
      </Stack>
      <Row gap="$xxxl" rowGap="$huge" flexWrap="wrap" alignItems="flex-start">
        {children}
      </Row>
    </Stack>
  );
}

const journeyWidth = 300;

function Term({ name, children }: { name: string; children: string }) {
  return (
    <Stack flex={1} minWidth={240} gap="$xs">
      <Text bold color="$colorStrong">
        {name}
      </Text>
      <Text variant="label" fontWeight="$regular" color="$colorSubtle">
        {children}
      </Text>
    </Stack>
  );
}

export function App() {
  return (
    <Stack
      width="100%"
      maxWidth="$appWidth"
      alignSelf="center"
      paddingHorizontal="$xxl"
      paddingVertical="$huge"
    >
      <Stack gap="$lg" maxWidth="$contentWidth">
        <Text eyebrow>Linky · planned feature</Text>
        <Text variant="headline" color="$colorStrong">
          Beacon
        </Text>
        <Text variant="title" fontWeight="$regular" color="$colorSubtle">
          Contacts who are physically near each other see it in Linky, and a
          user can tell them whether they buy or sell bitcoin. Discovery runs
          over Bluetooth LE in the Android app. Conversations stay on Nostr.
        </Text>
        <Text color="$colorMuted">
          Experimental, Android 12 and later. The controls live on the Proxy
          payments tab and show only with Experimental features on. Every screen
          below is built from Linky's real UI elements with made-up people.
          Spec:{" "}
          <TextLink href="https://github.com/linky-fit/linky/issues/566">
            issue #566
          </TextLink>
          .
        </Text>
      </Stack>
      <Row
        gap="$xxl"
        flexWrap="wrap"
        alignItems="flex-start"
        paddingTop="$xxxl"
      >
        <Term name="Beacon">
          The Bluetooth broadcast a phone runs while the beacon switch is on. It
          tells mutual contacts the user is nearby and may carry a trade.
        </Term>
        <Term name="Nearby">
          A mutual contact whose beacon this phone received in the last two
          minutes.
        </Term>
        <Term name="Trade">
          The buy or sell intent, without an amount, that a beacon can carry;
          shown as Buys BTC or Sells BTC. Not an offer: offers are proxy
          payments.
        </Term>
      </Row>

      <Divider marginTop="$huge" />
      <Chapter
        id="turning-on"
        number={1}
        title="Turning it on"
        sees="With Experimental features on, the Proxy payments tab gets a Nearby section at its end, after Earn bitcoin. It holds the beacon switch. The first time the switch is turned on, a short intro explains what the beacon does, then Android asks for the Nearby devices permission. If the user declines, the section says what is missing and its Allow button asks again. The trade under the switch unlocks once the beacon runs."
        device="The switch starts a foreground service that broadcasts and scans over Bluetooth LE, also with the app closed. For each mutual contact the beacon carries one of three states: nearby only, buys BTC or sells BTC, masked so only that contact can read it. No amount is ever broadcast. To everyone else it looks like random bytes that change every ten minutes. While Linky is on screen the phone also broadcasts the user's plain npub, readable by anyone, so people can add each other; that stops the moment the app leaves the screen. The switch, the trade and the nearby list stay on this phone: nothing goes to Evolu or Nostr."
      >
        <Phone caption="Beacon off">
          <ProxyPaymentsScreen state="off" />
        </Phone>
        <Phone caption="First time the switch is turned on">
          <BeaconIntroScreen />
        </Phone>
        <Phone caption="Permission prompt">
          <ProxyPaymentsScreen state="asking" />
        </Phone>
        <Phone caption="Permission declined">
          <ProxyPaymentsScreen state="denied" />
        </Phone>
        <Phone caption="Beacon on, trade set" beaconOn>
          <ProxyPaymentsScreen state="on" trade={daveSells} />
        </Phone>
      </Chapter>

      <Divider />
      <Chapter
        id="trade"
        number={2}
        title="Choosing a trade"
        sees="The trade sits in the same Nearby section of the Proxy payments tab, under the switch. The user only says whether they buy or sell bitcoin: None, Buys BTC or Sells BTC. There is no amount. Nearby contacts see the choice on the user's avatar, in the chat banner and in a notification."
        device="The beacon carries the trade as one of three states per contact: nearby only, buys BTC or sells BTC, masked so only that contact can read it. Nothing else, and no amount is ever broadcast. Every change of the trade picks a new nonce, so the mask is never reused."
      >
        <Phone caption="Trade: None" beaconOn>
          <ProxyPaymentsScreen state="on" />
        </Phone>
        <Phone caption="Trade: Sells BTC" beaconOn>
          <ProxyPaymentsScreen state="on" trade={daveSells} />
        </Phone>
      </Chapter>

      <Divider />
      <Chapter
        id="contacts"
        number={3}
        title="Nearby on the contacts page"
        sees="A Nearby section above the contact sections, a row of avatars like stories. While the user's trade is not None, their avatar comes first with Buys BTC or Sells BTC on it, and a tap opens the Proxy payments tab scrolled to its Nearby section. Then nearby contacts, those with a trade first, with their trade on the avatar. A tap opens the conversation. With nobody nearby and no trade of their own, the section is not shown at all. The sections below stay as they are."
        device="A contact stays nearby for two minutes after their beacon was last received. Each received packet is one lookup in a table of tags the phone precomputes for every contact and ten-minute slot. A contact seen both by beacon and by npub shows once."
      >
        <Phone
          caption="Your trade set, four contacts nearby"
          beaconOn
          width={320}
        >
          <ContactsScreen
            me="Dave"
            myTrade={daveSells}
            nearby={nearbyForDave}
          />
        </Phone>
        <Phone
          caption="No trade of your own, four contacts nearby"
          beaconOn
          width={320}
        >
          <ContactsScreen me="Dave" nearby={nearbyForDave} />
        </Phone>
        <Phone
          caption="Nobody nearby, no trade: no Nearby section"
          beaconOn
          width={320}
        >
          <ContactsScreen me="Dave" nearby={[]} />
        </Phone>
      </Chapter>

      <Divider />
      <Chapter
        id="chat"
        number={4}
        title="The nearby banner in a conversation"
        sees="While the contact is nearby, the conversation shows a banner under the top bar. Plain presence says Nearby. With a trade it also says whether they buy or sell bitcoin. It goes away two minutes after the last packet. Messages and payments work as before."
        device="The banner reads the same nearby list as the stories row. Arranging the trade happens in the conversation, over Nostr, like any other message."
      >
        <Phone caption="Nearby" beaconOn>
          <ChatScreen
            contact="Ben Ellis"
            nearby
            messages={[
              { text: "I'll bring the board games", time: "05:57 PM" },
              {
                text: "I think I'm right behind you in the queue",
                time: "06:03 PM",
                outgoing: true,
              },
            ]}
          />
        </Phone>
        <Phone caption="Nearby, with a trade" beaconOn>
          <ChatScreen
            contact="Mia Novak"
            nearby
            trade={miaBuys}
            messages={[
              { text: "Are you at the meetup already?", time: "05:41 PM" },
              {
                text: "Yes, by the bar. I can sell you some",
                time: "05:44 PM",
                outgoing: true,
              },
              { text: "Great, coming over", time: "05:45 PM" },
            ]}
          />
        </Phone>
      </Chapter>

      <Divider />
      <Chapter
        id="add-contact"
        number={5}
        title="Finding new people on the add-contact page"
        sees="With the add-contact page open, people nearby who also have Linky open show up under Nearby, above New Linky users. Only people who are not contacts yet are listed. Add saves the contact."
        device="While Linky is on screen, the phone also broadcasts its plain npub. It stops as soon as the app leaves the screen, so nobody can follow the identity around. Scanning for npubs runs only while this page is open. Names and pictures come from the Nostr profile; without one the row shows the npub."
      >
        <Phone caption="Two people nearby with Linky open">
          <AddContactScreen
            nearby={nearbyStrangers}
            suggestions={newLinkyUsers}
          />
        </Phone>
      </Chapter>

      <Divider />
      <Chapter
        id="notifications"
        number={6}
        title="Android notifications"
        sees="While the beacon runs, Beacon is on stays in the notification shade with a Turn off action. When a contact's trade is received, Linky notifies once per contact per session, and a tap opens the conversation. Plain presence never notifies."
        device="Android requires a visible notification for a foreground service, so the beacon cannot run silently. The service restarts when the user opens the app, not when the phone boots."
      >
        <Phone caption="Notification shade" beaconOn>
          <NotificationShadeScreen>
            <TradeNotification person="Mia Novak" trade={miaBuys} />
            <BeaconOnNotification />
          </NotificationShadeScreen>
        </Phone>
        <Phone caption="Heads-up over the app" beaconOn width={320}>
          <ContactsScreen
            me="Dave"
            nearby={nearbyForDave}
            overlay={<TradeNotification person="Mia Novak" trade={miaBuys} />}
          />
        </Phone>
      </Chapter>

      <Divider />
      <Stack id="journeys" gap="$huge" paddingVertical="$huge">
        <Stack gap="$sm">
          <Text variant="caption" bold color="$accentText">
            7
          </Text>
          <Text variant="display" color="$colorStrong">
            Journeys
          </Text>
        </Stack>
        <Journey
          title="Dave turns on the beacon and sets a trade"
          text="Dave is at a meetup with bitcoin to sell. He turns the beacon on in the Nearby section of the Proxy payments tab, reads the intro once, allows Bluetooth and sets his trade to Sells BTC. From then on the phone advertises in the background."
        >
          <Phone
            caption="1. Proxy payments tab, Nearby section"
            width={journeyWidth}
          >
            <ProxyPaymentsScreen state="off" tap="switch" />
          </Phone>
          <Phone caption="2. Switch on → first-time intro" width={journeyWidth}>
            <BeaconIntroScreen tapTurnOn />
          </Phone>
          <Phone caption="3. Allow Nearby devices" width={journeyWidth}>
            <ProxyPaymentsScreen state="asking" tap="allow" />
          </Phone>
          <Phone
            caption="4. Trade set to Sells BTC"
            width={journeyWidth}
            beaconOn
          >
            <ProxyPaymentsScreen state="on" trade={daveSells} tap="sell" />
          </Phone>
          <Phone
            caption="5. You first in the Nearby row"
            width={journeyWidth}
            beaconOn
          >
            <ContactsScreen
              me="Dave"
              myTrade={daveSells}
              nearby={nearbyForDave}
            />
          </Phone>
        </Journey>
        <Journey
          title="Mia, a mutual contact, walks past"
          text="Mia has Dave saved and Dave has her. Her beacon is on too. Her phone matches Dave's packet against its tag table, notifies her once about his trade, and puts him first in her stories row."
        >
          <Phone caption="1. Trade notification" width={journeyWidth} beaconOn>
            <ContactsScreen
              me="Mia Novak"
              nearby={nearbyForMia}
              overlay={<TradeNotification person="Dave" trade={daveSells} />}
            />
          </Phone>
          <Phone
            caption="2. Dave first in the row"
            width={journeyWidth}
            beaconOn
          >
            <ContactsScreen
              me="Mia Novak"
              nearby={nearbyForMia}
              tapped="Dave"
            />
          </Phone>
          <Phone
            caption="3. Conversation with banner"
            width={journeyWidth}
            beaconOn
          >
            <ChatScreen
              contact="Dave"
              nearby
              trade={daveSells}
              messages={[
                {
                  text: "Saw you're selling BTC, still available?",
                  time: "07:12 PM",
                  outgoing: true,
                },
                { text: "Yes! I'm by the window", time: "07:13 PM" },
              ]}
            />
          </Phone>
        </Journey>
        <Journey
          title="Dave and Petra meet for the first time"
          text="Neither has the other saved, so the beacon can't match them. Both open the add-contact page and find each other under Nearby. Once both have saved each other, they are mutual contacts and see each other nearby."
        >
          <Phone caption="1. Dave sees Petra, taps Add" width={journeyWidth}>
            <AddContactScreen
              nearby={[petra]}
              suggestions={newLinkyUsers}
              tapped={petra.name}
            />
          </Phone>
          <Phone caption="2. Petra sees Dave, taps Add" width={journeyWidth}>
            <AddContactScreen
              nearby={[
                {
                  name: "Dave",
                  npub: "npub1d4ve…k0x3",
                  uri: "/avatars/dave.svg",
                },
              ]}
              suggestions={newLinkyUsers}
              tapped="Dave"
            />
          </Phone>
          <Phone
            caption="3. Mutual now, so Nearby"
            width={journeyWidth}
            beaconOn
          >
            <ChatScreen contact="Petra Dvorakova" nearby messages={[]} />
          </Phone>
        </Journey>
      </Stack>
    </Stack>
  );
}
