const BotInterface = require('../bot_interface')
const Memory = require('../memory')
const GoalManager = require('./goal_manager')
const { log } = require('../utils')
const { countItem } = require('../actions/inventory')
const { handleCraft } = require('../actions/crafting')
const { handleMine } = require('../actions/mining')
const { handleSmelt } = require('../actions/smelting')
const { buildShelter } = require('../actions/building')
const { handleHunt, handleEat, handleSleep } = require('../actions/survival')
const { handleExplore } = require('../actions/navigation')

const PRIORITIES = {
    CRITICAL: 100,
    HIGH: 80,
    MEDIUM: 50,
    LOW: 20,
    IDLE: 0
}

const DecisionEngine = {
    async decideNextTask() {
        const bot = BotInterface.getBot()
        if (!bot || !bot.entity) return null

        // 1. SURVIVAL (Critical) - Immediate Threat Response
        // Health critical?
        if (bot.health < 10) {
            log('🧠 Decision: Health critical! Seeking food/safety.')
            if (bot.food < 20 && hasFood(bot)) {
                return {
                    type: 'eat',
                    priority: PRIORITIES.CRITICAL,
                    execute: async () => await handleEat()
                }
            }
            // TODO: Add flee/barricade logic
        }

        // Hunger critical?
        if (bot.food < 6) {
             log('🧠 Decision: Starving! Hunting/Eating.')
             if (hasFood(bot)) {
                 return {
                    type: 'eat',
                    priority: PRIORITIES.CRITICAL,
                    execute: async () => await handleEat()
                 }
             } else {
                 return {
                     type: 'hunt',
                     priority: PRIORITIES.CRITICAL,
                     execute: async () => await handleHunt()
                 }
             }
        }

        // Night time & dangerous?
        if (!bot.time.isDay && !Memory.data.hasShelter) {
            log('🧠 Decision: Night time and no shelter.')
            
            // Check materials for shelter
            const hasMaterials = countItem('cobblestone') >= 100 || countItem('oak_planks') >= 100
            
            if (hasMaterials) {
                 return {
                    type: 'build_shelter',
                    priority: PRIORITIES.HIGH,
                    execute: async () => {
                        const success = await buildShelter()
                        if (success) {
                            Memory.data.hasShelter = true
                            Memory.save()
                            Memory.setHome(bot.entity.position)
                        }
                    }
                }
            } else {
                 // No materials for full shelter.
                 // Emergency action: Dig hole or Gather if safe?
                 // Night gathering is dangerous.
                 // If we have pickaxe, maybe dig down 3 blocks and cover head?
                 
                 // For now, let's just create a goal to gather materials for TOMORROW
                 // And try to hide/survive tonight (e.g., stay near light or dig)
                 
                 // If no goal to gather cobble exists, add it
                 const existingGoal = GoalManager.getGoals().find(g => g.type === GoalManager.GOAL_TYPES.GATHER && g.params.item === 'cobblestone')
                 if (!existingGoal) {
                     log('🧠 Added goal: Gather Cobblestone for Shelter')
                     GoalManager.createGoal(GoalManager.GOAL_TYPES.GATHER, { item: 'cobblestone', count: 100 }, PRIORITIES.HIGH)
                 }
                 
                 return {
                     type: 'emergency_hide',
                     priority: PRIORITIES.HIGH,
                     execute: async () => {
                         log('⚠️ Emergency: Digging hole for safety...')
                         // TODO: Implement digHole() in survival.js
                         // For now, just wait/idle safely
                         await handleSleep() // Try sleep if possible, or just stand still
                     }
                 }
            }
        }
        
        // Night time & have bed?
        if (!bot.time.isDay && countItem('white_bed') > 0) {
             return {
                 type: 'sleep',
                 priority: PRIORITIES.HIGH,
                 execute: async () => await handleSleep()
             }
        }

        // 2. GOAL EXECUTION (High/Medium)
        // Check for active high-level goals
        const activeGoal = GoalManager.getHighestPriorityGoal()
        
        if (activeGoal) {
            log(`🧠 Pursuing Goal: ${activeGoal.type} (Priority: ${activeGoal.priority})`)
            
            // Decompose if needed
            if (activeGoal.subGoals.length === 0) {
                 await GoalManager.decomposeGoal(activeGoal)
            }
            
            // Execute next sub-goal
            // This needs to be robust. For now, we simulate execution of known types.
            // Ideally, GoalManager returns an executable task.
            
            // For MVP: If goal is 'gather_wood', we execute handleMine
            if (activeGoal.type === GoalManager.GOAL_TYPES.GATHER) {
                return {
                    type: 'gather_resource',
                    priority: activeGoal.priority,
                    execute: async () => {
                        const result = await handleMine(activeGoal.params.item, activeGoal.params.count)
                        if (result === 'done') {
                             GoalManager.markGoalComplete(activeGoal.id)
                        } else if (result === 'failed') {
                             // Resource not found nearby.
                             // Strategy: Add a high-priority "Explore" goal? 
                             // Or just explore once.
                             log(`⚠️ Could not find ${activeGoal.params.item}. Exploring...`)
                             await handleExplore()
                        }
                    }
                }
            }
            
            // Add more handlers here as we implement GoalManager decomposition
        }

        // 3. IDLE / MAINTENANCE (Fallback)
        // If no goals, create a default goal
        if (!activeGoal) {
            // Default: Gather Wood if low
            if (countItem('oak_log') < 10) {
                GoalManager.createGoal(GoalManager.GOAL_TYPES.GATHER, { item: 'oak_log', count: 10 }, PRIORITIES.MEDIUM)
                return null // Next tick will pick it up
            }
            
            // Default: Explore
            return {
                type: 'explore',
                priority: PRIORITIES.LOW,
                execute: async () => {
                    log('🧠 No active goals. Wandering...')
                    await handleExplore()
                }
            }
        }

        return null
    }
}

function hasFood(bot) {
    return bot.inventory.items().some(item => item.foodPoints > 0)
}

function getTotalFood(bot) {
    return bot.inventory.items().reduce((acc, item) => acc + (item.foodPoints ? item.count : 0), 0)
}

module.exports = DecisionEngine
