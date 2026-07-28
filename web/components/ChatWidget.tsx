"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ChatMessage } from "@/lib/types";

// Floating in-app assistant. Knows how the platform works and can persist
// per-book translation instructions / glossary terms via backend tools.
export function ChatWidget({ bookId, bookTitle }: { bookId?: string; bookTitle?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    try {
      const res = await api.chat(next, bookId);
      let reply = res.reply || "";
      if (res.actions?.length) {
        const done = res.actions
          .filter((a) => (a.result as { ok?: boolean })?.ok)
          .map((a) => a.tool.replace(/_/g, " "));
        if (done.length) reply += `\n\n✓ ${done.join(", ")}`;
      }
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `Sorry — the assistant is unavailable. (${String(e)})` },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        className="chat-fab"
        aria-label={open ? "Close assistant" : "Open assistant"}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "×" : "Ask"}
      </button>

      {open && (
        <div className="chat-panel" role="dialog" aria-label="In-app assistant">
          <div className="chat-head">
            <b>Assistant</b>
            <span className="chat-ctx">
              {bookId ? `${bookTitle || bookId}` : "Library"}
            </span>
          </div>
          <div className="chat-body" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="chat-empty">
                Ask how anything works, or tell me how to translate this{bookId ? " book" : ""} —
                e.g. <em>&ldquo;translate only pages 10–30&rdquo;</em> or{" "}
                <em>&ldquo;always transliterate divine names&rdquo;</em>.
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={"chat-msg " + m.role}>
                  {m.content.split("\n").map((line, j) => (
                    <p key={j}>{line}</p>
                  ))}
                </div>
              ))
            )}
            {sending && <div className="chat-msg assistant chat-typing">…</div>}
          </div>
          <div className="chat-input">
            <textarea
              rows={2}
              placeholder="Ask a question or give an instruction…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn btn-primary sm" onClick={send} disabled={sending || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
