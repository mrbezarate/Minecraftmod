const Memory = require('../memory')
const { log } = require('../utils')

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9)

const GoalManager = {
    // Goal Types
    GOAL_TYPES: {
        BUILD: 'build',
        GATHER: 'gather',
        CRAFT: 'craft',
        EXPLORE: 'explore',
        SURVIVE: 'survive',
        TRADE: 'trade'
    },

    init() {
        log('🎯 GoalManager initialized')
        // Restore goals from memory if needed (handled by Memory.load)
    },

    createGoal(type, params, priority = 50) {
        const id = generateId()
        const goal = {
            id,
            type,
            params, // e.g., { item: 'oak_log', count: 64 } or { structure: 'house_v1' }
            priority,
            status: 'pending', // pending, active, completed, failed
            subGoals: [],
            created: Date.now()
        }
        Memory.addGoal(goal)
        log(`🎯 New Goal Created: ${type} (ID: ${id})`)
        return goal
    },

    getGoals() {
        return Memory.getGoals()
    },

    getHighestPriorityGoal() {
        const goals = Memory.getGoals().filter(g => g.status !== 'completed' && g.status !== 'failed')
        if (goals.length === 0) return null
        
        return goals.sort((a, b) => b.priority - a.priority)[0]
    },

    async decomposeGoal(goal) {
        // Logic to break down complex goals
        // This acts as the "Planner"
        
        if (goal.subGoals.length > 0) return // Already decomposed
        
        log(`🤔 Decomposing goal: ${goal.type}`)

        switch (goal.type) {
            case this.GOAL_TYPES.CRAFT:
                // E.g. Craft Diamond Pickaxe
                // Subgoals: Gather Diamond (3), Gather Stick (2), Craft Table...
                break;
            
            case this.GOAL_TYPES.BUILD:
                // E.g. Build House
                // Subgoals: Clear Area, Gather Materials, Place Blocks
                break;
                
            // ... add more logic
        }
    },

    markGoalComplete(id) {
        Memory.updateGoal(id, { status: 'completed', completedAt: Date.now() })
        log(`✅ Goal Completed: ${id}`)
    }
}

module.exports = GoalManager
