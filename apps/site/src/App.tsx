import { Stack } from "@linky-fit/ui";
import { SiteLayout } from "./SiteLayout";
import { ClosingCta, Privacy } from "./landing/Closing";
import { copy } from "./landing/copy";
import { FeatureStory } from "./landing/FeatureStory";
import { Hero } from "./landing/Hero";
import "./landing/landing.css";
import { TokenSection } from "./landing/TokenSection";
import { useSiteLocale } from "./useSiteLocale";

function App() {
  const [locale, setLocale] = useSiteLocale();
  const activeCopy = copy[locale];

  return (
    <SiteLayout copy={activeCopy} locale={locale} onLocaleChange={setLocale}>
      <Stack gap="$huge">
        <Hero copy={activeCopy} />
        <FeatureStory copy={activeCopy} />
        <TokenSection copy={activeCopy} />
        <Privacy copy={activeCopy} />
        <ClosingCta copy={activeCopy} />
      </Stack>
    </SiteLayout>
  );
}

export default App;
