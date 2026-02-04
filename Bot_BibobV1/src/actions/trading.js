const BotInterface = require('../bot_interface')
const { log, sleep } = require('../utils')
const { goToPositionSafe } = require('./navigation')

const Trading = {
    async findTrader(bot) {
        return bot.nearestEntity(e => e.name === 'villager' && e.position.distanceTo(bot.entity.position) < 32)
    },

    async handleTrading(itemName, count) {
        const bot = BotInterface.getBot()
        log('💎 Looking for a trader...')

        const villager = await this.findTrader(bot)
        if (!villager) {
            log('💎 No villagers nearby.')
            return false
        }

        await goToPositionSafe(villager.position, 2)
        
        try {
            const trade = await bot.openVillager(villager)
            log(`💎 Opened trade with villager (Profession: ${villager.metadata[16] || 'Unknown'})`) // Metadata index varies by version
            
            // Iterate trades
            for (const t of trade.trades) {
                // t.inputItem1, t.outputItem
                // Logic to match desired item
                if (t.outputItem.name === itemName) {
                    if (!t.disabled) {
                        log(`💎 Found trade for ${itemName}! Cost: ${t.inputItem1.count} ${t.inputItem1.name}`)
                        
                        // Check if we can afford
                        const balance = bot.inventory.count(t.inputItem1.type)
                        if (balance >= t.inputItem1.count) {
                            await bot.trade(trade, trades.indexOf(t), count)
                            log(`💎 Traded successfully!`)
                            trade.close()
                            return true
                        } else {
                            log(`💎 Cannot afford. Have ${balance}, need ${t.inputItem1.count}`)
                        }
                    }
                }
            }
            trade.close()
        } catch (e) {
            log(`💎 Trading failed: ${e.message}`)
        }
        return false
    }
}

module.exports = Trading
