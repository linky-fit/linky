import { Stack } from "@linky-fit/ui";
import { useState, type ComponentType, type ReactNode, type Ref } from "react";
import type { Screen } from "../copy";
import { ChatPayFlowScreen } from "./chatPay";
import { ChatRequestFlowScreen } from "./chatRequest";
import { ContactsScreen, WalletScreen } from "./home";
import { ProxyOfferScreen } from "./proxy";
import { useInView } from "./playback";
import { RecurringListScreen } from "./recurring";
import { TokenShareScreen } from "./token";

const demoScreens: Record<Screen, ComponentType> = {
  "chat-payment": ChatPayFlowScreen,
  "chat-request": ChatRequestFlowScreen,
  contacts: ContactsScreen,
  wallet: WalletScreen,
  "proxy-offer": ProxyOfferScreen,
  "recurring-list": RecurringListScreen,
  "token-share": TokenShareScreen,
};

/** The app's surface under the phone's status bar. */
export function DemoSurface({
  ref,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div ref={ref} className="demo-screen">
      <Stack
        flex={1}
        gap="$none"
        paddingTop="$huge"
        backgroundColor="$background"
      >
        {children}
      </Stack>
    </div>
  );
}

/** A demo screen that replays its animations whenever it comes into view while `active`. */
export function DemoScreen({
  screen,
  active = true,
}: {
  screen: Screen;
  active?: boolean;
}) {
  const { ref, inView } = useInView();
  const playing = active && inView;
  const [run, setRun] = useState({ playing, count: 0 });
  if (run.playing !== playing) {
    setRun({ playing, count: run.count + (playing ? 1 : 0) });
  }
  const Demo = demoScreens[screen];
  return (
    <DemoSurface ref={ref}>
      <Demo key={run.count} />
    </DemoSurface>
  );
}
