import { IBotController } from './types';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3'); // Fix import to use require like others, safer for mixed env

export class ExplorationModule {
  private botController: IBotController;
  private isExploring: boolean = false;
  private lastTarget: any = null; // Use any to avoid strict type checks with Vec3 if types are messed up

  constructor(botController: IBotController) {
    this.botController = botController;
  }

  async startExploring() {
    if (this.isExploring) {
      this.botController.log('Exploration already in progress.', 'info');
      return;
    }
    this.isExploring = true;
    this.botController.currentTask = 'exploring';
    this.botController.log('Exploration module started.', 'info');

    while (this.isExploring && this.botController.bot) {
      this.botController.log('Exploration loop tick...', 'info');
      const bot = this.botController.bot;
      
      if (!bot.entity || !bot.entity.position) {
        this.botController.log('Waiting for bot entity/position...', 'info');
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      if (this.botController.currentTask !== 'exploring') {
        this.botController.log(`Stopping exploration: task changed to ${this.botController.currentTask}`, 'info');
        this.isExploring = false;
        break;
      }
      
      // Strict check for emergency
      if (this.botController.currentTask === 'survival_emergency') {
         this.isExploring = false;
         break;
      }

      // Smarter target selection: Spiral pattern from current position
      // This prevents running back and forth randomly
      let targetPos: any; // Declare outside
      
      if (!this.lastTarget || bot.entity.position.distanceTo(this.lastTarget) < 5) {
        // We reached the target or don't have one, pick a new one
        const angle = (Date.now() / 1000) % (Math.PI * 2); // Time-based angle for continuous rotation
        const distance = 15 + Math.random() * 10; 
        
        targetPos = bot.entity.position.offset(
          Math.cos(angle) * distance,
          0,
          Math.sin(angle) * distance
        );
      } else {
        // Continue to old target if valid
        targetPos = this.lastTarget;
      }
      
      this.lastTarget = targetPos;

      // Find a suitable Y level (ground)
      const groundBlock = bot.blockAt(targetPos);
      if (groundBlock && groundBlock.name === 'air') {
        // Look down
        for (let yOffset = 0; yOffset > -5; yOffset--) {
          const b = bot.blockAt(targetPos.offset(0, yOffset, 0));
          if (b && b.name !== 'air') {
            targetPos.y += yOffset + 1;
            break;
          }
        }
      }

      this.botController.log(`Moving to exploration target: ${Math.round(targetPos.x)}, ${Math.round(targetPos.z)}`);

      // Move to target
      try {
        if (!bot.pathfinder) {
          this.botController.log('Pathfinder not found on bot instance!', 'error');
          this.isExploring = false;
          return;
        }
        
        const goal = new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2);
        this.botController.log(`Setting goal: ${Math.round(targetPos.x)}, ${Math.round(targetPos.y)}, ${Math.round(targetPos.z)}`);
        bot.pathfinder.setGoal(goal);
        
        // Wait for movement to finish or timeout
        await new Promise<void>((resolve) => {
          let hasFinished = false;

          const finish = (reason: string) => {
             if (hasFinished) return;
             hasFinished = true;
             this.botController.log(`Movement finished: ${reason}`, 'info');
             cleanup();
             
             // If failed, wait a bit to prevent spam
             if (reason !== 'reached') {
                 setTimeout(resolve, 2000);
             } else {
                 resolve();
             }
          };

          const timeout = setTimeout(() => {
            this.botController.log('Movement timeout, picking new target.', 'warn');
            finish('timeout');
          }, 15000); 
          
          const onGoalReached = () => {
            finish('reached');
          };
          
          const onPathUpdate = (results: any) => {
            if (results.status === 'noPath') {
              this.botController.log(`No path found to target`, 'warn');
              finish('noPath');
            } else if (results.status === 'timeout') {
               // Only finish if it's a hard timeout from pathfinder
               this.botController.log(`Path calculation timeout`, 'warn');
               finish('pathTimeout');
            }
          };

          const onPathFailed = () => {
            finish('failed');
          };

          const cleanup = () => {
            clearTimeout(timeout);
            bot.removeListener('goal_reached', onGoalReached);
            bot.removeListener('path_update', onPathUpdate);
            // bot.removeListener('path_reset', onPathFailed); // Removed invalid listener
            if (bot.pathfinder) bot.pathfinder.setGoal(null); 
          };

          bot.on('goal_reached', onGoalReached);
          bot.on('path_update', onPathUpdate);
          // bot.on('path_reset', onPathFailed); // Removed invalid listener
        });
      } catch (e: any) {
        this.botController.log(`Movement error: ${e.message}`, 'error');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait on error
      }

      // Record surroundings after moving
      await this.scanSurroundings();
      
      // Additional small delay between moves
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  stopExploring() {
    this.isExploring = false;
  }

  private async scanSurroundings() {
    const bot = this.botController.bot;
    if (!bot || !this.botController.memory) return;

    // Look for interesting blocks
    const interestingBlocks = ['chest', 'diamond_ore', 'iron_ore', 'gold_ore', 'spawner', 'village_center'];
    
    for (const blockName of interestingBlocks) {
      const block = bot.findBlock({
        matching: (b: any) => b.name.includes(blockName),
        maxDistance: 32
      });

      if (block) {
        const memId = await this.botController.memory.saveMemory(
          'discovery',
          `found_${blockName}`,
          { name: blockName, position: block.position },
          0.8
        );
        await this.botController.memory.saveLocation(
          memId,
          block.position.x,
          block.position.y,
          block.position.z,
          bot.game.dimension
        );
      }
    }
  }
}
