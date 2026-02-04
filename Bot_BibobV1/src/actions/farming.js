const BotInterface = require('../bot_interface')
const { log, sleep } = require('../utils')
const { goToPositionSafe } = require('./navigation')
const { ensureItem } = require('./crafting')

const FARM_RADIUS = 4

async function handleFarming() {
    const bot = BotInterface.getBot()
    log('🌾 Checking farm status...')

    // 1. Harvest mature crops
    const matureCrops = findMatureCrops(bot)
    if (matureCrops.length > 0) {
        log(`🌾 Found ${matureCrops.length} mature crops. Harvesting...`)
        for (const crop of matureCrops) {
            await harvestCrop(bot, crop)
        }
    }

    // 2. Plant seeds
    // Check for seeds in inventory
    const seeds = bot.inventory.items().find(i => i.name.includes('seeds') || i.name === 'carrot' || i.name === 'potato')
    if (seeds) {
        const farmland = findEmptyFarmland(bot)
        if (farmland.length > 0) {
            log(`🌾 Found ${farmland.length} empty farmland blocks. Planting...`)
            for (const block of farmland) {
                if (bot.inventory.count(seeds.type) > 0) {
                    await plantSeed(bot, block, seeds.name)
                }
            }
        } else {
            // Create new farmland if we have seeds but no land
            await createFarmland(bot)
        }
    }
}

function findMatureCrops(bot) {
    return bot.findBlocks({
        matching: (block) => {
            return (block.name === 'wheat' && block.metadata === 7) || 
                   (block.name === 'carrots' && block.metadata === 7) ||
                   (block.name === 'potatoes' && block.metadata === 7)
        },
        maxDistance: 32,
        count: 50
    }).map(p => bot.blockAt(p))
}

function findEmptyFarmland(bot) {
    return bot.findBlocks({
        matching: block => block.name === 'farmland' && bot.blockAt(block.position.offset(0, 1, 0)).name === 'air',
        maxDistance: 32,
        count: 50
    }).map(p => bot.blockAt(p))
}

async function harvestCrop(bot, block) {
    await goToPositionSafe(block.position)
    await bot.dig(block)
    // Collect drops? Bot usually picks them up automatically if close.
}

async function plantSeed(bot, block, seedName) {
    const seed = bot.inventory.items().find(i => i.name === seedName)
    if (!seed) return

    await goToPositionSafe(block.position)
    await bot.equip(seed, 'hand')
    
    // Plant on top of farmland
    const topBlock = block
    try {
        await bot.placeBlock(topBlock, { x: 0, y: 1, z: 0 })
        await sleep(200)
    } catch (e) {
        // Ignore placement errors (maybe occupied)
    }
}

async function createFarmland(bot) {
    // Find water
    const water = bot.findBlock({
        matching: block => block.name === 'water',
        maxDistance: 32
    })

    if (!water) {
        log('🌾 No water found for farming.')
        return
    }

    // Find dirt/grass near water (within 4 blocks)
    const dirt = bot.findBlocks({
        matching: block => (block.name === 'dirt' || block.name === 'grass_block') && block.position.distanceTo(water.position) <= 4,
        maxDistance: 32,
        count: 10
    }).map(p => bot.blockAt(p))

    if (dirt.length === 0) return

    // Ensure Hoe
    await ensureItem('wooden_hoe', 1)
    
    const hoe = bot.inventory.items().find(i => i.name.includes('hoe'))
    if (!hoe) return

    await bot.equip(hoe, 'hand')

    for (const block of dirt) {
        // Check if air above
        const above = bot.blockAt(block.position.offset(0, 1, 0))
        if (above.name !== 'air' && above.name !== 'cave_air') continue

        await goToPositionSafe(block.position)
        try {
            await bot.activateBlock(block) // Till
            await sleep(500)
        } catch (e) {
            log(`🌾 Failed to till: ${e.message}`)
        }
    }
}

module.exports = {
    handleFarming
}
