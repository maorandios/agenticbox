# AgenticBox — הנחיות סוכן

## שלב נוכחי
Phase O2: Onyx Adapter server-only מוכן (feature flag `ONYX_ENABLED`).
- אין אינדוקס מלא / queue / worker / Search API / UI Ask אמיתי עדיין.
- Phase 2C Inbox API mode קיים אך mock נשאר ברירת מחדל.
- Settings: Connect + סטטוס סנכרון + התחל/Retry (Phase 2B).
- אין Webhooks / Outlook עדיין.
- יש להריץ migrations כולל `0008_backfill_progress_and_queue_wrappers.sql`.
- לתצוגת HTML משופרת (טבלאות מ-raw): להריץ גם `0010_get_message_raw_html.sql`.
- Onyx: `ONYX_INGESTION_API_KEY` (Admin) ל-ingest/delete בלבד; `ONYX_CHAT_API_KEY` (Basic) ל-chat בלבד; `ONYX_CC_PAIR_ID` נדרש כש-`ONYX_ENABLED=true`.


## עקרונות
- ממשק עברית מלא + `dir="rtl"`
- מונוכרום בלבד; סטטוסים באייקון/טקסט/מסגרת
- `threadId` ב-URL הוא מקור האמת לשיחה הנבחרת
- כיווניות תוכן: `dir="auto"`, `unicode-bidi: plaintext`, `<bdi>` ל-metadata
- Google Sans כ־`--font-ui`; להוסיף קבצים מורשים בלבד תחת `public/fonts`
- credentials / grant ids / raw HTML / webhook payloads — private schema + service role בלבד
- React לא צורך אובייקטי Nylas גולמיים

## Responsive
- ≥1440: 3 פאנלים מלאים
- 1280–1439: 3 פאנלים מצומצמים
- 1024–1279: רשימה + שיחה; Agent כ-Overlay

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
