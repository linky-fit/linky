import { Stack, UIProvider } from "@linky-fit/ui";
import { DemoProvider } from "./demo/DemoProvider";
import { LocaleProvider } from "./LocaleProvider";
import { Closing, SiteFooter } from "./sections/Closing";
import { Contact } from "./sections/Contact";
import { Hero } from "./sections/Hero";
import { SiteHeader } from "./sections/SiteHeader";
import { Steps } from "./sections/Steps";
import { Stories } from "./sections/Stories";
import { Why } from "./sections/Why";
import { useSiteLocale } from "./useSiteLocale";

export function App() {
  const [locale, setLocale] = useSiteLocale();
  return (
    <UIProvider mode="dark" brand="fazole">
      <LocaleProvider locale={locale} onLocaleChange={setLocale}>
        <DemoProvider>
          <Stack
            id="top"
            flexGrow={1}
            gap="$none"
            backgroundColor="$background"
          >
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
              <Stories />
              <Steps />
              <Why />
              <Closing />
              <Contact />
            </Stack>
            <SiteFooter />
          </Stack>
        </DemoProvider>
      </LocaleProvider>
    </UIProvider>
  );
}
