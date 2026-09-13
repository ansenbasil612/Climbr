'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { QUEST_TYPE_STYLES, todayUTCString } from '../../lib/quests'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [goals, setGoals] = useState([])
  const [quests, setQuests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [questActionLoading, setQuestActionLoading] = useState(null)
  const [view, setView] = useState('daily') // 'daily' | 'weekly'
  const [totalXp, setTotalXp] = useState(0)

  const refresh = async (userId) => {
    const [
      { data: goalsData, error: goalsError },
      { data: questsData, error: questsError },
      { data: profileData, error: profileError },
    ] = await Promise.all([
      supabase.from('goals').select('*').eq('user_id', userId),
      supabase.from('quests').select('*').eq('user_id', userId),
      supabase.from('profiles').select('total_xp').eq('id', userId).single(),
    ])

    if (goalsError || questsError || profileError) {
      setError((goalsError || questsError || profileError).message)
      return
    }

    setError(null)
    setGoals(goalsData)
    setQuests(questsData)
    setTotalXp(profileData?.total_xp ?? 0)
  }

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setUser(user)
      await refresh(user.id)
      setLoading(false)
    }
    load()
  }, [router])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const handleCompleteQuest = async (questId) => {
    setQuestActionLoading(questId)
    const { error } = await supabase.rpc('complete_quest', { p_quest_id: questId })
    if (error) {
      alert(`Failed to complete quest: ${error.message}`)
    } else {
      await refresh(user.id)
    }
    setQuestActionLoading(null)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    )
  }

  const activeGoals = goals.filter((g) => g.status === 'active')
  const activeGoalIds = new Set(activeGoals.map((g) => g.id))
  const activeGoalQuests = quests.filter((q) => activeGoalIds.has(q.goal_id))

  const totalCount = activeGoalQuests.length
  const completedCount = activeGoalQuests.filter((q) => q.completed).length
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const today = todayUTCString()
  const dailyQuests = activeGoalQuests.filter((q) => q.type === 'daily' && q.due_date === today)
  const weeklyQuests = activeGoalQuests.filter((q) => q.type === 'weekly')
  const allQuestsForView = view === 'daily' ? dailyQuests : weeklyQuests
  // Only what's still actionable - completed and expired quests don't belong
  // on a "what's left to do" view. Completed ones live in the Quest Board's
  // Completed tab instead.
  const visibleQuests = allQuestsForView.filter((q) => !q.completed && !q.expired_at)

  const goalTitleById = Object.fromEntries(activeGoals.map((g) => [g.id, g.title]))
  const questsByGoal = {}
  for (const quest of visibleQuests) {
    if (!questsByGoal[quest.goal_id]) questsByGoal[quest.goal_id] = []
    questsByGoal[quest.goal_id].push(quest)
  }

  const style = QUEST_TYPE_STYLES[view]

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Today</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold bg-gray-900 border border-gray-700 rounded-full px-4 py-1.5">
              ⭐ {totalXp} XP
            </span>
            <Link href="/quest-board" className="text-gray-400 hover:text-white text-sm transition-colors">
              Quest Board
            </Link>
            <button
              onClick={handleSignOut}
              className="text-gray-400 hover:text-white text-sm transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>

        {error && (
          <p className="text-red-400 text-sm">Failed to load your goals: {error}</p>
        )}

        {!error && activeGoals.length === 0 && (
          <div className="border border-gray-800 rounded-lg p-8 text-center space-y-4">
            <p className="text-gray-400">You have no active goals yet.</p>
            <Link
              href="/goals/new"
              className="inline-block bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Create your first goal
            </Link>
          </div>
        )}

        {!error && activeGoals.length > 0 && (
          <div className="space-y-8">
            <ProgressRing percent={percent} completedCount={completedCount} totalCount={totalCount} />

            <div className="flex justify-center gap-2 border-b border-gray-800">
              <button
                onClick={() => setView('daily')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  view === 'daily'
                    ? 'border-white text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Daily
              </button>
              <button
                onClick={() => setView('weekly')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  view === 'weekly'
                    ? 'border-white text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Weekly
              </button>
            </div>

            {visibleQuests.length === 0 ? (
              <p className="text-gray-500 text-sm text-center">
                {allQuestsForView.length === 0
                  ? view === 'daily'
                    ? 'No daily quests due today.'
                    : 'No weekly quests right now.'
                  : `All ${view} quests completed! 🎉`}
              </p>
            ) : (
              <div className="space-y-6">
                {Object.entries(questsByGoal).map(([goalId, goalQuests]) => (
                  <div key={goalId} className="space-y-2">
                    <h2 className="text-sm text-gray-400 uppercase tracking-wide">{goalTitleById[goalId]}</h2>
                    <ul className="space-y-2">
                      {goalQuests.map((quest) => {
                        const isBusy = questActionLoading === quest.id
                        const canComplete = !quest.completed && !quest.expired_at

                        return (
                          <li
                            key={quest.id}
                            className={`border rounded-lg p-4 flex items-start gap-4 ${style.card}`}
                          >
                            <input
                              type="checkbox"
                              checked={quest.completed}
                              disabled={!canComplete || isBusy}
                              onChange={() => handleCompleteQuest(quest.id)}
                              className="mt-1 w-5 h-5 accent-white cursor-pointer disabled:cursor-not-allowed"
                            />
                            <div className="flex-1">
                              <p className={quest.completed || quest.expired_at ? 'line-through text-gray-500' : 'text-white font-medium'}>
                                {quest.title}
                              </p>
                              {quest.description && (
                                <p className="text-gray-500 text-sm mt-1">{quest.description}</p>
                              )}
                              {quest.expired_at && !quest.completed && (
                                <p className="text-xs text-gray-500 mt-1">Expired</p>
                              )}
                            </div>
                            <span className={`text-xs rounded-full px-2 py-1 whitespace-nowrap ${style.badge}`}>
                              +{quest.xp_reward} XP
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function ProgressRing({ percent, completedCount, totalCount }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-36 h-36">
        <svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-90">
          <circle cx="72" cy="72" r={radius} stroke="#1f2937" strokeWidth="12" fill="none" />
          <circle
            cx="72"
            cy="72"
            r={radius}
            stroke="#ffffff"
            strokeWidth="12"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold">{percent}%</span>
          <span className="text-xs text-gray-500">complete</span>
        </div>
      </div>
      <p className="text-sm text-gray-400">
        {completedCount} / {totalCount} quests across active goals
      </p>
    </div>
  )
}
