const path = require('path')

const CONFIG = {
  HOST: process.env.MC_HOST || 'localhost',
  PORT: parseInt(process.env.MC_PORT || '25565'),
  USERNAME: process.env.MC_USERNAME || 'BotBibob6',
  VERSION: process.env.MC_VERSION || '1.19.4',
  AUTO_RECONNECT: true,
  RECONNECT_DELAY: 5000,
  CHAT_COMMANDS: true,
  
  // Connection parameters
  KEEP_ALIVE_TIMEOUT: 60000,
  CONNECT_TIMEOUT: 30000,
  
  // Performance parameters
  THINK_INTERVAL: 500,
  TASK_CHECK_INTERVAL: 500,
  MEMORY_UPDATE_INTERVAL: 5000,
  RESOURCE_CHECK_INTERVAL: 3000,
  NAVIGATION_CHECK_INTERVAL: 1000,
  LIVELINESS_INTERVAL: 2000, // New: Liveliness check
  
  // Logging
  ENABLE_LOGGING: true,
  LOG_ERRORS_ONLY: false,
  
  // Gameplay
  ROLEPLAY_MODE: false,
  AUTO_START: false, // Wait for !start
  
  // Navigation
  MAX_PATHFIND_DISTANCE: 128,
  DANGER_BLOCK_DISTANCE: 3,
  
  // Combat
  COMBAT_DISTANCE: 4,
  FLEE_HEALTH: 8,
  
  // Survival
  EAT_AT_FOOD: 18,
  EAT_AT_HEALTH: 15,
  SLEEP_AT_NIGHT: true // New: Sleep behavior
}

module.exports = CONFIG
