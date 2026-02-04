import mineflayer from 'mineflayer';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pathfinderPkg = require('mineflayer-pathfinder');
const collectBlock = require('mineflayer-collectblock');
const autoEat = require('mineflayer-auto-eat');
const pvp = require('mineflayer-pvp');
const tool = require('mineflayer-tool');
const mcDataFactory = require('minecraft-data');

const pathfinderData = pathfinderPkg.default || pathfinderPkg;
const { pathfinder, Movements, goals } = pathfinderData;
import { v4 as uuidv4 } from 'uuid';
import { MemoryManager } from './memory';
import { DecisionEngine } from './decision';
import { run } from '../database';
import { IBotController, ExtendedBot } from './types';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/bot_error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/bot_combined.log' }),
  ],
});

export class MinecraftBot implements IBotController {
  public bot: ExtendedBot | null = null;
  public memory: MemoryManager | null = null;
  private decisionEngine: DecisionEngine | null = null;
  private sessionId: string;
  private options: mineflayer.BotOptions;
  private _currentTask: string = 'idle';
  public get currentTask(): string { return this._currentTask; }
  public set currentTask(value: string) {
    if (this._currentTask !== value) {
      this.log(`Task changed: ${this._currentTask} -> ${value}`, 'info');
      this._currentTask = value;
    }
  }
  private ws: any; // WebSocket for dashboard
  private broadcastInterval: NodeJS.Timeout | null = null;
  private isStarted: boolean = false;
  private shouldReconnect: boolean = true;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(options: mineflayer.BotOptions, wsServer: any) {
    this.options = options;
    this.sessionId = uuidv4();
    this.ws = wsServer;
    this.decisionEngine = new DecisionEngine(this);
    
    // Start broadcast loop immediately to show offline status
    this.startBroadcastLoop();
  }

  private startBroadcastLoop() {
      if (this.broadcastInterval) clearInterval(this.broadcastInterval);
      this.broadcastInterval = setInterval(() => this.broadcastStatus(), 500);
  }

  async start() {
    this.shouldReconnect = true; // Enable reconnect on manual start
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    
    this.log(`Bot start requested for ${this.options.username} on ${this.options.host}:${this.options.port}`, 'info');
    this.log(`Connecting to ${this.options.host}:${this.options.port}...`, 'info');
    
    try {
      this.bot = mineflayer.createBot({
        ...this.options,
        version: '1.19.4',
        hideErrors: false
      }) as ExtendedBot;
      this.log('Mineflayer bot instance created.', 'info');
    } catch (e: any) {
      this.log(`Failed to create bot instance: ${e.message}`, 'error');
      return;
    }

    this.memory = new MemoryManager(this.sessionId);

    // Register session in DB
    try {
      await run(
        `INSERT INTO bot_sessions (id, username, server_address) VALUES (?, ?, ?)`,
        [this.sessionId, this.options.username, `${this.options.host}:${this.options.port}`]
      );
    } catch (e) {
      console.error('DB session registration failed:', e);
    }

    this.setupPlugins();
    this.setupEvents();
    
    logger.info(`Bot ${this.options.username} instance created for session ${this.sessionId}`);
  }

  private setupPlugins() {
    if (!this.bot) return;
    this.log('Loading plugins...', 'info');
    try {
      const load = (name: string, plugin: any) => {
        if (!plugin) {
          this.log(`Plugin ${name} is null or undefined!`, 'error');
          return;
        }
        
        // Try different export patterns
        const potentialPlugins = [
          plugin.plugin, // mineflayer-tool, pvp, collectblock
          plugin.default, // ESM default export
          plugin // CommonJS direct export or pathfinder
        ];

        let loaded = false;
        for (const p of potentialPlugins) {
          if (typeof p === 'function') {
            this.bot!.loadPlugin(p);
            this.log(`Plugin ${name} loaded successfully.`, 'info');
            loaded = true;
            break;
          }
        }

        if (!loaded) {
          this.log(`Plugin ${name} is not a function! (Type: ${typeof plugin}, Keys: ${Object.keys(plugin).join(',')})`, 'error');
        }
      };

      load('pathfinder', pathfinderData.pathfinder || pathfinderData);
      load('collectBlock', collectBlock);
      load('autoEat', autoEat);
      load('pvp', pvp);
      load('tool', tool);
      
      this.log('All plugins attempted to load.', 'info');
    } catch (e: any) {
      this.log(`Plugin loading failed: ${e.message}`, 'error');
    }
  }

