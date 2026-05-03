"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, Lock, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

// Chat widget — Tier-A and Tier-B dispatch.
//
// Tier-A (/api/chat): Pro + Premium. Streaming text response. Snapshot-
// based — last-100-events front-loaded into the system prompt. Single-
// message turns (no conversation history sent to server).
//
// Tier-B (/api/chat-v2): Premium only. Tool-calling agent loop. Server
// returns sync JSON with text + tool_calls + usage. Multi-turn —
// client maintains the message history and sends the full thread.
//
// Locked decisions (memory: project_vendcast_tier-b_chatbot.md):
//   - Premium-only Tier-B (cost delta vs Tier-A; Premium under-
//     differentiated against Pro)
//   - Read-only tools in v1
//   - No persisted history in v1 — client-side only
//   - $10/op/mo soft cap; 402 response when reached

interface ToolCallSummary {
  name: string;
  input?: unknown;
  result_summary?: { count?: number; sample?: string; error?: string };
}

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Tier-B turns surface the tool calls used to answer. */
  toolCalls?: ToolCallSummary[];
}

interface ChatWidgetProps {
  isPro: boolean;
  isPremium: boolean;
  enabled: boolean;
}

// Tier-B keeps the conversation history client-side. Cap at the
// server's 20-message limit so we never round-trip a refusal.
const MAX_HISTORY = 20;

export function ChatWidget({ isPro, isPremium, enabled }: ChatWidgetProps) {
  if (!enabled) return null;

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open && isPro) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, isPro]);

  async function handleSendTierB(text: string) {
    // Build the conversation history Tier-B expects. Trim to the
    // server's 20-message cap, keeping the most recent turns.
    const history = messages
      .slice(-(MAX_HISTORY - 1))
      .map((m) => ({ role: m.role, content: m.content }));
    const payload = { messages: [...history, { role: "user", content: text }] };

    const res = await fetch("/api/chat-v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.status === 402) {
      // Monthly cap reached — surface distinctly from generic errors.
      const data = (await res.json()) as { error?: string };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.error ??
            "Monthly AI assistant cap reached. Resets on the 1st.",
        },
      ]);
      return;
    }

    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err.error ?? "Something went wrong"}`,
        },
      ]);
      return;
    }

    const data = (await res.json()) as {
      text: string;
      tool_calls?: ToolCallSummary[];
      truncated?: boolean;
    };

    const finalText = data.truncated
      ? `${data.text}\n\n(Note: I hit the tool-call limit for this turn — ask a narrower follow-up if you need more.)`
      : data.text;

    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: finalText,
        toolCalls: data.tool_calls,
      },
    ]);
  }

  async function handleSendTierA(text: string) {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    if (!res.ok) {
      const err = (await res.json()) as { error?: string };
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err.error ?? "Something went wrong"}`,
        },
      ]);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let assistantText = "";

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      assistantText += decoder.decode(value, { stream: true });
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: assistantText,
        };
        return updated;
      });
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      if (isPremium) {
        await handleSendTierB(text);
      } else {
        await handleSendTierA(text);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection error — please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Suggestion prompts — Tier-B can answer richer queries (filters,
  // aggregations) than Tier-A's snapshot. Surface tier-appropriate
  // examples so the operator gets a feel for what the assistant can do.
  const suggestions = isPremium
    ? [
        "Show me my August catering events.",
        "What's my best-performing repeat booking?",
        "What's coming up in the next 2 weeks?",
      ]
    : [
        "What's my best-performing event type?",
        "How did last month compare to the month before?",
        "Which upcoming events have the highest forecasts?",
      ];

  return (
    <>
      {open && (
        <div
          className="fixed bottom-20 right-4 z-50 w-[380px] max-w-[calc(100vw-2rem)] bg-background border rounded-xl shadow-2xl flex flex-col"
          style={{ height: 500 }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Ask your data</span>
              {isPremium && (
                <span className="text-[10px] font-bold uppercase bg-brand-teal/10 text-brand-teal rounded px-1.5 py-0.5">
                  Premium
                </span>
              )}
              {isPro && !isPremium && (
                <span className="text-[10px] font-bold uppercase bg-primary/10 text-primary rounded px-1.5 py-0.5">
                  AI
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {!isPro ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold">
                  AI Assistant is a Pro feature
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Ask questions about your events, revenue trends, and forecasts
                  — answered in seconds using your real data.
                </p>
              </div>
              <Link href="/dashboard/upgrade">
                <Button size="sm" className="mt-1">
                  Upgrade to Pro
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.length === 0 && (
                  <div className="text-center pt-6 space-y-2">
                    <p className="text-sm font-medium">
                      {isPremium
                        ? "Ask anything about your business"
                        : "Ask about your events"}
                    </p>
                    <div className="space-y-1.5">
                      {suggestions.map((q) => (
                        <button
                          key={q}
                          onClick={() => {
                            setInput(q);
                            inputRef.current?.focus();
                          }}
                          className="block w-full text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg px-3 py-2 transition-colors border"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {msg.content ? (
                        // whitespace-pre-wrap preserves the assistant's
                        // line breaks + bullet formatting (the model emits
                        // newlines for lists; without this they collapse
                        // into a wall of text). break-words handles long
                        // event names that would otherwise overflow the
                        // 85% bubble width.
                        <div className="whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                      ) : (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Thinking…
                        </span>
                      )}
                      {msg.role === "assistant" &&
                        msg.toolCalls &&
                        msg.toolCalls.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-foreground/10 space-y-1">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                              {msg.toolCalls.length} tool
                              {msg.toolCalls.length === 1 ? "" : "s"} used
                            </p>
                            {msg.toolCalls.map((tc, j) => (
                              <div
                                key={j}
                                className="text-[11px] text-muted-foreground flex items-center gap-1.5"
                              >
                                <Wrench className="h-3 w-3 shrink-0" />
                                <code className="font-mono">{tc.name}</code>
                                {typeof tc.result_summary?.count === "number" && (
                                  <span>
                                    · {tc.result_summary.count} row
                                    {tc.result_summary.count === 1 ? "" : "s"}
                                  </span>
                                )}
                                {tc.result_summary?.error && (
                                  <span className="text-destructive">
                                    · error
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                    </div>
                  </div>
                ))}

                {loading &&
                  messages[messages.length - 1]?.role !== "assistant" && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-xl px-3 py-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      </div>
                    </div>
                  )}

                <div ref={bottomRef} />
              </div>

              <div className="border-t p-3 flex items-end gap-2 shrink-0">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isPremium
                      ? "Ask anything…"
                      : "Ask about your events..."
                  }
                  rows={1}
                  className="flex-1 resize-none text-sm bg-muted rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground min-h-[38px] max-h-24"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                  disabled={loading}
                />
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={handleSend}
                  disabled={!input.trim() || loading}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 right-4 z-50 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
        title="Ask your data"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </>
  );
}
