// bot.js — Умный динамичный Minecraft бот с памятью и параллельными задачами
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals: { GoalNear, GoalBlock, GoalXZ, GoalY } } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const mcDataLib = require('minecraft-data')

// ==================== КОНФИГУРАЦИЯ ====================
const CONFIG = {
  HOST: process.env.MC_HOST || 'localhost',
  PORT: parseInt(process.env.MC_PORT || '25565'),
  USERNAME: process.env.MC_USERNAME || 'BotBibob6',
  VERSION: process.env.MC_VERSION || '1.19.4',
  AUTO_RECONNECT: true,
  RECONNECT_DELAY: 5000,
  CHAT_COMMANDS: true,
  // Параметры подключения
  KEEP_ALIVE_TIMEOUT: 60000,  // Таймаут keepalive (мс) - увеличено до 60 секунд
  CONNECT_TIMEOUT: 30000,     // Таймаут подключения (мс)
  // Параметры производительности (оптимизировано)
  THINK_INTERVAL: 500,       // Интервал мышления (мс) - увеличено для оптимизации
  TASK_CHECK_INTERVAL: 500,  // Проверка задач - увеличено для оптимизации
  MEMORY_UPDATE_INTERVAL: 5000, // Обновление памяти - увеличено для оптимизации
  RESOURCE_CHECK_INTERVAL: 3000, // Проверка ресурсов - отдельный интервал
  NAVIGATION_CHECK_INTERVAL: 1000, // Проверка навигации - отдельный интервал
  // Логирование
  ENABLE_LOGGING: true,      // Подробное логирование включено
  LOG_ERRORS_ONLY: false,   // Логировать все действия
  // Ролевая игра
  ROLEPLAY_MODE: false,      // Режим ролевой игры (автоматическое развитие)
  // Параметры навигации
  MAX_PATHFIND_DISTANCE: 128,
  DANGER_BLOCK_DISTANCE: 3,  // Дистанция опасных блоков (лава, кактус)
  // Параметры боя
  COMBAT_DISTANCE: 4,         // Оптимальная дистанция боя
  FLEE_HEALTH: 8,            // Бежать при здоровье ниже
  // Параметры выживания
  EAT_AT_FOOD: 18,           // Есть когда голод ниже
  EAT_AT_HEALTH: 15          // Есть когда здоровье ниже
}

// ==================== СИСТЕМА ПАМЯТИ ====================
const Memory = {
  // Места
  home: null,                 // Дом (точка спавна)
  knownLocations: new Map(),   // Известные места: {name: {pos, type, timestamp}}
  resourceLocations: new Map(), // Места ресурсов: {blockType: [{pos, count, timestamp}]}
  dangerousAreas: new Set(), // Опасные зоны (координаты как строки "x,y,z")
  
  // Маршруты
  pathHistory: [],            // История путей
  stuckPositions: new Set(),  // Места где застревал
  
  // Ресурсы
  inventoryHistory: [],      // История инвентаря
  craftHistory: [],          // История крафта
  
  // Боевая память
  mobLocations: new Map(),   // Позиции мобов: {mobType: [{pos, timestamp}]}
  combatHistory: [],         // История боев
  
  // Время
  lastDayTime: null,
  lastNightTime: null,
  
  // Инициализация
  init() {
    log('🧠 Система памяти инициализирована')
  },
  
  // Сохранение известного места
  saveLocation(name, pos, type = 'point') {
    this.knownLocations.set(name, {
      pos: pos.clone(),
      type: type,
      timestamp: Date.now()
    })
  },
  
  // Получение ближайшего известного места
  getNearestLocation(pos, type = null) {
    let nearest = null
    let minDist = Infinity
    
    for (const [name, loc] of this.knownLocations) {
      if (type && loc.type !== type) continue
      const dist = pos.distanceTo(loc.pos)
      if (dist < minDist) {
        minDist = dist
        nearest = { name, ...loc }
      }
    }
    
    return nearest
  },
  
  // Сохранение ресурса
  saveResource(blockType, pos) {
    if (!this.resourceLocations.has(blockType)) {
      this.resourceLocations.set(blockType, [])
    }
    const resources = this.resourceLocations.get(blockType)
    // Проверяем, нет ли уже этого места
    const exists = resources.some(r => r.pos.distanceTo(pos) < 2)
    if (!exists) {
      resources.push({
        pos: pos.clone(),
        count: 1,
        timestamp: Date.now()
      })
      // Ограничиваем размер (последние 50)
      if (resources.length > 50) resources.shift()
    }
  },
  
  // Получение ближайшего ресурса
  getNearestResource(blockType, currentPos) {
    const resources = this.resourceLocations.get(blockType)
    if (!resources || resources.length === 0) return null
    
    let nearest = null
    let minDist = Infinity
    
    for (const resource of resources) {
      const dist = currentPos.distanceTo(resource.pos)
      if (dist < minDist && dist < 128) {
        minDist = dist
        nearest = resource
      }
    }
    
    return nearest
  },
  
  // Отметить опасную зону
  markDangerous(pos) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
    this.dangerousAreas.add(key)
  },
  
  // Проверка опасной зоны
  isDangerous(pos) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
    return this.dangerousAreas.has(key)
  },
  
  // Очистка старой памяти
  cleanup() {
    const now = Date.now()
    const maxAge = 3600000 // 1 час
    
    // Очистка старых ресурсов
    for (const [type, resources] of this.resourceLocations) {
      const filtered = resources.filter(r => now - r.timestamp < maxAge)
      this.resourceLocations.set(type, filtered)
    }
    
    // Очистка старых мест
    for (const [name, loc] of this.knownLocations) {
      if (now - loc.timestamp > maxAge * 24) {
        this.knownLocations.delete(name)
      }
    }
  }
}

// ==================== СИСТЕМА ЗАДАЧ ====================
const TaskQueue = {
  tasks: [],
  currentTask: null,
  isExecuting: false,      // Флаг выполнения задачи
  interruptFlag: false,    // Флаг прерывания для критических задач
  priority: {
    CRITICAL: 200,         // Критический (только бой/бегство) - прерывает всё
    COMBAT: 100,           // Бой - высший приоритет
    SURVIVAL: 80,          // Выживание (еда, здоровье)
    USER_COMMAND: 70,      // Команды пользователя (высокий приоритет)
    RESOURCE: 60,          // Ресурсы
    CRAFT: 63,             // Крафт
    EXPLORE: 30,           // Исследование
    IDLE: 10               // Простой
  },
  
  // Добавить задачу
  add(task) {
    // Проверяем, не критическая ли задача
    if (task.priority >= this.priority.CRITICAL) {
      // Критическая задача - прерываем текущую
      if (this.currentTask && this.currentTask.priority < this.priority.CRITICAL) {
        this.interruptFlag = true
        log('⚠️  Прерывание задачи из-за критической угрозы')
      }
    }
    
    // Улучшенная проверка дубликатов (предотвращает кик)
    const isDuplicate = this.tasks.some(t => {
      // Проверяем тип задачи
      if (t.type !== task.type) return false
      
      // Проверяем приоритет
      if (t.priority !== task.priority) return false
      
      // Проверяем цель/позицию/предмет
      if (task.target && t.target) {
        if (task.target.id && t.target.id && task.target.id === t.target.id) return true
        if (task.target.position && t.target.position) {
          const dist = task.target.position.distanceTo(t.target.position)
          if (dist < 2) return true
        }
      }
      if (task.position && t.position) {
        const dist = task.position.distanceTo(t.position)
        if (dist < 2) return true
      }
      if (task.item && t.item && task.item.type === t.item.type) return true
      if (task.blockType && t.blockType && task.blockType === t.blockType) return true
      
      return false
    })
    
    // Проверяем текущую задачу
    if (this.currentTask && this.currentTask.type === task.type) {
      if (task.target && this.currentTask.target && task.target.id === this.currentTask.target.id) {
        log('⚠️  Задача уже выполняется, пропускаем дубликат')
        return
      }
      if (task.position && this.currentTask.position) {
        const dist = task.position.distanceTo(this.currentTask.position)
        if (dist < 2) {
          log('⚠️  Задача уже выполняется, пропускаем дубликат')
          return
        }
      }
    }
    
    if (!isDuplicate) {
      this.tasks.push(task)
      this.tasks.sort((a, b) => (b.priority || 0) - (a.priority || 0))
      log(`📋 Добавлена задача: ${task.type} (приоритет: ${task.priority})`)
    } else {
      log(`⚠️  Пропущен дубликат задачи: ${task.type}`)
    }
  },
  
  // Получить следующую задачу
  getNext() {
    if (this.tasks.length === 0) return null
    return this.tasks.shift()
  },
  
  // Очистить задачи
  clear() {
    this.tasks = []
    this.currentTask = null
    this.isExecuting = false
    this.interruptFlag = false
  },
  
  // Проверка наличия задач
  hasTasks() {
    return this.tasks.length > 0 || this.currentTask !== null
  },
  
  // Проверка, можно ли прервать текущую задачу
  canInterrupt() {
    return this.interruptFlag && 
           this.currentTask && 
           this.currentTask.priority < this.priority.CRITICAL
  }
}

