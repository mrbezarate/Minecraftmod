const Vec3 = require('vec3')
const BotInterface = require('../bot_interface')
const { log, sleep } = require('../utils')

function countItem(name) {
  const bot = BotInterface.getBot()
  return bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0)
}

async function handleCraft(itemName, quantity) {
  const bot = BotInterface.getBot()
  const mcData = BotInterface.getMcData()
  quantity = quantity || 1

  log(`🔨 Crafting ${itemName} x${quantity}`)

  try {
    let itemDef = mcData.itemsByName[itemName]

    if (!itemDef) {
      const variants = [
        itemName,
        itemName.replace(/-/g, '_'),
        itemName.replace(/_/g, ''),
        `minecraft:${itemName}`
      ]
      for (const variant of variants) {
        itemDef = mcData.itemsByName[variant]
        if (itemDef) {
          log(`✅ Found item as: ${variant}`)
          itemName = variant
          break
        }
      }
    }

    if (!itemDef) {
      log(`❌ Item ${itemName} not found in database`)
      return 'failed'
    }

    log(`📦 Item ID: ${itemDef.id}, Name: ${itemDef.name}`)

    try {
        await ensureItem(itemName, quantity)
        log(`✅ Successfully crafted ${itemName} x${quantity}`)
        
        await handlePostCraft(itemName)
        
        return 'done'
    } catch (e) {
        log(`❌ Crafting error: ${e.message}`)
        bot.chat(`Cannot craft ${itemName}: ${e.message}`)
        return 'failed'
    }

  } catch (e) {
    log(`❌ Error in handleCraft ${itemName}: ${e.message}`)
    return 'failed'
  }
}

async function handlePostCraft(itemName) {
  const bot = BotInterface.getBot()
  
  if (itemName === 'crafting_table' || itemName === 'furnace' || itemName === 'chest') {
    log(`🏗️ Auto-placing ${itemName}...`)
    await placeBlockNear(itemName)
  }
  
  if (itemName.includes('pickaxe') || itemName.includes('sword') || itemName.includes('axe') || itemName.includes('shovel')) {
    log(`⚔️ Auto-equipping ${itemName}...`)
    const mcData = BotInterface.getMcData()
    const itemDef = mcData.itemsByName[itemName]
    if (itemDef) {
        try {
            await bot.equip(itemDef.id, 'hand')
        } catch (e) {
            log(`⚠️ Could not equip ${itemName}: ${e.message}`)
        }
    }
  }
}

async function placeBlockNear(blockName) {
  const bot = BotInterface.getBot()
  const item = bot.inventory.items().find(i => i.name === blockName)
  if (!item) return false

  const nearBlock = bot.findBlock({
    matching: (b) => b.type !== 0 && b.boundingBox === 'block' && b.name !== 'air',
    maxDistance: 4
  })
  
  if (nearBlock) {
     try {
       await bot.equip(item, 'hand')
       await bot.placeBlock(nearBlock, new Vec3(0, 1, 0))
       await sleep(500)
       return true
     } catch (e) {
        log(`⚠️ Could not place ${blockName}: ${e.message}`)
     }
  }
  return false
}

