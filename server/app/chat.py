"""In-app assistant: answers questions about the platform and can act on books.

A small, dependency-free chat client over OpenRouter's OpenAI-compatible
``/chat/completions`` endpoint (stdlib ``urllib``, matching the rest of the
codebase). The assistant is given (a) curated knowledge about how the platform
works so it answers usage questions correctly, (b) the current book's live
context, and (c) a few tools so instructions the user types actually persist
(e.g. "for this book, transliterate all divine names").

Tools are deliberately limited to safe, non-token-spending actions: read book
status, set a book's translation instructions, and add glossary terms. Starting
an ingest (which costs money) is intentionally NOT a tool — that stays an
explicit UI action.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from . import db

CHAT_MODEL = os.environ.get("HAYDARI_CHAT_MODEL", "google/gemini-2.5-flash")
_BASE = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
_MAX_TOOL_TURNS = 5

# Curated, accurate description of the platform so answers reflect how it really
# works. Keep in sync with the actual pipeline/API behaviour.
APP_KNOWLEDGE = """\
You are the built-in assistant for "Miʿrāj", an Arabic→English translation platform for
classical and contemporary Shia Islamic texts (falsafa, ʿirfān, uṣūl, hadith). Answer
questions about how to use the app accurately and concisely, and help the editor configure
how their books are translated. If you are unsure, say so — never invent features.

HOW THE PLATFORM WORKS
- Library: the home page lists every book with a live progress bar. Upload one or more Arabic
  source PDFs (optionally with a title, author, and translation instructions). Each becomes a
  book with status "uploaded".
- Ingestion pipeline (per book): OCR (a vision model reads the scanned Arabic, preserving
  diacritics and footnotes) → translation (a two-pass draft-then-refine, with a glossary and
  translation-memory injected, and Qurʾān/Hadith detected and replaced with canonical English
  rather than machine-translated) → QA scoring → human review.
- Ingestion is INCREMENTAL and RESUMABLE. It processes one page at a time and saves after each
  page, so progress is live and partial work is never lost. You choose a page range (from/to)
  and there is a per-run safety cap (default 20 pages) so one click never burns through a huge
  book. When a run finishes with pages remaining, a "Continue" button processes the next window.
- Review workbench: open a book to review each segment's translation, edit it, and approve.
  Every edit becomes training signal (correction pairs, translation-memory, glossary).
- Per-book translation instructions: free-text guidance ("transliterate all divine names",
  "keep footnotes as footnotes", "prefer 'the mutakallimūn' for المتكلّمون") that is injected
  into every translation prompt for that book at the highest priority. Set them at upload or ask
  me to change them.
- Glossary/termbase: fixed AR→EN term mappings, enforced during translation. Scope can be
  "global" (all books) or "book" (one book).
- Models: translation runs through OpenRouter, so any model can be used. A cheaper bulk model
  handles most segments and a stronger frontier model handles doctrinal/long/low-confidence ones.

WHEN THE USER GIVES TRANSLATION INSTRUCTIONS
- If they describe how a specific book should be translated and a book is in context, call
  set_translation_notes to persist it (merge with, don't blindly erase, existing notes unless
  they ask to replace).
- If they define a fixed term mapping ("always translate X as Y"), call add_glossary_term.
- Confirm what you saved in plain language.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_book_status",
            "description": "Get live status for a book: ingestion status, pages done/total, review progress, and its current translation instructions.",
            "parameters": {
                "type": "object",
                "properties": {"book_id": {"type": "string", "description": "e.g. B-02"}},
                "required": ["book_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_translation_notes",
            "description": "Set (replace) the per-book translation instructions injected into every translation prompt for this book.",
            "parameters": {
                "type": "object",
                "properties": {
                    "book_id": {"type": "string"},
                    "notes": {"type": "string", "description": "The full instruction text to store."},
                },
                "required": ["book_id", "notes"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_glossary_term",
            "description": "Add a fixed Arabic→English term mapping enforced during translation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "term_ar": {"type": "string"},
                    "term_en": {"type": "string"},
                    "note": {"type": "string"},
                    "scope": {"type": "string", "enum": ["global", "book"]},
                    "book_id": {"type": "string", "description": "Required when scope is 'book'."},
                },
                "required": ["term_ar", "term_en"],
            },
        },
    },
]