// ==================== УТИЛИТЫ ====================
function log(...args) {
  if (!CONFIG.ENABLE_LOGGING) {
    // Если логирование отключено, проверяем только ошибки
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

// ==================== СОЗДАНИЕ БОТА ====================
let bot = null
let mcData = null
let isRunning = false
let thinkingInterval = null
let taskInterval = null
let memoryInterval = null
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 10

// Проверка доступности сервера (базовая проверка порта)
async function checkServerAvailability() {
  return new Promise((resolve) => {
    const net = require('net')
    const socket = new net.Socket()
    
    socket.setTimeout(5000)
    
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
    
    try {
      socket.connect(CONFIG.PORT, CONFIG.HOST)
    } catch (e) {
      resolve(false)
    }
  })
}

function createBot() {
  // Логирование подключения только при первой попытке
  if (reconnectAttempts === 0) {
    log(`Подключение к ${CONFIG.HOST}:${CONFIG.PORT} как ${CONFIG.USERNAME}...`)
    log(`Версия: ${CONFIG.VERSION}`)
  }
  
  try {
    bot = mineflayer.createBot({
      host: CONFIG.HOST,
      port: CONFIG.PORT,
      username: CONFIG.USERNAME,
      version: CONFIG.VERSION,
      auth: 'offline',
      keepAlive: true
    })

    bot.loadPlugin(pathfinder)
    
    // Увеличиваем лимит слушателей событий для pathfinder
    if (bot.pathfinder && bot.pathfinder.bot) {
      bot.pathfinder.bot.setMaxListeners(50)
    }
    bot.setMaxListeners(50)
    
    Memory.init()

    setupEventHandlers()
    
    // Настраиваем keepalive таймаут после подключения
    bot.once('login', () => {
      reconnectAttempts = 0 // Сбрасываем счетчик при успешном подключении
      try {
        // Устанавливаем таймаут сокета для увеличения keepalive таймаута
        if (bot._client && bot._client.socket && bot._client.socket.setTimeout) {
          bot._client.socket.setTimeout(CONFIG.KEEP_ALIVE_TIMEOUT)
        }
      } catch (e) {
        // Игнорируем ошибки настройки таймаута
      }
    })
    
    return bot
    } catch (err) {
    log('❌ Ошибка при создании бота:', err.message)
    log('💡 Проверьте:')
    log('   1. Сервер запущен и доступен?')
    log(`   2. Правильный адрес ${CONFIG.HOST}:${CONFIG.PORT}?`)
    log(`   3. Версия сервера совпадает с ${CONFIG.VERSION}?`)
    log('   4. Нет ли файрвола, блокирующего подключение?')
    
    reconnectAttempts++
    if (CONFIG.AUTO_RECONNECT && reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      log(`🔄 Попытка переподключения через ${CONFIG.RECONNECT_DELAY}ms...`)
      setTimeout(() => createBot(), CONFIG.RECONNECT_DELAY)
    } else if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      log('❌ Превышено максимальное количество попыток переподключения')
      log('💡 Проверьте настройки сервера и попробуйте запустить бота вручную')
    }
    
    return null
  }
}

// ==================== ОБРАБОТЧИКИ СОБЫТИЙ ====================
function setupEventHandlers() {
  bot.once('spawn', async () => {
    reconnectAttempts = 0 // Сбрасываем счетчик при успешном подключении
    const spawnPos = bot.entity.position.clone()
    log('✅ Бот успешно заспавнился!')
    log(`📍 Позиция: X=${spawnPos.x.toFixed(1)}, Y=${spawnPos.y.toFixed(1)}, Z=${spawnPos.z.toFixed(1)}`)
    log(`🎮 Игровой режим: ${bot.game.gameMode === 0 ? 'Survival' : bot.game.gameMode === 1 ? 'Creative' : 'Other'}`)
    
    try {
      mcData = mcDataLib(bot.version)
      bot.pathfinder.setMovements(new Movements(bot, mcData))
      bot.pathfinder.setGoal(null)
      
      // Сохраняем дом
      Memory.home = spawnPos.clone()
      Memory.saveLocation('home', spawnPos, 'home')
      
      if (bot.game && bot.game.gameMode === 1) {
        bot.chat('Я в креативе — переключите в survival для корректной работы.')
        log('⚠️  WARN: бот в креативе, рекомендуется переключить в survival')
      }

      isRunning = true
      
      // Запускаем параллельные системы
      startParallelSystems()
      
    } catch (e) {
      log('❌ Ошибка при инициализации:', e.message)
      log(e.stack)
    }
  })

  bot.on('chat', async (username, message) => {
    if (username === bot.username) return
    log(`💬 [CHAT] ${username}: ${message}`)
    
    if (CONFIG.CHAT_COMMANDS) {
      await handleChatCommand(username, message)
    }
  })

  bot.on('whisper', (username, message) => {
    log(`📩 [WHISPER] ${username}: ${message}`)
  })

  bot.on('kicked', (reason) => {
    // Логирование только критичных ошибок
    if (CONFIG.LOG_ERRORS_ONLY) {
      log('🚫 KICKED:', reason)
    }
    isRunning = false
    stopParallelSystems()
  })

  bot.on('error', (err) => {
    const errorMsg = err.message || String(err)
    log('❌ ERROR:', errorMsg)
    
    // Детальная обработка различных типов ошибок
    if (errorMsg.includes('timed out') || errorMsg.includes('timeout')) {
      log('⏱️  Таймаут keepalive! Сервер не отвечает на пакеты.')
      log('💡 Возможные причины:')
      log('   1. Сервер не запущен или недоступен')
      log(`   2. Неправильный адрес: ${CONFIG.HOST}:${CONFIG.PORT}`)
      log('   3. Проблемы с сетью или файрволом')
      log('   4. Сервер перегружен или не отвечает на keepalive пакеты')
      log(`   5. Версия сервера не совпадает с ${CONFIG.VERSION}`)
      log('   6. Сервер в офлайн-режиме и требует другой тип авторизации')
      log('')
      log('🔧 Рекомендации:')
      log('   - Проверьте, что сервер запущен и доступен')
      log('   - Попробуйте подключиться с обычного клиента Minecraft')
      log('   - Проверьте логи сервера на наличие ошибок')
      log('   - Убедитесь, что версия сервера совпадает с настройкой бота')
      
      // Принудительно закрываем соединение
      if (bot && bot._client) {
        try {
          bot._client.end()
        } catch (e) {}
      }
      
      isRunning = false
      stopParallelSystems()
      
      reconnectAttempts++
      if (CONFIG.AUTO_RECONNECT && reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
        log(`🔄 Автоматическое переподключение через ${CONFIG.RECONNECT_DELAY}ms...`)
        setTimeout(() => {
          if (bot) {
            try {
              bot.end()
            } catch (e) {}
          }
          bot = null
          createBot()
        }, CONFIG.RECONNECT_DELAY)
      } else if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
        log('❌ Превышено максимальное количество попыток переподключения')
        log('💡 Проверьте настройки сервера и попробуйте запустить бота вручную')
      }
    } else if (errorMsg.includes('ECONNREFUSED')) {
      log('🚫 Подключение отклонено сервером')
      log(`💡 Убедитесь, что сервер запущен на ${CONFIG.HOST}:${CONFIG.PORT}`)
    } else if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('getaddrinfo')) {
      log('🌐 Не удалось найти сервер')
      log(`💡 Проверьте правильность адреса: ${CONFIG.HOST}`)
    } else if (errorMsg.includes('authentication')) {
      log('🔐 Ошибка аутентификации')
      log('💡 Для онлайн-серверов может потребоваться настройка auth')
    }
  })

  bot.on('end', (reason) => {
    // Логирование только критичных ошибок
    if (CONFIG.LOG_ERRORS_ONLY && reason) {
      log('🔌 Отключен от сервера:', reason)
    }
    isRunning = false
    stopParallelSystems()
    
    reconnectAttempts++
    if (CONFIG.AUTO_RECONNECT && reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      setTimeout(() => {
        bot = null
        createBot()
      }, CONFIG.RECONNECT_DELAY)
    }
  })
  
  // Обработка событий подключения
  bot.on('connect', () => {
    log('🔗 Установлено соединение с сервером...')
  })
  
  bot.on('login', () => {
    log('🔐 Выполняется вход на сервер...')
  })

  bot.on('health', () => {
    if (bot.health < CONFIG.FLEE_HEALTH) {
      log(`⚠️  КРИТИЧЕСКОЕ здоровье: ${bot.health.toFixed(1)}/20, Голод: ${bot.food}/20`)
    }
  })

  bot.on('death', () => {
    log('💀 Бот умер!')
    const deathPos = bot.entity.position.clone()
    Memory.markDangerous(deathPos)
    log(`📍 Место смерти отмечено как опасное: ${deathPos}`)
  })

  bot.on('entitySpawn', (entity) => {
    if (entity.type === 'mob' && entity.mobType) {
      // Сохраняем позицию моба
      const mobType = entity.mobType
      if (!Memory.mobLocations.has(mobType)) {
        Memory.mobLocations.set(mobType, [])
      }
      Memory.mobLocations.get(mobType).push({
        pos: entity.position.clone(),
        timestamp: Date.now()
      })
    }
  })

  bot.on('blockUpdate', (oldBlock, newBlock) => {
    // Отслеживаем изменения блоков (ресурсы, опасности)
    if (newBlock && newBlock.name) {
      const name = newBlock.name
      if (name.includes('lava') || name.includes('fire')) {
        Memory.markDangerous(newBlock.position)
      }
    }
  })

  bot.on('playerJoined', (player) => {
    log(`👋 Игрок присоединился: ${player.username}`)
  })

  bot.on('playerLeft', (player) => {
    log(`👋 Игрок покинул: ${player.username}`)
  })
}

// ==================== СИСТЕМА РОЛЕВОЙ ИГРЫ ====================
let roleplayInterval = null
let lastRoleplayCheck = 0

function startRoleplayMode() {
  log('🎮 Запуск системы ролевой игры...')
  if (roleplayInterval) {
    clearInterval(roleplayInterval)
  }
  
  roleplayInterval = setInterval(() => {
    if (!CONFIG.ROLEPLAY_MODE || !isRunning || !bot.entity) return
    const now = Date.now()
    if (now - lastRoleplayCheck > 2000) { // Проверяем каждые 2 секунды
      lastRoleplayCheck = now
      checkRoleplayNeeds()
    }
  }, 2000)
  
  // Сразу запускаем первую проверку
  checkRoleplayNeeds()
}

function stopRoleplayMode() {
  if (roleplayInterval) {
    clearInterval(roleplayInterval)
    roleplayInterval = null
  }
}

