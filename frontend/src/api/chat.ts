import { api } from "./client";

/** One piece of a chat answer: a paragraph, a list with bold item names, label and value facts, or a link to a page of this site. */
export type ChatBlock =
  | { type: "text"; text: string }
  | { type: "list"; items: { name: string; detail: string }[] }
  | { type: "facts"; rows: { label: string; value: string }[] }
  | { type: "link"; text: string; href: string };

/** One answer from the help chatbot. `found` is false when our data has no answer. */
export interface ChatReply {
  /** The whole answer as plain text. */
  answer: string;
  found: boolean;
  topic: string;
  /** The same answer split into blocks for the chat panel. */
  blocks?: ChatBlock[];
  suggestions: string[];
}

/** Ask the help chatbot. The backend answers only from the site's own data; no AI is called. */
export async function askChat(question: string): Promise<ChatReply> {
  return (await api.request<ChatReply>("/api/chat", { method: "POST", body: { question } })).data;
}
