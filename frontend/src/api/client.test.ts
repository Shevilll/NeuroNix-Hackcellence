import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient, newIdempotencyKey } from "./client";

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function setup(responses: Array<Response | Error>) {
  const fetchFn = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async () => {});
  const client = createClient({ fetchFn, sleep, random: () => 0.5 });
  return { client, fetchFn, sleep };
}

describe("api client: success", () => {
  it("returns parsed JSON and the replay flag", async () => {
    const { client } = setup([json(200, { ok: 1 }, { "Idempotent-Replay": "true" })]);
    const res = await client.request<{ ok: number }>("/api/health");
    expect(res.data).toEqual({ ok: 1 });
    expect(res.replayed).toBe(true);
  });

  it("sends JSON body and Idempotency-Key header", async () => {
    const { client, fetchFn } = setup([json(200, {})]);
    await client.request("/api/packages", {
      method: "POST",
      body: { a: 1 },
      idempotencyKey: "key-1",
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/packages");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    const headers = new Headers(init.headers);
    expect(headers.get("Idempotency-Key")).toBe("key-1");
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});

describe("api client: retries", () => {
  it.each([429, 502, 503, 504])("retries status %i and then succeeds", async (status) => {
    const { client, fetchFn } = setup([json(status, {}), json(200, { ok: true })]);
    const res = await client.request("/api/x");
    expect(res.data).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries network errors", async () => {
    const { client, fetchFn } = setup([new TypeError("Failed to fetch"), json(200, {})]);
    await client.request("/api/x");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("uses the same Idempotency-Key on every attempt", async () => {
    const { client, fetchFn } = setup([json(503, {}), json(503, {}), json(200, {})]);
    await client.request("/api/x", { method: "POST", body: {}, idempotencyKey: "same" });
    const keys = fetchFn.mock.calls.map(
      (c) => new Headers((c as unknown as [string, RequestInit])[1].headers).get("Idempotency-Key"),
    );
    expect(keys).toEqual(["same", "same", "same"]);
  });

  it("gives up after 3 attempts and throws the last error", async () => {
    const { client, fetchFn } = setup([json(503, {}), json(503, {}), json(503, { detail: "down" })]);
    await expect(client.request("/api/x")).rejects.toMatchObject({ status: 503 });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("backs off exponentially, capped at 2 seconds", async () => {
    const { client, sleep } = setup([json(503, {}), json(503, {}), json(200, {})]);
    await client.request("/api/x");
    const delays = sleep.mock.calls.map((c) => (c as unknown as [number])[0]);
    expect(delays).toHaveLength(2);
    // random() = 0.5 -> jitter factor 0.75..1.25 band centre; delays grow and stay <= 2000
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(2000);
    expect(delays[0]).toBeGreaterThanOrEqual(125);
  });
});

describe("api client: no retry on client errors", () => {
  it.each([400, 404, 409, 422])("does not retry status %i", async (status) => {
    const { client, fetchFn } = setup([json(status, { detail: "nope" })]);
    await expect(client.request("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("exposes status and body on ApiError", async () => {
    const { client } = setup([json(422, { detail: [{ loc: ["body", "nights"], msg: "bad" }] })]);
    const err = await client.request("/api/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.body).toEqual({ detail: [{ loc: ["body", "nights"], msg: "bad" }] });
  });
});

describe("newIdempotencyKey", () => {
  it("returns a unique non-empty string each call", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
