import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { askChat } from "../api/chat";
import ChatBot from "./ChatBot";

vi.mock("../api/chat", () => ({ askChat: vi.fn() }));
const ask = vi.mocked(askChat);

beforeEach(() => {
  ask.mockReset();
});

async function open() {
  await userEvent.click(screen.getByRole("button", { name: /ask the help chat/i }));
  return screen.getByRole("dialog", { name: /help chat/i });
}

describe("ChatBot (bottom-right help chat, answers only from our data)", () => {
  it("starts closed as a launcher button at the bottom right", () => {
    render(<ChatBot />);
    const launcher = screen.getByRole("button", { name: /ask the help chat/i });
    expect(launcher.closest(".chatbot")).toHaveClass("chatbot--bottom-right");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with a greeting and example questions, and closes again", async () => {
    render(<ChatBot />);
    const dialog = await open();
    expect(within(dialog).getByText(/ask me about hotels/i)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: /hotels in tokyo/i }).length).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText(/your question/i)).toHaveFocus();
    await userEvent.click(within(dialog).getByRole("button", { name: /close help chat/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes with the Escape key", async () => {
    render(<ChatBot />);
    await open();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sends the question and shows the answer from the backend", async () => {
    ask.mockResolvedValue({ answer: "Hotels in Dubai: Palm Sands (rated 9.0)", found: true, topic: "hotels", suggestions: ["Things to do in Dubai"] });
    render(<ChatBot />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText(/your question/i), "hotels in Dubai{Enter}");
    expect(ask).toHaveBeenCalledWith("hotels in Dubai");
    const log = within(dialog).getByRole("log");
    expect(within(log).getByText("hotels in Dubai")).toBeInTheDocument();
    expect(await within(log).findByText(/Palm Sands/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Things to do in Dubai" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/your question/i)).toHaveValue("");
  });

  it("shows the honest no-idea answer as it came, marked as not found", async () => {
    ask.mockResolvedValue({ answer: "I have no idea about that.", found: false, topic: "unknown", suggestions: [] });
    render(<ChatBot />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText(/your question/i), "weather tomorrow{Enter}");
    const answer = await within(dialog).findByText("I have no idea about that.");
    expect(answer.closest(".chatbot__msg")).toHaveClass("chatbot__msg--unknown");
  });

  it("asks a suggested question when its chip is clicked", async () => {
    ask.mockResolvedValue({ answer: "Hotels in Tokyo: ...", found: true, topic: "hotels", suggestions: [] });
    render(<ChatBot />);
    const dialog = await open();
    await userEvent.click(within(dialog).getAllByRole("button", { name: /hotels in tokyo/i })[0]);
    expect(ask).toHaveBeenCalledWith("Hotels in Tokyo");
  });

  it("does not send an empty question", async () => {
    render(<ChatBot />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText(/your question/i), "   {Enter}");
    expect(ask).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("says it could not reach the help service instead of making up an answer", async () => {
    ask.mockRejectedValue(new Error("network down"));
    render(<ChatBot />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText(/your question/i), "hotels in Tokyo{Enter}");
    const error = await within(dialog).findByText(/could not reach/i);
    expect(error.closest(".chatbot__msg")).toHaveClass("chatbot__msg--error");
  });

  it("keeps the input usable and shows a typing indicator while waiting", async () => {
    let resolve!: (v: Awaited<ReturnType<typeof askChat>>) => void;
    ask.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ChatBot />);
    const dialog = await open();
    await userEvent.type(within(dialog).getByLabelText(/your question/i), "hi{Enter}");
    expect(within(dialog).getByRole("status")).toHaveTextContent(/looking it up/i);
    resolve({ answer: "Hello!", found: true, topic: "greeting", suggestions: [] });
    expect(await within(dialog).findByText("Hello!")).toBeInTheDocument();
    expect(within(dialog).queryByText(/looking it up/i)).not.toBeInTheDocument();
  });
});
