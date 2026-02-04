const { goals: { GoalNear } } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const BotInterface = require('../bot_interface')
const Memory = require('../memory')
const TaskQueue = require('../task_queue')
const { log, sleep } = require('../utils')
const CONFIG = require('../config')

let activeNavigationListeners = new Map()

async function handleGo(position, range = 2) {
  const bot = BotInterface.getBot()
  const dist = bot.entity.position.distanceTo(position)
  log(`🚶 Going to ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)} (dist: ${dist.toFixed(1)})`)
  
  if (TaskQueue.interruptFlag) {
    log('⚠️  Movement interrupted')
    return 'interrupted'
  }
  
  try {
    await goToPositionSafe(position, range, 20000)
    log(`✅ Reached target`)
    return 'done'
  } catch (e) {
    if (TaskQueue.interruptFlag) {
      log('⚠️  Movement interrupted')
      return 'interrupted'
    }
    if (e.message && e.message.includes('timeout')) {
      const currentPos = bot.entity.position
      const dist = currentPos.distanceTo(position)
      if (dist <= range * 3) {
        log(`✅ Close enough (${dist.toFixed(1)})`)
        return 'done'
      }
    }
    log(`❌ Movement error: ${e.message}`)
    return 'failed'
  }
}

async function goToPositionSafe(targetPos, range = 2, timeout = 20000) {
  const bot = BotInterface.getBot()
  if (!bot.entity) return
  
  if (TaskQueue.interruptFlag) {
    throw new Error('interrupted')
  }
  
  const startPos = bot.entity.position
  const dist = startPos.distanceTo(targetPos)
  
  // If close, go directly
  if (dist < 5) {
    return await goToPosition(targetPos, range, Math.min(timeout, 10000))
  }
  
  // Check for dangerous path
  const path = calculateSafePath(startPos, targetPos)
  
  if (path.length === 0) {
    return await goToPosition(targetPos, range, timeout)
  }
  
  // Use waypoints
  const waypoints = path.slice(0, 3)
  for (const waypoint of waypoints) {
    if (TaskQueue.interruptFlag) break
    try {
      await goToPosition(waypoint, 2, 8000)
    } catch (e) {
      if (e.message && e.message.includes('interrupted')) {
        throw e
      }
    }
  }
  
  if (!TaskQueue.interruptFlag) {
    return await goToPosition(targetPos, range, timeout)
  } else {
    throw new Error('interrupted')
  }
}

function calculateSafePath(start, end) {
  const path = []
  const steps = 10
  const step = end.minus(start).scaled(1 / steps)
  
  for (let i = 1; i < steps; i++) {
    const waypoint = start.plus(step.scaled(i))
    if (!Memory.isDangerous(waypoint)) {
      path.push(waypoint)
    } else {
      const avoidPos = avoidDanger(waypoint)
      if (avoidPos) {
        path.push(avoidPos)
      }
    }
  }
  return path
}

function avoidDanger(dangerPos) {
  const offsets = [
    new Vec3(2, 0, 0), new Vec3(-2, 0, 0),
    new Vec3(0, 0, 2), new Vec3(0, 0, -2),
    new Vec3(2, 0, 2), new Vec3(-2, 0, -2)
  ]
  
  for (const offset of offsets) {
    const avoidPos = dangerPos.plus(offset)
    if (!Memory.isDangerous(avoidPos)) {
      return avoidPos
    }
  }
  return null
}

