'use client'

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function SignUp() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [username, setUsername] = useState('')
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)

    const handleSignUp = async (e) => {
  e.preventDefault()
  setLoading(true)
  setError(null)

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  })

  if (error) {
    setError(error.message)
    setLoading(false)
    return
  }

  router.push('/dashboard')
}

    return (
        <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
            <div className="max-w-md w-full space-y-8">

                <div className="text-center space-y-2">
                    <h1 className="text-4xl font-bold">Create your account</h1>
                    <p className="text-gray-400">Start your journey today</p>
                </div>

                <form onSubmit={handleSignUp} className="space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm text-gray-400">Username</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white"
                            placeholder="yourname"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white"
                            placeholder="you@example.com"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm text-gray-400">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-white"
                            placeholder="••••••••"
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
                        {loading ? 'Creating account...' : 'Get Started'}
                    </button>
                </form>

                <p className="text-center text-gray-400 text-sm">
                    Already have an account?{' '}
                    <Link href="/login" className="text-white underline">
                        Log in
                    </Link>
                </p>

            </div>
        </main>
    )
}