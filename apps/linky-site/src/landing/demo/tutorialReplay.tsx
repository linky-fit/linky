import {
  Button,
  Card,
  ListRow,
  Progress,
  Row,
  Stack,
  Text,
  type IconName,
  type TourTarget,
} from "@linky-fit/ui";
import { border, shadow, size, space } from "@linky-fit/ui/tokens";
import { useLayoutEffect, useRef, useState } from "react";
import { ChatScreen, Message } from "./chat";
import { PayPage } from "./chatPay";
import { DemoBody, DemoTopBar } from "./chrome";
import { SettingsScene } from "./contactBlock";
import { FlowScenes, Tap } from "./flow";
import { ContactsScreen } from "./home";
import { noop } from "./noop";
import { useCues, useFlow } from "./playback";

// In time order, as `useFlow` plays them.
const tutorialCues = {
  tapTutorial: 700,
  tutorial: 1000,
  tapShowHow: 2300,
  contacts: 2600,
  step1: 2850,
  tapContact: 4000,
  chat: 4300,
  step2: 4750,
  tapPay: 5900,
  pay: 6200,
  step3: 6650,
};

const digits = ["2", "1", "0", "0"];
const digitTicks = [7450, 7700, 7950, 8200];

type At = (cue: keyof typeof tutorialCues) => boolean;

interface Task {
  icon: IconName;
  title: string;
  done: boolean;
}

// The web app's Tutorial page in its order, without the Android-only beacon.
const tasks: Task[] = [
  { icon: "UserPlus", title: "Add contact", done: true },
  { icon: "MessageCircleMore", title: "Send a message", done: true },
  { icon: "ArrowDownRight", title: "Receive bitcoin", done: true },
  { icon: "ShieldCheck", title: "Back up keys", done: true },
  { icon: "HandCoins", title: "Pay", done: true },
  { icon: "Zap", title: "Register a Linky name", done: true },
  { icon: "Users", title: "Create a group", done: false },
  { icon: "Landmark", title: "Set up proxy payments", done: false },
];

const replayed = "Pay";

interface GuideStep {
  title: string;
  body: string;
  /** The `data-guide` of the element the step highlights. */
  target: string;
}

// The web app's pay walkthrough; its fourth step, Wallet > Send, is left out.
const contactStep: GuideStep = {
  title: "Pay",
  body: "Open any contact.",
  target: "contact-card",
};
const chatStep: GuideStep = {
  title: "Payment",
  body: "In the conversation, tap Pay.",
  target: "chat-pay",
};
const amountStep: GuideStep = {
  title: "Send payment",
  body: "Enter an amount (using the keypad) and tap Send.",
  target: "pay-step3",
};
const payGuide = [contactStep, chatStep, amountStep];
const payGuideSteps = 4;

function TutorialScene({ tapShowHow }: { tapShowHow: boolean }) {
  const done = tasks.filter((task) => task.done).length;
  const progress = `Completed ${done}/${tasks.length}`;
  return (
    <>
      <DemoTopBar title="Tutorial" leading="ChevronLeft" />
      <DemoBody paddingTop="$lg" gap="$lg">
        <Text color="$colorMuted">Learn Linky step by step.</Text>
        <Row gap="$sm">
          <Stack flex={1}>
            <Progress
              value={Math.round((done / tasks.length) * 100)}
              max={100}
              accessibilityLabel={progress}
            />
          </Stack>
          <Text variant="caption" bold color="$colorMuted">
            {progress}
          </Text>
        </Row>
        <Stack>
          {tasks.map((task) => (
            <ListRow
              key={task.title}
              icon={task.icon}
              title={task.title}
              trailing={
                <Tap on={task.title === replayed && tapShowHow}>
                  <Button
                    size="sm"
                    variant={task.done ? "secondary" : "primary"}
                    onPress={noop}
                  >
                    Show how
                  </Button>
                </Tap>
              }
            />
          ))}
        </Stack>
      </DemoBody>
    </>
  );
}

