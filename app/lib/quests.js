// Shared, client-safe quest presentation logic used by both the dashboard
// (today's daily/weekly view) and the quest board (full goal/quest browser).

// Distinct color + XP identity per quest type. Kept as literal Tailwind
// classes (not built from a template string) so the JIT compiler can see
// and keep them - a dynamically-constructed class name would get purged.
export const QUEST_TYPE_STYLES = {
  intro: {
    label: 'Introductory quests',
    hint: 'One-time - stay on the board until done',
    card: 'border-purple-900 bg-purple-950/30',
    badge: 'bg-purple-500/20 text-purple-300',
  },
  daily: {
    label: 'Daily quests',
    hint: 'Refreshes every day',
    card: 'border-blue-900 bg-blue-950/30',
    badge: 'bg-blue-500/20 text-blue-300',
  },
  weekly: {
    label: 'Weekly quests',
    hint: 'Refreshes every week',
    card: 'border-amber-900 bg-amber-950/30',
    badge: 'bg-amber-500/20 text-amber-300',
  },
}

// Consecutive completed cycles counting back from the most recent resolved
// one. A cycle still pending (e.g. today's daily quest, not yet completed or
// expired) is skipped rather than breaking the streak; the first expired,
// not-completed cycle stops the count.
//
// Quests are grouped by due_date first so multiple rows sharing one date
// (e.g. "Remake plan" regenerating today's quest, or leftover duplicates)
// count as a single cycle instead of one increment per row.
export function computeStreak(quests) {
  const byDate = new Map()
  for (const q of quests) {
    if (!q.due_date) continue
    const entry = byDate.get(q.due_date) || { completed: false, resolved: false }
    entry.completed = entry.completed || q.completed
    entry.resolved = entry.resolved || q.completed || !!q.expired_at
    byDate.set(q.due_date, entry)
  }

  const datesDesc = [...byDate.keys()].sort((a, b) => new Date(b) - new Date(a))
  let streak = 0
  for (const date of datesDesc) {
    const entry = byDate.get(date)
    if (!entry.resolved) continue // still open, doesn't count either way
    if (entry.completed) {
      streak++
    } else {
      break // expired without completing - streak ends here
    }
  }
  return streak
}

// Today's date as YYYY-MM-DD in UTC, matching how due_date is stored
// everywhere else (goal creation, the cron job) - using local browser time
// here would drift from the server's day boundary near midnight.
export function todayUTCString() {
  return new Date().toISOString().slice(0, 10)
}
