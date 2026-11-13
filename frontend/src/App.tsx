import { useEffect, useRef, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import ChatBot from "./components/ChatBot";
import Icon from "./components/Icon";
import Logo from "./components/Logo";
import { I18nProvider, useI18n } from "./i18n/I18nProvider";
import LanguageSwitcher from "./i18n/LanguageSwitcher";
import CheckPage from "./pages/CheckPage";
import CreditsPage from "./pages/CreditsPage";
import PlannerPage from "./pages/PlannerPage";
import ReservationPage from "./pages/ReservationPage";

const navClass = ({ isActive }: { isActive: boolean }) => `nav__link${isActive ? " nav__link--active" : ""}`;

function Shell() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // A new page closes the phone menu.
  useEffect(() => setMenuOpen(false), [pathname]);

  // While open, Escape or a press outside the header closes it. An Escape the language list already
  // handled (it calls preventDefault) only closes that list.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <div className="app">
      <div className="backdrop" aria-hidden="true" />
      <header className="app-header" ref={headerRef}>
        <div className="app-header__inner">
          <NavLink to="/" className="brand" end>
            <Logo />
            <span className="brand__name">Build My Holiday</span>
          </NavLink>
          <button
            ref={menuButtonRef}
            type="button"
            className="menu-btn"
            aria-expanded={menuOpen}
            aria-controls="header-menu"
            aria-label={t("nav.menu")}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? "cross" : "menu"} />
          </button>
          <div id="header-menu" className={`header-menu${menuOpen ? " header-menu--open" : ""}`}>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end className={navClass}>
              <Icon name="home" /> <span>{t("nav.plan")}</span>
            </NavLink>
            <NavLink to="/r" className={navClass}>
              <Icon name="search" /> <span>{t("nav.bookings")}</span>
            </NavLink>
            <NavLink to="/check" className={navClass}>
              <Icon name="shield" /> <span>{t("nav.check")}</span>
            </NavLink>
          </nav>
          <LanguageSwitcher />
          </div>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<PlannerPage />} />
        <Route path="/r" element={<ReservationPage />} />
        <Route path="/r/:number" element={<ReservationPage />} />
        <Route path="/check" element={<CheckPage />} />
        <Route path="/credits" element={<CreditsPage />} />
        <Route path="*" element={<PlannerPage />} />
      </Routes>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span className="site-footer__brand">
            <Logo /> Build My Holiday
          </span>
          <span className="site-footer__note">
            {t("foot.note")}{" "}
            <NavLink to="/credits">{t("foot.credits")}</NavLink>
          </span>
        </div>
      </footer>
      <ChatBot />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </I18nProvider>
  );
}
