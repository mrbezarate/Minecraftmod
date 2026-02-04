const BotInterface = require('../bot_interface')
const { log, sleep } = require('../utils')
const { goToPositionSafe } = require('./navigation')
const { ensureItem } = require('./crafting')
const Memory = require('../memory')
const Vec3 = require('vec3')

const Architect = {
    // Procedural Blueprint Generator
    generateBlueprint(type) {
        if (type === 'basic_shelter') {
            const size = 5
            const height = 4
            const blocks = []
            
            // Floor & Ceiling
            for (let x = 0; x < size; x++) {
                for (let z = 0; z < size; z++) {
                    blocks.push({ x, y: 0, z, type: 'cobblestone' }) // Floor
                    blocks.push({ x, y: height, z, type: 'oak_planks' }) // Roof
                }
            }
            
            // Walls
            for (let y = 1; y < height; y++) {
                for (let x = 0; x < size; x++) {
                    for (let z = 0; z < size; z++) {
                        if (x === 0 || x === size - 1 || z === 0 || z === size - 1) {
                            // Leave door gap
                            if (x === 2 && z === 0 && y < 3) continue 
                            blocks.push({ x, y, z, type: 'oak_planks' })
                        }
                    }
                }
            }
            
            return { name: 'basic_shelter', size: { x: size, y: height, z: size }, blocks }
        }
        return null
    },

    async construct(blueprint, originPos) {
        const bot = BotInterface.getBot()
        log(`🏗️ Starting construction of ${blueprint.name} at ${originPos}`)

        // Sort blocks by Y level (build bottom-up)
        const sortedBlocks = blueprint.blocks.sort((a, b) => a.y - b.y)

        for (const blockDef of sortedBlocks) {
            const targetPos = originPos.plus(new Vec3(blockDef.x, blockDef.y, blockDef.z))
            
            // Check existing
            const existingBlock = bot.blockAt(targetPos)
            if (existingBlock.name === blockDef.type) continue

            // Clear if needed
            if (existingBlock.boundingBox === 'block') {
                await bot.dig(existingBlock)
            }

            // Ensure material
            // (Simplified: assumes we have it or GoalManager gathered it)
            if (bot.inventory.count(bot.registry.itemsByName[blockDef.type].id) === 0) {
                log(`🏗️ Missing material: ${blockDef.type}. Pausing construction.`)
                return false // Return failure, GoalManager should handle gathering
            }

            // Place
            await this.placeBlock(bot, targetPos, blockDef.type)
        }
        
        log(`🏗️ Construction complete!`)
        return true
    },

    async placeBlock(bot, pos, type) {
        const item = bot.inventory.items().find(i => i.name === type)
        if (!item) return

        // Move close
        if (bot.entity.position.distanceTo(pos) > 4) {
            await goToPositionSafe(pos.offset(1, 0, 1))
        }

        // Avoid standing inside
        if (bot.entity.position.distanceTo(pos) < 1.5) {
            const safePos = pos.offset(2, 0, 2)
             await goToPositionSafe(safePos)
        }

        // Place logic (using reference block)
        const reference = this.findReferenceBlock(bot, pos)
        if (reference) {
            await bot.equip(item, 'hand')
            try {
                await bot.placeBlock(reference.block, reference.face)
                await sleep(100)
            } catch (e) {
                // ignore
            }
        } else {
             // Try to place on ground if y=0 relative to something?
             // Hard to place in air.
             // Advanced scaffolding would go here.
        }
    },

    findReferenceBlock(bot, pos) {
        const neighbors = [
            new Vec3(0, -1, 0), new Vec3(0, 1, 0),
            new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1), new Vec3(0, 0, -1)
        ]
        
        for (const off of neighbors) {
            const np = pos.plus(off)
            const b = bot.blockAt(np)
            if (b && b.type !== 0 && b.boundingBox === 'block') {
                return { block: b, face: off.scaled(-1) }
            }
        }
        return null
    }
}

module.exports = Architect
