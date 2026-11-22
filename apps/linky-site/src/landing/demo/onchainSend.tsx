import {
  Amount,
  Button,
  IconButton,
  ListRow,
  MediaFrame,
  Notice,
  OptionTile,
  Row,
  Section,
  Stack,
  Text,
  TextField,
  TopBar,
  type IconName,
} from "@linky-fit/ui";
import { DemoBody, DemoTabBar, DemoTopBar } from "./chrome";
import { Arrive, FlowScenes, Tap } from "./flow";
import { noop } from "./noop";
import { onchainSendCues } from "./onchainSendCues";
import { useFlow } from "./playback";

const payoutAddress =
  "bc1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rq9x8k2m";
const title = "Send to on-chain wallet";

/** The Wallet tab, its balance below the 202,000 sat a 200,000 sat send would cost, so 100,000 sat is the largest it pays. */
function WalletScene({ tapSend }: { tapSend: boolean }) {
  return (
    <>
      <TopBar
        large
        title="Wallet"
        trailing={
          <IconButton
            icon="ScanLine"
            size="sm"
            variant="ghost"
            accessibilityLabel="ScanLine"
            onPress={noop}
          />
        }
      />
      <Stack
        flex={1}
        paddingHorizontal="$xl"
        paddingTop="$md"
        paddingBottom="$huge"
        overflow="hidden"
      >
        <Stack flexGrow={1} gap="$xxl" justifyContent="space-between">
          <Stack alignItems="center" gap="$xs" paddingTop="$xxl">
            <Amount value="158,420" unit="sat" size="xl" />
            <Button variant="ghost" size="sm" icon="History" onPress={noop}>
              History
            </Button>
          </Stack>
          <Row gap="$sm">
            <Button
              flex={1}
              icon="ArrowDownRight"
              minHeight="$controlLg"
              borderRadius="$pill"
              onPress={noop}
            >
              Receive
            </Button>
            <Tap on={tapSend} flex={1}>
              <Button
                flex={1}
                icon="ArrowUpRight"
                minHeight="$controlLg"
                borderRadius="$pill"
                onPress={noop}
              >
                Send
              </Button>
            </Tap>
          </Row>
        </Stack>
      </Stack>
      <DemoTabBar active="wallet" />
    </>
  );
}

const scanActions: readonly [IconName, string][] = [
  ["ClipboardPaste", "Paste"],
  ["BadgePlus", "Issue"],
  ["Images", "Gallery"],
];

/** The full-screen Send scanner, with a touch on its on-chain row. */
function SendScanScene({ tapOnchain }: { tapOnchain: boolean }) {
  return (
    <Stack flex={1} gap="$md" padding="$xl" paddingBottom="$huge">
      <Row>
        <Text flex={1} variant="title">
          Send
        </Text>
        <IconButton
          icon="X"
          size="sm"
          accessibilityLabel="Close"
          onPress={noop}
        />
      </Row>
      <MediaFrame accessibilityLabel="Camera preview" fill>
        <Stack flex={1} backgroundColor="$bezel" />
      </MediaFrame>
      <Stack gap="$sm">
        <ListRow icon="Keyboard" title="Type recipient" onPress={noop} />
        <Tap on={tapOnchain}>
          <ListRow icon="Bitcoin" title={title} onPress={noop} />
        </Tap>
        <Row gap="$sm" alignItems="stretch">
          {scanActions.map(([icon, label]) => (
            <OptionTile
              key={label}
              label={label}
              icon={icon}
              flex={1}
              onPress={noop}
            />
          ))}
        </Row>
      </Stack>
    </Stack>
  );
}

/** The send form at its largest payable amount, the payout address pasted once `pasted`. */
function SendFormScene({
  tapAddress,
  pasted,
  tapSubmit,
}: {
  tapAddress: boolean;
  pasted: boolean;
  tapSubmit: boolean;
}) {
  return (
    <>
      <DemoTopBar title={title} leading="ChevronLeft" />
      <DemoBody paddingTop="$lg">
        <Text color="$colorSubtle">
          Arrives in your bitcoin wallet within 24 hours.
        </Text>
        <Stack alignItems="center" gap="$xs" paddingVertical="$lg">
          <Row alignItems="center" gap="$lg">
            <IconButton
              icon="Minus"
              variant="secondary"
              accessibilityLabel="Lower amount"
              onPress={noop}
            />
            <Amount value="100,000" unit="sat" size="lg" />
            <IconButton
              icon="Plus"
              variant="secondary"
              accessibilityLabel="Higher amount"
              disabled
              onPress={noop}
            />
          </Row>
          <Text variant="caption" color="$colorMuted">
            + 1,000 sat fee
          </Text>
        </Stack>
        <Tap on={tapAddress}>
          <TextField
            label="Bitcoin address to send to"
            value={pasted ? payoutAddress : ""}
            onChangeText={noop}
          />
        </Tap>
        <Tap on={tapSubmit}>
          <Button disabled={!pasted} onPress={noop}>
            Send
          </Button>
        </Tap>
      </DemoBody>
    </>
  );
}

/** The transfer's page: on its way, then completed once opening the payout address in the explorer found the payout. */
function TransferScene({
  tapOpen,
  completed,
}: {
  tapOpen: boolean;
  completed: boolean;
}) {
  return (
    <>
      <DemoTopBar title={title} leading="ChevronLeft" />
      <DemoBody paddingTop="$lg" gap="$lg">
        {completed ? (
          <Arrive key="completed">
            <Notice
              tone="accent"
              title="Completed"
              description="100,000 sat was sent to your on-chain wallet."
            />
          </Arrive>
        ) : (
          <Notice
            tone="info"
            title="On its way"
            description="Your bitcoin wallet receives 100,000 sat within 24 hours after you paid."
          />
        )}
        <Section>
          <ListRow title="Paid" value="101,000 sat" />
        </Section>
        <Section>
          <ListRow title="You get" value="100,000 sat" />
        </Section>
        <Stack gap="$xs" alignItems="center">
          <Text variant="caption" color="$colorMuted">
            To address:
          </Text>
          <Text mono textAlign="center">
            {payoutAddress.match(/.{1,4}/gu)?.join(" ")}
          </Text>
        </Stack>
        <Tap on={tapOpen}>
          <ListRow
            icon="ArrowUpRight"
            title="Open address in browser"
            chevron={false}
            onPress={noop}
          />
        </Tap>
        {completed ? (
          <Arrive>
            <ListRow
              icon="ArrowUpRight"
              title="View transaction in browser"
              chevron={false}
              onPress={noop}
            />
          </Arrive>
        ) : null}
      </DemoBody>
    </>
  );
}

/** Dave sends 100,000 sat from his wallet to a bitcoin address, opens it in the explorer and sees the payout land. */
export function OnchainSendScreen() {
  const at = useFlow(onchainSendCues);
  const current = [at("scan"), at("form"), at("sent")].filter(Boolean).length;
  return (
    <FlowScenes
      current={current}
      scenes={[
        { node: <WalletScene tapSend={at("tapSend")} /> },
        {
          node: <SendScanScene tapOnchain={at("tapOnchain")} />,
          enter: "modal",
        },
        {
          node: (
            <SendFormScene
              tapAddress={at("tapAddress")}
              pasted={at("paste")}
              tapSubmit={at("tapSubmit")}
            />
          ),
          enter: "push",
        },
        {
          node: (
            <TransferScene
              tapOpen={at("tapOpen") && !at("completed")}
              completed={at("completed")}
            />
          ),
          enter: "push",
        },
      ]}
    />
  );
}
