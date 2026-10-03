import {
  Button,
  DeviceFrame,
  Icon,
  Pressable,
  Row,
  Stack,
  Text,
  type DeviceFrameProps,
  type IconName,
} from "@linky-fit/ui";
import { themes } from "@linky-fit/ui/tokens";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useColorMode } from "../colorMode";
import type { CtaMode, LandingCopy, Screen } from "./copy";
import { ScaledScreen } from "./demo/ScaledScreen";
import { demoScreens } from "./demo/screens";

interface PlatformCtas {
  primary: CtaMode;
  secondary: CtaMode[];
  others: CtaMode[];
}

const androidCtas: PlatformCtas = {
  primary: "google-play",
  secondary: ["zapstore"],
  others: ["web", "android-apk"],
};

const defaultCtas: PlatformCtas = {
  primary: "web",
  secondary: [],
  others: ["google-play", "zapstore", "android-apk"],
};

const ctaIcons: Record<CtaMode, IconName> = {
  "android-apk": "Download",
  "google-play": "Play",
  web: "Monitor",
  zapstore: "Zap",
};

const ctaUrls: Record<CtaMode, string> = {
  "android-apk":
    "https://github.com/hynek-jina/linky/releases/latest/download/linky.apk",
  "google-play": "https://play.google.com/store/apps/details?id=fit.linky.app",
  web: "https://app.linky.fit",
  zapstore: "https://zapstore.dev/apps/fit.linky.app",
};

const isAndroid = () => /android/i.test(navigator.userAgent);

const launchApp = (mode: CtaMode) => {
  if (mode === "google-play" && isAndroid()) {
    window.location.assign(
      `intent://play.google.com/store/apps/details?id=fit.linky.app#Intent;scheme=https;package=com.android.vending;S.browser_fallback_url=${encodeURIComponent(ctaUrls.web)};end`,
    );
    return;
  }
  window.open(ctaUrls[mode], "_blank", "noopener,noreferrer");
};

/** The platform's recommended apps, with the other platforms one tap away. */
export function AppLaunch({
  copy,
  centered = false,
}: {
  copy: Pick<LandingCopy, "ctaLabels" | "showOthersLabel">;
  centered?: boolean;
}) {
  const [{ primary, secondary, others }] = useState(() =>
    isAndroid() ? androidCtas : defaultCtas,
  );
  const [showOthers, setShowOthers] = useState(false);
  return (
    <Stack gap="$lg" alignItems={centered ? "center" : "flex-start"}>
      <Row
        gap="$sm"
        flexWrap="wrap"
        justifyContent={centered ? "center" : "flex-start"}
      >
        <Button
          icon={ctaIcons[primary]}
          paddingHorizontal="$xxl"
          onPress={() => launchApp(primary)}
        >
          {copy.ctaLabels[primary]}
        </Button>
        {[...secondary, ...(showOthers ? others : [])].map((mode) => (
          <Button
            key={mode}
            variant="secondary"
            icon={ctaIcons[mode]}
            onPress={() => launchApp(mode)}
          >
            {copy.ctaLabels[mode]}
          </Button>
        ))}
      </Row>
      {showOthers ? null : (
        <Pressable
          gap="$xs"
          paddingVertical="$xs"
          borderRadius="$sm"
          onPress={() => setShowOthers(true)}
        >
          <Text
            variant="label"
            color="$colorMuted"
            hoverStyle={{ color: "$color" }}
          >
            {copy.showOthersLabel}
          </Text>
          <Icon name="ChevronDown" size="sm" color="$colorMuted" />
        </Pressable>
      )}
    </Stack>
  );
}

/** A soft pool of accent light behind the product. */
export function Glow({
  size,
  top,
  left,
}: {
  size: string;
  top: string;
  left: string;
}) {
  const mode = useColorMode();
  return (
    <div
      aria-hidden
      className="landing-glow"
      style={{
        width: size,
        height: size,
        top,
        left,
        transform: "translate(-50%, -50%)",
        background: `radial-gradient(closest-side, ${themes[mode].accent}, transparent)`,
        opacity: mode === "dark" ? 0.32 : 0.22,
      }}
    />
  );
}

/** A live app screen in a phone. */
export function Phone({
  screen,
  ...props
}: Omit<DeviceFrameProps, "children"> & { screen: Screen }) {
  const DemoScreen = demoScreens[screen];
  return (
    <DeviceFrame {...props}>
      <ScaledScreen>
        <DemoScreen />
      </ScaledScreen>
    </DeviceFrame>
  );
}

/** Fades its content in the first time it scrolls into view. */
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { threshold: 0.15 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={visible ? "landing-reveal is-visible" : "landing-reveal"}
    >
      {children}
    </div>
  );
}
