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

render();