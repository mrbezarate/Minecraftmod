const { goals: { GoalNear, GoalBlock } } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const BotInterface = require('../bot_interface')
const Memory = require('../memory')
const TaskQueue = require('../task_queue')
const { log, sleep } = require('../utils')
const { equipBestTool } = require('./inventory')
const { goToPositionSafe } = require('./navigation')

async function handleMine(blockName, count = 1) {
  const bot = BotInterface.getBot()
  const mcData = BotInterface.getMcData()
  
  log(`⛏️  Mining ${blockName} x${count}`)
  
  let collected = 0
  let failures = 0
  
  while (collected < count && failures < 5) {
    if (TaskQueue.interruptFlag) {
       log('⚠️ Mining interrupted')
       return 'interrupted'
    }
    
    // Find nearest block
    const blockDef = mcData.blocksByName[blockName]
    if (!blockDef) {
      log(`❌ Unknown block ${blockName}`)
      return 'failed'
    }
    
    const maxDistance = 32
    const blocks = bot.findBlocks({
      matching: blockDef.id,
      maxDistance: maxDistance,
      count: 10
    })
    
    if (blocks.length === 0) {
      log(`⚠️ Block ${blockName} not found nearby`)
      
      // Try to find in memory
      const known = Memory.getNearestResource(blockName, bot.entity.position)
      if (known) {
        log(`🧠 Found ${blockName} in memory at ${known.pos}`)
        await goToPositionSafe(known.pos, 3)
        // Don't continue, return special status to retry
        return 'retry_moved'
      }
      
      // If not found nearby and not in memory, we need to EXPLORE
      // But mining action shouldn't handle exploration directly if it fails.
      // It should return 'failed' and let DecisionEngine/GoalManager decide to Explore.
      
      return 'failed'
    }
    
    // Scan for cluster
    const cluster = scanCluster(blocks[0], blockDef.id)
    log(`🔎 Found cluster of ${cluster.length} blocks`)
    
    for (const pos of cluster) {
       if (collected >= count) break
       if (TaskQueue.interruptFlag) return 'interrupted'
       
       const block = bot.blockAt(pos)
       if (!block || block.type !== blockDef.id) continue
       
       try {
         await goToPositionSafe(pos, 3)
         await digBlockReliable(block)
         collected++
         failures = 0
       } catch (e) {
         log(`⚠️ Mining error: ${e.message}`)
         failures++
       }
    }
  }
  
  return collected >= count ? 'done' : 'failed'
}

function scanCluster(startPos, blockId) {
  const bot = BotInterface.getBot()
  const cluster = []
  const queue = [startPos]
  const visited = new Set([startPos.toString()])
  
  while (queue.length > 0 && cluster.length < 20) {
    const pos = queue.shift()
    cluster.push(pos)
    
    const offsets = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 1, 0), new Vec3(0, -1, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ]
    
    for (const offset of offsets) {
      const next = pos.plus(offset)
      if (!visited.has(next.toString())) {
        const block = bot.blockAt(next)
        if (block && block.type === blockId) {
          visited.add(next.toString())
          queue.push(next)
        }
      }
    }
  }
  
  return cluster.sort((a, b) => {
    const pos = bot.entity.position
    return a.distanceTo(pos) - b.distanceTo(pos)
  })
}

async function digBlockReliable(block) {
  const bot = BotInterface.getBot()
  
  if (bot.canSeeBlock(block)) {
    // try to equip tool
    let toolType = 'pickaxe'
    if (block.name.includes('log') || block.name.includes('planks')) toolType = 'axe'
    if (block.name.includes('dirt') || block.name.includes('sand') || block.name.includes('gravel')) toolType = 'shovel'
    
    await equipBestTool(toolType)
    
    try {
      await bot.dig(block)
      return true
    } catch (e) {
      throw e
    }
  } else {
    throw new Error('cannot see block')
  }
}

module.exports = {
  handleMine,
  scanCluster,
  digBlockReliable
}
