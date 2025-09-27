/* Popup logic for Tabs + Gemini (MV3)
 - Fetch live tabs and extract text via chrome.scripting.executeScript
 - Ask Gemini which tabs are relevant and what they say
 - Fallback to simple keyword matching if API fails
*/

const API_KEY = "AIzaSyBpl2jIVgdaKfHM6Hzniwr_HTVhX2_bD5A";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;

/** @typedef {{ id: number, url: string, title: string, favicon?: string, text?: string }} TabContent */

const state = {
  tabs: /** @type {TabContent[]} */ ([]),
  loadingTabs: false,
  error: null,
  messages: /** @type {{ role: "user"|"assistant", content: string, data?: any }[]} */ ([]),
  asking: false,
};

const el = {
  tabsList: () => document.getElementById("tabs-list"),
  noTabs: () => document.getElementById("no-tabs"),
  refreshing: () => document.getElementById("refreshing-badge"),
  refreshBtn: () => document.getElementById("refresh-btn"),
  error: () => document.getElementById("error"),
  chatLog: () => document.getElementById("chat-log"),
  question: () => document.getElementById("question"),
  ask: () => document.getElementById("ask"),
};

// UI helpers
function setRefreshing(v) {
  const r = el.refreshing();
  if (r) r.style.display = v ? "inline-block" : "none";
}
function setError(msg) {
  const e = el.error();
  if (!e) return;
  if (msg) {
    e.textContent = msg;
    e.style.display = "block";
  } else {
    e.textContent = "";
    e.style.display = "none";
  }
}

function faviconFor(u, provided) {
  if (provided) return provided;
  try {
    const hostname = new URL(u).hostname;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
  } catch {
    return "";
  }
}

function renderTabs() {
  const list = el.tabsList();
  const noTabs = el.noTabs();
  if (!list || !noTabs) return;
  list.innerHTML = "";
  if (!state.tabs.length) {
    noTabs.style.display = "block";
    return;
  }
  noTabs.style.display = "none";
  for (const t of state.tabs) {
    const li = document.createElement("li");
    li.className = "tab-item";

    const row = document.createElement("div");
    row.className = "tab-row";

    const icon = document.createElement("img");
    icon.className = "icon";
    icon.src = faviconFor(t.url, t.favicon);
    icon.alt = "";
    row.appendChild(icon);

    const a = document.createElement("a");
    a.href = t.url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = t.title || t.url;
    row.appendChild(a);

    const host = document.createElement("span");
    host.className = "hostname";
    try { host.textContent = new URL(t.url).hostname; } catch { host.textContent = t.url; }
    row.appendChild(host);

    const snippet = document.createElement("div");
    snippet.className = "snippet";
    snippet.textContent = (t.text || "No readable text").slice(0, 220);

    li.appendChild(row);
    li.appendChild(snippet);
    list.appendChild(li);
  }
}

function renderMessages() {
  const log = el.chatLog();
  if (!log) return;
  log.innerHTML = "";
  if (!state.messages.length) {
    const empty = document.createElement("div");
    empty.className = "small-note";
    empty.textContent = 'Ask things like: "Where did I see the pricing for X?", "What is Y as defined across my tabs?"';
    log.appendChild(empty);
  }
  for (const m of state.messages) {
    const wrap = document.createElement("div");
    wrap.className = "msg";

    const role = document.createElement("div");
    role.className = "role" + (m.role === "user" ? "" : "");
    role.textContent = m.role === "user" ? "You" : "Gemini";

    const content = document.createElement("div");
    content.className = "content";
    content.textContent = m.content;

    wrap.appendChild(role);
    wrap.appendChild(content);

    if (m.role === "assistant" && m.data && Array.isArray(m.data.relevantTabs) && m.data.relevantTabs.length) {
      const rel = document.createElement("div");
      rel.className = "relevant";

      const label = document.createElement("div");
      label.className = "label";
      label.textContent = "Relevant tabs";

      const ul = document.createElement("ul");
      for (const rt of m.data.relevantTabs) {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = rt.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = rt.title || rt.url;
        li.appendChild(link);
        if (rt.reason) {
          const span = document.createElement("span");
          span.textContent = ` — ${rt.reason}`;
          span.style.color = "#a3a3ad";
          li.appendChild(span);
        }
        ul.appendChild(li);
      }

      rel.appendChild(label);
      rel.appendChild(ul);
      wrap.appendChild(rel);
    }

    log.appendChild(wrap);
  }
  // scroll to bottom
  log.scrollTop = log.scrollHeight;
}

