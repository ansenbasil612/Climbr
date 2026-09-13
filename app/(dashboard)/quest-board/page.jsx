'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { QUEST_TYPE_STYLES, computeStreak } from '../../lib/quests'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function QuestBoard() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [goals, setGoals] = useState([])
  const [questsByGoal, setQuestsByGoal] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(null) // goal id currently being acted on
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [questActionLoading, setQuestActionLoading] = useState(null) // quest id currently being completed
  const [activeTab, setActiveTab] = useState('active') // 'active' | 'inactive' - goal status
  const [selectedGoalId, setSelectedGoalId] = useState(null)
  const [totalXp, setTotalXp] = useState(0)

  const refresh = async (userId) => {
    const [
      { data: goalsData, error: goalsError },
      { data: questsData, error: questsError },
      { data: profileData, error: profileError },
    ] = await Promise.all([
      supabase
        .from('goals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('quests')
        .select('*')
        .eq('user_id', userId)
        .order('due_date', { ascending: true }),
      supabase.from('profiles').select('total_xp').eq('id', userId).single(),
    ])

    if (goalsError || questsError || profileError) {
      setError((goalsError || questsError || profileError).message)
      return
    }

    const grouped = {}
    for (const quest of questsData) {
      if (!grouped[quest.goal_id]) grouped[quest.goal_id] = []
      grouped[quest.goal_id].push(quest)
    }

    setError(null)
    setGoals(goalsData)
    setQuestsByGoal(grouped)
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

  const handleSelectTab = (tab) => {
    setActiveTab(tab)
    setSelectedGoalId(null)
  }

  const handleSetStatus = async (goalId, status) => {
    const confirmMessage =
      status === 'completed'
        ? 'Mark this goal as complete?'
        : 'Abandon this goal? It will move to your Inactive tab.'
    if (!window.confirm(confirmMessage)) return

    setActionLoading(goalId)
    const { error } = await supabase.from('goals').update({ status }).eq('id', goalId).eq('user_id', user.id)
    if (error) {
      alert(`Failed to update goal: ${error.message}`)
    } else {
      await refresh(user.id)
    }
    setActionLoading(null)
  }

  const handleDeleteGoal = async (goalId) => {
    if (!window.confirm('Delete this goal and all its quests? This cannot be undone.')) return

    setActionLoading(goalId)

    // Delete quests first so this can't fail on a foreign key from goals -> quests.
    const { error: questsDeleteError } = await supabase.from('quests').delete().eq('goal_id', goalId)
    if (questsDeleteError) {
      alert(`Failed to delete quests: ${questsDeleteError.message}`)
      setActionLoading(null)
      return
    }

    const { error: goalDeleteError } = await supabase.from('goals').delete().eq('id', goalId).eq('user_id', user.id)
    if (goalDeleteError) {
      alert(`Failed to delete goal: ${goalDeleteError.message}`)
      setActionLoading(null)
      return
    }

    setSelectedGoalId((current) => (current === goalId ? null : current))
    await refresh(user.id)
    setActionLoading(null)
  }

  const handleDeleteAllInactive = async (inactiveGoalIds) => {
    if (inactiveGoalIds.length === 0) return
    if (!window.confirm(`Delete all ${inactiveGoalIds.length} inactive goal${inactiveGoalIds.length === 1 ? '' : 's'} and their quests? This cannot be undone.`)) {
      return
    }

    setBulkDeleting(true)

    const { error: questsDeleteError } = await supabase.from('quests').delete().in('goal_id', inactiveGoalIds)
    if (questsDeleteError) {
      alert(`Failed to delete quests: ${questsDeleteError.message}`)
      setBulkDeleting(false)
      return
    }

    const { error: goalsDeleteError } = await supabase
      .from('goals')
      .delete()
      .in('id', inactiveGoalIds)
      .eq('user_id', user.id)
    if (goalsDeleteError) {
      alert(`Failed to delete goals: ${goalsDeleteError.message}`)
      setBulkDeleting(false)
      return
    }

    setSelectedGoalId((current) => (inactiveGoalIds.includes(current) ? null : current))
    await refresh(user.id)
    setBulkDeleting(false)
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

  const handleRegenerate = async (goalId) => {
    if (!window.confirm('Remake the quest plan? This replaces all current quests for this goal, including any progress on them.')) return

    setActionLoading(goalId)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }

    const res = await fetch(`/api/goals/${goalId}/regenerate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await res.json()

    if (!res.ok) {
      alert(`Failed to remake quest plan: ${data.error}`)
      setActionLoading(null)
      return
    }

    await refresh(user.id)
    setActionLoading(null)
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    )
  }

  const activeGoals = goals.filter((g) => g.status === 'active')
  const inactiveGoals = goals.filter((g) => g.status !== 'active')
  const visibleGoals = activeTab === 'active' ? activeGoals : inactiveGoals
  const selectedGoal = visibleGoals.find((g) => g.id === selectedGoalId) || null

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Your Quest Board</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold bg-gray-900 border border-gray-700 rounded-full px-4 py-1.5">
              ⭐ {totalXp} XP
            </span>
            <Link href="/dashboard" className="text-gray-400 hover:text-white text-sm transition-colors">
              Today
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

        {!error && goals.length === 0 && (
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

        {goals.length > 0 && (
          <div className="space-y-6">
            <div className="flex gap-2 border-b border-gray-800">
              <button
                onClick={() => handleSelectTab('active')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === 'active'
                    ? 'border-white text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Active ({activeGoals.length})
              </button>
              <button
                onClick={() => handleSelectTab('inactive')}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === 'inactive'
                    ? 'border-white text-white'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Inactive ({inactiveGoals.length})
              </button>
            </div>

            {visibleGoals.length === 0 && (
              <p className="text-gray-500 text-sm">
                {activeTab === 'active' ? 'No active goals.' : 'No completed or abandoned goals.'}
              </p>
            )}

            {activeTab === 'inactive' && inactiveGoals.length > 0 && (
              <button
                onClick={() => handleDeleteAllInactive(inactiveGoals.map((g) => g.id))}
                disabled={bulkDeleting}
                className="text-red-400 hover:text-red-300 underline text-sm disabled:opacity-50"
              >
                {bulkDeleting ? 'Deleting...' : `Delete all inactive goals (${inactiveGoals.length})`}
              </button>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {visibleGoals.map((goal) => {
                const isSelected = goal.id === selectedGoalId
                const goalQuests = questsByGoal[goal.id] || []
                const dailyStreak = computeStreak(goalQuests.filter((q) => q.type === 'daily'))
                const weeklyStreak = computeStreak(goalQuests.filter((q) => q.type === 'weekly'))

                return (
                  <button
                    key={goal.id}
                    onClick={() => setSelectedGoalId(isSelected ? null : goal.id)}
                    className={`text-left border rounded-lg p-6 transition-colors ${
                      isSelected
                        ? 'border-white bg-gray-900'
                        : 'border-gray-800 hover:border-gray-600'
                    }`}
                  >
                    <p className="text-lg font-semibold truncate">{goal.title}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-400 border border-gray-700 rounded-full px-3 py-1 uppercase tracking-wide">
                        {goal.status}
                      </span>
                      {dailyStreak > 0 && (
                        <span className="text-xs text-orange-400 border border-orange-900 bg-orange-950/30 rounded-full px-3 py-1">
                          🔥 {dailyStreak}d
                        </span>
                      )}
                      {weeklyStreak > 0 && (
                        <span className="text-xs text-orange-400 border border-orange-900 bg-orange-950/30 rounded-full px-3 py-1">
                          🔥 {weeklyStreak}w
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>

            {selectedGoal && (
              <GoalDetail
                key={selectedGoal.id}
                goal={selectedGoal}
                quests={questsByGoal[selectedGoal.id] || []}
                isBusy={actionLoading === selectedGoal.id}
                questActionLoading={questActionLoading}
                onSetStatus={handleSetStatus}
                onRegenerate={handleRegenerate}
                onDelete={handleDeleteGoal}
                onCompleteQuest={handleCompleteQuest}
              />
            )}

            <Link
              href="/goals/new"
              className="inline-block text-gray-400 hover:text-white text-sm underline"
            >
              + Set another goal
            </Link>
          </div>
        )}
      </div>
    </main>
  )
}

function GoalDetail({ goal, quests, isBusy, questActionLoading, onSetStatus, onRegenerate, onDelete, onCompleteQuest }) {
  const [subTab, setSubTab] = useState('active') // 'active' | 'completed'

  const activeQuests = quests.filter((q) => !q.completed)
  const completedQuests = quests.filter((q) => q.completed)
  const visibleQuests = subTab === 'active' ? activeQuests : completedQuests

  const intro = visibleQuests.filter((q) => q.type === 'intro')
  const daily = visibleQuests.filter((q) => q.type === 'daily')
  const weekly = visibleQuests.filter((q) => q.type === 'weekly')

  return (
    <div className="border border-gray-800 rounded-lg p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{goal.title}</h2>
          {goal.description && (
            <p className="text-gray-400 text-sm mt-1">{goal.description}</p>
          )}
        </div>
        <span className="text-xs text-gray-400 border border-gray-700 rounded-full px-3 py-1 uppercase tracking-wide whitespace-nowrap">
          {goal.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {goal.status !== 'completed' && (
          <button
            onClick={() => onSetStatus(goal.id, 'completed')}
            disabled={isBusy}
            className="text-gray-400 hover:text-white underline disabled:opacity-50"
          >
            Mark complete
          </button>
        )}
        {goal.status !== 'abandoned' && (
          <button
            onClick={() => onSetStatus(goal.id, 'abandoned')}
            disabled={isBusy}
            className="text-gray-400 hover:text-white underline disabled:opacity-50"
          >
            Abandon
          </button>
        )}
        <button
          onClick={() => onRegenerate(goal.id)}
          disabled={isBusy}
          className="text-gray-400 hover:text-white underline disabled:opacity-50"
        >
          {isBusy ? 'Working...' : 'Remake plan'}
        </button>
        <button
          onClick={() => onDelete(goal.id)}
          disabled={isBusy}
          className="text-red-400 hover:text-red-300 underline disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      {quests.length === 0 ? (
        <p className="text-gray-500 text-sm">No quests generated for this goal yet.</p>
      ) : (
        <>
          <div className="flex gap-2 border-b border-gray-800">
            <button
              onClick={() => setSubTab('active')}
              className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                subTab === 'active'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              Active ({activeQuests.length})
            </button>
            <button
              onClick={() => setSubTab('completed')}
              className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                subTab === 'completed'
                  ? 'border-white text-white'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              Completed ({completedQuests.length})
            </button>
          </div>

          <div className="space-y-4">
            <QuestList type="intro" quests={intro} subTab={subTab} questActionLoading={questActionLoading} onCompleteQuest={onCompleteQuest} />
            <QuestList type="daily" quests={daily} subTab={subTab} questActionLoading={questActionLoading} onCompleteQuest={onCompleteQuest} />
            <QuestList type="weekly" quests={weekly} subTab={subTab} questActionLoading={questActionLoading} onCompleteQuest={onCompleteQuest} />
          </div>
        </>
      )}
    </div>
  )
}

function QuestList({ type, quests, subTab, questActionLoading, onCompleteQuest }) {
  const style = QUEST_TYPE_STYLES[type]

  if (quests.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm text-gray-400 uppercase tracking-wide">
          {style.label} <span className="normal-case text-gray-600">- {style.hint}</span>
        </h3>
        <p className="text-gray-500 text-sm">
          No {subTab} {type === 'intro' ? 'introductory' : type} quests.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm text-gray-400 uppercase tracking-wide">
        {style.label} <span className="normal-case text-gray-600">- {style.hint}</span>
      </h3>
      <ul className="space-y-2">
        {quests.map((quest) => {
          const canComplete = !quest.completed && !quest.expired_at
          const isBusy = questActionLoading === quest.id

          return (
            <li
              key={quest.id}
              className={`border rounded-lg p-3 flex items-start justify-between gap-3 ${style.card}`}
            >
              <div>
                <p className={quest.completed || quest.expired_at ? 'line-through text-gray-500' : 'text-white'}>
                  {quest.title}
                </p>
                {quest.description && (
                  <p className="text-gray-500 text-xs mt-1">{quest.description}</p>
                )}
                <QuestStatusLine quest={quest} />
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`text-xs rounded-full px-2 py-1 whitespace-nowrap ${style.badge}`}>
                  +{quest.xp_reward} XP
                </span>
                {canComplete && (
                  <button
                    onClick={() => onCompleteQuest(quest.id)}
                    disabled={isBusy}
                    className="text-xs text-gray-400 hover:text-white underline disabled:opacity-50 whitespace-nowrap"
                  >
                    {isBusy ? 'Working...' : 'Mark complete'}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function QuestStatusLine({ quest }) {
  if (quest.completed) {
    return <p className="text-xs text-green-400 mt-1">Completed</p>
  }
  if (quest.expired_at) {
    return <p className="text-xs text-gray-500 mt-1">Expired</p>
  }
  if (quest.missed_at) {
    return <p className="text-xs text-yellow-400 mt-1">Missed</p>
  }
  if (quest.due_date) {
    return <p className="text-gray-600 text-xs mt-1">Due {quest.due_date}</p>
  }
  return null
}
