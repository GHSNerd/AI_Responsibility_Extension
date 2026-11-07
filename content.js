
console.log("[tracker] content script loaded on", location.hostname);

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

// Returns { mode, msgs } where each msg has { node, role, len }. Text is never kept.
function readMessages() {
  for (const c of CANDIDATES[location.hostname] || []) {
    const nodes = document.querySelectorAll(c.sel);
    if (nodes.length) {
      return {
        mode: "selectors",
        msgs: [...nodes].map((n) => ({
          node: n,
          role: c.role(n) === "user" ? "user" : "assistant",
          len: n.textContent.length,
        })),
      };
    }
  }
  const root = document.querySelector("main") || document.body;
  return { mode: "fallback", msgs: [{ node: root, role: "assistant", len: root.textContent.length }] };
}

(() => {
  if (window.__emissionsTrackerLoaded) return;
  window.__emissionsTrackerLoaded = true;
  if (!CANDIDATES[location.hostname]) return;

  const THROTTLE_MS = 1000;
  const SETTLE_MS = 2000;     // after load/navigation, everything is baseline
  const MAX_JUMP = 6000;      // fallback mode: ignore implausible one-second jumps

  let known = new WeakMap();  // node -> highest length seen
  let lastNode = null;        // last message node from the previous pass
  let lastPath = location.pathname;
  let lastMode = null;
  let settleUntil = Date.now() + 1500;
  let lastRun = 0;
  let pending = null;

  function reset() {
    known = new WeakMap();
    lastNode = null;
    settleUntil = Date.now() + SETTLE_MS;
  }

  function report() {
    lastRun = Date.now();

    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      reset();
    }

    const { msgs, mode } = readMessages();
    if (mode !== lastMode) {
      lastMode = mode;
      reset();
    }

    const baselining = Date.now() < settleUntil;
    const lastInList = msgs.length ? msgs[msgs.length - 1].node : null;
    let dU = 0, dA = 0;

    const count = (role, n) => {
      if (mode === "fallback" && n > MAX_JUMP) return; // likely a layout change, not streaming
      if (role === "user") dU += n;
      else dA += n;
    };

    for (const m of msgs) {
      const prev = known.get(m.node);

      if (prev === undefined) {
        // First time seeing this message
        known.set(m.node, m.len);
        const isAppended =
          lastNode && lastNode.isConnected
            ? !!(lastNode.compareDocumentPosition(m.node) & Node.DOCUMENT_POSITION_FOLLOWING)
            : false;
        // Only count messages added after the last known one (a new turn).
        // Older messages loaded above (lazy history) are baseline only.
        if (!baselining && isAppended) count(m.role, m.len);
        continue;
      }

      if (m.len > prev) {
        known.set(m.node, m.len);
        if (!baselining) count(m.role, m.len - prev); // streaming growth
      }
    }

    if (lastInList) lastNode = lastInList;

    if (dU || dA) {
      try {
        chrome.runtime.sendMessage({
          type: "usage",
          userChars: dU,        // deltas, not totals
          assistantChars: dA,
          fallback: mode === "fallback",
        });
      } catch {
        // extension reloaded; this script is orphaned
      }
    }
  }

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

  setTimeout(report, 1500);
})();