async function checkRoleplayNeeds() {
  if (!bot.entity || !mcData) return
  
  log('🤔 Проверяю что нужно для развития...')
  
  // 1. Проверка базовых инструментов
  const hasWoodenPickaxe = countItem('wooden_pickaxe') > 0
  const hasWoodenAxe = countItem('wooden_axe') > 0
  const hasWoodenSword = countItem('wooden_sword') > 0
  const hasCraftingTable = countItem('crafting_table') > 0
  
  // 2. Проверка ресурсов
  const logCount = countItem('oak_log') + countItem('birch_log') + countItem('spruce_log') + countItem('jungle_log') + countItem('acacia_log') + countItem('dark_oak_log')
  const plankCount = countItem('oak_planks') + countItem('birch_planks') + countItem('spruce_planks')
  const cobblestoneCount = countItem('cobblestone')
  const coalCount = countItem('coal')
  const ironCount = countItem('iron_ingot')
  const foodCount = bot.inventory.items().filter(i => {
    const name = i.name || ''
    return /apple|bread|beef|cooked|porkchop|chicken|mutton|carrot|potato|steak/i.test(name)
  }).reduce((s, i) => s + i.count, 0)
  
  // 3. Проверка печи
  const hasFurnace = countItem('furnace') > 0
  
  // Приоритет 1: Дерево для базовых инструментов
  if (logCount < 8 && !TaskQueue.hasTasks()) {
    log('🌳 Нужно больше дерева! Ищу дерево для добычи...')
    const logBlock = bot.findBlock({
      matching: (b) => {
        const def = mcData.blocks[b.type]
        return def && (def.name.includes('_log') || def.name === 'log')
      },
      maxDistance: 32
    })
    if (logBlock) {
      TaskQueue.add({
        type: 'mine',
        block: logBlock,
        tool: 'axe',
        priority: TaskQueue.priority.RESOURCE
      })
      log(`🌳 Нашел дерево на ${logBlock.position}, иду добывать`)
    } else {
      log('🌳 Дерево не найдено рядом, исследую территорию...')
      TaskQueue.add({
        type: 'explore',
        priority: TaskQueue.priority.EXPLORE
      })
    }
  }
  
  // Приоритет 2: Доски для верстака
  if (plankCount < 4 && logCount >= 1 && !hasCraftingTable && !TaskQueue.hasTasks()) {
    log('🪵 Нужны доски для верстака, крафчу доски из бревен...')
    const logItem = bot.inventory.items().find(i => {
      const name = i.name || ''
      return name.includes('_log') || name === 'log' || name === 'log2'
    })
    
    if (logItem) {
      log(`🪵 Нашел бревно: ${logItem.name}, определяю тип досок...`)
      
      // Определяем тип досок из типа бревна
      const logType = logItem.name
      let plankType = 'oak_planks' // По умолчанию
      
      if (logType.includes('oak')) plankType = 'oak_planks'
      else if (logType.includes('birch')) plankType = 'birch_planks'
      else if (logType.includes('spruce')) plankType = 'spruce_planks'
      else if (logType.includes('jungle')) plankType = 'jungle_planks'
      else if (logType.includes('acacia')) plankType = 'acacia_planks'
      else if (logType.includes('dark_oak')) plankType = 'dark_oak_planks'
      else if (logType === 'log' || logType === 'log2') plankType = 'oak_planks'
      else {
        // Пробуем заменить _log на _planks
        plankType = logType.replace('_log', '_planks').replace('log', 'planks')
      }
      
      log(`🔨 Крафчу ${plankType} из ${logType}...`)
      
      // Используем систему крафта через TaskQueue для надежности
      TaskQueue.add({
        type: 'craft',
        item: plankType,
        quantity: 4,
        priority: TaskQueue.priority.CRAFT
      })
    } else {
      log('⚠️  Нет бревен в инвентаре для крафта досок')
    }
  }
  
  // Приоритет 3: Верстак
  if (!hasCraftingTable && plankCount >= 4) {
    log('🔨 Нужен верстак, крафчу верстак...')
    TaskQueue.add({
      type: 'craft',
      item: 'crafting_table',
      quantity: 1,
      priority: TaskQueue.priority.CRAFT
    })
  }
  
  // Приоритет 4: Деревянные инструменты
  if (hasCraftingTable && plankCount >= 2) {
    if (!hasWoodenPickaxe && !TaskQueue.hasTasks()) {
      log('⛏️ Нужна деревянная кирка, крафчу...')
      TaskQueue.add({
        type: 'craft',
        item: 'wooden_pickaxe',
        quantity: 1,
        priority: TaskQueue.priority.CRAFT
      })
    }
    if (!hasWoodenAxe && !TaskQueue.hasTasks()) {
      log('🪓 Нужен деревянный топор, крафчу...')
      TaskQueue.add({
        type: 'craft',
        item: 'wooden_axe',
        quantity: 1,
        priority: TaskQueue.priority.CRAFT
      })
    }
    if (!hasWoodenSword && plankCount >= 2 && !TaskQueue.hasTasks()) {
      log('⚔️ Нужен деревянный меч, крафчу...')
      TaskQueue.add({
        type: 'craft',
        item: 'wooden_sword',
        quantity: 1,
        priority: TaskQueue.priority.CRAFT
      })
    }
  }
  
  // Приоритет 5: Камень
  if (hasWoodenPickaxe && cobblestoneCount < 20 && !TaskQueue.hasTasks()) {
    log('🪨 Нужен камень, ищу камень для добычи...')
    const stoneBlock = bot.findBlock({
      matching: (b) => {
        const def = mcData.blocks[b.type]
        return def && (def.name === 'stone' || def.name === 'cobblestone')
      },
      maxDistance: 32
    })
    if (stoneBlock) {
      TaskQueue.add({
        type: 'mine',
        block: stoneBlock,
        tool: 'pickaxe',
        priority: TaskQueue.priority.RESOURCE
      })
      log(`🪨 Нашел камень на ${stoneBlock.position}, иду добывать`)
    }
  }
  
  // Приоритет 6: Печь
  if (cobblestoneCount >= 8 && !hasFurnace && !TaskQueue.hasTasks()) {
    log('🔥 Нужна печь, крафчу печь...')
    TaskQueue.add({
      type: 'craft',
      item: 'furnace',
      quantity: 1,
      priority: TaskQueue.priority.CRAFT
    })
  }
  
  // Приоритет 7: Еда
  if (foodCount < 10 && !TaskQueue.hasTasks()) {
    log('🍖 Нужна еда, ищу животных...')
    const animals = Object.values(bot.entities).filter(e => {
      if (!e || !e.position) return false
      if (e.type !== 'mob') return false
      const mobType = e.mobType || e.name || ''
      return /pig|cow|chicken|sheep|rabbit/i.test(mobType)
    })
    
    if (animals.length > 0) {
      const nearest = animals.reduce((closest, animal) => {
        const dist1 = bot.entity.position.distanceTo(closest.position)
        const dist2 = bot.entity.position.distanceTo(animal.position)
        return dist2 < dist1 ? animal : closest
      })
      
      const dist = bot.entity.position.distanceTo(nearest.position)
      if (dist < 16) {
        const animalName = nearest.mobType || nearest.name || 'животное'
        log(`🐷 Нашел животное ${animalName} на дистанции ${dist.toFixed(1)} блоков, иду добывать еду...`)
        TaskQueue.add({
          type: 'combat',
          target: nearest,
          priority: TaskQueue.priority.RESOURCE,
          reason: 'food' // Помечаем что это для еды, не для защиты
        })
      }
    } else {
      log('🐷 Животные не найдены, исследую территорию...')
      TaskQueue.add({
        type: 'explore',
        priority: TaskQueue.priority.EXPLORE
      })
    }
  }
  
  // Приоритет 8: Уголь для плавки
  if (hasFurnace && coalCount < 5 && !TaskQueue.hasTasks()) {
    log('⛽ Нужен уголь, ищу угольную руду...')
    const coalBlock = bot.findBlock({
      matching: (b) => {
        const def = mcData.blocks[b.type]
        return def && def.name === 'coal_ore'
      },
      maxDistance: 32
    })
    if (coalBlock) {
      TaskQueue.add({
        type: 'mine',
        block: coalBlock,
        tool: 'pickaxe',
        priority: TaskQueue.priority.RESOURCE
      })
      log(`⛽ Нашел уголь на ${coalBlock.position}, иду добывать`)
    }
  }
  
  // Приоритет 9: Исследование если нет задач
  if (!TaskQueue.hasTasks() && Math.random() < 0.3) {
    log('🗺️ Нет задач, исследую территорию...')
    TaskQueue.add({
      type: 'explore',
      priority: TaskQueue.priority.EXPLORE
    })
  }
}

// ==================== ПАРАЛЛЕЛЬНЫЕ СИСТЕМЫ ====================
function startParallelSystems() {
  // Система мышления (быстрая)
  thinkingInterval = setInterval(async () => {
    if (!isRunning || !bot.entity) return
    await think()
  }, CONFIG.THINK_INTERVAL)
  
  // Система выполнения задач
  taskInterval = setInterval(async () => {
    if (!isRunning || !bot.entity) return
    await processTasks()
  }, CONFIG.TASK_CHECK_INTERVAL)
  
  // Система обновления памяти
  memoryInterval = setInterval(() => {
    if (!isRunning) return
    Memory.cleanup()
    updateMemory()
  }, CONFIG.MEMORY_UPDATE_INTERVAL)
  
  log('🚀 Параллельные системы запущены')
}

function stopParallelSystems() {
  if (thinkingInterval) clearInterval(thinkingInterval)
  if (taskInterval) clearInterval(taskInterval)
  if (memoryInterval) clearInterval(memoryInterval)
  stopRoleplayMode()
}

// ==================== СИСТЕМА МЫШЛЕНИЯ ====================
let lastResourceCheck = 0
let lastNavigationCheck = 0

async function think() {
  try {
    const now = Date.now()
    
    // Всегда проверяем бой и выживание (критично)
    await Promise.all([
      checkCombat(),
      checkSurvival()
    ])
    
    // Ресурсы проверяем реже
    if (now - lastResourceCheck > CONFIG.RESOURCE_CHECK_INTERVAL) {
      lastResourceCheck = now
      await checkResources()
    }
    
    // Навигацию проверяем реже
    if (now - lastNavigationCheck > CONFIG.NAVIGATION_CHECK_INTERVAL) {
      lastNavigationCheck = now
      await checkNavigation()
    }
  } catch (e) {
    // Тихие ошибки в мышлении
  }
}

