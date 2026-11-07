const SITES = {
  "claude.ai": "https://claude.ai/*",
  "chatgpt.com": "https://chatgpt.com/*",
  "gemini.google.com": "https://gemini.google.com/*",
};

async function render() {
  const granted = (await chrome.permissions.getAll()).origins || [];
  const box = document.getElementById("sites");
  box.innerHTML = "";

  for (const [name, origin] of Object.entries(SITES)) {
    const on = granted.includes(origin);
    const btn = document.createElement("button");
    btn.textContent = `${on ? "Stop tracking" : "Track"} ${name}`;
    btn.style.cssText = "display:block;width:100%;margin:4px 0";
    btn.onclick = async () => {
      // Must run inside a click (user gesture)
      if (on) await chrome.permissions.remove({ origins: [origin] });
      else if (!(await chrome.permissions.request({ origins: [origin] }))) return;
      await syncContentScripts();
      render();
    };
    box.appendChild(btn);
  }

  const { totals = {} } = await chrome.storage.local.get("totals");
  const sum = Object.values(totals).reduce(
    (a, d) => ({ g: a.g + d.gCO2, t: a.t + d.tokens }),
    { g: 0, t: 0 }
  );
  if (sum.t) {
    document.getElementById("totals").textContent =
      `~${sum.t.toLocaleString()} tokens ≈ ${sum.g.toFixed(1)} g CO₂e (rough estimate)`;
  }
}

async function syncContentScripts() {
  const granted = (await chrome.permissions.getAll()).origins || [];
  try { await chrome.scripting.unregisterContentScripts({ ids: ["tracker"] }); } catch {}
  if (granted.length) {
    await chrome.scripting.registerContentScripts([{
      id: "tracker",
      matches: granted,
      js: ["content.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    }]);
  }
}

// Keep these in sync with background.js
const CHARS_PER_TOKEN = 4;
const WH_PER_1K_OUTPUT_TOKENS = 0.3;
const WH_PER_1K_INPUT_TOKENS = 0.1;
const GRID_G_CO2_PER_KWH = 400;

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
        add(day, role, (m.text || "").length);
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
      const inTok = u / CHARS_PER_TOKEN, outTok = a / CHARS_PER_TOKEN;
      const wh = (inTok / 1000) * WH_PER_1K_INPUT_TOKENS + (outTok / 1000) * WH_PER_1K_OUTPUT_TOKENS;
      totals[`${day}${suffix}`] = {
        tokens: Math.round(inTok + outTok),
        gCO2: (wh / 1000) * GRID_G_CO2_PER_KWH,
      };
      tokens += Math.round(inTok + outTok);
    }
    await chrome.storage.local.set({ totals });
    status.textContent = `Imported ${Object.keys(parsed.days).length} days (~${tokens.toLocaleString()} tokens).`;
  } catch {
    status.textContent = "Couldn't read that file.";
  }
  e.target.value = "";
};

render();