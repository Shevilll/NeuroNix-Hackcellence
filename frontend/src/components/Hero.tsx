import type { ReactNode } from "react";

/** The blue band under the header with the page title. Content below overlaps it. */
export default function Hero({ title, sub, children }: { title: string; sub: string; children?: ReactNode }) {
  return (
    <div className="hero">
      <div className="hero__inner">
        <h1 className="hero__title">{title}</h1>
        <p className="hero__sub">{sub}</p>
        {children}
      </div>
    </div>
  );
}
