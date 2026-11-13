import { useEffect, useState } from "react";
import { getPlaces } from "../api/endpoints";
import type { Place } from "../lib/travel";

let cache: Record<string, Place> | null = null;

/** attraction id -> latitude and longitude. Loaded once; without it the plan shows no travel times. */
export function usePlaces(): Record<string, Place> {
  const [places, setPlaces] = useState<Record<string, Place>>(cache ?? {});
  useEffect(() => {
    if (cache) return;
    getPlaces().then((m) => { cache = m; setPlaces(m); }, () => undefined);
  }, []);
  return places;
}
