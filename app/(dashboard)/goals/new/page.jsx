'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useRouter } from 'next/navigation'

export default function NewGoal() {
  const router = useRouter()
  const [checkingAuth, setCheckingAuth] = useState(true)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [skillLevel, setSkillLevel] = useState('beginner')
  const [timeframeDays, setTimeframeDays] = useState('30')
  const [hoursPerDay, setHoursPerDay] = useState('1')
  const [questGenerationTime, setQuestGenerationTime] = useState('09:00')

  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }
      setCheckingAuth(false)
    }
    getUser()
  }, [router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.push('/login')
      return
    }

    const res = await fetch('/api/goals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        title,
        description,
        skill_level: skillLevel,
        timeframe_days: Number(timeframeDays),
        hours_per_day: Number(hoursPerDay),
        quest_generation_time: questGenerationTime,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error || 'Something went wrong')
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  if (checkingAuth) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8">

        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold">Set a new goal</h1>
          <p className="text-gray-400">We'll turn it into a quest plan</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-gray-400">Goal title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white"
              placeholder="Learn to play guitar"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={3}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white resize-none"
              placeholder="What does success look like?"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">Skill level</label>
            <select
              value={skillLevel}
              onChange={(e) => setSkillLevel(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white"
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Timeframe (days)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={timeframeDays}
                onChange={(e) => setTimeframeDays(e.target.value)}
                required
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm text-gray-400">Hours/day</label>
              <input
                type="number"
                min="1"
                step="1"
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(e.target.value)}
                required
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-gray-400">Daily quest reminder time</label>
            <input
              type="time"
              value={questGenerationTime}
              onChange={(e) => setQuestGenerationTime(e.target.value)}
              required
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-white"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {loading ? 'Generating your quest plan...' : 'Create goal'}
          </button>
        </form>

      </div>
    </main>
  )
}