async function goToPosition(pos, range = 1, timeout = 20000) {
  const bot = BotInterface.getBot()
  
  return new Promise((resolve, reject) => {
    if (!bot.entity || !bot.pathfinder) {
      reject(new Error('Bot entity or pathfinder not available'))
      return
    }
    
    const listenerKey = 'navigation'
    if (activeNavigationListeners.has(listenerKey)) {
      const oldListeners = activeNavigationListeners.get(listenerKey)
      try {
        bot.removeListener('goal_reached', oldListeners.onReached)
        bot.removeListener('goal_updated', oldListeners.onUpdated)
      } catch (e) {}
    }
    
    const goal = new GoalNear(pos.x, pos.y, pos.z, range)
    
    const currentPos = bot.entity.position
    const currentDist = currentPos.distanceTo(pos)
    if (currentDist <= range) {
      resolve()
      return
    }
    
    let resolved = false
    let timeoutId = null
    
    const onReached = () => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve()
    }
    
    const onUpdated = () => {
      if (resolved) return
      const currentPos = bot.entity.position
      const dist = currentPos.distanceTo(pos)
      if (dist <= range) {
        resolved = true
        cleanup()
        resolve()
      }
    }
    
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      try {
        bot.removeListener('goal_reached', onReached)
        bot.removeListener('goal_updated', onUpdated)
      } catch (e) {}
      activeNavigationListeners.delete(listenerKey)
    }
    
    activeNavigationListeners.set(listenerKey, { onReached, onUpdated })
    
    try {
      bot.pathfinder.setGoal(goal)
      bot.once('goal_reached', onReached)
      bot.on('goal_updated', onUpdated)
    } catch (e) {
      cleanup()
      reject(e)
      return
    }
    
    timeoutId = setTimeout(() => {
      if (resolved) return
      resolved = true
      cleanup()
      const finalPos = bot.entity.position
      const finalDist = finalPos.distanceTo(pos)
      if (finalDist <= range * 2) {
        resolve()
      } else {
        reject(new Error('go timeout'))
      }
    }, timeout)
  })
}

// Check navigation logic (to be called periodically)
async function checkNavigation() {
  const bot = BotInterface.getBot()
  const mcData = BotInterface.getMcData()
  if (!bot.entity) return
  
  const pos = bot.entity.position
  
  // Check dangerous blocks
  const dangerousBlocks = bot.findBlocks({
    matching: (b) => {
      const def = mcData.blocks[b.type]
      if (!def) return false
      const name = def.name || ''
      return /lava|fire|cactus|magma/i.test(name)
    },
    maxDistance: CONFIG.DANGER_BLOCK_DISTANCE,
    count: 10
  })
  
  for (const blockPos of dangerousBlocks) {
    Memory.markDangerous(blockPos)
  }
  
  // Check stuck
  const lastPos = Memory.pathHistory[Memory.pathHistory.length - 1]
  if (lastPos && pos.distanceTo(lastPos) < 0.5) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
    Memory.stuckPositions.add(key)
  }
  
  Memory.pathHistory.push(pos.clone())
  if (Memory.pathHistory.length > 100) {
    Memory.pathHistory.shift()
  }
}

async function handleExplore() {
  const bot = BotInterface.getBot()
  log('🗺️  Exploring territory...')
  
  const currentPos = bot.entity.position
  let explorePos = null
  let attempts = 0
  
  while (!explorePos && attempts < 10) {
    const angle = Math.random() * Math.PI * 2
    const distance = 30 + Math.random() * 30 // Increased distance (30-60 blocks)
    const offset = new Vec3(
      Math.cos(angle) * distance,
      0,
      Math.sin(angle) * distance
    )
    
    explorePos = currentPos.plus(offset)
    
    // Simple ground check (y-level)
    // We don't know the Y at target, so we assume same Y or rely on Pathfinder to handle it.
    // Ideally we'd raycast.
    
    if (Memory.isDangerous(explorePos)) {
      explorePos = null
      attempts++
      continue
    }
    
    const key = `${Math.floor(explorePos.x)},${Math.floor(explorePos.y)},${Math.floor(explorePos.z)}`
    if (Memory.stuckPositions.has(key)) {
      explorePos = null
      attempts++
      continue
    }
    
    break
  }
  
  if (explorePos) {
    log(`🗺️  Exploring direction: ${explorePos.x.toFixed(1)}, ${explorePos.z.toFixed(1)}`)
    try {
        await goToPositionSafe(explorePos, 3)
        Memory.saveLocation(`explore_${Date.now()}`, explorePos, 'explore')
        log('✅ Exploration finished, location saved')
    } catch (e) {
        log(`⚠️ Exploration move failed: ${e.message}`)
    }
  } else {
    log('⚠️  Could not find safe place to explore')
  }
  
  return 'done'
}

module.exports = {
  handleGo,
  goToPositionSafe,
  checkNavigation,
  handleExplore
}
