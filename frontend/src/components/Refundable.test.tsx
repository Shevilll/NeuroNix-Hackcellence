import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePackage, reply, stubApi } from "../test/fixtures";
import ChangeOptions from "./ChangeOptions";
import PackageView from "./PackageView";

afterEach(() => vi.unstubAllGlobals());

/** The sample package with the Tokyo room free to cancel and the Kyoto room not. */
function withRefundable(tokyo: boolean | undefined, kyoto: boolean | undefined) {
  const base = makePackage();
  return makePackage({
    items: base.items.map((i) =>
      i.type !== "hotel" ? i : { ...i, refundable: i.city === "Tokyo" ? tokyo : kyoto },
    ),
  });
}

function hotelRow(name: RegExp) {
  return screen.getAllByRole("listitem").find((li) => name.test(li.textContent ?? ""))!;
}

describe("Free cancellation (rooms.refundable, display only)", () => {
  it("tags each hotel in the plan as free cancellation or non-refundable", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={withRefundable(true, false)} budget={350000} />);
    expect(within(hotelRow(/Ginza Pearl Hotel/)).getByText("Free cancellation")).toBeInTheDocument();
    expect(within(hotelRow(/Ginza Pearl Hotel/)).queryByText("Non-refundable")).toBeNull();
    expect(within(hotelRow(/Sakura Garden Hotel/)).getByText("Non-refundable")).toBeInTheDocument();
  });

  it("shows no tag for a hotel saved before the flag existed", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi()));
    render(<PackageView pkg={withRefundable(undefined, undefined)} budget={350000} />);
    expect(screen.queryByText("Free cancellation")).toBeNull();
    expect(screen.queryByText("Non-refundable")).toBeNull();
  });

  it("tags each hotel option in the change list", async () => {
    const options = [
      { hotel_id: "HTL-TYO-004", room_id: "RM-TYO-004-B", name: "Ueno Garden Inn · Family Room", stars: 3, rooms: 1, refundable: true, price_diff: 1568 },
      { hotel_id: "HTL-TYO-009", room_id: "RM-TYO-009-A", name: "Shinjuku Budget Stay · Twin", stars: 2, rooms: 2, refundable: false, price_diff: -2360 },
    ];
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url.startsWith("/api/packages/pkg_test1/options/hotels") ? reply(200, options) : undefined))));
    render(<ChangeOptions id="pkg_test1" pkg={makePackage()} kind="hotels" params={{ city: "Tokyo" }} title="Change your Tokyo hotel" onChanged={() => {}} onClose={() => {}} />);
    const rows = await screen.findAllByRole("listitem");
    expect(within(rows[0]).getByText("Free cancellation")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Non-refundable")).toBeInTheDocument();
  });
});
