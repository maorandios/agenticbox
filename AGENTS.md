# AgenticBox — הנחיות סוכן

## שלב נוכחי
UI/UX בלבד עם Mock Data ו-State מקומי. אין Backend, Nylas, Supabase, OpenAI או API Routes עסקיים.

## עקרונות
- ממשק עברית מלא + `dir="rtl"`
- מונוכרום בלבד; סטטוסים באייקון/טקסט/מסגרת
- `threadId` ב-URL הוא מקור האמת לשיחה הנבחרת
- כיווניות תוכן: `dir="auto"`, `unicode-bidi: plaintext`, `<bdi>` ל-metadata
- Google Sans כ־`--font-ui`; להוסיף קבצים מורשים בלבד תחת `public/fonts`

## Responsive
- ≥1440: 3 פאנלים מלאים
- 1280–1439: 3 פאנלים מצומצמים
- 1024–1279: רשימה + שיחה; Agent כ-Overlay

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
