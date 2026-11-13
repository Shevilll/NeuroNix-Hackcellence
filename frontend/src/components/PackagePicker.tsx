import { useRef, type KeyboardEvent } from "react";
import type { TripPackage } from "../api/endpoints";
import { duration, inr } from "../lib/format";
import { useI18n } from "../i18n/I18nProvider";
import CityRoute from "./CityRoute";
import Icon, { type IconName } from "./Icon";

export interface PackageChoice {
  key: string;
  label: string;
  package_id: string;
  package: TripPackage;
}

const ICONS: Record<string, IconName> = { recommended: "shield", cheapest: "wallet", fastest: "clock", best_rated: "star" };

interface Props {
  choices: PackageChoice[];
  value: string;
  budget: number;
  onPick: (key: string) => void;
}

/** G4: the traveler picks one of the packages. A tab list, so arrow keys move between them. */
export default function PackagePicker({ choices, value, budget, onPick }: Props) {
  const { t } = useI18n();
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
    <div className="picker" role="tablist" aria-label={t("pk.aria")}>
      {choices.map((c, i) => {
        const p = c.package;
        const selected = c.key === value;
        const icon = ICONS[c.key];
        return (
          <button
            key={c.key}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="tab"
            data-kind={c.key.replace(/_/g, "-")}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`picker__tab${selected ? " picker__tab--active" : ""}`}
            onClick={() => onPick(c.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="picker__top">
              <span className="picker__label">
                {icon && <Icon name={icon} />}
                {c.label}
              </span>
              {p.total_inr > budget && <span className="picker__flag">{t("pk.over")}</span>}
            </span>
            {icon && <span className="picker__about">{t(`pk.${c.key}.sub`)}</span>}
            <span className="picker__price">{inr(p.total_inr)}</span>
            <span className="picker__route">
              <CityRoute cities={p.cities} nights={p.nights_per_city} />
            </span>
            <span className="picker__meta">
              {p.travel_minutes !== undefined && <span>{t("pk.travel", { time: duration(p.travel_minutes) })}</span>}
              {p.avg_stars !== undefined && <span>{t("pk.stars", { n: Number(p.avg_stars.toFixed(1)) })}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