  private setupEvents() {
    if (!this.bot) return;

    this.bot.once('spawn', () => {
      // Configure AutoEat
      if (this.bot && this.bot.autoEat) {
        this.bot.autoEat.options = {
          priority: 'foodPoints',
          startAt: 19, // Eat almost immediately to keep hunger maxed
          bannedFood: ['rotten_flesh', 'spider_eye', 'pufferfish'],
          eatingTimeout: 3000
        };
        
        // Disable auto-eating during critical actions to prevent kicks
        this.bot.autoEat.disable(); 
        
        // Smart enabling: only eat when idle or safe
        setInterval(() => {
          const isBusy = this.currentTask === 'pvp' || this.currentTask === 'running_away';
          if (!isBusy && this.bot && this.bot.autoEat) {
             this.bot.autoEat.enable();
          } else if (this.bot && this.bot.autoEat) {
             this.bot.autoEat.disable();
          }
        }, 1000);

        this.log('AutoEat configured with high-quality food priority.', 'info');
      }
    });

    this.bot.on('physicsTick', () => {
      // Very high frequency, only log once every 100 ticks
      if ((this.bot as any)._tickCount === undefined) (this.bot as any)._tickCount = 0;
      (this.bot as any)._tickCount++;
      if ((this.bot as any)._tickCount % 200 === 0) {
        // this.log('Tick pulse...', 'info');
      }
    });

    this.bot.on('spawn', () => {
      this.log('Bot spawned in world', 'info');
      
      const version = this.bot!.version;
      this.log(`Bot version: ${version}`, 'info');
      
      const factory = mcDataFactory.default || mcDataFactory;
      const mcData = typeof factory === 'function' ? factory(version) : null;
      
      if (mcData) {
        this.log('Minecraft data loaded successfully.', 'info');
        try {
          const movements = new (Movements as any)(this.bot!, mcData);
          // Configure movements for better exploration
          movements.canDig = true;
          movements.allow1by1towers = true;
          movements.allowFreeMotion = true;
          movements.allowSprinting = true;
          movements.climbMax = 1;
          
          if (this.bot && this.bot.pathfinder) {
            this.bot.pathfinder.setMovements(movements);
            this.log('Navigation system (Pathfinder) movements set.', 'info');
          } else {
            this.log('Pathfinder plugin not initialized on bot!', 'error');
          }
        } catch (e: any) {
          this.log(`Navigation init failed: ${e.message}`, 'error');
        }
      } else {
        this.log(`Failed to load minecraft-data for version ${version}`, 'error');
      }

      if (!this.isStarted) {
        this.isStarted = true;
        this.log('AI Brain starting...', 'info');
        this.decisionEngine?.start();
        
        // Periodic status broadcast to UI
        // Loop is already running from constructor
      } else {
        this.log('AI Brain already running.', 'info');
      }
    });

    this.bot.on('health', () => {
      this.broadcastStatus();
    });

    this.bot.on('death', () => {
      this.log('Bot died!', 'warn');
      this.currentTask = 'dead';
      
      // Stop any current action
      if (this.bot && this.bot.pathfinder) {
        this.bot.pathfinder.setGoal(null);
      }
      
      this.tryRespawn();
    });

    // Respawn Watchdog: Check every 5 seconds if bot is dead but didn't respawn
    setInterval(() => {
        if (this.bot && this.bot.health !== undefined && this.bot.health <= 0) {
            this.log('Respawn Watchdog: Bot appears dead. Attempting respawn...', 'warn');
            this.tryRespawn();
        }
    }, 5000);

    this.bot.on('chat', (username, message) => {
      if (username === this.bot?.username) return;
      logger.info(`Chat: ${username}: ${message}`);
    });

    this.bot.on('error', (err) => {
      logger.error(`Bot connection error: ${err.message}`);
      this.log(`Connection error: ${err.message}`, 'error');
    });

    this.bot.on('kicked', (reason) => {
      logger.warn(`Bot kicked from server: ${reason}`);
      this.log(`Kicked: ${reason}`, 'warn');
      this.isStarted = false;
      this.handleDisconnect();
    });

    this.bot.on('end', () => {
      this.log('Bot connection ended.', 'warn');
      this.isStarted = false;
      this.handleDisconnect();
    });
  }

