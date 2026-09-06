import { Bitcoin, Languages, MessageCircle, Settings } from "lucide-react";
import { navigateTo } from "../hooks/useRouting";
import type { Translate } from "../i18n";
import { ModalSheet } from "./ModalSheet";
import { SettingsLinkRow } from "./SettingsRows";

interface MenuModalProps {
  closeMenu: () => void;
  openFeedbackContact: () => void;
  t: Translate;
}

export function MenuModal({
  closeMenu,
  openFeedbackContact,
  t,
}: MenuModalProps) {
  return (
    <ModalSheet
      className="menu-modal-overlay"
      sheetClassName="menu-modal-sheet"
      aria-modal="false"
      aria-label={t("menu")}
      onClick={closeMenu}
    >
      <SettingsLinkRow
        icon={<Languages size={18} />}
        label={t("language")}
        onClick={() => {
          closeMenu();
          navigateTo({ route: "settingsLanguage" });
        }}
      />
      <SettingsLinkRow
        icon={<Bitcoin size={18} />}
        label={t("unit")}
        onClick={() => {
          closeMenu();
          navigateTo({ route: "settingsUnits" });
        }}
      />
      <SettingsLinkRow
        icon={<Settings size={18} />}
        label={t("advanced")}
        dataGuide="open-advanced"
        onClick={() => {
          closeMenu();
          navigateTo({ route: "advanced" });
        }}
      />
      <SettingsLinkRow
        icon={<MessageCircle size={18} />}
        label={t("feedback")}
        onClick={() => {
          closeMenu();
          openFeedbackContact();
        }}
      />
    </ModalSheet>
  );
}
