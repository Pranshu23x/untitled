"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { askGemini, type GeminiResult, type TabContent } from "@/lib/gemini";
import { tryRefreshTabs } from "@/lib/tabs";
import { Loader2, Send } from "lucide-react";

export default function Home() {
  const [tabs, setTabs] = useState<TabContent[]>([]);
  const [loadingTabs, setLoadingTabs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string; data?: GeminiResult }[]>([]);
  const [asking, setAsking] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Initial load + auto-refresh
  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingTabs(true);
      await tryRefreshTabs((t) => active && setTabs(t), (msg) => active && setError(msg));
      setLoadingTabs(false);
    })();

    const interval = setInterval(() => {
      tryRefreshTabs((t) => setTabs(t), (msg) => setError(msg));
    }, 15000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const onAsk = useCallback(async () => {
    if (!question.trim()) return;
    const q = question.trim();
    setQuestion("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setAsking(true);
    try {
      const res = await askGemini(q, tabs);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.answer || "",
          data: res,
        },
      ]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Sorry, I couldn't reach Gemini. I did a quick keyword match instead.",
        },
      ]);
    } finally {
      setAsking(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
    }
  }, [question, tabs]);

  const faviconFor = useCallback((t: TabContent) => {
    return t.favicon || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(t.url)}&sz=32`;
  }, []);

  const filteredTabs = tabs; // reserved for future search/filter

  return (
    <div className="min-h-screen w-full p-4 sm:p-6 md:p-10 bg-background text-foreground">
      <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Live Tabs</span>
                <div className="flex items-center gap-2">
                  {loadingTabs && <Badge variant="secondary">Refreshing…</Badge>}
                  <Button variant="outline" size="sm" onClick={() => tryRefreshTabs(setTabs, setError)}>
                    Refresh
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {error && (
                <div className="text-sm text-red-600 mb-3">{error}</div>
              )}
              <ScrollArea className="h-[60vh] pr-4">
                <ul className="space-y-3">
                  {filteredTabs.map((t) => (
                    <li key={t.id} className="rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <img src={faviconFor(t)} alt="" className="w-4 h-4" />
                        <a href={t.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          {t.title || t.url}
                        </a>
                        <Badge variant="secondary" className="ml-auto text-xs">
                          {(() => { try { return new URL(t.url).hostname; } catch { return t.url; } })()}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-3">
                        {t.text?.slice(0, 220) || "No readable text"}
                      </p>
                    </li>
                  ))}
                  {filteredTabs.length === 0 && (
                    <li className="text-sm text-muted-foreground">No tabs found.</li>
                  )}
                </ul>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="h-[78vh] flex flex-col">
            <CardHeader>
              <CardTitle>Ask Gemini about your open tabs</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col gap-3">
              <div ref={scrollRef as any} className="flex-1 overflow-auto rounded-md border p-3 bg-card/50">
                {messages.length === 0 && (
                  <div className="text-sm text-muted-foreground">
                    Ask things like: "Where did I see the pricing for X?", "What is Y as defined across my tabs?"
                  </div>
                )}
                <div className="space-y-4">
                  {messages.map((m, i) => (
                    <div key={i} className="text-sm">
                      <div className={m.role === "user" ? "font-medium" : ""}>
                        {m.role === "user" ? "You" : "Gemini"}
                      </div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      {m.role === "assistant" && m.data?.relevantTabs?.length ? (
                        <div className="mt-2 space-y-1">
                          <div className="text-xs text-muted-foreground">Relevant tabs</div>
                          <ul className="space-y-1">
                            {m.data.relevantTabs.map((rt, idx) => (
                              <li key={rt.id + String(idx)} className="text-xs">
                                <a className="underline" href={rt.url} target="_blank" rel="noreferrer">
                                  {rt.title}
                                </a>
                                {rt.reason ? <span className="text-muted-foreground"> — {rt.reason}</span> : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {asking && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Thinking…
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  placeholder="Ask where you saw X, or what X means across your tabs…"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) onAsk();
                  }}
                />
                <Button onClick={onAsk} disabled={!question.trim() || asking}>
                  <Send className="w-4 h-4 mr-1" /> Ask
                </Button>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Note: In a Chrome extension, this will use chrome.tabs.query and chrome.scripting.executeScript to read live tab content. On the web, mock tabs are shown.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}