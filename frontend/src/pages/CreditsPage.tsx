import { useEffect, useState } from "react";
import { getCredits, type PhotoCredit } from "../api/endpoints";
import Hero from "../components/Hero";
import Icon from "../components/Icon";
import { useI18n } from "../i18n/I18nProvider";
import Spinner from "../components/Spinner";
import ZoomImage from "../components/ZoomImage";

/** Every photo the app shows, with its author, source and licence (images/ATTRIBUTIONS.md). */
export default function CreditsPage() {
  const { t } = useI18n();
  const [credits, setCredits] = useState<PhotoCredit[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getCredits().then(
      (list) => live && setCredits(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <Hero
        title={t("foot.credits")}
        sub={t("cr.sub")}
      />
      <main className="page">
        <section className="card credits" aria-label={t("foot.credits")}>
          <p className="muted credits__intro">
            {t("cr.intro")}
          </p>
          {failed && (
            <p role="alert" className="inline-error inline-error--box">
              <Icon name="warning" /> {t("cr.fail")}
            </p>
          )}
          {!credits && !failed && <Spinner label={t("cr.loading")} showLabel />}
          {credits && (
            <ul className="credits__list">
              {credits.map((c) => (
                <li key={c.file} className="credit">
                  <ZoomImage className="credit__thumb" src={`/${c.file}`} caption={c.used_for} />
                  <div className="credit__body">
                    <span className="credit__name">{c.used_for}</span>
                    <span className="credit__by">{t("cr.by", { author: c.author })}</span>
                    <span className="credit__links">
                      {c.source_url ? (
                        <a href={c.source_url} target="_blank" rel="noreferrer">
                          {c.source_title}
                        </a>
                      ) : (
                        <span>{c.source_title}</span>
                      )}
                      {c.license_url ? (
                        <a className="credit__license" href={c.license_url} target="_blank" rel="noreferrer">
                          {c.license}
                        </a>
                      ) : (
                        <span className="credit__license">{c.license}</span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
