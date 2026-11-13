import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import Icon from "./Icon";
import "./ZoomImage.css";

interface Props {
  src: string;
  className?: string;
  /** Short description of the photo, used in the button name and under the large photo. */
  caption?: string;
}

/** A thumbnail that opens a larger photo in an overlay. Esc, the backdrop or Minimize closes it. */
export default function ZoomImage({ src, className, caption }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="zoom__trigger"
        aria-label={caption ? t("zoom.enlargeNamed", { name: caption }) : t("zoom.enlarge")}
        onClick={() => setOpen(true)}
      >
        <img className={className} src={src} alt="" loading="lazy" />
      </button>
      {open && (
        <div
          className="zoom__backdrop"
          data-testid="zoom-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={caption ?? t("zoom.photo")}
          onClick={() => setOpen(false)}
        >
          <figure className="zoom__figure" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="zoom__close" onClick={() => setOpen(false)} autoFocus>
              <Icon name="cross" />
              <span>{t("zoom.min")}</span>
            </button>
            <img className="zoom__big" src={src} alt={caption ?? ""} />
            {caption && <figcaption className="zoom__caption">{caption}</figcaption>}
          </figure>
        </div>
      )}
    </>
  );
}
