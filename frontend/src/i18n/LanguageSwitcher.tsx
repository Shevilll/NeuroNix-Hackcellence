import Icon from "../components/Icon";
import { useI18n } from "./I18nProvider";
import { LANGUAGES } from "./languages";
import "./LanguageSwitcher.css";

/** The language picker in the header: a native dropdown, so it works with keyboard, touch and screen readers. */
export default function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <label className="lang-switch">
      <span className="lang-switch__field">
      <select className="lang-switch__select" value={lang} aria-label={t("lang.label")} onChange={(e) => setLang(e.target.value)}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      <span className="lang-switch__chevron" aria-hidden="true">
        <Icon name="chevron" />
      </span>
      </span>
    </label>
  );
}