// Проверка боя
async function checkCombat() {
  if (!bot.entity) return
  
  const nearbyMobs = Object.values(bot.entities).filter(e => {
    if (!e || !e.position) return false
    if (e.type !== 'mob') return false
    if (e === bot.entity) return false
    
    const dist = bot.entity.position.distanceTo(e.position)
    if (dist > 16) return false
    
    // Проверяем агрессивность
    const mobType = e.mobType || e.name || ''
    const aggressive = /zombie|skeleton|creeper|spider|enderman|witch|phantom/i.test(mobType)
    
    return aggressive
  })
  
  if (nearbyMobs.length > 0) {
    const nearest = nearbyMobs.reduce((closest, mob) => {
      const dist1 = bot.entity.position.distanceTo(closest.position)
      const dist2 = bot.entity.position.distanceTo(mob.position)
      return dist2 < dist1 ? mob : closest
    })
    
    const dist = bot.entity.position.distanceTo(nearest.position)
    
    // Если слишком близко и здоровье низкое - бежим (критический приоритет)
    if (dist < 3 && bot.health < CONFIG.FLEE_HEALTH) {
      TaskQueue.add({
        type: 'flee',
        target: nearest,
        priority: TaskQueue.priority.CRITICAL
      })
    } else if (dist < 8) {
      // Атакуем (критический приоритет если очень близко)
      TaskQueue.add({
        type: 'combat',
        target: nearest,
        priority: dist < 4 ? TaskQueue.priority.CRITICAL : TaskQueue.priority.COMBAT
      })
    }
  }
}

// Проверка выживания
async function checkSurvival() {
  if (!bot.entity) return
  
  // Проверка голода
  if (bot.food < CONFIG.EAT_AT_FOOD) {
    const food = bot.inventory.items().find(i => {
      const name = i.name || ''
      return /apple|bread|beef|cooked|porkchop|chicken|mutton|carrot|potato/i.test(name)
    })
    
    if (food) {
      TaskQueue.add({
        type: 'eat',
        item: food,
        priority: TaskQueue.priority.SURVIVAL
      })
    }
  }
  
  // Проверка здоровья
  if (bot.health < CONFIG.EAT_AT_HEALTH && bot.food > 18) {
    const food = bot.inventory.items().find(i => {
      const name = i.name || ''
      return /golden_apple|enchanted_golden_apple|steak|cooked_beef/i.test(name)
    })
    
    if (food) {
      TaskQueue.add({
        type: 'eat',
        item: food,
        priority: TaskQueue.priority.SURVIVAL
      })
    }
  }
}

// Проверка ресурсов (оптимизировано - проверяем только один тип за раз)
let resourceCheckIndex = 0
const resourceTypes = ['oak_log', 'stone', 'cobblestone', 'iron_ore', 'coal_ore']

async function checkResources() {
  if (!bot.entity || !mcData) return
  
  // Проверяем только один тип ресурса за раз для оптимизации
  const type = resourceTypes[resourceCheckIndex % resourceTypes.length]
  resourceCheckIndex++
  
  try {
    const block = bot.findBlock({
      matching: (b) => {
        const def = mcData.blocks[b.type]
        return def && def.name === type
      },
      maxDistance: 32
    })
    
    if (block) {
      Memory.saveResource(type, block.position)
    }
  } catch (e) {
    // Игнорируем ошибки поиска блоков
  }
}

// Проверка навигации
async function checkNavigation() {
  if (!bot.entity) return
  
  const pos = bot.entity.position
  
  // Проверяем опасные блоки рядом
  const dangerousBlocks = bot.findBlocks({
    matching: (b) => {
      const def = mcData.blocks[b.type]
      if (!def) return false
      const name = def.name || ''
      return /lava|fire|cactus|magma/i.test(name)
    },
    maxDistance: CONFIG.DANGER_BLOCK_DISTANCE,
    count: 10
  })
  
  for (const blockPos of dangerousBlocks) {
    Memory.markDangerous(blockPos)
  }
  
  // Проверка застревания
  const lastPos = Memory.pathHistory[Memory.pathHistory.length - 1]
  if (lastPos && pos.distanceTo(lastPos) < 0.5) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
    Memory.stuckPositions.add(key)
  }
  
  // Сохраняем историю пути
  Memory.pathHistory.push(pos.clone())
  if (Memory.pathHistory.length > 100) {
    Memory.pathHistory.shift()
  }
}

// Обновление памяти
function updateMemory() {
  if (!bot.entity) return
  
  const pos = bot.entity.position
  
  // Обновляем время дня/ночи
  if (bot.time.timeOfDay !== undefined) {
    const time = bot.time.timeOfDay
    if (time >= 0 && time < 13000) {
      Memory.lastDayTime = Date.now()
    } else {
      Memory.lastNightTime = Date.now()
    }
  }
}

// ==================== ОБРАБОТКА ЗАДАЧ ====================
async function processTasks() {
  // Проверяем прерывание критической задачей
  if (TaskQueue.canInterrupt()) {
    log('🛑 Прерывание текущей задачи критической угрозой')
    TaskQueue.currentTask = null
    TaskQueue.isExecuting = false
    // Останавливаем движение
    try {
      bot.pathfinder.setGoal(null)
    } catch (e) {}
  }
  
  // Если уже выполняем задачу - не берем новую
  if (TaskQueue.isExecuting) {
    return
  }
  
  if (TaskQueue.currentTask) {
    // Выполняем текущую задачу
    TaskQueue.isExecuting = true
    log(`▶️  Выполняю задачу: ${TaskQueue.currentTask.type} (приоритет: ${TaskQueue.currentTask.priority})`)
    try {
      const result = await executeTask(TaskQueue.currentTask)
      if (result === 'done') {
        log(`✅ Задача выполнена: ${TaskQueue.currentTask.type}`)
        TaskQueue.currentTask = null
        TaskQueue.isExecuting = false
        TaskQueue.interruptFlag = false
      } else if (result === 'failed') {
        log(`❌ Задача провалена: ${TaskQueue.currentTask.type}`)
        TaskQueue.currentTask = null
        TaskQueue.isExecuting = false
        TaskQueue.interruptFlag = false
      } else if (result === 'interrupted') {
        log(`⚠️  Задача прервана: ${TaskQueue.currentTask.type}`)
        TaskQueue.currentTask = null
        TaskQueue.isExecuting = false
        TaskQueue.interruptFlag = false
      }
    } catch (e) {
      log(`❌ Ошибка выполнения задачи ${TaskQueue.currentTask.type}:`, e.message)
      TaskQueue.currentTask = null
      TaskQueue.isExecuting = false
      TaskQueue.interruptFlag = false
    }
  } else {
    // Берем новую задачу
    const task = TaskQueue.getNext()
    if (task) {
      TaskQueue.currentTask = task
      TaskQueue.interruptFlag = false
      log(`📋 Начата новая задача: ${task.type} (приоритет: ${task.priority})`)
    } else {
      // Нет задач - если режим ролевой игры, он сам добавит задачи
      if (!CONFIG.ROLEPLAY_MODE && Math.random() < 0.3) {
        TaskQueue.add({
          type: 'explore',
          priority: TaskQueue.priority.EXPLORE
        })
      }
    }
  }
}

async function executeTask(task) {
  // Проверяем прерывание перед выполнением
  if (TaskQueue.interruptFlag && task.priority < TaskQueue.priority.CRITICAL) {
    return 'interrupted'
  }
  
  try {
    switch (task.type) {
      case 'combat':
        return await handleCombat(task.target)
      case 'flee':
        return await handleFlee(task.target)
      case 'eat':
        return await handleEat(task.item)
      case 'mine':
        return await handleMine(task.block, task.tool)
      case 'craft':
        return await handleCraft(task.item, task.quantity)
      case 'go':
        return await handleGo(task.position, task.range)
      case 'explore':
        return await handleExplore()
      default:
        return 'done'
    }
  } catch (e) {
    // Проверяем, не прервано ли
    if (TaskQueue.interruptFlag && task.priority < TaskQueue.priority.CRITICAL) {
      return 'interrupted'
    }
    throw e
  }
}

// ==================== ОБРАБОТЧИКИ ЗАДАЧ ====================

// Бой
async function handleCombat(target) {
  if (!target || !target.position) return 'done'
  
  const dist = bot.entity.position.distanceTo(target.position)
  const mobType = target.mobType || target.name || 'unknown'
  
  if (dist > 16) {
    log(`⚔️  Моб ${mobType} слишком далеко (${dist.toFixed(1)} блоков), прекращаю бой`)
    return 'done'
  }
  
  log(`⚔️  Вступаю в бой с ${mobType} (дистанция: ${dist.toFixed(1)} блоков)`)
  
  // Проверяем прерывание
  if (TaskQueue.interruptFlag) {
    return 'interrupted'
  }
  
  // Проверяем тип моба
  const isCreeper = /creeper/i.test(mobType)
  
  if (isCreeper && dist < 4) {
    // Крипер близко - отступаем
    const fleeDir = bot.entity.position.minus(target.position).normalize()
    const fleePos = bot.entity.position.plus(fleeDir.scaled(5))
    try {
      await goToPositionSafe(fleePos, 2, 10000)
    } catch (e) {
      // Игнорируем ошибки перемещения
    }
    return 'done'
  }
  
  // Подходим на оптимальную дистанцию
  if (dist > CONFIG.COMBAT_DISTANCE) {
    try {
      await goToPositionSafe(target.position, CONFIG.COMBAT_DISTANCE, 15000)
    } catch (e) {
      // Продолжаем даже при ошибке перемещения
    }
  } else if (dist < CONFIG.COMBAT_DISTANCE - 1) {
    // Отступаем немного
    const fleeDir = bot.entity.position.minus(target.position).normalize()
    const fleePos = bot.entity.position.plus(fleeDir.scaled(2))
    try {
      await goToPositionSafe(fleePos, 1, 10000)
    } catch (e) {
      // Игнорируем
    }
  }
  
  // Атакуем
  try {
    bot.attack(target)
  } catch (e) {
    // Игнорируем ошибки атаки
  }
  
  return 'continue' // Продолжаем бой
}

// Бегство
async function handleFlee(target) {
  if (!target || !target.position) return 'done'
  
  const fleeDir = bot.entity.position.minus(target.position).normalize()
  const fleePos = bot.entity.position.plus(fleeDir.scaled(10))
  
  await goToPositionSafe(fleePos, 3)
  
  // Проверяем, убежали ли
  const dist = bot.entity.position.distanceTo(target.position)
  if (dist > 16) {
    return 'done'
  }
  
  return 'continue'
}

// Еда
async function handleEat(item) {
  if (!item) return 'done'
  
  log(`🍖 Ем ${item.name} (здоровье: ${bot.health.toFixed(1)}/20, голод: ${bot.food}/20)`)
  try {
    await bot.equip(item, 'hand')
    await bot.consume()
    await sleep(1000)
    log(`✅ Поел ${item.name}, теперь голод: ${bot.food}/20`)
    return 'done'
  } catch (e) {
    log(`❌ Ошибка при еде: ${e.message}`)
    return 'failed'
  }
}

