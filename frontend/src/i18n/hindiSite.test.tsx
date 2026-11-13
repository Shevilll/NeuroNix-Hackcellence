/**
 * The whole site in Hindi: every page and panel is rendered with Hindi chosen, and no English
 * interface word may be left. Names that come from the catalog (hotels, airlines, attractions,
 * flight codes) are data and stay as they are.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import NoPackageNotice from "../components/NoPackageNotice";
import OverBudgetNotice from "../components/OverBudgetNotice";
import PackageView from "../components/PackageView";
import { bookings, credits, makePackage, reply, stubApi } from "../test/fixtures";
import { I18nProvider } from "./I18nProvider";
import { MESSAGES } from "./messages";

const hi = MESSAGES.hi;

/** Catalog data: names, codes and file names that are not interface text. */
const DATA = [
  "AirVeda AV 520 BLR to NRT", "AirVeda AV 515 KIX to BLR", "Ginza Pearl Hotel", "Sakura Garden Hotel",
  "Narita limousine bus to Ginza", "Senso-ji", "Shinkansen Tokyo to Kyoto", "Kansai limousine bus to Kyoto station",
  "Fushimi Inari Taisha", "Kiyomizu-dera", "Hotel room (generic)", "Kiyomizu.jpg", "Twin room.jpg", "Martin Falbisoner",
  "Jane Doe", "CC BY-SA 4.0", "CC0", "Build My Holiday", "English", "Grand Kyoto Inn · Twin room", "Grand Kyoto Inn",
  "Gion", "Chrome", "Edge", "Safari", "JSON", "INR",
];

const ENGLISH = [
  /\b(night|nights|adult|adults|child|children|room|rooms|seat|seats|problem|problems|booking|bookings)\b/i,
  /\b(Day|Check in|check out|Change|Remove|Add|Export|Travel rules|Total|Arrival|Fly home|Leave home|Move to)\b/,
  /\b(budget|Budget|Free|Open|Delete|Print|Copy|Reservation|Photo|Loading|Choose|Pick|Try|Use|Raise|Within|Over)\b/,
  /\b(Tokyo|Kyoto|Osaka|Japan|Dubai|Bengaluru|Delhi|Mumbai|Chennai|United Arab Emirates)\b/,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/,
  /\b(rule|rules|flight|flights|hotel|hotels|transfer|transfers|attraction|attractions|price|stars?)\b/i,
  /\b(the|and|your|with|for|this|that|is|are|not|no|of|in|on|to)\b/i,
];

/** All interface text on the page: visible text plus accessible names, placeholders and titles. */
function interfaceText(): string {
  const attrs = [...document.body.querySelectorAll("[aria-label],[placeholder],[title],[alt]")]
    .flatMap((el) => ["aria-label", "placeholder", "title", "alt"].map((a) => el.getAttribute(a) ?? ""));
  let text = [document.body.textContent ?? "", ...attrs].join("\n");
  for (const name of DATA.sort((a, b) => b.length - a.length)) text = text.split(name).join(" ");
  return text;
}

function expectNoEnglish() {
  const text = interfaceText();
  const left = ENGLISH.flatMap((re) => text.match(new RegExp(re.source, re.flags + "g")) ?? []);
  expect(left, `English left on the page:\n${text}`).toEqual([]);
}

const pkg = makePackage({
  country: "Japan",
  traveler: { adults: 2, children: 1, child_ages: [6], home_airport: "BLR" },
  items: makePackage().items!.map((i) => (i.item_id === "i2" ? { ...i, warnings: ["You reach the hotel at 13:10; check-in opens at 15:00."] } : i)),
} as never);

