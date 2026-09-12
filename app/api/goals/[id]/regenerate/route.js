import { NextResponse } from 'next/server'
import { createSupabaseForToken } from '../../../../lib/supabase'
import { generateIntroQuests, generateDailyQuest, generateWeeklyQuest, introQuestRows, cycleQuestRow } from '../../../../lib/questPlan'

export async function POST(request, context) {
  const { id } = await context.params

  // --- Auth (same pattern as POST /api/goals) ---
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

  // --- Load the goal (RLS + explicit user_id check restrict this to rows the caller owns) ---
  const { data: goal, error: goalError } = await supabase
    .from('goals')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (goalError || !goal) {
    return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  }

  // --- Generate a fresh start (intro quests + day 1 + week 1) before
  // touching the existing quests, so a failed Claude call never leaves the
  // goal with no quests at all. ---
  const today = new Date()
  const weekOneEnd = new Date(today)
  weekOneEnd.setDate(weekOneEnd.getDate() + Math.min(6, goal.timeframe_days - 1))

  let introQuests, dailyQuest, weeklyQuest
  try {
    ;[introQuests, dailyQuest, weeklyQuest] = await Promise.all([
      generateIntroQuests({ title: goal.title, description: goal.description, skillLevel: goal.skill_level, hoursPerDay: goal.hours_per_day }),
      generateDailyQuest({ title: goal.title, description: goal.description, skillLevel: goal.skill_level, hoursPerDay: goal.hours_per_day, dayNumber: 1 }),
      generateWeeklyQuest({ title: goal.title, description: goal.description, skillLevel: goal.skill_level, hoursPerDay: goal.hours_per_day, weekNumber: 1 }),
    ])
  } catch (err) {
    return NextResponse.json({ error: `Failed to generate quest plan: ${err.message}` }, { status: 502 })
  }

  const { error: deleteError } = await supabase.from('quests').delete().eq('goal_id', goal.id)
  if (deleteError) {
    return NextResponse.json({ error: `Failed to clear old quests: ${deleteError.message}` }, { status: 500 })
  }

  const rows = [
    ...introQuestRows({ quests: introQuests, goalId: goal.id, userId: user.id }),
    cycleQuestRow({ quest: dailyQuest, type: 'daily', goalId: goal.id, userId: user.id, dueDate: today }),
    cycleQuestRow({ quest: weeklyQuest, type: 'weekly', goalId: goal.id, userId: user.id, dueDate: weekOneEnd }),
  ]

  const { data: savedQuests, error: questsError } = await supabase.from('quests').insert(rows).select()
  if (questsError) {
    return NextResponse.json({ error: `Failed to save new quests: ${questsError.message}` }, { status: 500 })
  }

  return NextResponse.json({ goal, quests: savedQuests }, { status: 200 })
}
