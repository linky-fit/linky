import type { StoryScreenKey } from "../copy";
import { useCopy } from "../locale";

/** What assistive technology calls the phone on each step of the story. */
export const useStoryLabels = (): Record<StoryScreenKey, string> => {
  const { labels } = useCopy().demo;
  return {
    amount: labels.amountStep,
    qr: labels.qrStep,
    paid: labels.paidStep,
  };
};
