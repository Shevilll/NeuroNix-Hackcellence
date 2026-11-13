import { afterEach, describe, expect, it, vi } from "vitest";
import { changePackage } from "./endpoints";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("changePackage", () => {
  it("retries a failed change with the same Idempotency-Key so the server can replay it", async () => {
    const responses = [json(503, {}), json(200, { package: { trip_id: "p1" } })];
    const fetchFn = vi.fn(async (..._args: Parameters<typeof fetch>) => responses.shift() as Response);
    vi.stubGlobal("fetch", fetchFn);

    const result = await changePackage("p1", { op: "remove_attraction", item_id: "i9", expected_version: 1 });

    expect(result.package.trip_id).toBe("p1");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const keys = fetchFn.mock.calls.map((call) => new Headers(call[1]?.headers).get("Idempotency-Key"));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it("uses a new key for each separate change", async () => {
    const fetchFn = vi.fn(async (..._args: Parameters<typeof fetch>) => json(200, { package: { trip_id: "p1" } }));
    vi.stubGlobal("fetch", fetchFn);

    await changePackage("p1", { op: "remove_attraction", item_id: "i9", expected_version: 1 });
    await changePackage("p1", { op: "remove_attraction", item_id: "i8", expected_version: 2 });

    const keys = fetchFn.mock.calls.map((call) => new Headers(call[1]?.headers).get("Idempotency-Key"));
    expect(keys[0]).not.toBe(keys[1]);
  });
});
