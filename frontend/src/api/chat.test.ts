import { afterEach, describe, expect, it, vi } from "vitest";
import { askChat } from "./chat";

afterEach(() => vi.unstubAllGlobals());

describe("askChat", () => {
  it("posts the question to /api/chat and returns the reply", async () => {
    const reply = { answer: "Hi", found: true, topic: "greeting", suggestions: [] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchFn);
    await expect(askChat("hello")).resolves.toEqual(reply);
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).toContain("/api/chat");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ question: "hello" });
  });
});
