import { Stack, UIProvider } from "@linky-fit/ui";
import { DemoProvider } from "./demo/DemoProvider";
import { Audience, Benefits } from "./sections/Benefits";
import { Closing, SiteFooter } from "./sections/Closing";
import { Comparison } from "./sections/Comparison";
import { Faq } from "./sections/Faq";
import {
  HistoryFeature,
  PrivacyFeature,
  TipsFeature,
  WalletFeature,
} from "./sections/Features";
import { Hero } from "./sections/Hero";
import { HowItWorks } from "./sections/HowItWorks";
import { SiteHeader } from "./sections/SiteHeader";

export function App() {
  return (
    <UIProvider mode="dark" brand="fazole">
      <DemoProvider>
        <Stack id="top" flexGrow={1} gap="$none" backgroundColor="$background">
          <SiteHeader />
          <Stack
            render="main"
            width="100%"
            maxWidth="$appWidth"
            alignSelf="center"
            paddingHorizontal="$xl"
            gap="$none"
          >
            <Hero />
            <Benefits />
            <HowItWorks />
            <TipsFeature />
            <Audience />
            <HistoryFeature />
            <WalletFeature />
            <Comparison />
            <PrivacyFeature />
            <Faq />
            <Closing />
          </Stack>
          <SiteFooter />
        </Stack>
      </DemoProvider>
    </UIProvider>
  );
}
