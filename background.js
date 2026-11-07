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

async function record(host, { convKey, userChars, assistantChars }) {
  const key = `${host}${convKey}`;

  // Memory-only baseline (cleared when the browser closes): last totals seen per conversation
  const { baselines = {} } = await chrome.storage.session.get("baselines");
  const prev = baselines[key] || { u: 0, a: 0 };
  const dU = Math.max(0, userChars - prev.u);
  const dA = Math.max(0, assistantChars - prev.a);
  baselines[key] = { u: Math.max(prev.u, userChars), a: Math.max(prev.a, assistantChars) };
  await chrome.storage.session.set({ baselines });

  if (!dU && !dA) return;

  const inTok = dU / CHARS_PER_TOKEN;
  const outTok = dA / CHARS_PER_TOKEN;
  const wh = (inTok / 1000) * WH_PER_1K_INPUT_TOKENS + (outTok / 1000) * WH_PER_1K_OUTPUT_TOKENS;
  const g = (wh / 1000) * GRID_G_CO2_PER_KWH;

  const day = new Date().toISOString().slice(0, 10);
  const { totals = {} } = await chrome.storage.local.get("totals");
  const id = `${day}|${host}`;
  const t = totals[id] || { tokens: 0, gCO2: 0 };
  t.tokens += Math.round(inTok + outTok);
  t.gCO2 += g;
  totals[id] = t;
  await chrome.storage.local.set({ totals });
}