import Select from "../components/Select";
import { useI18n } from "./I18nProvider";
import { LANGUAGES } from "./languages";
import "./LanguageSwitcher.css";

/**
 * The language picker in the header. It uses the same dropdown as the form (components/Select),
 * so its list matches the rest of the app instead of the browser's native menu.
 */
export default function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch">
      <span id="lang-switch-label" className="sr-only">{t("lang.label")}</span>
      <Select
        id="lang-switch"
        labelledBy="lang-switch-label"
        value={lang}
        placeholder={t("lang.label")}
        options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
        onChange={setLang}
      />
    </div>
  );
}
