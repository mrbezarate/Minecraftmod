const BotInterface = require('../bot_interface')
const TaskQueue = require('../task_queue')
const { log, translateItemName } = require('../utils')
const { handleCraft } = require('../actions/crafting')
const { handleGo } = require('../actions/navigation')

async function handleChatCommand(username, message) {
  const bot = BotInterface.getBot()
  const mcData = BotInterface.getMcData()
  
  if (username === bot.username) return
  
  const command = message.split(' ')[0]
  const args = message.split(' ').slice(1)
  
  log(`💬 Chat: ${username}: ${message}`)
  
  if (command === '!craft') {
    const rawName = args[0]
    const count = parseInt(args[1] || '1')
    
    let itemName = translateItemName(rawName, mcData) || rawName
    
    bot.chat(`I will try to craft ${itemName} x${count}`)
    
    TaskQueue.add({
      type: 'craft',
      item: { name: itemName, count: count },
      priority: TaskQueue.priority.USER_COMMAND,
      execute: async () => await handleCraft(itemName, count)
    })
  }
  
  if (command === '!come') {
    const player = bot.players[username]
    if (player && player.entity) {
      bot.chat('Coming!')
      TaskQueue.add({
        type: 'move',
        position: player.entity.position.clone(),
        priority: TaskQueue.priority.USER_COMMAND,
        execute: async () => await handleGo(player.entity.position)
      })
    } else {
      bot.chat('I cannot see you!')
    }
  }
  
  if (command === '!stop') {
    bot.chat('Stopping all tasks.')
    TaskQueue.clear()
    bot.pathfinder.setGoal(null)
  }
  
  if (command === '!info') {
      const pos = bot.entity.position
      bot.chat(`I am at ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}. Health: ${bot.health}. Food: ${bot.food}`)
  }
  
  if (command === '!start') {
      BotInterface.isActive = true
      bot.chat('🟢 Starting autonomous mode!')
      log('🟢 Bot started via command.')
  }
}

module.exports = {
  handleChatCommand
}