const okReport = {
  valid: false,
  violations: [{ code: "ATTRACTION_CLOSED", group: "Attractions", message: "ATT-KYO-002 is closed on 2027-04-13" }],
  checklist: ["Dates and cities", "Flights", "Airport transfers", "Transfers between cities", "Hotels", "Attractions", "Prices"]
    .map((group) => ({ group, ok: group !== "Attractions" })),
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("bmh.lang", "hi");
  vi.stubGlobal("fetch", vi.fn(stubApi((url) => {
    if (url === "/api/check") return reply(200, okReport);
    if (url === "/api/reservations") return reply(200, bookings);
    if (url === "/api/credits") return reply(200, credits);
    if (url === "/api/reservations/4435693622") return reply(200, { reservation_number: "4435693622", package: pkg });
    if (url.startsWith("/api/packages/pkg_test1/options/hotels")) {
      return reply(200, [{ hotel_id: "H2", room_id: "R2", name: "Grand Kyoto Inn · Twin room", hotel_name: "Grand Kyoto Inn",
        stars: 4, rating: 8.6, area: "Gion", rooms: 2, price: 30000, price_diff: 1568 }]);
    }
    if (url === "/api/packages/pkg_test1/city-plans") {
      return reply(200, [
        { cities: ["Tokyo", "Kyoto"], nights_per_city: [2, 2], total_inr: 231924, within_budget: true, current: true },
        { cities: ["Osaka"], nights_per_city: [4], total_inr: 400000, within_budget: false, current: false },
      ]);
    }
    return undefined;
  })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("the whole site in Hindi", () => {
  it("planner page, form, example menu and date picker", async () => {
    window.history.pushState({}, "", "/");
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: hi["form.examples"] }));
    expect(screen.getByText(hi["ex.menon.title"])).toBeInTheDocument();
    expectNoEnglish();
    await user.keyboard("{Escape}");
    await user.click(screen.getAllByText(hi["dp.pick"])[0].closest("button")!);
    expectNoEnglish();
  });

  it("a package with its change panels", async () => {
    render(<I18nProvider><PackageView pkg={pkg} budget={350000} edit={{ id: "pkg_test1", onChanged: vi.fn() }} /></I18nProvider>);
    await screen.findByText(hi["g.Flights"]);
    expectNoEnglish();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: hi["pkg.changeHotelIn"].replace("{city}", hi["p.Tokyo"]) }));
    await screen.findByText(hi["opt.rating"].replace("{n}", "8.6"));
    expectNoEnglish();
    await user.click(screen.getByRole("button", { name: hi["pkg.changeCities"] }));
    await screen.findByText(hi["opt.current"]);
    expectNoEnglish();
  });

  it("no package and over budget, with the backend's reasons", () => {
    render(
      <I18nProvider>
        <NoPackageNotice
          result={{ status: "NO_PACKAGE", reasons: [{ code: "NO_ARRIVAL_FLIGHT", message: "No flight from Mumbai (BOM) lands in Japan on 3 Apr 2027." }],
            nearby: [{ kind: "other_dates", start_date: "2027-04-05", end_date: "2027-04-13", nights: 8, total_inr: 190000, within_budget: true,
              message: "Start on 5 Apr (8 nights, back on 13 Apr): ₹1,90,000, within your budget." }] } as never}
          onTry={vi.fn()}
        />
        <OverBudgetNotice
          result={{ status: "OVER_BUDGET", cheapest_total: 89997, budget: 85000, short_by: 4997, suggestions: [],
            suggestion_details: [
              { kind: "fewer_nights", start_date: "2027-04-05", end_date: "2027-04-09", nights: 4, total_inr: 80000, message: "Stay 4 nights instead of 5: ₹80,000, within your budget." },
              { kind: "raise_budget", amount_inr: 4997, message: "Raise your budget by ₹4,997 to afford the cheapest package (₹89,997)." },
            ], cheapest_package: pkg } as never}
          onTry={vi.fn()}
          onRaise={vi.fn()}
        />
      </I18nProvider>,
    );
    expectNoEnglish();
  });

  it("bookings list, a reservation, the checker and the credits", async () => {
    window.history.pushState({}, "", "/r");
    const { unmount } = render(<App />);
    await screen.findByText("4435693622");
    expectNoEnglish();
    unmount();

    window.history.pushState({}, "", "/r/4435693622");
    const second = render(<App />);
    await screen.findByText(hi["card.confirmed"]);
    await waitFor(() => expect(screen.getAllByText(hi["g.Flights"]).length).toBeGreaterThan(0));
    expectNoEnglish();
    second.unmount();

    window.history.pushState({}, "", "/check");
    const third = render(<App />);
    await screen.findByText(hi["chk.load"]);
    expectNoEnglish();
    third.unmount();

    window.history.pushState({}, "", "/credits");
    render(<App />);
    await screen.findByText("Kiyomizu-dera");
    expectNoEnglish();
  });
});
