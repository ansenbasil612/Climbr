import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4">
      <div className="max-w-2xl w-full text-center space-y-8">
        
        <div className="space-y-4">
          <h1 className="text-6xl font-bold tracking-tight">
            Climbr
          </h1>
          <p className="text-xl text-gray-400">
            Turn your goals into quests. Level up your life.
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href="/signup"
            className="block w-full max-w-sm mx-auto bg-white text-black font-semibold py-3 px-6 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Get Started
          </Link>
          <Link
            href="/login"
            className="block w-full max-w-sm mx-auto border border-gray-700 text-white font-semibold py-3 px-6 rounded-lg hover:bg-gray-900 transition-colors"
          >
            Log In
          </Link>
        </div>

        <p className="text-gray-600 text-sm">
          Set a goal. Get a quest plan. Show up every day.
        </p>

      </div>
    </main>
  )
}