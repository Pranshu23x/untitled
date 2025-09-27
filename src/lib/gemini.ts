const GEMINI_API_KEY = "AIzaSyBpl2jIVgdaKfHM6Hzniwr_HTVhX2_bD5A";
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=";

export type TabContent = {
  id: number | string;
  url: string;
  title: string;
  favicon?: string | null;
  text: string;
};

export type GeminiResult = {
  answer: string;
  relevantTabs: Array<{
    id: string | number;
    url: string;
    title: string;
    reason?: string;
  }>;
  raw?: unknown;
};

function buildPrompt(question: string, tabs: TabContent[]): string {
  const catalog = tabs
    .map((t, i) => {
      const host = (() => {
        try {
          return new URL(t.url).hostname;
        } catch {
          return t.url;
        }
      })();
      const snippet = (t.text || "").slice(0, 1500).replace(/\s+/g, " ");
      return `Tab #${i + 1}\n- id: ${t.id}\n- title: ${t.title}\n- host: ${host}\n- url: ${t.url}\n- content: """${snippet}"""`;
    })
    .join("\n\n");

  return `You are a helpful assistant. The user has multiple browser tabs. Your job:\n1) Identify which tab(s) contain the answer to the user's question.\n2) Provide a concise answer.\n3) Return a short reason for why those tabs were chosen.\n\nReturn your answer as:\nANSWER: <concise answer>\nTABS:\n- <tab id or url> — <short reason>\n\nTabs Catalog:\n${catalog}\n\nUser Question: ${question}`;
}

export async function askGemini(
  question: string,
  tabs: TabContent[]
): Promise<GeminiResult> {
  const prompt = buildPrompt(question, tabs);

  try {
    const res = await fetch(GEMINI_ENDPOINT + GEMINI_API_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topK: 32,
          topP: 0.95,
          maxOutputTokens: 1024,
        },
      }),
    });

    if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);

    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      data?.candidates?.[0]?.content?.parts?.[0]?.string_value ||
      "";

    // Parse simple format
    const answerMatch = text.match(/ANSWER:\s*([\s\S]*?)\nTABS:/i);
    const tabsSectionMatch = text.match(/TABS:\s*([\s\S]*)/i);
    const answer = answerMatch ? answerMatch[1].trim() : text.trim();

    const relevantTabs: GeminiResult["relevantTabs"] = [];
    if (tabsSectionMatch) {
      const lines = tabsSectionMatch[1]
        .split(/\n+/)
        .map((l: string) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        // format: - <id or url> — <reason>
        const m = line.match(/^[-•]\s*(.+?)\s*[—-]\s*(.+)$/);
        if (m) {
          const ref = m[1].trim();
          const reason = m[2].trim();
          const byId = tabs.find((t) => String(t.id) === ref);
          const byUrl = tabs.find((t) => t.url.includes(ref) || ref.includes(t.url));
          const chosen = byId || byUrl;
          if (chosen) {
            relevantTabs.push({ id: chosen.id, url: chosen.url, title: chosen.title, reason });
          }
        }
      }
    }

    // Fallback: simple keyword scoring if parsing failed
    if (relevantTabs.length === 0) {
      const q = question.toLowerCase();
      const scored = tabs
        .map((t) => ({
          t,
          score:
            (t.title?.toLowerCase().includes(q) ? 5 : 0) +
            (t.text?.toLowerCase().includes(q) ? 3 : 0),
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ t }) => ({ id: t.id, url: t.url, title: t.title, reason: "keyword match" }));
      return { answer, relevantTabs: scored, raw: data };
    }

    return { answer, relevantTabs, raw: data };
  } catch (e: any) {
    // On error, do keyword-only response
    const q = question.toLowerCase();
    const scored = tabs
      .map((t) => ({
        t,
        score:
          (t.title?.toLowerCase().includes(q) ? 5 : 0) +
          (t.text?.toLowerCase().includes(q) ? 3 : 0),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ t }) => ({ id: t.id, url: t.url, title: t.title, reason: "keyword match (fallback)" }));

    return {
      answer:
        "I used keyword matching as a fallback due to an API error. Here are the most relevant tabs and likely answer based on text snippets.",
      relevantTabs: scored,
      raw: { error: String(e) },
    };
  }
}