// ==================== СИСТЕМА УМНОЙ ДОБЫЧИ ====================

const MINING_CONFIG = {
  CLUSTER_SEARCH_RADIUS: 1.5,
  MAX_CLUSTER_SIZE: 64,
  MAX_SEARCH_DEPTH: 10,
  LOG_COLORS: {
    ORE: '\x1b[36m',    // Cyan (Руда)
    WOOD: '\x1b[33m',   // Yellow (Дерево)
    STONE: '\x1b[37m',  // White (Камень)
    INFO: '\x1b[32m',   // Green (Инфо)
    WARN: '\x1b[31m',   // Red (Ошибка)й
    RESET: '\x1b[0m'    // Reset
  }
}

const MiningLogger = {
  startTime: 0,
  blocksMined: 0,
  
  startSession(resourceName) {
    this.startTime = Date.now()
    this.blocksMined = 0
    const color = this.getColor(resourceName)
    console.log(`${color}⛏️  НАЧАЛО ДОБЫЧИ КЛАСТЕРА: ${resourceName}${MINING_CONFIG.LOG_COLORS.RESET}`)
  },
  
  logBlock(resourceName, position, current, total) {
    this.blocksMined++
    const duration = (Date.now() - this.startTime) / 1000
    const bpm = duration > 0 ? (this.blocksMined / (duration / 60)).toFixed(1) : 0
    const percent = Math.round((current / total) * 100)
    const color = this.getColor(resourceName)
    
    // Форматируем вывод в одну строку с обновлением
    console.log(
      `${color}🔨 [${resourceName}] ` +
      `Pos: ${position.x},${position.y},${position.z} | ` +
      `Progress: ${percent}% (${current}/${total}) | ` +
      `Speed: ${bpm} blk/min${MINING_CONFIG.LOG_COLORS.RESET}`
    )
  },
  
  endSession(resourceName) {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1)
    const bpm = duration > 0 ? (this.blocksMined / (duration / 60)).toFixed(1) : 0
    console.log(
      `${MINING_CONFIG.LOG_COLORS.INFO}✅ КЛАСТЕР ${resourceName} ДОБЫТ\n` +
      `   Всего блоков: ${this.blocksMined}\n` +
      `   Время: ${duration} сек\n` +
      `   Эффективность: ${bpm} блоков/мин${MINING_CONFIG.LOG_COLORS.RESET}`
    )
  },
  
  getColor(name) {
    if (name.includes('ore') || name.includes('diamond') || name.includes('gold') || name.includes('iron') || name.includes('coal')) return MINING_CONFIG.LOG_COLORS.ORE
    if (name.includes('log') || name.includes('wood') || name.includes('planks') || name.includes('leaves')) return MINING_CONFIG.LOG_COLORS.WOOD
    return MINING_CONFIG.LOG_COLORS.STONE
  }
}

// Алгоритм поиска кластера (BFS)
async function scanCluster(startBlock) {
  const cluster = []
  const visited = new Set()
  const queue = [startBlock]
  const type = startBlock.type
  
  visited.add(startBlock.position.toString())
  
  let iterations = 0
  const maxIterations = 1000 // Защита от зависания
  
  while (queue.length > 0 && cluster.length < MINING_CONFIG.MAX_CLUSTER_SIZE && iterations < maxIterations) {
    iterations++
    const currentBlock = queue.shift()
    cluster.push(currentBlock)
    
    // Смещения для поиска соседей (включая диагонали для плотных жил)
    const offsets = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 1, 0), new Vec3(0, -1, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1),
      // Диагонали
      new Vec3(1, 1, 0), new Vec3(1, -1, 0),
      new Vec3(-1, 1, 0), new Vec3(-1, -1, 0),
      new Vec3(0, 1, 1), new Vec3(0, -1, 1),
      new Vec3(0, 1, -1), new Vec3(0, -1, -1)
    ]

    for (const off of offsets) {
       const neighborPos = currentBlock.position.plus(off)
       const key = neighborPos.toString()
       
       if (!visited.has(key)) {
         visited.add(key)
         const neighborBlock = bot.blockAt(neighborPos)
         if (neighborBlock && neighborBlock.type === type) {
           queue.push(neighborBlock)
         }
       }
    }
  }
  return cluster
}

// Добыча
async function handleMine(block, toolType) {
  if (!block) return 'done'
  
  const blockName = block.name || 'unknown'
  
  try {
    // Автоматически определяем нужный инструмент если не указан
    if (!toolType) {
      const name = blockName.toLowerCase()
      if (name.includes('log') || name.includes('wood') || name.includes('planks') || name.includes('leaves')) {
        toolType = 'axe'
      } else if (name.includes('stone') || name.includes('ore') || name.includes('cobblestone') || name.includes('coal') || name.includes('iron') || name.includes('gold') || name.includes('diamond') || name.includes('emerald')) {
        toolType = 'pickaxe'
      } else if (name.includes('dirt') || name.includes('sand') || name.includes('gravel') || name.includes('clay')) {
        toolType = 'shovel'
      }
    }
    
    // Подбираем лучший инструмент
    if (toolType) {
      await equipBestTool(toolType)
    }
    
    // ЗАПУСК УМНОЙ ДОБЫЧИ
    MiningLogger.startSession(blockName)
    
    // 1. Сканируем весь кластер
    const cluster = await scanCluster(block)
    log(`� Обнаружен кластер ${blockName}: ${cluster.length} блоков`)
    
    const totalBlocks = cluster.length
    let minedCount = 0
    
    // 2. Добываем блоки по одному
    while (cluster.length > 0) {
        // Проверяем прерывание
        if (TaskQueue.interruptFlag) {
            log('⚠️ Добыча прервана')
            return 'interrupted'
        }
        
        // ОПТИМИЗАЦИЯ ПУТИ: Сортируем оставшиеся блоки по дистанции от текущей позиции
        // Бот всегда идет к ближайшему блоку в кластере
        cluster.sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))
        
        const targetBlock = cluster.shift()
        
        // Проверка существования блока (мог быть добыт другим или исчезнуть)
        const currentBlockState = bot.blockAt(targetBlock.position)
        if (!currentBlockState || currentBlockState.type !== block.type) {
            continue
        }
        
        // Подходим если далеко
        if (bot.entity.position.distanceTo(targetBlock.position) > 4) {
            await goToPositionSafe(targetBlock.position, 1)
        }
        
        // Добываем
        await digBlockReliable(targetBlock, toolType)
        minedCount++
        
        // Логирование и статистика
        MiningLogger.logBlock(blockName, targetBlock.position, minedCount, totalBlocks)
        
        // Сохраняем ресурс в память (обновляем данные)
        Memory.saveResource(blockName, targetBlock.position)
        
        // Небольшая пауза для реалистичности и обновления физики
        await sleep(100)
    }
    
    MiningLogger.endSession(blockName)
    return 'done'
    
  } catch (e) {
    log(`❌ Ошибка при добыче ${blockName}: ${e.message}`)
    return 'failed'
  }
}

// Крафт
// Крафт (Новая рекурсивная система)
async function handleCraft(itemName, quantity) {
  quantity = quantity || 1

  log(`🔨 Крафчу ${itemName} x${quantity}`)

  try {
    // Пробуем найти предмет в базе данных
    let itemDef = mcData.itemsByName[itemName]

    // Если не найден, пробуем варианты с подчеркиванием
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
          log(`✅ Найден предмет как: ${variant}`)
          itemName = variant
          break
        }
      }
    }

    if (!itemDef) {
      log(`❌ Предмет ${itemName} не найден в базе данных`)
      log(`💡 Попробуйте проверить правильность названия предмета`)
      return 'failed'
    }

    log(`📦 ID предмета: ${itemDef.id}, название: ${itemDef.name}`)

    // Запуск рекурсивной проверки и крафта
    try {
        await ensureItem(itemName, quantity)
        log(`✅ Успешно скрафтил ${itemName} x${quantity}`)
        
        // АВТО-ИСПОЛЬЗОВАНИЕ ПОСЛЕ КРАФТА
        await handlePostCraft(itemName)
        
        return 'done'
    } catch (e) {
        log(`❌ Ошибка крафта: ${e.message}`)
        bot.chat(`Не могу скрафтить ${itemName}: ${e.message}`)
        return 'failed'
    }

  } catch (e) {
    log(`❌ Ошибка при крафте ${itemName}: ${e.message}`)
    if (e.stack) {
      log(`   Stack: ${e.stack.split('\n')[0]}`)
    }
    return 'failed'
  }
}

// Автоматическое использование предмета после крафта
async function handlePostCraft(itemName) {
  // 1. Установка функциональных блоков
  if (itemName === 'crafting_table' || itemName === 'furnace' || itemName === 'chest') {
    log(`🏗️ Авто-установка ${itemName}...`)
    await placeBlockNear(itemName)
  }
  
  // 2. Экипировка инструментов
  if (itemName.includes('pickaxe') || itemName.includes('sword') || itemName.includes('axe') || itemName.includes('shovel')) {
    log(`⚔️ Авто-экипировка ${itemName}...`)
    const itemDef = mcData.itemsByName[itemName]
    if (itemDef) {
        try {
            await bot.equip(itemDef.id, 'hand')
        } catch (e) {
            log(`⚠️ Не удалось экипировать ${itemName}: ${e.message}`)
        }
    }
  }
}

// Утилита для установки блока рядом
async function placeBlockNear(blockName) {
  const item = bot.inventory.items().find(i => i.name === blockName)
  if (!item) return false

  const nearBlock = bot.findBlock({
    matching: (b) => b.type !== 0 && b.boundingBox === 'block' && b.name !== 'air',
    maxDistance: 4
  })
  
  if (nearBlock) {
     try {
       // Ставим на блок сверху
       await bot.equip(item, 'hand')
       await bot.placeBlock(nearBlock, new Vec3(0, 1, 0))
       await sleep(500)
       return true
     } catch (e) {
        log(`⚠️ Не удалось поставить ${blockName}: ${e.message}`)
     }
  }
  return false
}

