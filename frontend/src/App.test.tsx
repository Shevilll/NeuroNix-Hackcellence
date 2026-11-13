import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const options = {
  departure_cities: [{ airport: "BLR", city: "Bengaluru" }],
  countries: [{ code: "JP", name: "Japan" }],
  rules: {
    min_nights: 3,
    max_nights: 10,
    min_nights_per_city: 2,
    max_travelers: 9,
    data_window: { first_night: "2027-04-01", last_departure: "2027-04-20" },
  },
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("App shell", () => {
  it("shows the product name in the header and a main landmark", () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, options)));
    render(<App />);
    expect(screen.getByRole("banner")).toHaveTextContent("Build My Holiday");
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});

describe("App options loading", () => {
  it("shows a loading state, then the form filled from /api/options", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, options)));
    render(<App />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Bengaluru \(BLR\)/ })).toBeInTheDocument();
  });

  it("shows a clear error with a retry button when options cannot be loaded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(404, { detail: "Not Found" }))
      .mockResolvedValueOnce(reply(200, options));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(await screen.findByLabelText(/departure city/i)).toBeInTheDocument();
  });
});

describe("App submit", () => {
  async function submitMenon(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /load menon example/i }));
    await user.click(screen.getByRole("button", { name: /build my holiday/i }));
  }

  it("posts the request with an Idempotency-Key", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/options" ? reply(200, options) : reply(200, { status: "OK" }),
    );
    await submitMenon(fetchMock);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("/api/packages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ origin: "BLR", nights: 6 });
    expect(new Headers(init.headers).get("Idempotency-Key")).toBeTruthy();
  });

  it("shows the server's message when the request is rejected", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/options" ? reply(200, options) : reply(422, { detail: "Nights out of range" }),
    );
    await submitMenon(fetchMock);
    expect(await screen.findByRole("alert")).toHaveTextContent("Nights out of range");
  });
});
