const BotInterface = require('../bot_interface')
const TaskQueue = require('../task_queue')
const { log, sleep } = require('../utils')
const { equipBestTool } = require('./inventory')
const { goToPositionSafe } = require('./navigation')

async function handleCombat(target) {
  const bot = BotInterface.getBot()
  if (!target) return
  
  log(`⚔️  Combat started with ${target.name}`)
  await equipBestTool('sword') || await equipBestTool('axe')
  
  while (target && target.isValid && target.health > 0) {
     if (bot.health < 8) {
       log('💔 Low health! Fleeing!')
       return await handleFlee(target)
     }
     
     const dist = bot.entity.position.distanceTo(target.position)
     if (dist > 3) {
       bot.lookAt(target.position.offset(0, target.height, 0))
       bot.setControlState('forward', true)
       bot.setControlState('sprint', true)
       bot.setControlState('jump', dist > 5) // Critical hit attempt
     } else {
       bot.setControlState('forward', false)
       bot.setControlState('sprint', false)
       bot.attack(target)
       await sleep(500) // Attack cooldown
     }
     
     await sleep(50)
  }
  
  bot.clearControlStates()
  log('⚔️  Combat finished')
}

async function handleFlee(threat) {
  const bot = BotInterface.getBot()
  log('🏃 Fleeing!')
  
  // Simple flee: run opposite to threat
  const threatPos = threat.position
  const myPos = bot.entity.position
  
  const fleeDir = myPos.minus(threatPos).normalize()
  const fleeTarget = myPos.plus(fleeDir.scaled(30))
  
  try {
    await goToPositionSafe(fleeTarget, 2)
    return 'fled'
  } catch (e) {
    return 'failed'
  }
}

module.exports = {
  handleCombat,
  handleFlee
}
