import { estimate } from "./constants.js";

const ADAPTERS = {
  "claude.ai": () =>
    [...document.querySelectorAll("[data-message-role]")].map((n) => ({
      role: n.getAttribute("data-message-role"),
      text: n.innerText.trim(),
    })),

  "chatgpt.com": () =>
    [...document.querySelectorAll("[data-message-author-role]")].map((n) => ({
      role: n.getAttribute("data-message-author-role"),
      text: n.innerText.trim(),
    })),

  "gemini.google.com": () =>
    [...document.querySelectorAll("user-query, model-response")].map((n) => ({
      role: n.tagName.toLowerCase() === "user-query" ? "user" : "assistant",
      text: n.innerText.trim(),
    })),
};
// Selectors are placeholders. Inspect each site and fix them; they change often.

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== "usage" || !sender.url) return;
  const host = new URL(sender.url).hostname;
  record(host, msg);
});

async function record(host, { userChars, assistantChars }) {
  if (!userChars && !assistantChars) return;

  const { tokens, gCO2 } = estimate(userChars, assistantChars);

  const day = new Date().toISOString().slice(0, 10);
  const { totals = {} } = await chrome.storage.local.get("totals");
  const id = `${day}|${host}`;
  const t = totals[id] || { tokens: 0, gCO2: 0 };
  t.tokens += tokens;
  t.gCO2 += gCO2;
  totals[id] = t;
  await chrome.storage.local.set({ totals });
  await updateBadge(totals);
}