// Рекурсивная функция обеспечения наличия предмета
async function ensureItem(itemName, quantity, depth = 0) {
  const indent = '  '.repeat(depth)
  const itemDef = mcData.itemsByName[itemName]
  if (!itemDef) throw new Error(`Unknown item: ${itemName}`)
  
  const current = countItem(itemName)
  if (current >= quantity) {
    if (depth > 0) log(`${indent}✅ ${itemName}: есть ${current}, нужно ${quantity}`)
    return true
  }

  const missing = quantity - current
  log(`${indent}🔍 Нужно ${itemName} x${missing} (есть ${current}). Ищу рецепт...`)

  // Ищем рецепты
  const recipes = bot.recipesFor(itemDef.id, null, 1, true)
  if (!recipes || recipes.length === 0) {
    // Пробуем добыть, если это базовый ресурс (бревна, камень)
    if (itemName.includes('log') || itemName.includes('stone') || itemName.includes('cobblestone')) {
        log(`${indent}⛏️ Нет рецепта, пытаюсь добыть ${itemName}...`)
        // Тут можно вызвать добычу, но пока просто кидаем ошибку чтобы не усложнять рекурсию
        // В будущем можно интегрировать TaskQueue
    }
    log(`${indent}❌ Нет рецепта для ${itemName}. Это базовый ресурс.`)
    throw new Error(`нет ресурса ${itemName}`)
  }

  // Сортируем рецепты (простые первыми)
  recipes.sort((a, b) => (a.ingredients ? a.ingredients.length : 0) - (b.ingredients ? b.ingredients.length : 0))

  let lastError = null
  
  for (const recipe of recipes) {
    try {
      const times = Math.ceil(missing / recipe.resultCount)
      log(`${indent}📋 Попытка рецепта для ${itemName} (x${times} крафтов)`)
      
      // Проверяем и создаем ингредиенты
      if (recipe.ingredients) {
        for (const ing of recipe.ingredients) {
          const ingName = mcData.items[ing.id].name
          const needed = ing.count * times
          await ensureItem(ingName, needed, depth + 1)
        }
      }
      
      // Если нужен верстак
      let tableBlock = null
      if (recipe.requiresTable) {
        log(`${indent}🛠️ Требуется верстак`)
        tableBlock = bot.findBlock({
          matching: (b) => b.name === 'crafting_table',
          maxDistance: 4
        })
        
        if (!tableBlock) {
          log(`${indent}🛠️ Верстак не найден рядом. Проверяю инвентарь...`)
          
          // Проверяем, есть ли верстак, если нет - крафтим
          if (countItem('crafting_table') === 0) {
              await ensureItem('crafting_table', 1, depth + 1)
          }
          
          // Ставим верстак
          const placed = await placeBlockNear('crafting_table')
          if (placed) {
              tableBlock = bot.findBlock({
                matching: (b) => b.name === 'crafting_table',
                maxDistance: 5
              })
          }
        }
        
        if (!tableBlock) {
           throw new Error('Нужен верстак, но не могу его найти или поставить')
        }
      }
      
      // Крафт
      log(`${indent}🔨 Крафчу ${itemName} x${times * recipe.resultCount}...`)
      await bot.craft(recipe, times, tableBlock)
      log(`${indent}✅ Скрафчено ${itemName}`)
      
      // Проверка результата
      await sleep(200)
      const newCount = countItem(itemName)
      if (newCount >= (current + (times * recipe.resultCount)) || newCount >= quantity) {
        return true
      }
      return true
      
    } catch (e) {
      lastError = e
      log(`${indent}⚠️ Рецепт не сработал: ${e.message}`)
      continue 
    }
  }
  
  throw lastError || new Error(`Не удалось скрафтить ${itemName}`)
}

// Перемещение
async function handleGo(position, range) {
  range = range || 2
  
  const dist = bot.entity.position.distanceTo(position)
  log(`🚶 Иду к позиции ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)} (дистанция: ${dist.toFixed(1)} блоков)`)
  
  // Проверяем прерывание
  if (TaskQueue.interruptFlag) {
    log('⚠️  Перемещение прервано')
    return 'interrupted'
  }
  
  try {
    await goToPositionSafe(position, range, 20000)
    log(`✅ Достиг цели на позиции ${position.x.toFixed(1)}, ${position.y.toFixed(1)}, ${position.z.toFixed(1)}`)
    return 'done'
  } catch (e) {
    // Проверяем, не прервано ли
    if (TaskQueue.interruptFlag) {
      log('⚠️  Перемещение прервано')
      return 'interrupted'
    }
    // Для таймаутов не считаем это ошибкой - возможно уже близко
    if (e.message && e.message.includes('timeout')) {
      const currentPos = bot.entity.position
      const dist = currentPos.distanceTo(position)
      if (dist <= range * 3) {
        log(`✅ Достаточно близко к цели (${dist.toFixed(1)} блоков)`)
        return 'done'
      }
    }
    log(`❌ Ошибка при перемещении: ${e.message}`)
    return 'failed'
  }
}

// Исследование
async function handleExplore() {
  log('🗺️  Начинаю исследование территории...')
  // Выбираем случайное направление, избегая опасных зон
  const currentPos = bot.entity.position
  let explorePos = null
  let attempts = 0
  
  while (!explorePos && attempts < 10) {
    const angle = Math.random() * Math.PI * 2
    const distance = 10 + Math.random() * 20
    const offset = new Vec3(
      Math.cos(angle) * distance,
      0,
      Math.sin(angle) * distance
    )
    
    explorePos = currentPos.plus(offset)
    
    // Проверяем, не опасная ли зона
    if (Memory.isDangerous(explorePos)) {
      explorePos = null
      attempts++
      continue
    }
    
    // Проверяем, не застревали ли здесь
    const key = `${Math.floor(explorePos.x)},${Math.floor(explorePos.y)},${Math.floor(explorePos.z)}`
    if (Memory.stuckPositions.has(key)) {
      explorePos = null
      attempts++
      continue
    }
    
    break
  }
  
  if (explorePos) {
    log(`🗺️  Исследую направление: ${explorePos.x.toFixed(1)}, ${explorePos.y.toFixed(1)}, ${explorePos.z.toFixed(1)}`)
    await goToPositionSafe(explorePos, 3)
    Memory.saveLocation(`explore_${Date.now()}`, explorePos, 'explore')
    log('✅ Исследование завершено, новое место сохранено в память')
  } else {
    log('⚠️  Не удалось найти безопасное место для исследования')
  }
  
  return 'done'
}

// ==================== УЛУЧШЕННАЯ НАВИГАЦИЯ ====================

// Безопасное перемещение с обходом опасностей
async function goToPositionSafe(targetPos, range = 2, timeout = 20000) {
  if (!bot.entity) return
  
  // Проверяем прерывание
  if (TaskQueue.interruptFlag) {
    throw new Error('interrupted')
  }
  
  const startPos = bot.entity.position
  const dist = startPos.distanceTo(targetPos)
  
  // Если очень близко - просто идем напрямую
  if (dist < 5) {
    return await goToPosition(targetPos, range, Math.min(timeout, 10000))
  }
  
  // Проверяем прямой путь на опасности
  const path = calculateSafePath(startPos, targetPos)
  
  if (path.length === 0) {
    // Прямой путь безопасен или используем обычный pathfinder
    return await goToPosition(targetPos, range, timeout)
  }
  
  // Идем по безопасному пути (максимум 3 waypoint для скорости)
  const waypoints = path.slice(0, 3)
  for (const waypoint of waypoints) {
    if (!isRunning || TaskQueue.interruptFlag) break
    try {
      await goToPosition(waypoint, 2, 8000)
    } catch (e) {
      // Продолжаем даже при ошибке
      if (e.message && e.message.includes('interrupted')) {
        throw e
      }
    }
  }
  
  // Финальное приближение
  if (!TaskQueue.interruptFlag) {
    return await goToPosition(targetPos, range, timeout)
  } else {
    throw new Error('interrupted')
  }
}

// Расчет безопасного пути
function calculateSafePath(start, end) {
  const path = []
  const steps = 10
  const step = end.minus(start).scaled(1 / steps)
  
  for (let i = 1; i < steps; i++) {
    const waypoint = start.plus(step.scaled(i))
    
    // Проверяем опасность
    if (!Memory.isDangerous(waypoint)) {
      path.push(waypoint)
    } else {
      // Обходим опасность
      const avoidPos = avoidDanger(waypoint)
      if (avoidPos) {
        path.push(avoidPos)
      }
    }
  }
  
  return path
}

// Обход опасности
function avoidDanger(dangerPos) {
  // Пробуем обойти с разных сторон
  const offsets = [
    new Vec3(2, 0, 0),
    new Vec3(-2, 0, 0),
    new Vec3(0, 0, 2),
    new Vec3(0, 0, -2),
    new Vec3(2, 0, 2),
    new Vec3(-2, 0, -2)
  ]
  
  for (const offset of offsets) {
    const avoidPos = dangerPos.plus(offset)
    if (!Memory.isDangerous(avoidPos)) {
      return avoidPos
    }
  }
  
  return null
}

// Обычное перемещение с правильной очисткой слушателей
let activeNavigationListeners = new Map()

