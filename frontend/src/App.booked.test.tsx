import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { makePackage, reply, stubApi } from "./test/fixtures";

beforeEach(() => {
  sessionStorage.clear();
  window.history.pushState({}, "", "/r/4435693622");
});
afterEach(() => vi.unstubAllGlobals());

const booked = () => makePackage({ items: makePackage().items.map((i) => ({ ...i, status: "BOOKED" as const })) });

describe("editing a booking after it is confirmed", () => {
  it("offers the change buttons on the reservation page", async () => {
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => (url === "/api/reservations/4435693622"
      ? reply(200, { reservation_number: "4435693622", package: booked() }) : undefined))));
    render(<App />);
    expect(await screen.findByRole("button", { name: /change hotel.*Kyoto/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change arrival flight/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^remove/i }).length).toBeGreaterThan(0);
  });

  it("sends a removal to the reservation, shows the edited booking and keeps the number", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const before = booked();
    const after = { ...before, total_inr: before.total_inr - 1000, items: before.items.filter((i) => i.item_id !== "i4") };
    vi.stubGlobal("fetch", vi.fn(stubApi((url, init) => {
      if (url === "/api/reservations/4435693622") return reply(200, { reservation_number: "4435693622", package: before });
      if (url === "/api/reservations/4435693622/changes") {
        calls.push({ url, body: JSON.parse(init!.body as string) });
        return reply(200, { reservation_number: "4435693622", package: after, price_diff_inr: -1000, warnings: [] });
      }
      return undefined;
    })));
    render(<App />);
    await userEvent.click((await screen.findAllByRole("button", { name: /^remove/i }))[0]);

    expect(await screen.findByRole("status")).toHaveTextContent(/checked again/i);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ op: "remove_attraction", item_id: "i4", expected_version: 1 });
    expect(screen.getByRole("heading", { name: /reservation 4435693622/i })).toBeInTheDocument();
    expect(screen.getByText(`₹${(after.total_inr).toLocaleString("en-IN")}`)).toBeInTheDocument();
  });

  it("loads the options of a booked package from its package id", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", vi.fn(stubApi((url) => {
      if (url === "/api/reservations/4435693622") return reply(200, { reservation_number: "4435693622", package: booked() });
      if (url.includes("/options/")) {
        asked.push(url);
        return reply(200, []);
      }
      return undefined;
    })));
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: /change hotel.*Kyoto/i }));
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toMatch(/^\/api\/packages\/pkg_test1\/options\/hotels\?city=Kyoto/);
  });
});
