import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { askChat, type ChatReply } from "../api/chat";
import ChatBot from "./ChatBot";

vi.mock("../api/chat", () => ({ askChat: vi.fn() }));
const ask = vi.mocked(askChat);

beforeEach(() => ask.mockReset());

async function answer(reply: ChatReply, ui = <ChatBot />) {
  ask.mockResolvedValue(reply);
  render(ui);
  await userEvent.click(screen.getByRole("button", { name: /ask the help chat/i }));
  const dialog = screen.getByRole("dialog", { name: /help chat/i });
  await userEvent.type(within(dialog).getByLabelText(/your question/i), "question{Enter}");
  const first = reply.blocks?.[0];
  await within(dialog).findByText(first?.type === "text" ? first.text : reply.answer.split("\n")[0]);
  const bubbles = dialog.querySelectorAll(".chatbot__msg--bot");
  return bubbles[bubbles.length - 1] as HTMLElement;
}

const HOTELS: ChatReply = {
  answer: "Hotels in Tokyo, best rated first:\n- Ginza Imperial Suites: Ginza, 5-star, rated 9.3, rooms from ₹23,520 a night\n- Ginza Pearl Hotel: Ginza, 4-star, rated 8.6, rooms from ₹6,440 a night\nAnd 7 more.",
  found: true,
  topic: "hotels",
  suggestions: [],
  blocks: [
    { type: "text", text: "Hotels in Tokyo, best rated first:" },
    {
      type: "list",
      items: [
        { name: "Ginza Imperial Suites", detail: "Ginza, 5-star, rated 9.3, rooms from ₹23,520 a night" },
        { name: "Ginza Pearl Hotel", detail: "Ginza, 4-star, rated 8.6, rooms from ₹6,440 a night" },
      ],
    },
    { type: "text", text: "And 7 more." },
  ],
};

describe("ChatBot reply formatting", () => {
  it("shows a list reply as paragraphs and a bullet list with the names in bold", async () => {
    const bubble = await answer(HOTELS);
    const paragraphs = bubble.querySelectorAll("p");
    expect([...paragraphs].map((p) => p.textContent)).toEqual(["Hotels in Tokyo, best rated first:", "And 7 more."]);
    const items = within(bubble).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const name = within(items[0]).getByText("Ginza Imperial Suites");
    expect(name.tagName).toBe("STRONG");
    expect(items[0]).toHaveTextContent("rooms from ₹23,520 a night");
    expect(bubble.textContent).not.toMatch(/^-|\n- /m);
  });

  it("shows facts as label and value pairs", async () => {
    const bubble = await answer({
      answer: "Kiyomizu-dera is a temple in Kyoto.\nOpen: Every day, 06:00 to 18:00\nTicket: ₹280 per adult",
      found: true,
      topic: "attraction",
      suggestions: [],
      blocks: [
        { type: "text", text: "Kiyomizu-dera is a temple in Kyoto." },
        { type: "facts", rows: [{ label: "Open", value: "Every day, 06:00 to 18:00" }, { label: "Ticket", value: "₹280 per adult" }] },
      ],
    });
    const terms = bubble.querySelectorAll("dl dt");
    const values = bubble.querySelectorAll("dl dd");
    expect([...terms].map((t) => t.textContent)).toEqual(["Open", "Ticket"]);
    expect([...values].map((v) => v.textContent)).toEqual(["Every day, 06:00 to 18:00", "₹280 per adult"]);
  });

  it("turns a link block into a link that opens the booking inside the app", async () => {
    const bubble = await answer(
      {
        answer: "Booking 1234567890:\nTotal: ₹2,31,924\nOpen booking 1234567890",
        found: true,
        topic: "booking",
        suggestions: [],
        blocks: [
          { type: "text", text: "Booking 1234567890:" },
          { type: "facts", rows: [{ label: "Total", value: "₹2,31,924" }] },
          { type: "link", text: "Open booking 1234567890", href: "/r/1234567890" },
        ],
      },
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="/r/:number" element={<p>booking page</p>} />
        </Routes>
        <ChatBot />
      </MemoryRouter>,
    );
    const link = within(bubble).getByRole("link", { name: "Open booking 1234567890" });
    expect(link).toHaveAttribute("href", "/r/1234567890");
    await userEvent.click(link);
    expect(screen.getByText("booking page")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /help chat/i })).toBeInTheDocument();
  });

  it("never links outside the site", async () => {
    const bubble = await answer({
      answer: "x",
      found: true,
      topic: "booking",
      suggestions: [],
      blocks: [
        { type: "text", text: "Somewhere else" },
        { type: "link", text: "Elsewhere", href: "https://example.com" },
        { type: "link", text: "Protocol relative", href: "//example.com" },
      ],
    });
    expect(within(bubble).queryByRole("link")).not.toBeInTheDocument();
  });

  it("falls back to the plain answer, one paragraph per line, when there are no blocks", async () => {
    const bubble = await answer({ answer: "First line.\nSecond line.", found: true, topic: "faq", suggestions: [] });
    expect([...bubble.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["First line.", "Second line."]);
  });
});
