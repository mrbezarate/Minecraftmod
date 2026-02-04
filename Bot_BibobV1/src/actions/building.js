const Vec3 = require('vec3')
const BotInterface = require('../bot_interface')
const { log, sleep } = require('../utils')
const { placeBlockNear } = require('./crafting')
const { ensureItem } = require('./crafting')
const { countItem, equipBestTool } = require('./inventory')
const { goToPositionSafe } = require('./navigation')

async function buildShelter() {
    const bot = BotInterface.getBot()
    const startPos = bot.entity.position.floor()
    
    log('🏠 Planning shelter construction...')
    
    // 1. Gather materials (need ~100 blocks for a small hut)
    // For simplicity, we assume we have cobblestone or wood
    let material = 'cobblestone'
    if (countItem('cobblestone') < 100) {
         if (countItem('oak_planks') > 100) {
             material = 'oak_planks'
         } else {
             // Try to get cobblestone
             log('🏠 Not enough materials. Need 100 cobblestone.')
             // Instead of throwing, we return false so Brain can decide to gather
             return false
         }
    }
    
    // 2. Clear area (5x5)
    // Simple clear: dig anything at target pos + 1 up
    // Building a 5x5 floor centered on bot? No, bot is at corner.
    // Let's build a 5x5 box.
    
    const size = 5
    const height = 4
    
    // Check if we can build here
    // For now, just build.
    
    log(`🏠 Building ${size}x${size} shelter with ${material}...`)
    
    // Build Walls
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                // Hollow inside
                if (x > 0 && x < size - 1 && z > 0 && z < size - 1) continue
                
                // Doorway at (2, 0, 0) and (2, 1, 0)
                if (x === 2 && z === 0 && (y === 0 || y === 1)) continue
                
                const targetPos = startPos.plus(new Vec3(x, y, z))
                const block = bot.blockAt(targetPos)
                
                // Dig if not air and not our material
                if (block.name !== 'air' && block.name !== material) {
                    await bot.dig(block)
                }
                
                // Place block
                if (block.name !== material) {
                     await placeBlockAt(targetPos, material)
                }
            }
        }
    }
    
    // Build Roof
    for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
             const targetPos = startPos.plus(new Vec3(x, height, z))
             await placeBlockAt(targetPos, material)
        }
    }
    
    // Place Door
    // await ensureItem('oak_door', 1)
    // ... complicated to place door correctly, skip for now or try simple place
    
    log('🏠 Shelter completed!')
    return true
}

async function placeBlockAt(pos, blockName) {
    const bot = BotInterface.getBot()
    const item = bot.inventory.items().find(i => i.name === blockName)
    if (!item) throw new Error(`No ${blockName}`)
    
    // Bot needs to be near but not inside the block
    const dist = bot.entity.position.distanceTo(pos)
    if (dist > 4) {
        await goToPositionSafe(pos.offset(1, 0, 1), 3)
    }
    
    // If bot is inside, move away
    if (bot.entity.position.distanceTo(pos) < 1.5) {
        const escapePos = pos.offset(-2, 0, -2)
        await goToPositionSafe(escapePos, 0)
    }
    
    // Find reference block (neighbor)
    // This is tricky for air placement. We need a neighbor.
    // If y=0, we likely have ground below.
    // If y>0, we have block below.
    
    const neighbors = [
        new Vec3(0, -1, 0),
        new Vec3(0, 1, 0),
        new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1), new Vec3(0, 0, -1)
    ]
    
    let refBlock = null
    let refFace = null
    
    for (const off of neighbors) {
        const np = pos.plus(off)
        const b = bot.blockAt(np)
        if (b && b.type !== 0 && b.boundingBox === 'block') {
            refBlock = b
            refFace = off.scaled(-1) // Face pointing to our target
            break
        }
    }
    
    if (refBlock) {
        try {
            await bot.equip(item, 'hand')
            await bot.placeBlock(refBlock, refFace)
            await sleep(200)
        } catch (e) {
            // ignore
        }
    }
}

module.exports = {
    buildShelter
}
