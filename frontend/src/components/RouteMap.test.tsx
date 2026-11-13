import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePackage, reply, stubApi } from "../test/fixtures";
import { mapPoints } from "../test/mapPoints";

/** Leaflet needs a real browser to lay tiles out; the test records what the map is asked to draw. */
const drawn = vi.hoisted(() => ({
  tiles: [] as { url: string; options: Record<string, unknown> }[],
  lines: [] as { points: [number, number][]; options: Record<string, unknown> }[],
  markers: [] as { at: [number, number]; options: Record<string, unknown> }[],
  fitted: 0,
}));

vi.mock("leaflet", () => {
  const layer = () => ({ addTo() { return this; } });
  const L = {
    map: () => ({
      fitBounds: () => { drawn.fitted += 1; },
      setView() { return this; },
      remove: () => undefined,
      attributionControl: { setPrefix: () => undefined },
    }),
    tileLayer: (url: string, options: Record<string, unknown>) => { drawn.tiles.push({ url, options }); return layer(); },
    layerGroup: () => ({
      addTo() { return this; },
      clearLayers: () => { drawn.lines.length = 0; drawn.markers.length = 0; },
    }),
    polyline: (points: [number, number][], options: Record<string, unknown>) => {
      drawn.lines.push({ points, options });
      return layer();
    },
    marker: (at: [number, number], options: Record<string, unknown>) => {
      drawn.markers.push({ at, options });
      return { ...layer(), bindTooltip() { return this; } };
    },
    divIcon: (options: Record<string, unknown>) => options,
    latLngBounds: (points: unknown[]) => ({ points, pad() { return this; } }),
  };
  return { default: L, ...L };
});

import RouteMap from "./RouteMap";

const withPoints = () =>
  vi.fn(stubApi((url) => (url === "/api/map-points" ? reply(200, mapPoints) : undefined)));

beforeEach(() => {
  drawn.tiles.length = 0;
  drawn.lines.length = 0;
  drawn.markers.length = 0;
  drawn.fitted = 0;
});
afterEach(() => vi.unstubAllGlobals());

describe("RouteMap (the whole route on a map)", () => {
  it("lists every stop of the trip in order under the map", async () => {
    vi.stubGlobal("fetch", withPoints());
    render(<RouteMap pkg={makePackage()} />);
    const list = await screen.findByRole("list", { name: "Stops on the route" });
    const names = within(list).getAllByRole("listitem").map((li) => li.textContent);
    expect(names).toHaveLength(10);
    expect(names[0]).toMatch(/Kempegowda International Airport/);
    expect(names[3]).toMatch(/Senso-ji/);
    expect(names[9]).toMatch(/Kempegowda International Airport/);
  });

  it("draws OpenStreetMap tiles with their credit, and needs no key", async () => {
    vi.stubGlobal("fetch", withPoints());
    render(<RouteMap pkg={makePackage()} />);
    await screen.findByRole("list", { name: "Stops on the route" });
    expect(drawn.tiles).toHaveLength(1);
    expect(drawn.tiles[0].url).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(String(drawn.tiles[0].options.attribution)).toMatch(/OpenStreetMap/);
    expect(drawn.tiles[0].url).not.toMatch(/key|token/i);
  });

  it("draws a line for each leg, flights dashed apart from the ground, and one marker per place", async () => {
    vi.stubGlobal("fetch", withPoints());
    render(<RouteMap pkg={makePackage()} />);
    await screen.findByRole("list", { name: "Stops on the route" });
    await waitFor(() => expect(drawn.lines).toHaveLength(9));
    const classes = drawn.lines.map((l) => l.options.className);
    expect(classes.filter((c) => c === "route-map__leg route-map__leg--flight")).toHaveLength(2);
    expect(classes.filter((c) => c === "route-map__leg")).toHaveLength(7);
    // BLR, NRT, KIX, two hotels and two visits: a place visited twice still gets one marker.
    expect(drawn.markers).toHaveLength(7);
    expect(drawn.fitted).toBeGreaterThan(0);
  });

  it("shows one day's route when a day is picked, and the whole trip again after", async () => {
    vi.stubGlobal("fetch", withPoints());
    const user = userEvent.setup();
    render(<RouteMap pkg={makePackage()} />);
    await screen.findByRole("list", { name: "Stops on the route" });
    expect(screen.getByRole("button", { name: "Whole trip" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Sun 11 Apr" }));
    expect(screen.getByRole("button", { name: "Sun 11 Apr" })).toHaveAttribute("aria-pressed", "true");
    const names = within(screen.getByRole("list", { name: "Stops on the route" }))
      .getAllByRole("listitem").map((li) => li.textContent);
    expect(names).toHaveLength(3);
    expect(names[0]).toMatch(/Ginza Pearl Hotel/);
    expect(names[1]).toMatch(/Senso-ji/);
    expect(names[2]).toMatch(/Ginza Pearl Hotel/);
    await waitFor(() => expect(drawn.lines).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Whole trip" }));
    expect(within(screen.getByRole("list", { name: "Stops on the route" })).getAllByRole("listitem")).toHaveLength(10);
  });

  it("shows nothing when the places cannot be loaded", async () => {
    const fetch = vi.fn(stubApi((url) => (url === "/api/map-points" ? reply(404, { detail: "not found" }) : undefined)));
    vi.stubGlobal("fetch", fetch);
    const { container } = render(<RouteMap pkg={makePackage()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
