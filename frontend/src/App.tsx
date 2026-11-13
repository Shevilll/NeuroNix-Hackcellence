import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import Icon from "./components/Icon";
import Logo from "./components/Logo";
import CheckPage from "./pages/CheckPage";
import CreditsPage from "./pages/CreditsPage";
import PlannerPage from "./pages/PlannerPage";
import ReservationPage from "./pages/ReservationPage";

const navClass = ({ isActive }: { isActive: boolean }) => `nav__link${isActive ? " nav__link--active" : ""}`;

function Shell() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__inner">
          <NavLink to="/" className="brand" end>
            <Logo />
            <span className="brand__name">Build My Holiday</span>
          </NavLink>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end className={navClass}>
              <Icon name="home" /> <span>Plan a trip</span>
            </NavLink>
            <NavLink to="/r" className={navClass}>
              <Icon name="search" /> <span>Bookings</span>
            </NavLink>
            <NavLink to="/check" className={navClass}>
              <Icon name="shield" /> <span>Check a trip file</span>
            </NavLink>
          </nav>
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
            <Logo size={24} /> Build My Holiday
          </span>
          <span className="site-footer__note">
            Prices in Indian rupees for everyone travelling. Photos from Wikimedia Commons under free licences:{" "}
            <NavLink to="/credits">Photo credits</NavLink>
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