  private handleDisconnect() {
      if (this.bot) {
          this.bot.removeAllListeners();
          this.bot = null;
      }
      
      if (this.shouldReconnect) {
          this.log('Reconnecting in 5 seconds...', 'info');
          if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = setTimeout(() => {
              this.log('Attempting reconnect...', 'info');
              this.start();
          }, 5000);
      }
  }

  private tryRespawn() {
    if (!this.bot) return;
    
    // Safety check: Don't respawn if already alive
    if (this.bot.health !== undefined && this.bot.health > 0) return;

    setTimeout(() => {
        this.log('Sending respawn packet...', 'info');
        try {
            // Method 1: Standard client command packet (0 = perform respawn)
            if ((this.bot as any)._client) {
                (this.bot as any)._client.write('client_command', { payload: 0 });
            }
            
            // Method 2: Force respawn if available (newer mineflayer versions)
            // @ts-ignore
            if (typeof this.bot.respawn === 'function') this.bot.respawn();
            
        } catch (e: any) {
            this.log(`Respawn error: ${e.message}`, 'error');
        }
    }, 1000);
  }

  public log(message: string, type: 'info' | 'warn' | 'error' = 'info') {
    const logEntry = {
      type: 'log',
      data: {
        timestamp: new Date().toLocaleTimeString(),
        message,
        type
      }
    };
    
    logger.log(type, message);

    if (this.ws) {
      const clientsList = this.ws.clients;
      if (clientsList) {
        clientsList.forEach((client: any) => {
          if (client.readyState === 1) {
            client.send(JSON.stringify(logEntry));
          }
        });
      }
    }
  }

  private broadcastStatus() {
    if (!this.ws) return;
    
    // Heartbeat to keep connection alive
    try {
      const clients = this.ws.clients;
      if (clients) {
        clients.forEach((client: any) => {
          if (client.readyState === 1) {
            try { client.ping(); } catch (e) {}
          }
        });
      }
    } catch (e) {}

    try {
        const pos = this.bot?.entity?.position;
        if (pos && ((this.bot as any)._lastLogPos === undefined || 
            (this.bot as any)._lastLogPos && pos.distanceTo((this.bot as any)._lastLogPos) > 0.1)) {
          // Position changed
          (this.bot as any)._lastLogPos = pos.clone();
        }

        let inventoryItems = [];
        try {
            if (this.bot && this.bot.inventory) {
                inventoryItems = this.bot.inventory.items().map(item => ({
                  name: item.name,
                  count: item.count
                }));
            }
        } catch (e) {
            // Inventory access failed silently
        }

        const status = {
          type: 'status_update',
          data: {
            connected: !!this.bot, 
            health: (this.bot as any)?.health ?? 20,
            hunger: (this.bot as any)?.food ?? 20,
            position: this.bot?.entity?.position || { x: 0, y: 0, z: 0 },
            currentTask: this.currentTask,
            inventory: inventoryItems
          }
        };

        const clientsList = this.ws.clients;
        if (clientsList) {
          clientsList.forEach((client: any) => {
            if (client.readyState === 1) {
              client.send(JSON.stringify(status));
            }
          });
        }
    } catch (e: any) {
        // Prevent broadcast error from crashing the bot
        console.error('Broadcast status error:', e.message);
    }
  }

  async stop() {
    this.shouldReconnect = false; // Disable auto-reconnect
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    
    if (!this.bot) return;
    this.log('Stopping bot and AI...', 'info');
    this.decisionEngine?.stop();
    // Do not clear broadcast interval, let it send offline status
    this.isStarted = false;
    
    try {
      await run(
        `UPDATE bot_sessions SET end_time = CURRENT_TIMESTAMP WHERE id = ?`,
        [this.sessionId]
      );
    } catch (e) {}

    this.bot.quit();
    this.bot = null;
  }
}
