const BotInterface = {
  bot: null,
  mcData: null,
  isActive: false, // Default to false (wait for !start)
  
  setBot(bot) {
    this.bot = bot
  },
  
  setMcData(mcData) {
    this.mcData = mcData
  },
  
  getBot() {
    if (!this.bot) throw new Error('Bot not initialized')
    return this.bot
  },
  
  getMcData() {
    if (!this.mcData) throw new Error('mcData not initialized')
    return this.mcData
  }
}

module.exports = BotInterface
