import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePackage, reply, stubApi } from "../test/fixtures";
import ChangeOptions from "./ChangeOptions";

afterEach(() => vi.unstubAllGlobals());

const hotelOptions = [
  { hotel_id: "HTL-TYO-004", room_id: "RM-TYO-004-B", name: "Ueno Garden Inn · Family Room", hotel_name: "Ueno Garden Inn",
    stars: 3, rating: 7.9, area: "Ueno", rooms: 1, price: 18928, price_diff: 1568 },
  { hotel_id: "HTL-TYO-009", room_id: "RM-TYO-009-A", name: "Shinjuku Budget Stay · Twin", hotel_name: "Shinjuku Budget Stay",
    stars: 2, rating: 7.1, area: "Shinjuku", rooms: 2, price: 15000, price_diff: -2360 },
  { hotel_id: "HTL-TYO-010", room_id: "RM-TYO-010-A", name: "Same Price Inn · Twin", hotel_name: "Same Price Inn",
    stars: 3, rating: 8.0, area: "Ginza", rooms: 1, price: 17360, price_diff: 0 },
];

describe("ChangeOptions (G2: every option shows its price difference)", () => {
  it("lists hotel options with stars, area and a signed price difference", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url.startsWith("/api/packages/pkg_test1/options/hotels") ? reply(200, hotelOptions) : undefined))));
    render(<ChangeOptions id="pkg_test1" pkg={makePackage()} kind="hotels" params={{ city: "Tokyo" }} title="Change your Tokyo hotel" onChanged={() => {}} onClose={() => {}} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText(/Ueno Garden Inn/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/3 stars/)).toBeInTheDocument();
    expect(within(rows[0]).getByText("Ueno")).toBeInTheDocument();
    expect(within(rows[0]).getByText("+₹1,568")).toBeInTheDocument();
    expect(within(rows[1]).getByText("−₹2,360")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Same price")).toBeInTheDocument();
  });

  it("applies a choice with the current version and passes the new package, price difference and warnings up", async () => {
    const changed = makePackage({ version: 2, total_inr: 233492 });
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => {
      if (url.startsWith("/api/packages/pkg_test1/options/hotels")) return reply(200, hotelOptions);
      if (url === "/api/packages/pkg_test1/changes") {
        calls.push(JSON.parse(init!.body as string));
        return reply(200, { package_id: "pkg_test1", package: changed, price_diff_inr: 1568,
          warnings: [{ code: "EMPTY_DAY", message: "11 Apr has no attractions planned." }] });
      }
      return undefined;
    })));
    const onChanged = vi.fn();
    render(<ChangeOptions id="pkg_test1" pkg={makePackage()} kind="hotels" params={{ city: "Tokyo" }} title="Change your Tokyo hotel" onChanged={onChanged} onClose={() => {}} />);
    await userEvent.click((await screen.findAllByRole("button", { name: /choose/i }))[0]);
    expect(calls[0]).toMatchObject({ op: "replace_hotel", city: "Tokyo", hotel_id: "HTL-TYO-004", room_id: "RM-TYO-004-B", expected_version: 1 });
    expect(onChanged).toHaveBeenCalledWith(changed, { price_diff_inr: 1568, warnings: [{ code: "EMPTY_DAY", message: "11 Apr has no attractions planned." }] });
  });

  it("shows the backend's reason when a change is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => {
      if (url.startsWith("/api/packages/pkg_test1/options/hotels")) return reply(200, hotelOptions);
      if (url === "/api/packages/pkg_test1/changes") return reply(422, { detail: { message: "Not enough rooms on 11 Apr.", violations: [] } });
      return undefined;
    })));
    render(<ChangeOptions id="pkg_test1" pkg={makePackage()} kind="hotels" params={{ city: "Tokyo" }} title="Change your Tokyo hotel" onChanged={() => {}} onClose={() => {}} />);
    await userEvent.click((await screen.findAllByRole("button", { name: /choose/i }))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Not enough rooms on 11 Apr.");
  });

  it("says when nothing else is valid, and filters attraction options to one day", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url.startsWith("/api/packages/pkg_test1/options/attractions") ? reply(200, [
      { attraction_id: "ATT-TYO-001", name: "teamLab Planets TOKYO", city: "Tokyo", date: "2027-04-10", price_diff: 5096 },
      { attraction_id: "ATT-TYO-003", name: "Tokyo Toy Museum", city: "Tokyo", date: "2027-04-11", price_diff: 1680 },
    ]) : undefined))));
    const { unmount } = render(<ChangeOptions id="pkg_test1" pkg={makePackage()} kind="attractions" params={{}} date="2027-04-11" title="Add an attraction" onChanged={() => {}} onClose={() => {}} />);
    expect(await screen.findByText("Tokyo Toy Museum")).toBeInTheDocument();
    expect(screen.queryByText("teamLab Planets TOKYO")).toBeNull();
    unmount();

    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url.startsWith("/api/packages/pkg_test1/options/flights") ? reply(200, []) : undefined))));
    render(<ChangeOptions id="pkg_test1" pkg={makePackage()} kind="flights" params={{ role: "return_flight" }} title="Change your return flight" onChanged={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/no other valid/i)).toBeInTheDocument();
  });

  it("shows flight times in India time (IST): a flight home leaves in Japan time and lands in India", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url.startsWith("/api/packages/pkg_test1/options/flights") ? reply(200, [
      { flight_id: "FL-499", name: "AirVeda AV 499 KIX to BLR", depart: "2027-04-14T12:00", arrive: "2027-04-14T18:00", price_diff: 0 },
    ]) : undefined))));
    render(<ChangeOptions id="pkg_test1" pkg={makePackage({ country: "Japan" })} kind="flights" params={{ role: "return_flight" }} title="Change your return flight" onChanged={() => {}} onClose={() => {}} />);
    // Leaves Osaka 12:00 JST = 08:30 IST; lands in Bengaluru 18:00, already IST.
    expect(await screen.findByText(/departs.*08:30/i)).toBeInTheDocument();
    expect(screen.getByText(/lands.*18:00/i)).toBeInTheDocument();
  });
});