async function goToPosition(pos, range = 1, timeout = 20000) {
  return new Promise((resolve, reject) => {
    if (!bot.entity || !bot.pathfinder) {
      reject(new Error('Bot entity or pathfinder not available'))
      return
    }
    
    // Очищаем предыдущие слушатели для этого типа события
    const listenerKey = 'navigation'
    if (activeNavigationListeners.has(listenerKey)) {
      const oldListeners = activeNavigationListeners.get(listenerKey)
      try {
        bot.removeListener('goal_reached', oldListeners.onReached)
        bot.removeListener('goal_updated', oldListeners.onUpdated)
      } catch (e) {}
    }
    
    const goal = new GoalNear(pos.x, pos.y, pos.z, range)
    
    // Проверяем расстояние - если уже близко, сразу возвращаемся
    const currentPos = bot.entity.position
    const currentDist = currentPos.distanceTo(pos)
    if (currentDist <= range) {
      resolve()
      return
    }
    
    let resolved = false
    let timeoutId = null
    
    const onReached = () => {
      if (resolved) return
      resolved = true
      cleanup()
      resolve()
    }
    
    const onUpdated = () => {
      if (resolved) return
      // Проверяем, не застряли ли и достигли ли цели
      const currentPos = bot.entity.position
      const dist = currentPos.distanceTo(pos)
      if (dist <= range) {
        resolved = true
        cleanup()
        resolve()
      }
    }
    
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      try {
        bot.removeListener('goal_reached', onReached)
        bot.removeListener('goal_updated', onUpdated)
      } catch (e) {}
      activeNavigationListeners.delete(listenerKey)
    }
    
    // Сохраняем слушатели для последующей очистки
    activeNavigationListeners.set(listenerKey, { onReached, onUpdated })
    
    try {
      bot.pathfinder.setGoal(goal)
      bot.once('goal_reached', onReached)
      bot.on('goal_updated', onUpdated)
    } catch (e) {
      cleanup()
      reject(e)
      return
    }
    
    timeoutId = setTimeout(() => {
      if (resolved) return
      resolved = true
      cleanup()
      // Проверяем, может быть уже близко
      const finalPos = bot.entity.position
      const finalDist = finalPos.distanceTo(pos)
      if (finalDist <= range * 2) {
        // Достаточно близко
        resolve()
      } else {
        // Действительно таймаут
        reject(new Error('go timeout'))
      }
    }, timeout)
  })
}

// ==================== УТИЛИТЫ ====================

function inventorySummary() {
  return bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ') || 'пустой'
}

function countItem(name) {
  return bot.inventory.items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0)
}

async function equipBestTool(toolType) {
  const order = toolType === 'axe'
    ? ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe']
    : toolType === 'pickaxe'
    ? ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe']
    : toolType === 'shovel'
    ? ['netherite_shovel', 'diamond_shovel', 'iron_shovel', 'stone_shovel', 'wooden_shovel']
    : []
    
  for (const name of order) {
    const it = bot.inventory.items().find(i => i.name === name)
    if (it) {
      try {
        await bot.equip(it, 'hand')
        return true
      } catch (e) { }
    }
  }
  return false
}

async function digBlockReliable(block, toolType = null, timeoutMs = 45000) {
  if (!block) throw new Error('Нет блока')
  
  try {
    if (bot.game && bot.game.gameMode === 1) {
      bot.swingArm('right')
      await sleep(200)
      return
    }
  } catch (e) { }
  
  // Выбираем инструмент (если не передан, определяем автоматически)
  if (!toolType) {
    const name = (block.name || '').toLowerCase()
    if (name.includes('log') || name.includes('wood') || name.includes('planks') || name.includes('leaves')) {
      toolType = 'axe'
    } else if (name.includes('stone') || name.includes('ore') || name.includes('cobblestone') || name.includes('coal') || name.includes('iron') || name.includes('gold') || name.includes('diamond') || name.includes('emerald')) {
      toolType = 'pickaxe'
    } else if (name.includes('dirt') || name.includes('sand') || name.includes('gravel') || name.includes('clay')) {
      toolType = 'shovel'
    }
  }
  
  if (toolType) {
    await equipBestTool(toolType)
  }
  
  const startState = bot.blockAt(block.position)
  if (!startState) return
  
  // Специальная обработка для блоков над головой (Fix для вертикальной добычи)
  const botPos = bot.entity.position
  const blockCenter = block.position.offset(0.5, 0.5, 0.5)
  const dy = blockCenter.y - (botPos.y + 1.62) // Разница высоты с глазами
  
  // Если блок выше глаз и близко по горизонтали
  if (dy > 0.5 && Math.abs(botPos.x - blockCenter.x) < 1.5 && Math.abs(botPos.z - blockCenter.z) < 1.5) {
    log('⬆️  Добыча блока над головой: фокусирую взгляд вверх')
    try {
      await bot.lookAt(blockCenter, true)
      await sleep(150) // Визуальная обратная связь (анимация)
    } catch (e) {}
  }

  try {
    await timeoutPromise(new Promise((resolve, reject) => {
      let done = false
      const cb = (err) => {
        if (done) return
        done = true
        if (err) reject(err)
        else resolve()
      }
      try {
        bot.dig(block, cb)
      } catch (e) {
        cb(e)
      }
    }), timeoutMs, 'dig timeout')
    
    // Ждем пока блок исчезнет
    const start = Date.now()
    while (Date.now() - start < 3000) {
      const now = bot.blockAt(block.position)
      if (!now || now.name === 'air') break
      await sleep(150)
    }
    await sleep(120)
  } catch (e) {
    log('digBlockReliable error:', e.message)
    try { bot.stopDigging() } catch (_) { }
    throw e
  }
}


// ==================== СЛОВАРЬ ПЕРЕВОДОВ РУССКИХ НАЗВАНИЙ ====================
const RussianItemNames = {
  // Доски
  'доски': 'oak_planks',
  'доска': 'oak_planks',
  'planks': 'oak_planks',
  
  // Инструменты - кирки
  'деревянная_кирка': 'wooden_pickaxe',
  'деревянная кирка': 'wooden_pickaxe',
  'деревяннаякирка': 'wooden_pickaxe',
  'деревянная_кирка': 'wooden_pickaxe',
  'кирка_деревянная': 'wooden_pickaxe',
  'кирка деревянная': 'wooden_pickaxe',
  'wooden_pickaxe': 'wooden_pickaxe',
  
  'каменная_кирка': 'stone_pickaxe',
  'каменная кирка': 'stone_pickaxe',
  'каменнаякирка': 'stone_pickaxe',
  'кирка_каменная': 'stone_pickaxe',
  'кирка каменная': 'stone_pickaxe',
  'stone_pickaxe': 'stone_pickaxe',
  
  'железная_кирка': 'iron_pickaxe',
  'железная кирка': 'iron_pickaxe',
  'железнаякирка': 'iron_pickaxe',
  'кирка_железная': 'iron_pickaxe',
  'кирка железная': 'iron_pickaxe',
  'iron_pickaxe': 'iron_pickaxe',
  
  'алмазная_кирка': 'diamond_pickaxe',
  'алмазная кирка': 'diamond_pickaxe',
  'алмазнаякирка': 'diamond_pickaxe',
  'кирка_алмазная': 'diamond_pickaxe',
  'кирка алмазная': 'diamond_pickaxe',
  'diamond_pickaxe': 'diamond_pickaxe',
  
  // Инструменты - топоры
  'деревянный_топор': 'wooden_axe',
  'деревянный топор': 'wooden_axe',
  'деревянныйтопор': 'wooden_axe',
  'топор_деревянный': 'wooden_axe',
  'топор деревянный': 'wooden_axe',
  'wooden_axe': 'wooden_axe',
  
  'каменный_топор': 'stone_axe',
  'каменный топор': 'stone_axe',
  'каменныйтопор': 'stone_axe',
  'топор_каменный': 'stone_axe',
  'топор каменный': 'stone_axe',
  'stone_axe': 'stone_axe',
  
  'железный_топор': 'iron_axe',
  'железный топор': 'iron_axe',
  'железныйтопор': 'iron_axe',
  'топор_железный': 'iron_axe',
  'топор железный': 'iron_axe',
  'iron_axe': 'iron_axe',
  
  'алмазный_топор': 'diamond_axe',
  'алмазный топор': 'diamond_axe',
  'алмазныйтопор': 'diamond_axe',
  'топор_алмазный': 'diamond_axe',
  'топор алмазный': 'diamond_axe',
  'diamond_axe': 'diamond_axe',
  
  // Инструменты - лопаты
  'деревянная_лопата': 'wooden_shovel',
  'деревянная лопата': 'wooden_shovel',
  'деревяннаялопата': 'wooden_shovel',
  'лопата_деревянная': 'wooden_shovel',
  'лопата деревянная': 'wooden_shovel',
  'wooden_shovel': 'wooden_shovel',
  
  'каменная_лопата': 'stone_shovel',
  'каменная лопата': 'stone_shovel',
  'каменнаялопата': 'stone_shovel',
  'лопата_каменная': 'stone_shovel',
  'лопата каменная': 'stone_shovel',
  'stone_shovel': 'stone_shovel',
  
  'железная_лопата': 'iron_shovel',
  'железная лопата': 'iron_shovel',
  'железнаялопата': 'iron_shovel',
  'лопата_железная': 'iron_shovel',
  'лопата железная': 'iron_shovel',
  'iron_shovel': 'iron_shovel',
  
  // Инструменты - мечи
  'деревянный_меч': 'wooden_sword',
  'деревянный меч': 'wooden_sword',
  'деревянныймеч': 'wooden_sword',
  'меч_деревянный': 'wooden_sword',
  'меч деревянный': 'wooden_sword',
  'wooden_sword': 'wooden_sword',
  
  'каменный_меч': 'stone_sword',
  'каменный меч': 'stone_sword',
  'каменныймеч': 'stone_sword',
  'меч_каменный': 'stone_sword',
  'меч каменный': 'stone_sword',
  'stone_sword': 'stone_sword',
  
  'железный_меч': 'iron_sword',
  'железный меч': 'iron_sword',
  'железныймеч': 'iron_sword',
  'меч_железный': 'iron_sword',
  'меч железный': 'iron_sword',
  'iron_sword': 'iron_sword',
  
  // Блоки и предметы
  'верстак': 'crafting_table',
  'стол_крафта': 'crafting_table',
  'стол крафта': 'crafting_table',
  'crafting_table': 'crafting_table',
  
  'печь': 'furnace',
  'furnace': 'furnace',
  
  'сундук': 'chest',
  'chest': 'chest',
  
  'факел': 'torch',
  'torch': 'torch',
  'факелы': 'torch',
  
  'палка': 'stick',
  'sticks': 'stick',
  'stick': 'stick',
  
  'уголь': 'coal',
  'coal': 'coal',
  
  'железо': 'iron_ingot',
  'железный_слиток': 'iron_ingot',
  'железный слиток': 'iron_ingot',
  'iron_ingot': 'iron_ingot',
  
  'золото': 'gold_ingot',
  'золотой_слиток': 'gold_ingot',
  'золотой слиток': 'gold_ingot',
  'gold_ingot': 'gold_ingot',
  
  'алмаз': 'diamond',
  'diamond': 'diamond',
  
  'яблоко': 'apple',
  'apple': 'apple',
  
  'хлеб': 'bread',
  'bread': 'bread',
  
  'доски_дуба': 'oak_planks',
  'доски дуба': 'oak_planks',
  'дубовые_доски': 'oak_planks',
  'дубовые доски': 'oak_planks',
  'oak_planks': 'oak_planks',
  
  'доски_березы': 'birch_planks',
  'доски березы': 'birch_planks',
  'березовые_доски': 'birch_planks',
  'березовые доски': 'birch_planks',
  'birch_planks': 'birch_planks',
  
  'доски_ели': 'spruce_planks',
  'доски ели': 'spruce_planks',
  'еловые_доски': 'spruce_planks',
  'еловые доски': 'spruce_planks',
  'spruce_planks': 'spruce_planks',
  
  'лестница': 'ladder',
  'ladder': 'ladder',
  
  'дверь': 'wooden_door',
  'деревянная_дверь': 'wooden_door',
  'деревянная дверь': 'wooden_door',
  'wooden_door': 'wooden_door',
  
  'кровать': 'bed',
  'bed': 'bed',
  
  'стол': 'crafting_table',
  'table': 'crafting_table',
  
  // Дополнительные предметы
  'веревка': 'string',
  'string': 'string',
  'нить': 'string',
  
  'кожа': 'leather',
  'leather': 'leather',
  
  'шерсть': 'wool',
  'wool': 'wool',
  
  'доска': 'oak_planks',
  'plank': 'oak_planks',
  
  // Блоки
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
  
  // Еда
  'мясо': 'beef',
  'beef': 'beef',
  'сырое_мясо': 'beef',
  'сырое мясо': 'beef',
  
  'жареное_мясо': 'cooked_beef',
  'жареное мясо': 'cooked_beef',
  'стейк': 'cooked_beef',
  'steak': 'cooked_beef',
  'cooked_beef': 'cooked_beef'
}

