# Climbr

A life-gamification app: users set goals, Claude generates a quest plan for each one, and completing quests earns XP. Next.js 16 (App Router), Tailwind v4, Supabase (auth + Postgres), Anthropic API.

## Environment variables (`.env.local`, gitignored)

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # server-only, bypasses RLS - used ONLY by the cron route
CRON_SECRET=                 # shared secret the cron route checks in Authorization: Bearer <value>
```

`.env.example` documents these with no real values. There is no `@supabase/ssr` package and no middleware — auth is plain client-side `supabase-js`, sessions live in the browser (not cookies).

## Database schema (Supabase Postgres)

**`profiles`**: `id uuid` (= `auth.users.id`), `username text`, `total_xp integer default 0`, `created_at timestamptz`.
- A trigger `on_auth_user_created` → `handle_new_user()` (SQL in git history/this conversation) auto-inserts a profile row on signup, pulling `username` from `raw_user_meta_data`. **Every `goals.user_id` FK is to `profiles(id)`, not `auth.users(id)` directly** — if a user is ever missing a profile row, every insert into `goals` fails with `goals_user_id_fkey` violation.

**`goals`**: `id uuid`, `user_id uuid` (FK → `profiles.id`), `title text NOT NULL`, `description text`, `skill_level text NOT NULL`, `timeframe_days integer NOT NULL` (total day count — the goal-creation form composes this from separate years/months/weeks/days inputs, ~365/30/7/1 day approximations), `hours_per_day numeric(4,2) NOT NULL` (supports 30-minute increments, e.g. `1.5`), `quest_generation_time text NOT NULL` (defaults to `'09:00'` server-side if the user leaves it blank — currently **not actually used to time anything**, see Cron section), `status text default 'active'` (`'active' | 'completed' | 'abandoned'`), `created_at timestamptz`.

**`quests`**: `id uuid`, `goal_id uuid`, `user_id uuid`, `title text NOT NULL`, `description text`, `type text NOT NULL` (`'intro' | 'daily' | 'weekly'`, enforced by a CHECK constraint `quests_type_check`), `xp_reward integer default 10`, `due_date date` (NULL for `intro` quests — they have no deadline), `completed boolean default false`, `completed_at timestamptz`, `missed_at timestamptz` (non-terminal flag, intro quests only), `expired_at timestamptz` (terminal, daily/weekly only — once set, the quest can never be completed), `created_at timestamptz`.

RLS is enabled on all three tables with owner-based policies (`auth.uid() = user_id`) covering select/insert/update/delete — confirmed working for goals and quests during this build.

## Quest generation model

Three quest types, generated differently:
- **`intro`** — 3 quests, generated once at goal creation, **never regenerated**. Stay on the board until completed. If still incomplete after the goal's first day, the cron flags `missed_at` (a soft "you should really do this" nudge — the quest stays fully completable).
- **`daily`** — one quest per calendar day, `due_date` = that day. Generated for "day 1" at goal creation, then one new one per day going forward via the cron.
- **`weekly`** — one quest per 7-day window, `due_date` = end of that window. Generated for "week 1" at goal creation, then a new one every 7th day via the cron.

When a new daily/weekly cycle generates and the previous one was never completed, it gets `expired_at` set (terminal — can't be completed after that, distinct from `missed_at`).

XP ranges by type, defined in `app/lib/questPlan.js`: intro 20–50, daily 5–30, weekly 50–150.

Claude is called via forced tool-use (`tool_choice: {type:'tool', name:...}`) rather than parsing free text, so responses are schema-shaped JSON. **Known model quirk**: Claude has been observed wrapping an array field in a JSON *string* instead of returning it directly (e.g. `{quests: "[...]"}` or even double-nested `{quests: "{\"quests\":[...]}"}`) — `coerceQuestArray()` in `app/lib/questPlan.js` defensively unwraps this. If quest generation ever throws "did not return valid quests" again, reproduce it directly against the Anthropic API (see "Debugging technique" below) before assuming it's a code bug.

## Cron / scheduled refresh

`app/api/cron/refresh-quests/route.js` (GET) is meant to run once daily via Vercel Cron (`vercel.json`, schedule `0 8 * * *`). It:
1. Checks `Authorization: Bearer ${CRON_SECRET}` — Vercel sets this automatically when invoking a configured cron path, as long as `CRON_SECRET` is set as a project env var.
2. Uses `createServiceRoleClient()` (in `app/lib/supabase.js`) to bypass RLS — there's no logged-in user in a cron context, and it needs to touch every user's goals.
3. For every `status='active'` goal: expires stale incomplete daily/weekly quests, generates today's daily quest if missing, generates the new week's weekly quest on 7-day boundaries (based on `daysSinceCreated % 7 === 0`, anchored to `goals.created_at`), and flags stale incomplete intro quests as missed.

**Not yet deployed to Vercel** — validated locally via manual curl only. `quest_generation_time` currently does nothing functionally: Vercel Hobby-tier cron jobs are capped at once/day with no per-minute granularity, so there's no way to honor a per-goal time-of-day without upgrading to Pro (which supports finer schedules) and rewriting the cron to check per-goal times hourly.

**Testing technique** (since there's no way to fast-forward real time): backdate a quest's `due_date` (`update quests set due_date = due_date - 1 where goal_id = '...' and type = 'daily'` — **do not add `and completed = false`** if you want to test a quest that's already completed, since that clause would just skip it and the date never moves) and/or a goal's `created_at` (for weekly boundary testing), then hit the cron route with curl. Always paste the actual curl JSON response when debugging — "unchanged" vs "generated" tells you immediately whether the backdate took effect.

## App routes

- `/` `/login` `/signup` — existing auth pages, client-side `supabase.auth.signInWithPassword`/`signUp`/etc.
- `/goals/new` — goal creation form (years/months/weeks/days timeframe, 30-min-increment hours/day dropdown, optional reminder time). Posts to `/api/goals` with `Authorization: Bearer <session.access_token>`.
- `/dashboard` — **"Today" view**: progress ring (% of active-goals' quests completed), Daily/Weekly toggle (`type='daily' AND due_date=today` vs all `type='weekly'`), grouped by goal, checkbox-driven completion. Only shows quests still actionable (`!completed && !expired_at`) — completed ones don't appear here at all, by design.
- `/quest-board` — **full goal/quest browser and management page** (this is what the original dashboard used to be before the "Today" redesign — moved here intact, not rebuilt from scratch): Active/Inactive goal tabs, goal cards with 🔥 streak badges, bulk "delete all inactive goals", click a card to expand into a detail panel with its own Active/Completed quest sub-tab, per-type (intro/daily/weekly) colored sections, and the goal management actions (mark complete, abandon, delete, "remake plan" = regenerate intro+day1+week1 quests).
- `/api/goals` (POST) — creates a goal + its starting quests (intro, day 1 daily, week 1 weekly).
- `/api/goals/[id]/regenerate` (POST) — "remake plan": regenerates the same starting set, generating via Claude *before* deleting old quests (so a failed Claude call never leaves a goal with zero quests).
- `/api/cron/refresh-quests` (GET) — see above.

## Server/auth pattern for API routes

No `@supabase/ssr`, no cookies, no service role key for normal routes. The client sends its Supabase access token as `Authorization: Bearer <token>`; the route calls `createSupabaseForToken(token)` (in `app/lib/supabase.js`) to get a client scoped to that user, then `supabase.auth.getUser()` to verify + get the user id. Every query made with that client respects RLS as that user. Only the cron route uses `createServiceRoleClient()` instead, since it has no per-user token to act under.

## Completing a quest

Client code **never** writes to `quests.completed` or `profiles.total_xp` directly — both dashboard pages call `supabase.rpc('complete_quest', { p_quest_id })`. That's a `SECURITY DEFINER` Postgres function (SQL in this conversation's history — not yet saved to a migrations file in the repo) that atomically verifies ownership, rejects already-completed/expired quests, sets `completed`/`completed_at`, and bumps `profiles.total_xp` by exactly that quest's own `xp_reward`. This exists specifically so a client can't set its own XP to an arbitrary value via a raw table update.

**Gotcha already hit once**: a `plpgsql` function with `RETURNS TABLE (..., total_xp integer)` creates an implicit OUT variable named `total_xp`, which collides with the real `profiles.total_xp` *column* referenced inside the function body ("column reference is ambiguous"). Fix was renaming the OUT column (e.g. `new_total_xp`), not the column itself.

## Streaks

`computeStreak()` in `app/lib/quests.js` groups quests by `due_date` first (so duplicate rows on one date — e.g. from clicking "Remake plan" — count as one cycle, not one increment per row), then walks dates descending, counting consecutive completed cycles and stopping at the first expired-and-not-completed one. Shown as 🔥 badges on goal cards in Quest Board. Only computed for `daily`/`weekly` (repeating) — not `intro`.

## Known environment gotchas hit during this build (Windows + Git Bash)

- `.env.local` uses CRLF line endings — a naive `split('\n')` parser leaves stray `\r` that silently breaks `$`-anchored regexes. Not an issue for Next.js's own env loader, only matters if writing an ad hoc script to read it.
- In PowerShell, `curl` is aliased to `Invoke-WebRequest` and doesn't understand `-H` the way real curl does — use `curl.exe` explicitly, or switch the terminal to Git Bash.
- The user works in Git Bash (`MINGW64`) most of the time, not PowerShell, despite VS Code's Windows default.

## Not yet done / open threads

- **Vercel deployment** — code and `vercel.json` are ready; the actual `vercel login` / `vercel env add` / `vercel --prod` sequence hasn't been run yet.
- **No un-complete action** — once a quest is checked off there's no way to undo it from the UI (would need to reverse the XP too).
- **`quest_generation_time`** — collected in the form, stored, but not functionally wired to anything (see Cron section).
- One test goal may still have leftover pre-redesign quest data if the earlier stale-data cleanup wasn't run on every goal — check via `select id, type, due_date, completed from quests where goal_id = '...' order by type, due_date` if a goal's quest counts look too high.
- The `complete_quest` SQL function and the `handle_new_user` trigger exist live in the Supabase project but are **not saved anywhere in this repo** (no `supabase/migrations` directory exists yet) — if this project is ever cloned fresh or the DB is reset, both need to be recreated manually. Worth adding a `supabase/migrations/` folder with the accumulated SQL from this whole build if that's a real risk.

## Conventions

- Dark theme throughout: `bg-black text-white`, cards as `border border-gray-800 rounded-lg`, primary buttons `bg-white text-black`, secondary actions as `text-gray-400 hover:text-white underline`, destructive actions `text-red-400 hover:text-red-300`.
- Every destructive or state-changing goal action (delete, abandon, mark complete, remake plan, bulk-delete-inactive) confirms via `window.confirm(...)` first.
- Type-based color coding (intro=purple, daily=blue, weekly=amber) is centralized in `app/lib/quests.js` as `QUEST_TYPE_STYLES` — literal Tailwind class strings (not template-string-constructed), required for Tailwind's JIT compiler to not purge them.
