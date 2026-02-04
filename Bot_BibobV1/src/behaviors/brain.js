const BotInterface = require('../bot_interface')
const Memory = require('../memory')
const TaskQueue = require('../task_queue')
const CONFIG = require('../config')
const { log } = require('../utils')
const DecisionEngine = require('./decision_engine')

let lastSleepAttempt = 0

async function updateBrain() {
  const bot = BotInterface.getBot()
  if (!bot.entity) return

  // If executing a task, don't interrupt unless critical (DecisionEngine can handle priorities if we want)
  // For now, simple queue check
  if (TaskQueue.hasTasks() || TaskQueue.isExecuting) return

  try {
      const decision = await DecisionEngine.decideNextTask()
      
      if (decision) {
          log(`🧠 Brain decided: ${decision.type} (Priority: ${decision.priority})`)
          TaskQueue.add(decision)
      }
  } catch (e) {
      log(`🧠 Brain error: ${e.message}`)
  }
}

module.exports = {
  updateBrain
}
