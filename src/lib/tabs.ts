import type { TabContent } from "./gemini";

const MAX_TEXT_LEN = 20000; // limit to avoid oversized prompts

function sanitize(text: string): string {
  return (text || "")
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .slice(0, MAX_TEXT_LEN);
}

export async function fetchTabsWithContent(): Promise<TabContent[]> {
  // If running as a Chrome extension page (or in chrome), attempt real APIs
  const hasChrome = typeof globalThis !== "undefined" && (globalThis as any)?.chrome;
  const chromeAny: any = hasChrome ? (globalThis as any).chrome : null;

  if (chromeAny?.tabs && chromeAny?.scripting) {
    try {
      const tabs: any[] = await new Promise((resolve, reject) => {
        chromeAny.tabs.query({ currentWindow: true }, (t: any[]) => {
          const err = chromeAny.runtime?.lastError;
          if (err) reject(err);
          else resolve(t);
        });
      });

      const results: TabContent[] = [];

      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          const injection = await chromeAny.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const title = document.title;
              const text = document.body?.innerText || "";
              const favicon =
                (document.querySelector('link[rel="icon"]') as HTMLLinkElement)?.href ||
                (document.querySelector('link[rel="shortcut icon"]') as HTMLLinkElement)?.href ||
                null;
              return { title, text, favicon };
            },
          });

          const [{ result }] = injection as Array<{ result: { title: string; text: string; favicon: string | null } }>;
          results.push({
            id: tab.id,
            url: tab.url || "",
            title: result?.title || tab.title || tab.url || "Untitled",
            favicon: result?.favicon || tab.favIconUrl || null,
            text: sanitize(result?.text || ""),
          });
        } catch (e) {
          // Skip tabs where scripts cannot be executed (e.g., chrome://, store, permissions)
          results.push({
            id: tab.id,
            url: tab.url || "",
            title: tab.title || tab.url || "Untitled",
            favicon: tab.favIconUrl || null,
            text: "",
          });
        }
      }

      return results;
    } catch (e) {
      // fallthrough to mock
      console.warn("Chrome APIs failed, using mock tabs:", e);
    }
  }

  // Mock data for web demo (no chrome APIs)
  const here = typeof window !== "undefined" ? window.location.href : "http://localhost:3000";
  return [
    {
      id: 1,
      url: here,
      title: typeof document !== "undefined" ? document.title || "This App" : "This App",
      favicon:
        typeof document !== "undefined"
          ? (
              (document.querySelector('link[rel="icon"]') as HTMLLinkElement)?.href ||
              (document.querySelector('link[rel="shortcut icon"]') as HTMLLinkElement)?.href ||
              "/favicon.ico"
            )
          : "/favicon.ico",
      text:
        typeof document !== "undefined" ? sanitize(document.body?.innerText || "This page") : "This page",
    },
    {
      id: 2,
      url: "https://news.ycombinator.com/",
      title: "Hacker News",
      favicon: "https://news.ycombinator.com/favicon.ico",
      text:
        "Hacker News is a social news website focusing on computer science and entrepreneurship. Users vote and comment on articles.",
    },
    {
      id: 3,
      url: "https://en.wikipedia.org/wiki/Artificial_intelligence",
      title: "Artificial intelligence - Wikipedia",
      favicon: "https://en.wikipedia.org/static/favicon/wikipedia.ico",
      text:
        "Artificial intelligence (AI) is intelligence demonstrated by machines, as opposed to the natural intelligence displayed by animals including humans.",
    },
  ];
}

export async function tryRefreshTabs(setter: (tabs: TabContent[]) => void, setError?: (msg: string | null) => void) {
  try {
    const tabs = await fetchTabsWithContent();
    setter(tabs);
    setError?.(null);
  } catch (e: any) {
    setError?.(e?.message || String(e));
  }
}