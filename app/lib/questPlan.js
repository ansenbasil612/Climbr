import { anthropic } from './anthropic'

const QUEST_MODEL = 'claude-sonnet-5'
const INTRO_QUEST_COUNT = 3

// XP ranges per quest type. Intro quests are one-time and foundational (worth
// more per quest since there are only a few); daily quests are frequent and
// small; weekly quests are milestone-sized.
export const XP_RANGES = {
  intro: [20, 50],
  daily: [5, 30],
  weekly: [50, 150],
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function xpFor(type, rawXp) {
  const [min, max] = XP_RANGES[type]
  return clamp(Math.round(rawXp), min, max)
}

function toDateString(date) {
  return date.toISOString().slice(0, 10)
}

// Claude occasionally violates its own tool schema by wrapping the array in a
// JSON string instead of returning it directly - e.g. `{ quests: "[...]" }`
// or even `{ quests: "{\"quests\":[...]}" }`. Unwrap those shapes instead of
// just failing on a technically-schema-noncompliant-but-recoverable response.
function coerceQuestArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed
      if (Array.isArray(parsed?.quests)) return parsed.quests
    } catch {
      return null
    }
  }
  return null
}

// --- Intro quests: generated once at goal creation, never regenerated. ---
export async function generateIntroQuests({ title, description, skillLevel, hoursPerDay }) {
  const tool = {
    name: 'generate_intro_quests',
    description: 'Return a short list of one-time introductory quests to kick off a new goal.',
    input_schema: {
      type: 'object',
      properties: {
        quests: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Short, action-oriented quest title' },
              description: { type: 'string', description: '1-2 sentence description of what to do' },
              xp_reward: { type: 'integer', minimum: XP_RANGES.intro[0], maximum: XP_RANGES.intro[1] },
            },
            required: ['title', 'description', 'xp_reward'],
          },
        },
      },
      required: ['quests'],
    },
  }

  const message = await anthropic.messages.create({
    model: QUEST_MODEL,
    max_tokens: 2048,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'generate_intro_quests' },
    messages: [
      {
        role: 'user',
        content: `Create exactly ${INTRO_QUEST_COUNT} one-time introductory quests for someone just starting this goal in a life-gamification app.

Goal: ${title}
Description: ${description}
Skill level: ${skillLevel}
Available time: ${hoursPerDay} hours/day

These quests happen once, before the daily/weekly grind starts - things like setting up equipment, doing a baseline assessment, planning a schedule, or removing a barrier to starting. Make them concrete and quick to finish. In an RPG-quest style, punchy and motivating.`,
      },
    ],
  })

  const toolUse = message.content.find((block) => block.type === 'tool_use')
  const quests = coerceQuestArray(toolUse?.input?.quests)
  if (!quests || quests.length === 0) {
    throw new Error('Claude did not return valid intro quests')
  }

  return quests.map((q) => ({
    title: q.title,
    description: q.description,
    xp_reward: xpFor('intro', q.xp_reward),
  }))
}

// --- A single daily or weekly quest, generated per refresh cycle. ---
async function generateSingleQuest({ type, title, description, skillLevel, hoursPerDay, cycleLabel }) {
  const tool = {
    name: 'generate_single_quest',
    description: `Return one ${type} quest for an ongoing goal.`,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, action-oriented quest title' },
        description: { type: 'string', description: '1-2 sentence description of what to do' },
        xp_reward: { type: 'integer', minimum: XP_RANGES[type][0], maximum: XP_RANGES[type][1] },
      },
      required: ['title', 'description', 'xp_reward'],
    },
  }

  const cadence = type === 'daily' ? 'a small, concrete action completable in one day' : 'a bigger milestone that builds toward the goal over a week'

  const message = await anthropic.messages.create({
    model: QUEST_MODEL,
    max_tokens: 1024,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'generate_single_quest' },
    messages: [
      {
        role: 'user',
        content: `Create one ${type} quest for this ongoing goal in a life-gamification app.

Goal: ${title}
Description: ${description}
Skill level: ${skillLevel}
Available time: ${hoursPerDay} hours/day
This quest is for: ${cycleLabel}

It should be ${cadence}. Make the title punchy and motivating, in an RPG-quest style. Don't repeat generic filler - make it feel specific to this goal.`,
      },
    ],
  })

  const toolUse = message.content.find((block) => block.type === 'tool_use')
  if (!toolUse || !toolUse.input?.title) {
    throw new Error(`Claude did not return a valid ${type} quest`)
  }

  return {
    title: toolUse.input.title,
    description: toolUse.input.description,
    xp_reward: xpFor(type, toolUse.input.xp_reward),
  }
}

export async function generateDailyQuest({ title, description, skillLevel, hoursPerDay, dayNumber }) {
  return generateSingleQuest({
    type: 'daily',
    title,
    description,
    skillLevel,
    hoursPerDay,
    cycleLabel: `day ${dayNumber}`,
  })
}

export async function generateWeeklyQuest({ title, description, skillLevel, hoursPerDay, weekNumber }) {
  return generateSingleQuest({
    type: 'weekly',
    title,
    description,
    skillLevel,
    hoursPerDay,
    cycleLabel: `week ${weekNumber}`,
  })
}

// --- Row builders for the `quests` table ---
export function introQuestRows({ quests, goalId, userId }) {
  return quests.map((q) => ({
    goal_id: goalId,
    user_id: userId,
    title: q.title,
    description: q.description,
    type: 'intro',
    xp_reward: q.xp_reward,
    due_date: null,
    completed: false,
    completed_at: null,
    missed_at: null,
    expired_at: null,
  }))
}

export function cycleQuestRow({ quest, type, goalId, userId, dueDate }) {
  return {
    goal_id: goalId,
    user_id: userId,
    title: quest.title,
    description: quest.description,
    type,
    xp_reward: quest.xp_reward,
    due_date: toDateString(dueDate),
    completed: false,
    completed_at: null,
    missed_at: null,
    expired_at: null,
  }
}
