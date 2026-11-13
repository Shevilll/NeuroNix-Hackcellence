import { useI18n } from "../i18n/I18nProvider";
import CheckerPanel from "../components/CheckerPanel";
import Hero from "../components/Hero";

export default function CheckPage() {
  const { t } = useI18n();
  return (
    <>
      <Hero title={t("nav.check")} sub={t("chk.sub")} />
      <main className="page page--narrow">
        <CheckerPanel />
      </main>
    </>
  );
}