def _execute_tool(conn, name: str, args: dict) -> dict:
    """Run a tool call against the DB. Returns a JSON-serialisable result."""
    if name == "get_book_status":
        b = db.get_book(conn, args.get("book_id", ""))
        if not b:
            return {"error": "book not found"}
        return {
            "id": b["id"], "title_en": b.get("title_en"), "title_ar": b.get("title_ar"),
            "status": b["status"], "pages_total": b.get("pages_total"),
            "pages_done": db.pages_done(conn, b["id"]),
            "review": b.get("progress"),
            "translation_notes": b.get("translation_notes"),
        }
    if name == "set_translation_notes":
        bid = args.get("book_id", "")
        if not db.get_book(conn, bid):
            return {"error": "book not found"}
        db.set_book_notes(conn, bid, (args.get("notes") or "").strip() or None)
        conn.commit()
        return {"ok": True, "book_id": bid, "saved": args.get("notes")}
    if name == "add_glossary_term":
        scope = args.get("scope") or ("book" if args.get("book_id") else "global")
        bid = args.get("book_id") if scope == "book" else None
        if scope == "book" and not bid:
            return {"error": "book_id required for book-scoped term"}
        db.insert_term(
            conn, term_ar=args.get("term_ar", ""), term_en=args.get("term_en", ""),
            note=args.get("note"), scope=scope, book_id=bid, created_by="assistant",
        )
        conn.commit()
        return {"ok": True, "scope": scope, "term": f"{args.get('term_ar')} → {args.get('term_en')}"}
    return {"error": f"unknown tool {name}"}


def _book_context(conn, book_id: str | None) -> str:
    if not book_id:
        return "No specific book is open; the user is on the Library."
    b = db.get_book(conn, book_id)
    if not b:
        return f"(book {book_id} not found)"
    return (
        f"CURRENT BOOK IN CONTEXT: {book_id} — {b.get('title_en') or b.get('title_ar')}\n"
        f"  status={b['status']}, pages_done={db.pages_done(conn, book_id)}, "
        f"pages_total={b.get('pages_total')}\n"
        f"  current translation instructions: {b.get('translation_notes') or '(none set)'}"
    )


def _call_openrouter(messages: list[dict]) -> dict:
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    body = json.dumps({
        "model": CHAT_MODEL,
        "messages": messages,
        "tools": TOOLS,
        "tool_choice": "auto",
        "usage": {"include": True},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{_BASE}/chat/completions", data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://haydari.local",
            "X-Title": "Haydari Assistant",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:  # pragma: no cover - network
        return json.loads(resp.read().decode("utf-8"))


def chat(conn, messages: list[dict], book_id: str | None = None) -> dict:
    """Run one assistant turn (with an internal tool loop). Returns
    ``{reply, actions}`` where actions lists any tools the assistant invoked."""
    convo = [
        {"role": "system", "content": APP_KNOWLEDGE + "\n\n" + _book_context(conn, book_id)},
        *[{"role": m["role"], "content": m.get("content", "")} for m in messages],
    ]
    actions: list[dict] = []
    for _ in range(_MAX_TOOL_TURNS):
        data = _call_openrouter(convo)
        msg = (data.get("choices") or [{}])[0].get("message") or {}
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            return {"reply": msg.get("content") or "", "actions": actions}
        # Record the assistant's tool-call message, then execute each call.
        convo.append({"role": "assistant", "content": msg.get("content") or "",
                      "tool_calls": tool_calls})
        for tc in tool_calls:
            fn = tc.get("function") or {}
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            # Default book scope to the open book when the model omits it.
            if book_id and "book_id" in {p for p in ("book_id",)} and not args.get("book_id"):
                if name in ("get_book_status", "set_translation_notes"):
                    args["book_id"] = book_id
            result = _execute_tool(conn, name, args)
            actions.append({"tool": name, "args": args, "result": result})
            convo.append({
                "role": "tool", "tool_call_id": tc.get("id"),
                "name": name, "content": json.dumps(result),
            })
    return {"reply": "I wasn't able to finish that in a reasonable number of steps. "
                     "Could you rephrase or break it into smaller steps?", "actions": actions}
