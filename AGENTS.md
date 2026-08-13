# AgenticBox — הנחיות סוכן

## שלב נוכחי
Phase O5D — **ONYX SAFELY SUSPENDED — ZERO RUNTIME CALLS**.
- `ONYX_ENABLED=false` (ברירת מחדל) + `FEED_CROSS_THREAD_CONTEXT_ENABLED=false`.
- Onyx suspended for Feed-first MVP. May return later for deep Q&A.
- Supabase Business Memory will be the primary cross-thread context source.
- אין Ingestion / Search / Chat / enqueue / worker ב־runtime.
- UI: מסך Ask/Search מוסתר מהניווט; `/search` מציג stub.
- Guard מרכזי ב־HTTP client: לפני כל fetch → `onyx_disabled`.
- אין Persist חדש / אין O5B / אין Business Memory עדיין.
- דוחות O5C נשמרים ב־`tmp/`; Adapter + migrations + `onyx_index_state` לא נמחקים.

## עקרונות
- ממשק עברית מלא + `dir="rtl"`
- מונוכרום בלבד; סטטוסים באייקון/טקסט/מסגרת
- `threadId` ב-URL הוא מקור האמת לשיחה הנבחרת
- כיווניות תוכן: `dir="auto"`, `unicode-bidi: plaintext`, `<bdi>` ל-metadata
- Google Sans כ־`--font-ui`; להוסיף קבצים מורשים בלבד תחת `public/fonts`
- credentials / grant ids / raw HTML / webhook payloads — private schema + service role בלבד
- React לא צורך אובייקטי Nylas גולמיים
- Feed rules: domain-agnostic + language-aware; fixtures may use domain examples, production rules must not hardcode them

## Responsive
- ≥1440: 3 פאנלים מלאים
- 1280–1439: 3 פאנלים מצומצמים
- 1024–1279: רשימה + שיחה; Agent כ-Overlay

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
