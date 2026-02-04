const { GoalBlock } = require('mineflayer-pathfinder').goals
const BotInterface = require('../bot_interface')
const { log, sleep } = require('../utils')
const { placeBlockNear, ensureItem } = require('./crafting')
const { countItem } = require('./inventory')

const SMELTABLES = {
    'iron_ingot': ['raw_iron', 'iron_ore'],
    'gold_ingot': ['raw_gold', 'gold_ore'],
    'copper_ingot': ['raw_copper', 'copper_ore'],
    'cooked_beef': ['beef'],
    'cooked_porkchop': ['porkchop'],
    'cooked_mutton': ['mutton'],
    'cooked_chicken': ['chicken'],
    'glass': ['sand', 'red_sand'],
    'stone': ['cobblestone']
}

const FUELS = ['coal', 'charcoal', 'oak_planks', 'spruce_planks', 'birch_planks', 'wooden_pickaxe', 'stick']

async function handleSmelt(outputName, count = 1) {
    const bot = BotInterface.getBot()
    
    // 1. Identify Input
    const possibleInputs = SMELTABLES[outputName]
    if (!possibleInputs) throw new Error(`Unknown smeltable: ${outputName}`)
    
    let inputName = null
    for (const name of possibleInputs) {
        if (countItem(name) > 0) {
            inputName = name
            break
        }
    }
    
    if (!inputName) {
        // We don't have input. Try to get it?
        // For now, throw error, GoalManager should have ensured we mined it.
        throw new Error(`No input for ${outputName} (need ${possibleInputs.join(' or ')})`)
    }
    
    // 2. Identify Fuel
    let fuelName = null
    for (const name of FUELS) {
        if (countItem(name) > 0) {
            fuelName = name
            break
        }
    }
    
    if (!fuelName) {
         // Try to get fuel?
         // Maybe craft planks from logs?
         if (countItem('oak_log') > 0) {
             await ensureItem('oak_planks', 1) // Craft some planks
             fuelName = 'oak_planks'
         } else {
             throw new Error('No fuel found')
         }
    }

    // 3. Find/Place Furnace
    let furnaceBlock = bot.findBlock({ matching: b => b.name === 'furnace', maxDistance: 32 })
    if (!furnaceBlock) {
        log('🔥 No furnace found. Creating one...')
        try {
            await ensureItem('furnace', 1)
            const placed = await placeBlockNear('furnace')
            if (!placed) throw new Error('Could not place furnace')
            await sleep(1000)
            furnaceBlock = bot.findBlock({ matching: b => b.name === 'furnace', maxDistance: 5 })
        } catch (e) {
            throw new Error(`Failed to setup furnace: ${e.message}`)
        }
    }
    
    if (!furnaceBlock) throw new Error('Furnace lost')
    
    // 4. Go to Furnace
    log(`🔥 Going to furnace at ${furnaceBlock.position}`)
    await bot.pathfinder.goto(new GoalBlock(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z))
    
    // 5. Operate Furnace
    log(`🔥 Smelting ${inputName} -> ${outputName}`)
    const furnace = await bot.openFurnace(furnaceBlock)
    
    try {
        const inputItem = bot.inventory.items().find(i => i.name === inputName)
        const fuelItem = bot.inventory.items().find(i => i.name === fuelName)
        
        if (inputItem && fuelItem) {
            await furnace.putInput(inputItem.type, null, count)
            await furnace.putFuel(fuelItem.type, null, 1) // Put 1 fuel for now, loop if needed
            
            log('🔥 Waiting for smelt...')
            await sleep(5000) // Wait a bit
            
            // Check output
            // Real logic needs to wait for event 'updateSlot' or loop checking furnace.outputItem
            // For simplicity, we wait a fixed time or check periodically
            
            let totalSmelted = 0
            while (totalSmelted < count && furnace.inputItem && furnace.inputItem.count > 0) {
                 if (furnace.outputItem && furnace.outputItem.count > 0) {
                     await furnace.takeOutput()
                     totalSmelted++
                 }
                 await sleep(1000)
                 
                 // Refuel if needed
                 if (!furnace.fuelItem && furnace.inputItem.count > 0) {
                     // Find more fuel
                     // ...
                     break // For now break
                 }
            }
            
            if (furnace.outputItem && furnace.outputItem.count > 0) {
                await furnace.takeOutput()
            }
        }
    } catch (e) {
        log(`🔥 Smelt error: ${e.message}`)
    } finally {
        furnace.close()
    }
}

module.exports = {
    handleSmelt
}