/** Where `element` sits in `layer`, ignoring the transforms of scenes sliding in. */
function layoutRect(element: HTMLElement, layer: HTMLElement): TourTarget {
  let top = -layer.offsetTop;
  let left = -layer.offsetLeft;
  for (
    let node: Element | null = element;
    node instanceof HTMLElement && node !== layer.offsetParent;
    node = node.offsetParent
  ) {
    top += node.offsetTop;
    left += node.offsetLeft;
  }
  return {
    top,
    left,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
}

// The app's padding around the highlighted element and its margin to the screen edges.
const pad = space.sm;

/** The app's guided tour over the phone: the scrim around the step's target and its card. */
function GuideOverlay({ step }: { step: GuideStep }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{
    target: TourTarget;
    below: boolean;
  }>();
  const { title, body, target } = step;
  const number = payGuide.indexOf(step) + 1;
  useLayoutEffect(() => {
    const layer = ref.current;
    const element = layer?.offsetParent?.querySelector(
      `[data-guide="${target}"]`,
    );
    if (!layer || !(element instanceof HTMLElement)) return;
    const rect = layoutRect(element, layer);
    setPlaced({
      target: {
        top: Math.max(rect.top - pad, pad),
        left: Math.max(rect.left - pad, pad),
        width: Math.min(rect.width + pad * 2, layer.offsetWidth - pad * 2),
        height: Math.min(rect.height + pad * 2, layer.offsetHeight - pad * 2),
      },
      below: rect.top + rect.height / 2 > layer.offsetHeight / 2,
    });
  }, [target]);
  return (
    // A plain element, so its ref is the DOM node to measure from; it also dims the status bar.
    <div
      ref={ref}
      className="flow-fade-in"
      style={{ position: "absolute", inset: `${-space.huge}px 0 0`, zIndex: 1 }}
    >
      {placed ? (
        <>
          {scrimBands(placed.target).map((band, index) => (
            <Stack
              key={index}
              position="absolute"
              {...band}
              backgroundColor="$scrim"
            />
          ))}
          <Stack
            position="absolute"
            {...placed.target}
            borderWidth={border.emphasis}
            borderColor="$accent"
            borderRadius="$card"
          />
          <Stack
            position="absolute"
            left="$xl"
            right="$xl"
            {...(placed.below
              ? { top: "$huge" }
              : { bottom: size.row + space.xl })}
            alignItems="center"
          >
            <Card width="100%" boxShadow={shadow.floating}>
              <Row justifyContent="space-between">
                <Text variant="title" flex={1}>
                  {title}
                </Text>
                <Text variant="caption" color="$colorMuted">
                  {number} / {payGuideSteps}
                </Text>
              </Row>
              <Text color="$colorSubtle">{body}</Text>
              <Row flexWrap="wrap" justifyContent="flex-end" gap="$sm">
                <Button variant="ghost" onPress={noop}>
                  Skip
                </Button>
                <Button
                  variant="secondary"
                  disabled={number <= 1}
                  onPress={noop}
                >
                  Back
                </Button>
                <Button onPress={noop}>Next</Button>
              </Row>
            </Card>
          </Stack>
        </>
      ) : null}
    </div>
  );
}

/** Four bands that dim everything around the target, as the app's tour does. */
const scrimBands = ({ top, left, width, height }: TourTarget) => [
  { top: 0, left: 0, right: 0, height: top },
  { top: top + height, left: 0, right: 0, bottom: 0 },
  { top, left: 0, width: left, height },
  { top, left: left + width, right: 0, height },
];

/** The walkthrough step on screen; none while the next page slides in. */
function guideStep(at: At) {
  if (at("step3")) return amountStep;
  if (at("step2") && !at("pay")) return chatStep;
  if (at("step1") && !at("chat")) return contactStep;
  return undefined;
}

/** Dave opens Settings > Tutorial, replays the pay walkthrough he finished long ago and follows it. */
export function TutorialReplayScreen() {
  const at = useFlow(tutorialCues);
  const step = guideStep(at);
  const pressed = useCues(digitTicks);
  return (
    <Stack flex={1} position="relative">
      <FlowScenes
        current={
          [at("tutorial"), at("contacts"), at("chat"), at("pay")].filter(
            Boolean,
          ).length
        }
        scenes={[
          {
            node: (
              <SettingsScene
                tapped={at("tapTutorial") ? "Tutorial" : undefined}
              />
            ),
          },
          {
            node: <TutorialScene tapShowHow={at("tapShowHow")} />,
            enter: "push",
          },
          {
            node: (
              <ContactsScreen
                tapped={at("tapContact") ? "Mia Novak" : undefined}
              />
            ),
          },
          {
            node: (
              <ChatScreen contact="Mia Novak" tapPay={at("tapPay")}>
                <Message>Dinner was great, thanks!</Message>
                <Message outgoing>
                  So good to see you! Same place next week?
                </Message>
                <Message>Absolutely 😊 Your turn to pay this time 🍝</Message>
              </ChatScreen>
            ),
            enter: "push",
          },
          {
            node: (
              <PayPage
                amount={Number(digits.slice(0, pressed).join(""))}
                pressedKey={digits[pressed - 1]}
                press={pressed}
              />
            ),
            enter: "push",
          },
        ]}
      />
      {step ? <GuideOverlay key={step.target} step={step} /> : null}
    </Stack>
  );
}
