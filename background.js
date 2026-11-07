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

async function record(host, { convKey, userChars, assistantChars, initial }) {
  const key = `${host}${convKey}`;

  const { baselines = {} } = await chrome.storage.session.get("baselines");
  const prev = baselines[key];

  if (!prev) {
    baselines[key] = { u: userChars, a: assistantChars };
    await chrome.storage.session.set({ baselines });
    if (initial) return;
  }

  const base = prev || { u: 0, a: 0 };
  const dU = Math.max(0, userChars - base.u);
  const dA = Math.max(0, assistantChars - base.a);
  baselines[key] = {
    u: Math.max(base.u, userChars),
    a: Math.max(base.a, assistantChars),
  };
  await chrome.storage.session.set({ baselines });

  if (!dU && !dA) return;

  const { tokens, gCO2 } = estimate(dU, dA);   // replaces the whole block

  const day = new Date().toISOString().slice(0, 10);
  const { totals = {} } = await chrome.storage.local.get("totals");
  const id = `${day}|${host}`;
  const t = totals[id] || { tokens: 0, gCO2: 0 };
  t.tokens += tokens;   // was: Math.round(inTok + outTok)
  t.gCO2 += gCO2;       // was: g
  totals[id] = t;
  await chrome.storage.local.set({ totals });
  await updateBadge(totals);
}