async function ensureItem(itemName, quantity, depth = 0) {
  const bot = BotInterface.getBot()
  const mcData = BotInterface.getMcData()
  
  const indent = '  '.repeat(depth)
  const itemDef = mcData.itemsByName[itemName]
  if (!itemDef) throw new Error(`Unknown item: ${itemName}`)
  
  const current = countItem(itemName)
  if (current >= quantity) {
    if (depth > 0) log(`${indent}✅ ${itemName}: have ${current}, need ${quantity}`)
    return true
  }

  const missing = quantity - current
  log(`${indent}🔍 Need ${itemName} x${missing} (have ${current}). Looking for recipe...`)

  // Use prismarine-recipe to find ALL recipes, not just ones possible with current inventory/tables
  const Recipe = require('prismarine-recipe')(bot.version).Recipe
  const recipes = Recipe.find(itemDef.id, null)

  if (!recipes || recipes.length === 0) {
    if (itemName.includes('log') || itemName.includes('stone') || itemName.includes('cobblestone')) {
        log(`${indent}⛏️ No recipe, trying to mine ${itemName}...`)
        // Future: trigger mining task? For now just throw error to indicate need for base resource
    }
    log(`${indent}❌ No recipe for ${itemName}. Base resource.`)
    throw new Error(`missing resource ${itemName}`)
  }

  recipes.sort((a, b) => (a.ingredients ? a.ingredients.length : 0) - (b.ingredients ? b.ingredients.length : 0))

  let lastError = null
  
  for (const recipe of recipes) {
    try {
      const times = Math.ceil(missing / recipe.resultCount)
      log(`${indent}📋 Trying recipe for ${itemName} (x${times} crafts)`)
      
      let ingredients = recipe.ingredients
      
      // If ingredients is null (common for shaped recipes in prismarine-recipe), derive from delta
      if (!ingredients && recipe.delta) {
        ingredients = recipe.delta.filter(d => d.count < 0).map(d => ({
            id: d.id,
            count: -d.count // delta is negative for consumed items
        }))
      }

      if (ingredients) {
        for (const ing of ingredients) {
          const ingDef = mcData.items[ing.id]
          if (!ingDef) {
              log(`${indent}⚠️ Unknown ingredient ID ${ing.id}`)
              continue
          }
          const ingName = ingDef.name
          const needed = ing.count * times
          await ensureItem(ingName, needed, depth + 1)
        }
      }
      
      let tableBlock = null
      if (recipe.requiresTable) {
        log(`${indent}🛠️ Requires crafting table`)
        
        // Find nearby table
        tableBlock = bot.findBlock({
          matching: (b) => b.name === 'crafting_table',
          maxDistance: 4
        })
        
        // If no table nearby, check if we can see one further away and move to it
        if (!tableBlock) {
             const distantTable = bot.findBlock({
                matching: (b) => b.name === 'crafting_table',
                maxDistance: 32
             })
             if (distantTable) {
                 log(`${indent}🏃 Found crafting table at ${distantTable.position}, moving to it...`)
                 const { GoalBlock } = require('mineflayer-pathfinder').goals
                 await bot.pathfinder.goto(new GoalBlock(distantTable.position.x, distantTable.position.y, distantTable.position.z))
                 tableBlock = distantTable
             }
        }
        
        if (!tableBlock) {
          log(`${indent}🛠️ Crafting table not found nearby. Checking inventory...`)
          
          if (countItem('crafting_table') === 0) {
              await ensureItem('crafting_table', 1, depth + 1)
          }
          
          const placed = await placeBlockNear('crafting_table')
          if (placed) {
              // Re-find the block we just placed
              tableBlock = bot.findBlock({
                matching: (b) => b.name === 'crafting_table',
                maxDistance: 4
              })
          }
        }
        
        if (!tableBlock) {
           throw new Error('Need crafting table but cannot find or place one')
        }

        // Ensure we are close enough to interact
        if (bot.entity.position.distanceTo(tableBlock.position) > 4) {
             log(`${indent}🏃 Moving closer to crafting table...`)
             const { GoalBlock } = require('mineflayer-pathfinder').goals
             await bot.pathfinder.goto(new GoalBlock(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z))
        }
      }
      
      log(`${indent}🔨 Crafting ${itemName} x${times * recipe.resultCount} using table at ${tableBlock ? tableBlock.position : 'inventory'}...`)
      await bot.craft(recipe, times, tableBlock)
      log(`${indent}✅ Crafted ${itemName}`)
      
      await sleep(200)
      const newCount = countItem(itemName)
      if (newCount >= (current + (times * recipe.resultCount)) || newCount >= quantity) {
        return true
      }
      return true
      
    } catch (e) {
      lastError = e
      log(`${indent}⚠️ Recipe failed: ${e.message}`)
      continue 
    }
  }
  
  throw lastError || new Error(`Could not craft ${itemName}`)
}

module.exports = {
  handleCraft,
  ensureItem,
  handlePostCraft,
  placeBlockNear
}
