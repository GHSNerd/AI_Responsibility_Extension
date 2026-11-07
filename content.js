// Candidate selectors per site, ordered from most to least stable.
// The first one that matches any elements wins.
// Prefer data-*, aria-*, role, and custom tag names over class names.
const CANDIDATES = {
  "claude.ai": [
    { sel: "[data-message-role]", role: (n) => n.getAttribute("data-message-role") },
    { sel: "[data-testid*='message']", role: (n) => (n.matches("[data-testid*='user']") ? "user" : "assistant") },
  ],
  "chatgpt.com": [
    { sel: "[data-message-author-role]", role: (n) => n.getAttribute("data-message-author-role") },
    {
      sel: "article[data-testid^='conversation-turn']",
      role: (n) => (n.querySelector("[data-message-author-role='user']") ? "user" : "assistant"),
    },
  ],
  "gemini.google.com": [
    { sel: "user-query, model-response", role: (n) => (n.tagName.toLowerCase() === "user-query" ? "user" : "assistant") },
  ],
};

// Returns { msgs, mode } where mode is "selectors" or "fallback".
// Only lengths are returned, never text.
function readMessages() {
  for (const c of CANDIDATES[location.hostname] || []) {
    const nodes = document.querySelectorAll(c.sel);
    if (nodes.length) {
      return {
        mode: "selectors",
        msgs: [...nodes].map((n) => ({
          role: c.role(n) === "user" ? "user" : "assistant",
          len: n.textContent.length,
        })),
      };
    }
  }
  // Selector-free fallback: treat all text in <main> as output.
  // Less accurate (can't separate user from AI), but survives redesigns.
  const root = document.querySelector("main") || document.body;
  return { mode: "fallback", msgs: [{ role: "assistant", len: root.textContent.length }] };
}

(() => {
  if (window.__emissionsTrackerLoaded) return; // avoid double injection
  window.__emissionsTrackerLoaded = true;

  if (!CANDIDATES[location.hostname]) return;

  const THROTTLE_MS = 1000;
  let lastRun = 0;
  let pending = null;
  let lastPath = location.pathname;
  let lastMode = null;
  let nextIsInitial = true; // first report on a page/conversation/mode is a baseline only

  function report() {
    lastRun = Date.now();

    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      nextIsInitial = true; // SPA navigation to another conversation
    }

    const { msgs, mode } = readMessages();
    if (mode !== lastMode) {
      lastMode = mode;
      nextIsInitial = true; // switching modes changes what's measured, so re-baseline
    }

    const sum = (role) =>
      msgs.filter((m) => m.role === role).reduce((a, m) => a + m.len, 0);

    try {
      chrome.runtime.sendMessage({
        type: "usage",
        // Mode is part of the key so selector and fallback baselines never mix
        convKey: `${location.pathname}#${mode}`,
        userChars: sum("user"),
        assistantChars: sum("assistant"),
        initial: nextIsInitial,
        fallback: mode === "fallback",
      });
    } catch {
      return; // extension was reloaded or updated; this script is orphaned
    }
    nextIsInitial = false;
  }

  // Throttle: run immediately if idle, otherwise at most once per THROTTLE_MS,
  // always finishing with a trailing run so the final text is captured.
  function schedule() {
    if (pending) return;
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastRun));
    pending = setTimeout(() => {
      pending = null;
      report();
    }, wait);
  }

  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Let the page finish loading history before taking the baseline
  setTimeout(report, 1500);
})();