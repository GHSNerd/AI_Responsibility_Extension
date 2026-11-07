import { estimate } from "./constants.js";

const SITES = {
  "claude.ai": "https://claude.ai/*",
  "chatgpt.com": "https://chatgpt.com/*",
  "gemini.google.com": "https://gemini.google.com/*",
};
const SCRIPT_ID = "tracker";

/* ---------- Permissions + content script registration ---------- */

async function grantedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  const known = Object.values(SITES);
  return origins.filter((o) => known.includes(o));
}

// One registered script whose matches = every site the user has granted.
// Re-run whenever permissions change (including revocations done outside the popup).
async function syncContentScripts() {
  const granted = await grantedOrigins();
  try { await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }); } catch {}
  if (granted.length) {
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches: granted,
      js: ["content.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    }]);
  }
}

// Registration only affects pages loaded later, so inject into tabs already open.
async function injectIntoOpenTabs(origin) {
  const tabs = await chrome.tabs.query({ url: origin });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
      .catch(console.error);
  }
}

/* ---------- UI ---------- */

async function render() {
  const granted = await grantedOrigins();
  const box = document.getElementById("sites");
  box.innerHTML = "";

  for (const [name, origin] of Object.entries(SITES)) {
    const on = granted.includes(origin);
    const btn = document.createElement("button");
    btn.textContent = `${on ? "Stop tracking" : "Track"} ${name}`;
    btn.style.cssText = "display:block;width:100%;margin:4px 0";
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (on) {
          await chrome.permissions.remove({ origins: [origin] });
          await syncContentScripts();
        } else {
          // request() must be the first await so it stays tied to the click
          const ok = await chrome.permissions.request({ origins: [origin] });
          if (ok) {
            await syncContentScripts();
            await injectIntoOpenTabs(origin);
          }
        }
      } catch (err) {
        console.error(err);
      }
      render();
    };
    box.appendChild(btn);
  }

  const { totals = {} } = await chrome.storage.local.get("totals");
  const sum = Object.values(totals).reduce(
    (a, d) => ({ g: a.g + (d.gCO2 || 0), t: a.t + (d.tokens || 0) }),
    { g: 0, t: 0 }
  );
  document.getElementById("totals").textContent = sum.t
    ? `~${sum.t.toLocaleString()} tokens ≈ ${sum.g.toFixed(1)} g CO₂e (rough estimate)`
    : "No usage recorded yet.";
}

/* ---------- Export import ---------- */

// Returns { source, days: { "YYYY-MM-DD": { u, a } } } using character counts only
function parseExport(data) {
  const days = {};
  const add = (day, role, len) => {
    if (!day || !len) return;
    const d = (days[day] ||= { u: 0, a: 0 });
    if (role === "user") d.u += len;
    else if (role === "assistant") d.a += len;
  };

  // Claude export: array of conversations with chat_messages
  if (Array.isArray(data) && data[0]?.chat_messages) {
    for (const c of data) {
      for (const m of c.chat_messages) {
        const role = m.sender === "human" ? "user" : "assistant";
        const day = (m.created_at || c.created_at || "").slice(0, 10);
        // Fall back to content blocks if a message has no top-level text
        const text =
          m.text ||
          (Array.isArray(m.content)
            ? m.content.map((b) => b.text || "").join("")
            : "");
        add(day, role, text.length);
      }
    }
    return { source: "claude", days };
  }

  // ChatGPT export: array of conversations with a "mapping" of message nodes
  if (Array.isArray(data) && data[0]?.mapping) {
    for (const c of data) {
      for (const node of Object.values(c.mapping)) {
        const msg = node.message;
        const role = msg?.author?.role;
        if (role !== "user" && role !== "assistant") continue;
        const parts = msg.content?.parts || [];
        const len = parts.filter((p) => typeof p === "string").join("").length;
        const t = msg.create_time || c.create_time;
        const day = t ? new Date(t * 1000).toISOString().slice(0, 10) : "";
        add(day, role, len);
      }
    }
    return { source: "chatgpt", days };
  }

  return null;
}

document.getElementById("import").onchange = async (e) => {
  const status = document.getElementById("importStatus");
  const file = e.target.files[0];
  if (!file) return;
  try {
    const parsed = parseExport(JSON.parse(await file.text()));
    if (!parsed) { status.textContent = "Unrecognized file format."; return; }

    const { totals = {} } = await chrome.storage.local.get("totals");

    // Re-importing replaces the previous import for this source (no double counting)
    const suffix = `|${parsed.source}-import`;
    for (const k of Object.keys(totals)) if (k.endsWith(suffix)) delete totals[k];

    let tokens = 0;
    for (const [day, { u, a }] of Object.entries(parsed.days)) {
      const { tokens: tk, gCO2 } = estimate(u, a);
      totals[`${day}${suffix}`] = { tokens: tk, gCO2 };
      tokens += tk;
    }
    await chrome.storage.local.set({ totals });
    status.textContent = `Imported ${Object.keys(parsed.days).length} days (~${tokens.toLocaleString()} tokens).`;
    render(); // refresh the totals line
  } catch {
    status.textContent = "Couldn't read that file.";
  }
  e.target.value = "";
};

/* ---------- Startup ---------- */

// Reconcile registration with current permissions (handles revocation from chrome://extensions)
syncContentScripts().catch(console.error).finally(render);