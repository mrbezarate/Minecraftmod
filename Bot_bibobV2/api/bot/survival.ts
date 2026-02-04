import { IBotController } from './types';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { goals } = require('mineflayer-pathfinder');
const Vec3 = require('vec3');

export class SurvivalModule {
  private botController: IBotController;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(botController: IBotController) {
    this.botController = botController;
  }

  start() {
    this.checkInterval = setInterval(() => this.checkSurvival(), 5000);
  }

  stop() {
    if (this.checkInterval) clearInterval(this.checkInterval);
  }

  private async checkSurvival() {
    const bot = this.botController.bot;
    if (!bot) return;

    // Check hunger
    if (bot.food < 15) {
      await this.handleHunger();
    }

    // Check health
    if (bot.health < 10) {
      await this.handleLowHealth();
    }

    // Check for threats
    const nearestEnemy = bot.nearestEntity((e) => 
      e.type === 'mob' && (e.kind === 'Hostile' || e.kind === 'Neutral')
    );
    
    if (nearestEnemy && bot.entity.position.distanceTo(nearestEnemy.position) < 10) {
      await this.handleThreat(nearestEnemy);
    }
  }

  private async handleHunger() {
    const bot = this.botController.bot;
    if (!bot) return;
    
    // Stop moving to eat safely - CRITICAL
    if (bot.pathfinder) bot.pathfinder.setGoal(null);
    bot.clearControlStates(); // Stop jumping/sprinting
    
    // Wait for stop
    await new Promise(resolve => setTimeout(resolve, 500));

    const food = bot.inventory.items().find((item: any) => 
        item.name.includes('cooked') || 
        item.name.includes('steak') || 
        item.name.includes('porkchop') || 
        item.name.includes('carrot') || 
        item.name.includes('apple') || 
        item.name.includes('bread')
    );
    
    if (food) {
      this.botController.log(`Attempting to eat ${food.name}...`, 'info');
      
      // Try AutoEat first
      if (bot.autoEat) {
        bot.autoEat.enable();
        // Wait a bit to see if it works
        await new Promise(resolve => setTimeout(resolve, 2000));
        if ((bot as any).food === 20) return;
      }

      // Manual fallback
      try {
          await bot.equip(food, 'hand');
          
          // Look up to avoid clicking blocks
          await bot.lookAt(bot.entity.position.offset(0, 2, 0));
          
          // Consume with longer timeout
          await Promise.race([
              bot.consume(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Consume timed out')), 5000))
          ]);
          
          this.botController.log('Ate food manually.', 'info');
          // Wait for saturation
          await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e: any) {
          this.botController.log(`Failed to eat: ${e.message}`, 'error');
          // If consume failed, try to deactivate item (stop eating animation/state)
          try { bot.deactivateItem(); } catch (err) {}
      }
    } else {
      // Need to find food - set goal for AI Decision Engine
      this.botController.currentTask = 'finding_food';
    }
  }

  private async handleLowHealth() {
    const bot = this.botController.bot;
    if (!bot) return;
    
    // Find nearest threat to run away from
    const nearestEnemy = bot.nearestEntity((e) => 
        e.type === 'mob' && (e.kind === 'Hostile' || e.kind === 'Neutral')
    );

    if (nearestEnemy) {
        await this.fleeFrom(nearestEnemy);
    } else {
        // No immediate enemy, but low health. Hide?
        // Just run to a random safe spot for now
        const randomEscape = bot.entity.position.offset(Math.random() * 20 - 10, 0, Math.random() * 20 - 10);
        await this.moveToSafeSpot(randomEscape);
    }
  }

  private async handleThreat(enemy: any) {
    const bot = this.botController.bot;
    if (!bot) return;

    if (bot.health > 10) {
      // Fight if healthy
      if (bot.pvp) {
        bot.pvp.attack(enemy);
      }
    } else {
      // Run away!
      await this.fleeFrom(enemy);
    }
  }

  private async fleeFrom(enemy: any) {
    const bot = this.botController.bot;
    if (!bot || !bot.entity) return;

    this.botController.log('Fleeing from enemy!', 'warn');
    this.botController.currentTask = 'running_away';
    bot.setControlState('sprint', true); // Run!

    // Calculate vector away from enemy
    const enemyPos = enemy.position;
    const botPos = bot.entity.position;
    const awayVector = botPos.minus(enemyPos).normalize();
    
    // Try to find a valid spot 15-25 blocks away
    let bestSpot = null;
    
    // Check 5 different angles (fan out)
    const angles = [0, Math.PI/4, -Math.PI/4, Math.PI/2, -Math.PI/2];
    
    for (const angle of angles) {
        // Rotate away vector
        const x = awayVector.x * Math.cos(angle) - awayVector.z * Math.sin(angle);
        const z = awayVector.x * Math.sin(angle) + awayVector.z * Math.cos(angle);
        const dir = new Vec3(x, 0, z).normalize();
        
        // Raycast to find a spot
        const targetPos = botPos.plus(dir.scaled(20));
        
        // Find a solid block near targetPos
        const safeBlock = bot.findBlock({
            matching: (b: any) => {
                return b.name !== 'air' && b.name !== 'water' && b.name !== 'lava'; // Solid ground
            },
            point: targetPos,
            maxDistance: 5
        });

        if (safeBlock) {
            // Check if there is air above it (so we can stand)
            const blockAbove = bot.blockAt(safeBlock.position.offset(0, 1, 0));
            const blockAbove2 = bot.blockAt(safeBlock.position.offset(0, 2, 0));
            
            if (blockAbove && blockAbove.name === 'air' && blockAbove2 && blockAbove2.name === 'air') {
                bestSpot = safeBlock.position.offset(0, 1, 0);
                break; // Found a good spot
            }
        }
    }

    if (bestSpot) {
        await this.moveToSafeSpot(bestSpot);
    } else {
        // Panic mode: just run in opposite direction blindly (better than standing)
        const panicPos = botPos.plus(awayVector.scaled(15));
        await this.moveToSafeSpot(panicPos);
    }
  }

  private async moveToSafeSpot(pos: any) {
      const bot = this.botController.bot;
      if (!bot || !bot.pathfinder) return;

      try {
          bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y, pos.z, 2));
      } catch (e) {
          // Ignore pathfinder errors during panic
      }
  }
}
