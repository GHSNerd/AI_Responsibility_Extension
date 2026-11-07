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

chrome.action.onClicked.addListener(async (tab) => {
  const host = new URL(tab.url).hostname;
  const origin = `https://${host}/*`;

  // Ask the user for access to this site if not already granted
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted || !ADAPTERS[host]) return;

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: ADAPTERS[host],
  });

  // Save locally, keyed by site and time
  const key = `${host}:${Date.now()}`;
  await chrome.storage.local.set({ [key]: result });
});