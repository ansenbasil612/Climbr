import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '../../../lib/supabase'
import { generateDailyQuest, generateWeeklyQuest, cycleQuestRow } from '../../../lib/questPlan'

// Runs once daily via Vercel Cron (see vercel.json). Vercel automatically
// sends `Authorization: Bearer ${CRON_SECRET}` when it invokes a cron path,
// as long as CRON_SECRET is set as an env var on the project - we just check
// it matches so nobody else can trigger this (it holds a service-role client
// that bypasses RLS for every user).
export async function GET(request) {
  const authHeader = request.headers.get('authorization') || ''
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  const { data: goals, error: goalsError } = await supabase.from('goals').select('*').eq('status', 'active')

  if (goalsError) {
    return NextResponse.json({ error: `Failed to load active goals: ${goalsError.message}` }, { status: 500 })
  }

  const results = []

  for (const goal of goals) {
    try {
      results.push({ goal_id: goal.id, ...(await refreshGoal(supabase, goal)) })
    } catch (err) {
      // One goal's Claude/DB failure shouldn't block the rest of the run.
      results.push({ goal_id: goal.id, error: err.message })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}

async function refreshGoal(supabase, goal) {
  const today = startOfUTCDay(new Date())
  const createdAt = startOfUTCDay(new Date(goal.created_at))
  const daysSinceCreated = Math.round((today - createdAt) / 86400000)
  const todayStr = toDateString(today)

  const summary = { daily: 'unchanged', weekly: 'unchanged', intro_missed: 0 }

  // --- Mark yesterday-or-earlier incomplete daily quests as expired ---
  await supabase
    .from('quests')
    .update({ expired_at: new Date().toISOString() })
    .eq('goal_id', goal.id)
    .eq('type', 'daily')
    .eq('completed', false)
    .is('expired_at', null)
    .lt('due_date', todayStr)

  // --- Generate today's daily quest if it doesn't exist yet ---
  const { data: existingDaily } = await supabase
    .from('quests')
    .select('id')
    .eq('goal_id', goal.id)
    .eq('type', 'daily')
    .eq('due_date', todayStr)
    .limit(1)

  if (!existingDaily || existingDaily.length === 0) {
    const dailyQuest = await generateDailyQuest({
      title: goal.title,
      description: goal.description,
      skillLevel: goal.skill_level,
      hoursPerDay: goal.hours_per_day,
      dayNumber: daysSinceCreated + 1,
    })
    const { error } = await supabase
      .from('quests')
      .insert(cycleQuestRow({ quest: dailyQuest, type: 'daily', goalId: goal.id, userId: goal.user_id, dueDate: today }))
    if (error) throw new Error(`daily insert: ${error.message}`)
    summary.daily = 'generated'
  }

  // --- Weekly: only act on 7-day boundaries within the goal's timeframe ---
  if (daysSinceCreated > 0 && daysSinceCreated % 7 === 0 && daysSinceCreated < goal.timeframe_days) {
    await supabase
      .from('quests')
      .update({ expired_at: new Date().toISOString() })
      .eq('goal_id', goal.id)
      .eq('type', 'weekly')
      .eq('completed', false)
      .is('expired_at', null)
      .lt('due_date', todayStr)

    const weekEnd = new Date(today)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + Math.min(6, goal.timeframe_days - 1 - daysSinceCreated))
    const weekEndStr = toDateString(weekEnd)

    const { data: existingWeekly } = await supabase
      .from('quests')
      .select('id')
      .eq('goal_id', goal.id)
      .eq('type', 'weekly')
      .eq('due_date', weekEndStr)
      .limit(1)

    if (!existingWeekly || existingWeekly.length === 0) {
      const weeklyQuest = await generateWeeklyQuest({
        title: goal.title,
        description: goal.description,
        skillLevel: goal.skill_level,
        hoursPerDay: goal.hours_per_day,
        weekNumber: Math.floor(daysSinceCreated / 7) + 1,
      })
      const { error } = await supabase
        .from('quests')
        .insert(cycleQuestRow({ quest: weeklyQuest, type: 'weekly', goalId: goal.id, userId: goal.user_id, dueDate: weekEnd }))
      if (error) throw new Error(`weekly insert: ${error.message}`)
      summary.weekly = 'generated'
    }
  }

  // --- Flag stale incomplete intro quests as "missed" (non-terminal - still completable) ---
  if (daysSinceCreated >= 1) {
    const { data: missedIntros } = await supabase
      .from('quests')
      .update({ missed_at: new Date().toISOString() })
      .eq('goal_id', goal.id)
      .eq('type', 'intro')
      .eq('completed', false)
      .is('missed_at', null)
      .select('id')
    summary.intro_missed = missedIntros?.length || 0
  }

  return summary
}

function startOfUTCDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function toDateString(date) {
  return date.toISOString().slice(0, 10)
}
