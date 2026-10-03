import { Stack } from "@linky-fit/ui";
import { useEffect, useRef, useState, type ComponentType } from "react";
import type { Screen } from "../copy";
import { ChatPaymentScreen, ChatRequestScreen } from "./chat";
import { ContactsScreen, WalletScreen } from "./home";
import { ProxyOfferScreen } from "./proxy";
import { RecurringListScreen } from "./recurring";
import { TokenShareScreen } from "./token";

const demoScreens: Record<Screen, ComponentType> = {
  "chat-payment": ChatPaymentScreen,
  "chat-request": ChatRequestScreen,
  contacts: ContactsScreen,
  wallet: WalletScreen,
  "proxy-offer": ProxyOfferScreen,
  "recurring-list": RecurringListScreen,
  "token-share": TokenShareScreen,
};

function useInView() {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold: 0.5 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, inView };
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
    <div ref={ref} className="demo-screen">
      <Stack
        flex={1}
        gap="$none"
        paddingTop="$huge"
        backgroundColor="$background"
      >
        <Demo key={run.count} />
      </Stack>
    </div>
  );
}
