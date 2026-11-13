import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePackage, reply, stubApi } from "../test/fixtures";
import { mapPoints } from "../test/mapPoints";

vi.mock("./RouteMap", () => ({
  default: ({ pkg }: { pkg: { trip_id: string } }) => <section aria-label="route map stand-in">{pkg.trip_id}</section>,
}));

import PackageView from "./PackageView";

afterEach(() => vi.unstubAllGlobals());

describe("PackageView shows the route map", () => {
  it("puts the route map of this package on the page", () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/map-points" ? reply(200, mapPoints) : undefined))));
    render(<PackageView pkg={makePackage()} budget={350000} />);
    expect(screen.getByRole("region", { name: "route map stand-in" })).toHaveTextContent("pkg_test1");
  });
});
