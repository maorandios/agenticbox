# AgenticBox — הנחיות סוכן

## שלב נוכחי
Phase O5A.3.2 — **migration fix בלבד; `0019` ממתין להחלה ידנית** (PG 15+ ל־column-specific `ON DELETE SET NULL`).
- Bug: composite FK עם `ON DELETE SET NULL` ללא column list מאפס גם `user_id`.
- Fix: `0019_feed_replacement_fk_delete_scope.sql` — SET NULL רק ל־`superseded_by_feed_item_id` / `supersedes_feed_item_id`.
- `supersedes_feed_item_id` עדיין בשימוש (`persist.ts`) → נוסף `feed_items_supersedes_idx`.
- אין OpenAI / שינוי Feed Items / O5B. לפני החלה: `select current_setting('server_version');`
- Feed: `OPENAI_FEED_MODEL=gpt-4o-mini`, `FEED_EXTRACTION_VERSION=o5a.3`.


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