async function tryRefreshTabs() {
  setError(null);
  setRefreshing(true);
  state.loadingTabs = true;
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    /** @type {TabContent[]} */
    const results = [];

    for (const tab of tabs) {
      if (!tab.id || !tab.url || tab.url.startsWith("chrome")) continue;
      const base = {
        id: tab.id,
        url: tab.url,
        title: tab.title || tab.url,
        favicon: faviconFor(tab.url, tab.favIconUrl || undefined),
        text: "",
      };

      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const getFavicon = () => {
              const link = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
              return link ? (link.getAttribute("href") || "") : "";
            };
            const absUrl = (u) => {
              try { return new URL(u, location.href).href; } catch { return u; }
            };
            const favicon = getFavicon();
            const text = document.body ? document.body.innerText || "" : "";
            return {
              title: document.title || location.href,
              url: location.href,
              favicon: favicon ? absUrl(favicon) : "",
              text: text.replace(/\s+/g, " ").trim().slice(0, 50000),
            };
          },
          world: "MAIN",
        });
        const data = injected?.[0]?.result;
        results.push({
          ...base,
          title: data?.title || base.title,
          url: data?.url || base.url,
          favicon: data?.favicon || base.favicon,
          text: data?.text || "",
        });
      } catch (e) {
        // Fallback: keep meta only
        results.push(base);
      }
    }

    state.tabs = results;
    renderTabs();
  } catch (e) {
    console.error(e);
    setError("Failed to fetch tabs. Ensure the extension has 'tabs' and 'scripting' permissions.");
  } finally {
    state.loadingTabs = false;
    setRefreshing(false);
  }
}

function keywordFallback(question, tabs) {
  const q = question.toLowerCase();
  const words = q.split(/[^a-z0-9]+/i).filter(Boolean).filter(w => w.length > 2);
  const scored = tabs.map(t => {
    const hay = ((t.title || "") + "\n" + (t.text || "")).toLowerCase();
    const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    return { tab: t, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score).slice(0, 5);

  return {
    answer: scored.length ? "I matched keywords to find potentially relevant tabs." : "I couldn't find relevant tabs using keyword match.",
    relevantTabs: scored.map(s => ({ id: s.tab.id, title: s.tab.title, url: s.tab.url, reason: `keyword overlap: ${s.score}` })),
  };
}

async function askGemini(question, tabs) {
  const limitedTabs = tabs.map(t => ({ id: t.id, title: t.title, url: t.url, text: (t.text || "").slice(0, 4000) }));
  const sys = `You are an assistant helping the user locate information across their currently open browser tabs.\n\nReturn a compact JSON object with keys: \n- answer: a short helpful answer to the user's question using tab content when possible\n- relevantTabs: an array of up to 5 items {id,title,url,reason} indicating which tabs contain relevant information and why.\n\nOnly output valid JSON, with no markdown.`;
  const user = `User question: ${question}\n\nOpen tabs (id,title,url,text):\n${JSON.stringify(limitedTabs)}`;

  const body = {
    contents: [
      { role: "user", parts: [{ text: sys + "\n\n" + user }] }
    ]
  };

  const res = await fetch(GEMINI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error("Gemini request failed");
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch {
    // If model returned plain text, wrap it
    return { answer: String(text || ""), relevantTabs: [] };
  }
}

async function onAsk() {
  const input = /** @type {HTMLInputElement|null} */ (el.question());
  if (!input) return;
  const q = (input.value || "").trim();
  if (!q) return;

  input.value = "";
  state.messages.push({ role: "user", content: q });
  renderMessages();

  const askBtn = el.ask();
  if (askBtn) askBtn.disabled = true;

  try {
    let result;
    try {
      result = await askGemini(q, state.tabs);
    } catch (e) {
      result = keywordFallback(q, state.tabs);
    }
    state.messages.push({ role: "assistant", content: result.answer || "", data: result });
  } finally {
    if (askBtn) askBtn.disabled = false;
    renderMessages();
  }
}

function wireEvents() {
  const refresh = el.refreshBtn();
  if (refresh) refresh.addEventListener("click", () => tryRefreshTabs());

  const ask = el.ask();
  if (ask) ask.addEventListener("click", onAsk);

  const input = el.question();
  if (input) input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onAsk();
  });
}

async function init() {
  wireEvents();
  await tryRefreshTabs();
  // auto refresh every 15s
  setInterval(() => { tryRefreshTabs(); }, 15000);
}

document.addEventListener("DOMContentLoaded", init);