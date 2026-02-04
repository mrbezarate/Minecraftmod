const CONFIG = require('./config')
const mcDataLib = require('minecraft-data')

function log(...args) {
  if (!CONFIG.ENABLE_LOGGING) {
    if (CONFIG.LOG_ERRORS_ONLY) {
      const isError = args.some(arg => 
        typeof arg === 'string' && (arg.includes('❌') || arg.includes('ERROR') || arg.includes('Ошибка'))
      )
      if (!isError) return
    } else {
      return
    }
  }
  
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}]`, ...args)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function timeoutPromise(promise, ms, msg = 'timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(msg)), ms))
  ])
}

const RussianItemNames = {
  // Boards
  'доски': 'oak_planks',
  'доска': 'oak_planks',
  'planks': 'oak_planks',
  
  // Tools - Pickaxes
  'деревянная_кирка': 'wooden_pickaxe',
  'деревянная кирка': 'wooden_pickaxe',
  'wooden_pickaxe': 'wooden_pickaxe',
  'каменная_кирка': 'stone_pickaxe',
  'каменная кирка': 'stone_pickaxe',
  'stone_pickaxe': 'stone_pickaxe',
  'железная_кирка': 'iron_pickaxe',
  'железная кирка': 'iron_pickaxe',
  'iron_pickaxe': 'iron_pickaxe',
  'алмазная_кирка': 'diamond_pickaxe',
  'алмазная кирка': 'diamond_pickaxe',
  'diamond_pickaxe': 'diamond_pickaxe',
  
  // Tools - Axes
  'деревянный_топор': 'wooden_axe',
  'wooden_axe': 'wooden_axe',
  'каменный_топор': 'stone_axe',
  'stone_axe': 'stone_axe',
  'железный_топор': 'iron_axe',
  'iron_axe': 'iron_axe',
  'алмазный_топор': 'diamond_axe',
  'diamond_axe': 'diamond_axe',
  
  // Tools - Shovels
  'деревянная_лопата': 'wooden_shovel',
  'wooden_shovel': 'wooden_shovel',
  'каменная_лопата': 'stone_shovel',
  'stone_shovel': 'stone_shovel',
  'железная_лопата': 'iron_shovel',
  'iron_shovel': 'iron_shovel',
  
  // Tools - Swords
  'деревянный_меч': 'wooden_sword',
  'wooden_sword': 'wooden_sword',
  'каменный_меч': 'stone_sword',
  'stone_sword': 'stone_sword',
  'железный_меч': 'iron_sword',
  'iron_sword': 'iron_sword',
  
  // Blocks & Items
  'верстак': 'crafting_table',
  'стол_крафта': 'crafting_table',
  'crafting_table': 'crafting_table',
  'печь': 'furnace',
  'furnace': 'furnace',
  'сундук': 'chest',
  'chest': 'chest',
  'факел': 'torch',
  'torch': 'torch',
  'палка': 'stick',
  'stick': 'stick',
  'уголь': 'coal',
  'coal': 'coal',
  'железо': 'iron_ingot',
  'iron_ingot': 'iron_ingot',
  'золото': 'gold_ingot',
  'gold_ingot': 'gold_ingot',
  'алмаз': 'diamond',
  'diamond': 'diamond',
  'яблоко': 'apple',
  'apple': 'apple',
  'хлеб': 'bread',
  'bread': 'bread',
  'лестница': 'ladder',
  'ladder': 'ladder',
  'дверь': 'wooden_door',
  'wooden_door': 'wooden_door',
  'кровать': 'bed',
  'bed': 'bed',
  'веревка': 'string',
  'string': 'string',
  'кожа': 'leather',
  'leather': 'leather',
  'шерсть': 'wool',
  'wool': 'wool',
  'камень': 'cobblestone',
  'cobblestone': 'cobblestone',
  'булыжник': 'cobblestone',
  'песок': 'sand',
  'sand': 'sand',
  'гравий': 'gravel',
  'gravel': 'gravel',
  'земля': 'dirt',
  'dirt': 'dirt',
  'дерево': 'oak_log',
  'бревно': 'oak_log',
  'log': 'oak_log',
  'мясо': 'beef',
  'beef': 'beef',
  'стейк': 'cooked_beef',
  'cooked_beef': 'cooked_beef'
}

function translateItemName(russianName, mcData) {
  if (!russianName) return null
  
  const normalized = russianName.toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-zа-яё0-9_]/g, '')
    .trim()
  
  if (RussianItemNames[normalized]) {
    return RussianItemNames[normalized]
  }
  
  const variants = [
    normalized,
    normalized.replace(/_/g, ' '),
    normalized.replace(/\s+/g, '_'),
    normalized.replace(/_/g, '')
  ]
  
  for (const variant of variants) {
    if (RussianItemNames[variant]) {
      return RussianItemNames[variant]
    }
  }
  
  // Keyword search
  const keywords = {
    'кирка': 'pickaxe',
    'топор': 'axe',
    'лопата': 'shovel',
    'меч': 'sword',
    'доски': 'planks'
  }
  
  for (const [ruKey, enValue] of Object.entries(keywords)) {
    if (normalized.includes(ruKey)) {
      if (['кирка', 'топор', 'лопата', 'меч'].includes(ruKey)) {
        // Try to guess material
        let material = 'wooden' // default
        if (normalized.includes('камен')) material = 'stone'
        if (normalized.includes('желез')) material = 'iron'
        if (normalized.includes('алмаз')) material = 'diamond'
        
        const combined = `${material}_${enValue}`
        if (RussianItemNames[combined] || (mcData && mcData.itemsByName[combined])) {
          return combined
        }
      }
    }
  }
  
  const result = russianName.toLowerCase().replace(/\s+/g, '_').replace(/minecraft:/g, '')
  return result
}

module.exports = {
  log,
  sleep,
  timeoutPromise,
  translateItemName,
  RussianItemNames
}
