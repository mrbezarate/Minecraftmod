const BotInterface = require('../bot_interface')
const { log } = require('../utils')

function inventorySummary() {
  const bot = BotInterface.getBot()
  return bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ') || 'empty'
}

function countItem(name) {
  const bot = BotInterface.getBot()
  return bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0)
}

async function equipBestTool(toolType) {
  const bot = BotInterface.getBot()
  const order = toolType === 'axe'
    ? ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe']
    : toolType === 'pickaxe'
    ? ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe']
    : toolType === 'shovel'
    ? ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel']
    : toolType === 'sword'
    ? ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword']
    : []
    
  for (const name of order) {
    const it = bot.inventory.items().find(i => i.name === name)
    if (it) {
      try {
        await bot.equip(it, 'hand')
        return true
      } catch (e) { }
    }
  }
  return false
}

module.exports = {
  inventorySummary,
  countItem,
  equipBestTool
}