// Функция перевода русского названия в английское техническое
function translateItemName(russianName) {
  if (!russianName) return null
  
  // Нормализуем входное значение
  const normalized = russianName.toLowerCase()
    .replace(/\s+/g, '_')  // Заменяем пробелы на подчеркивания
    .replace(/[^a-zа-яё0-9_]/g, '')  // Убираем спецсимволы
    .trim()
  
  // Прямой поиск
  if (RussianItemNames[normalized]) {
    return RussianItemNames[normalized]
  }
  
  // Поиск с заменой подчеркиваний на пробелы и обратно
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
  
  // Частичный поиск (если содержит ключевые слова)
  for (const [key, value] of Object.entries(RussianItemNames)) {
    // Точное совпадение
    if (normalized === key) {
      return value
    }
    // Если нормализованное название содержит ключ или наоборот
    if (normalized.includes(key) || key.includes(normalized)) {
      // Проверяем что это не слишком общее совпадение
      if (key.length > 3 && normalized.length > 3) {
        return value
      }
    }
  }
  
  // Умный поиск по ключевым словам
  const keywords = {
    'кирка': 'pickaxe',
    'топор': 'axe',
    'лопата': 'shovel',
    'меч': 'sword',
    'деревянн': 'wooden',
    'каменн': 'stone',
    'железн': 'iron',
    'алмазн': 'diamond',
    'доски': 'planks',
    'верстак': 'crafting_table',
    'печь': 'furnace'
  }
  
  let foundType = null
  let foundMaterial = null
  
  for (const [ruKey, enValue] of Object.entries(keywords)) {
    if (normalized.includes(ruKey)) {
      if (ruKey === 'кирка' || ruKey === 'топор' || ruKey === 'лопата' || ruKey === 'меч') {
        foundType = enValue
      } else if (ruKey === 'деревянн' || ruKey === 'каменн' || ruKey === 'железн' || ruKey === 'алмазн') {
        foundMaterial = enValue
      } else {
        // Прямое совпадение
        return enValue
      }
    }
  }
  
  // Если нашли тип и материал, формируем название
  if (foundType && foundMaterial) {
    const combined = `${foundMaterial}_${foundType}`
    if (RussianItemNames[combined] || mcData.itemsByName[combined]) {
      return combined
    }
  }
  
  // Если не найдено, возвращаем исходное значение (может быть уже английское)
  const result = russianName.toLowerCase().replace(/\s+/g, '_').replace(/minecraft:/g, '')
  log(`⚠️  Предмет "${russianName}" не найден в словаре, использую как есть: "${result}"`)
  return result
}

// ==================== КОМАНДЫ ЧАТА ====================
async function handleChatCommand(username, message) {
  const args = message.trim().split(/\s+/)
  const command = args[0].toLowerCase()
  
  if (!command.startsWith('!')) return
  
  const cmd = command.substring(1)
  
  try {
    switch (cmd) {
      case 'inv':
      case 'inventory':
        bot.chat(`📦 Инвентарь: ${inventorySummary()}`)
        break
        
      case 'pos':
      case 'position':
        const pos = bot.entity.position
        bot.chat(`📍 Позиция: X=${pos.x.toFixed(1)}, Y=${pos.y.toFixed(1)}, Z=${pos.z.toFixed(1)}`)
        break
        
      case 'health':
      case 'hp':
        bot.chat(`❤️  Здоровье: ${bot.health.toFixed(1)}/20, Голод: ${bot.food}/20`)
        break
        
      case 'memory':
        const locCount = Memory.knownLocations.size
        const resCount = Array.from(Memory.resourceLocations.values()).reduce((s, arr) => s + arr.length, 0)
        bot.chat(`🧠 Память: ${locCount} мест, ${resCount} ресурсов, ${Memory.dangerousAreas.size} опасных зон`)
        break
        
      case 'home':
        if (Memory.home) {
          bot.chat('🏠 Иду домой')
          TaskQueue.add({
            type: 'go',
            position: Memory.home,
            priority: TaskQueue.priority.USER_COMMAND
          })
        } else {
          bot.chat('❌ Дом не сохранен')
        }
        break
        
      case 'stop':
        TaskQueue.clear()
        bot.pathfinder.setGoal(null)
        bot.chat('🛑 Остановился')
        break
        
      case 'goto':
        if (args.length >= 4) {
          const x = parseFloat(args[1])
          const y = parseFloat(args[2])
          const z = parseFloat(args[3])
          bot.chat(`🚶 Иду к ${x}, ${y}, ${z}`)
          TaskQueue.add({
            type: 'go',
            position: new Vec3(x, y, z),
            priority: TaskQueue.priority.USER_COMMAND
          })
        } else {
          bot.chat('❌ Использование: !goto <x> <y> <z>')
        }
        break
        
      case 'craft':
        if (args[1]) {
          // Объединяем все аргументы кроме первого (команда) и последнего (количество) в название предмета
          const itemNameParts = args.slice(1)
          const lastArg = itemNameParts[itemNameParts.length - 1]
          const possibleQty = parseInt(lastArg)
          
          let itemName, qty
          if (!isNaN(possibleQty) && itemNameParts.length > 1) {
            // Последний аргумент - количество
            qty = possibleQty
            itemName = itemNameParts.slice(0, -1).join('_')
          } else {
            // Количество не указано или указано неправильно
            qty = parseInt(args[args.length - 1]) || 1
            if (!isNaN(parseInt(args[args.length - 1])) && args.length > 2) {
              itemName = itemNameParts.slice(0, -1).join('_')
            } else {
              itemName = itemNameParts.join('_')
            }
          }
          
          // Переводим русское название в английское техническое
          const translatedName = translateItemName(itemName)
          
          log(`🔍 Перевожу "${itemName}" -> "${translatedName}"`)
          
          if (translatedName && translatedName !== itemName) {
            bot.chat(`🔨 Крафчу ${itemName} (${translatedName}) x${qty}`)
          } else {
            bot.chat(`🔨 Крафчу ${itemName} x${qty}`)
          }
          
          TaskQueue.add({
            type: 'craft',
            item: translatedName || itemName,
            quantity: qty,
            priority: TaskQueue.priority.USER_COMMAND
          })
        } else {
          bot.chat('❌ Использование: !craft <предмет> [количество]')
          bot.chat('💡 Примеры: !craft доски, !craft деревянная_кирка, !craft верстак 2')
        }
        break
        
      case 'roleplay':
      case 'rp':
        CONFIG.ROLEPLAY_MODE = !CONFIG.ROLEPLAY_MODE
        if (CONFIG.ROLEPLAY_MODE) {
          bot.chat('🎮 Режим ролевой игры ВКЛЮЧЕН! Начинаю развиваться...')
          log('🎮 Режим ролевой игры активирован - бот начнет автоматически развиваться')
          startRoleplayMode()
        } else {
          bot.chat('🎮 Режим ролевой игры ВЫКЛЮЧЕН')
          log('🎮 Режим ролевой игры деактивирован')
        }
        break
        
      case 'help':
        bot.chat('📖 Команды: !inv, !pos, !health, !memory, !home, !stop, !goto <x> <y> <z>, !craft <предмет>, !roleplay')
        break
        
      default:
        break
    }
  } catch (e) {
    log('❌ Ошибка выполнения команды:', e.message)
    bot.chat(`❌ Ошибка: ${e.message}`)
  }
}

// ==================== ЗАПУСК БОТА ====================
log('🚀 Запуск умного Minecraft бота...')
log(`📋 Конфигурация:`)
log(`   Хост: ${CONFIG.HOST}:${CONFIG.PORT}`)
log(`   Имя: ${CONFIG.USERNAME}`)
log(`   Версия: ${CONFIG.VERSION}`)
log(`   Интервал мышления: ${CONFIG.THINK_INTERVAL}ms`)
log(`   Keepalive таймаут: ${CONFIG.KEEP_ALIVE_TIMEOUT}ms`)
log(`   Режим ролевой игры: ${CONFIG.ROLEPLAY_MODE ? 'ВКЛ' : 'ВЫКЛ'}`)
log('')
log('💡 Убедитесь, что сервер запущен и доступен!')
log('💡 Используйте команду !roleplay в чате для включения режима автоматического развития')
log('')

process.on('SIGINT', () => {
  // Логирование отключено для оптимизации
  isRunning = false
  stopParallelSystems()
  if (bot) {
    bot.quit('Завершение работы')
  }
  process.exit(0)
})

process.on('SIGTERM', () => {
  // Логирование отключено для оптимизации
  isRunning = false
  stopParallelSystems()
  if (bot) {
    bot.quit('Завершение работы')
  }
  process.exit(0)
})

createBot()
