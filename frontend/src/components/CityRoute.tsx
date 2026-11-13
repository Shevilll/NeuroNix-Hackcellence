import { Fragment } from "react";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";

/** "Tokyo (2n) -> Kyoto (2n)" with an SVG arrow between the cities. */
export default function CityRoute({ cities, nights }: { cities: string[]; nights: number[] }) {
  const { t, place } = useI18n();
  return (
    <span className="route">
      {cities.map((city, i) => (
        <Fragment key={city}>
          {i > 0 && (
            <>
              <span className="sr-only"> {t("route.then")} </span>
              <Icon name="arrow" className="route__arrow" />
            </>
          )}
          <span>{`${place(city)} (${t("u.nightsShort", { n: nights[i] })})`}</span>
        </Fragment>
      ))}
    </span>
  );
}
