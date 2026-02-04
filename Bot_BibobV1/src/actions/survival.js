const BotInterface = require('../bot_interface')
const { log, sleep } = require('../utils')
const { equipBestTool } = require('./inventory')
const { goToPositionSafe } = require('./navigation')

async function handleEat() {
  const bot = BotInterface.getBot()
  const mcData = BotInterface.getMcData()
  
  if (bot.food === 20) return
  
  log(`🍖 Hungry (${bot.food}/20). Looking for food...`)
  const items = bot.inventory.items()
  const food = items.find(item => {
    const def = mcData.foods[item.type]
    return def && def.foodPoints > 0
  })
  
  if (food) {
    log(`🍎 Eating ${food.name}`)
    try {
      await bot.equip(food, 'hand')
      await bot.consume()
      log('✅ Ate food')
    } catch (e) {
      log(`⚠️ Could not eat: ${e.message}`)
    }
  } else {
    log('⚠️ No food in inventory!')
  }
}

async function handleSleep() {
    const bot = BotInterface.getBot()
    if (!bot.time.isDay) {
        const bed = bot.findBlock({
            matching: block => block.name.includes('bed'),
            maxDistance: 32
        })
        
        if (bed) {
            if (bot.isSleeping) return
            try {
                await bot.sleep(bed)
                log('😴 Sleeping...')
            } catch (e) {
                log(`⚠️ Cannot sleep: ${e.message}`)
            }
        }
    }
}

async function handleHunt() {
    const bot = BotInterface.getBot()
    log('🏹 Hunting for food...')
    
    // Find animals
    const entity = bot.nearestEntity(e => 
        e.type === 'mob' && 
        ['pig', 'cow', 'chicken', 'sheep', 'rabbit'].includes(e.name) &&
        e.position.distanceTo(bot.entity.position) < 32
    )
    
    if (entity) {
        log(`🎯 Found ${entity.name}. Attacking!`)
        await equipBestTool('sword')
        await goToPositionSafe(entity.position, 2)
        
        while (entity.isValid && entity.health > 0) {
            if (bot.entity.position.distanceTo(entity.position) > 3) {
                 await bot.lookAt(entity.position)
                 bot.setControlState('forward', true)
                 bot.setControlState('sprint', true)
            } else {
                 bot.setControlState('forward', false)
                 bot.attack(entity)
                 await sleep(600)
            }
            await sleep(50)
        }
        
        log('✅ Target eliminated. Collecting drops...')
        bot.clearControlStates()
        await goToPositionSafe(entity.position, 1)
        await sleep(1000) // Wait for drops pickup
        return true
    } else {
        log('⚠️ No animals found nearby.')
        throw new Error('No animals found')
    }
}

module.exports = {
  handleEat,
  handleSleep,
  handleHunt
}
