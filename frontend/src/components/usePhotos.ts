import { useEffect, useState } from "react";
import { getImages } from "../api/endpoints";

let cache: Record<string, string> | null = null;

/** catalog id -> photo URL. Loaded once; the app works without photos if this fails. */
export function usePhotos(): Record<string, string> {
  const [photos, setPhotos] = useState<Record<string, string>>(cache ?? {});
  useEffect(() => {
    if (cache) return;
    getImages().then((m) => { cache = m; setPhotos(m); }, () => undefined);
  }, []);
  return photos;
}
