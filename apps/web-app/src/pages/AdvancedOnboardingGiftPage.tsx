import type { FC } from "react";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { OnboardingGiftForm } from "../components/OnboardingGiftForm";
import { navigateTo } from "../hooks/useRouting";
import { DEFAULT_ONBOARDING_GIFT } from "../utils/onboardingGift";

export const AdvancedOnboardingGiftPage: FC = () => {
  const { onboardingGift, setOnboardingGift } = useAdvancedSettingsContext();
  const { t } = useAppShellCore();

  return (
    <section className="panel">
      <OnboardingGiftForm
        initial={onboardingGift ?? DEFAULT_ONBOARDING_GIFT}
        submitLabel={t("saveChanges")}
        onSubmit={(gift) => {
          setOnboardingGift(gift);
          navigateTo({ route: "advanced" });
        }}
      />
    </section>
  );
};
