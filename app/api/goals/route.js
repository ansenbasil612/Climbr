import { NextResponse } from 'next/server'
import { createSupabaseForToken } from '../../lib/supabase'
import { generateIntroQuests, generateDailyQuest, generateWeeklyQuest, introQuestRows, cycleQuestRow } from '../../lib/questPlan'

export async function POST(request) {
  // --- Auth: the client sends its Supabase access token (session lives in
  // the browser, not cookies), we use it to act as that user under RLS. ---
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 })
  }

  const supabase = createSupabaseForToken(token)
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 })
  }

  // --- Parse + validate the goal form data ---
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { title, description, skill_level, timeframe_days, hours_per_day, quest_generation_time } = body

  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!description || typeof description !== 'string') {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }
  if (!skill_level || typeof skill_level !== 'string') {
    return NextResponse.json({ error: 'skill_level is required' }, { status: 400 })
  }
  if (!quest_generation_time || typeof quest_generation_time !== 'string') {
    return NextResponse.json({ error: 'quest_generation_time is required' }, { status: 400 })
  }

  const timeframeDays = Number(timeframe_days)
  if (!Number.isInteger(timeframeDays) || timeframeDays <= 0) {
    return NextResponse.json({ error: 'timeframe_days must be a positive integer' }, { status: 400 })
  }

  const hoursPerDay = Number(hours_per_day)
  if (!Number.isInteger(hoursPerDay) || hoursPerDay <= 0) {
    return NextResponse.json({ error: 'hours_per_day must be a positive whole number' }, { status: 400 })
  }

  // --- Save the goal ---
  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .insert({
      user_id: user.id,
      title,
      description,
      skill_level,
      timeframe_days: timeframeDays,
      hours_per_day: hoursPerDay,
      quest_generation_time,
      status: 'active',
    })
    .select()
    .single()

  if (goalError) {
    return NextResponse.json({ error: `Failed to save goal: ${goalError.message}` }, { status: 500 })
  }

  // --- Generate the starting quests with Claude: intro quests, day 1's
  // daily quest, and week 1's weekly quest. Everything after this comes
  // from the daily cron job (app/api/cron/refresh-quests). ---
  const today = new Date()
  const weekOneEnd = new Date(today)
  weekOneEnd.setDate(weekOneEnd.getDate() + Math.min(6, timeframeDays - 1))

  let introQuests, dailyQuest, weeklyQuest
  try {
    ;[introQuests, dailyQuest, weeklyQuest] = await Promise.all([
      generateIntroQuests({ title, description, skillLevel: skill_level, hoursPerDay }),
      generateDailyQuest({ title, description, skillLevel: skill_level, hoursPerDay, dayNumber: 1 }),
      generateWeeklyQuest({ title, description, skillLevel: skill_level, hoursPerDay, weekNumber: 1 }),
    ])
  } catch (err) {
    // Don't leave an orphaned goal with no quests behind.
    await supabase.from('goals').delete().eq('id', goal.id)
    return NextResponse.json({ error: `Failed to generate quest plan: ${err.message}` }, { status: 502 })
  }

  const rows = [
    ...introQuestRows({ quests: introQuests, goalId: goal.id, userId: user.id }),
    cycleQuestRow({ quest: dailyQuest, type: 'daily', goalId: goal.id, userId: user.id, dueDate: today }),
    cycleQuestRow({ quest: weeklyQuest, type: 'weekly', goalId: goal.id, userId: user.id, dueDate: weekOneEnd }),
  ]

  const { data: savedQuests, error: questsError } = await supabase.from('quests').insert(rows).select()

  if (questsError) {
    await supabase.from('goals').delete().eq('id', goal.id)
    return NextResponse.json({ error: `Failed to save quests: ${questsError.message}` }, { status: 500 })
  }

  return NextResponse.json({ goal, quests: savedQuests }, { status: 201 })
}
