import { Fragment } from "react";
import Icon from "./Icon";

/** "Tokyo (2n) -> Kyoto (2n)" with an SVG arrow between the cities. */
export default function CityRoute({ cities, nights }: { cities: string[]; nights: number[] }) {
  return (
    <span className="route">
      {cities.map((city, i) => (
        <Fragment key={city}>
          {i > 0 && (
            <>
              <span className="sr-only"> then </span>
              <Icon name="arrow" className="route__arrow" />
            </>
          )}
          <span>{`${city} (${nights[i]}n)`}</span>
        </Fragment>
      ))}
    </span>
  );
}
