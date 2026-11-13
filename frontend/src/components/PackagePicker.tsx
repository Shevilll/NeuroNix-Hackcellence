import { useRef, type KeyboardEvent } from "react";
import type { TripPackage } from "../api/endpoints";
import { duration, inr } from "../lib/format";
import CityRoute from "./CityRoute";
import Icon, { type IconName } from "./Icon";

export interface PackageChoice {
  key: string;
  label: string;
  package_id: string;
  package: TripPackage;
}

const ABOUT: Record<string, { icon: IconName; text: string }> = {
  recommended: { icon: "shield", text: "Most to see" },
  cheapest: { icon: "wallet", text: "Lowest price" },
  fastest: { icon: "clock", text: "Least travel time" },
  best_rated: { icon: "star", text: "Top hotel stars" },
};

const stars = (n: number) => `${Number(n.toFixed(1))} stars`;

interface Props {
  choices: PackageChoice[];
  value: string;
  budget: number;
  onPick: (key: string) => void;
}

/** G4: the traveler picks one of the packages. A tab list, so arrow keys move between them. */
export default function PackagePicker({ choices, value, budget, onPick }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + choices.length) % choices.length;
    refs.current[next]?.focus();
    onPick(choices[next].key);
  }

  return (
    <div className="picker" role="tablist" aria-label="Package choices">
      {choices.map((c, i) => {
        const p = c.package;
        const selected = c.key === value;
        const about = ABOUT[c.key];
        return (
          <button
            key={c.key}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`picker__tab${selected ? " picker__tab--active" : ""}`}
            onClick={() => onPick(c.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="picker__top">
              <span className="picker__label">
                {about && <Icon name={about.icon} />}
                {c.label}
              </span>
              {p.total_inr > budget && <span className="picker__flag">Over budget</span>}
            </span>
            {about && <span className="picker__about">{about.text}</span>}
            <span className="picker__price">{inr(p.total_inr)}</span>
            <span className="picker__route">
              <CityRoute cities={p.cities} nights={p.nights_per_city} />
            </span>
            <span className="picker__meta">
              {p.travel_minutes !== undefined && <span>{duration(p.travel_minutes)} travel</span>}
              {p.avg_stars !== undefined && <span>{stars(p.avg_stars)}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
