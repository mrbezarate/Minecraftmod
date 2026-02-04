import { IBotController } from './types';
import { SurvivalModule } from './survival';
import { ExplorationModule } from './exploration';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Vec3 = require('vec3'); // Proper import

export class DecisionEngine {
  private botController: IBotController;
  private survival: SurvivalModule;
  private exploration: ExplorationModule;
  private decisionInterval: NodeJS.Timeout | null = null;

  constructor(botController: IBotController) {
    this.botController = botController;
    this.survival = new SurvivalModule(botController);
    this.exploration = new ExplorationModule(botController);
  }

  start() {
    this.botController.log('AI Decision Engine starting...', 'info');
    this.survival.start();
    this.decisionInterval = setInterval(() => this.makeDecision(), 3000);
    this.makeDecision(); // Call once immediately
  }

  stop() {
    this.survival.stop();
    this.exploration.stopExploring();
    if (this.decisionInterval) clearInterval(this.decisionInterval);
  }

  private async makeDecision() {
    try {
        const bot = this.botController.bot;
        if (!bot || !bot.entity) {
          if (bot && !bot.entity) {
            this.botController.log('Waiting for bot entity to spawn...', 'info');
          }
          return;
        }

        this.botController.log(`Decision tick. Task: ${this.botController.currentTask}, Health: ${bot.health}, Food: ${bot.food}`);

        // 1. Critical Priority: Survival
    if (bot.health < 10 || bot.food < 10) { // Increased threshold to catch it earlier
      if (this.botController.currentTask !== 'survival_emergency') {
         this.botController.log('Survival emergency! Stopping other tasks.', 'warn');
         this.botController.currentTask = 'survival_emergency';
         this.exploration.stopExploring();
      }
      
      // Force survival check
      await (this.survival as any).handleHunger();
      return;
    }

        // 2. High Priority: Gathering basic resources if missing
        const inventoryItems = bot.inventory.items();
        const hasWood = inventoryItems.some(item => item.name.includes('log'));
        const hasPlanks = inventoryItems.some(item => item.name.includes('plank'));
        const hasCraftingTable = inventoryItems.some(item => item.name === 'crafting_table');
        
        // Crafting Logic
        if (hasWood && !hasPlanks) {
          this.botController.log('Has wood but no planks. Crafting...', 'info');
          await this.craftItem('oak_planks', 1);
          return;
        }

        if (hasPlanks && !hasCraftingTable) {
          this.botController.log('Has planks but no crafting table. Crafting...', 'info');
          await this.craftItem('crafting_table', 1);
          return;
        }

        const hasSticks = inventoryItems.some(item => item.name === 'stick');
        if (hasPlanks && !hasSticks) {
             await this.craftItem('stick', 1); // Need sticks for tools
             return;
        }

        const hasPickaxe = inventoryItems.some(item => item.name.includes('pickaxe'));
        if (hasCraftingTable && hasSticks && hasPlanks && !hasPickaxe) {
            // Need to place crafting table to craft tools
            await this.placeAndCraft('wooden_pickaxe', 'crafting_table');
            return;
        }

        if (!hasWood && !hasPlanks && this.botController.currentTask !== 'gathering_wood') {
          if (this.botController.currentTask.startsWith('gathering_')) return;
          
          // If we are exploring, we check for resources occasionally in the gatherResource call
          if (this.botController.currentTask === 'exploring') {
            // Every few ticks while exploring, try to find the resource again
            if (Math.random() < 0.2) {
              await this.gatherResource('oak_log');
            }
            return;
          }

          this.botController.log('No wood found. Starting resource search...', 'info');
          this.exploration.stopExploring();
          await this.gatherResource('oak_log');
          return;
        }

        // 3. Normal Priority: Exploration
        if (this.botController.currentTask === 'idle' || this.botController.currentTask === 'exploring') {
          this.botController.log('Starting exploration...', 'info');
          this.exploration.startExploring();
        }
    } catch (e: any) {
        this.botController.log(`Decision Engine Error: ${e.message}`, 'error');
    }
  }

  private async findEmergencyFood() {
    const bot = this.botController.bot!;
    const animal = bot.nearestEntity(e => 
      e.type === 'mob' && ['cow', 'pig', 'sheep', 'chicken'].includes(e.name || '')
    );

    if (animal) {
      await bot.pvp.attack(animal);
    } else {
      this.exploration.startExploring(); // Hope to find food while exploring
    }
  }

  private async craftItem(itemName: string, count: number) {
    const bot = this.botController.bot!;
    const recipes = bot.recipesFor(bot.registry.itemsByName[itemName].id, null, 1, null);
    
    if (recipes.length === 0) {
      this.botController.log(`No recipe found for ${itemName}`, 'warn');
      return;
    }

    try {
      this.botController.log(`Crafting ${count} ${itemName}...`, 'info');
      await bot.craft(recipes[0], count, null);
      this.botController.log(`Crafted ${itemName} successfully.`, 'info');
    } catch (e: any) {
      this.botController.log(`Crafting failed: ${e.message}`, 'error');
    }
  }

  private async placeAndCraft(itemName: string, tableName: string) {
    const bot = this.botController.bot!;
    
    // 1. Search for existing table first
    const existingTable = bot.findBlock({
        matching: (b) => b.name === tableName,
        maxDistance: 32
    });

    if (existingTable) {
        this.botController.log(`Found existing ${tableName} at ${existingTable.position}`, 'info');
        await this.craftUsingTable(existingTable, itemName);
        return;
    }

    // 2. If no table, check if we have one or need to craft it
    let tableItem = bot.inventory.items().find(item => item.name === tableName);
    if (!tableItem) {
        // Try to craft the table itself first (e.g. from planks)
        // This is a simplified check, assuming we have materials if we got here
        this.botController.log(`Missing ${tableName}, cannot place.`, 'error');
        return;
    }

    // 3. Find a solid block to place ON
    const botPos = bot.entity.position; // Use exact position for distance check
    if (!botPos) return;

    const replaceableBlocks = ['air', 'water', 'lava', 'grass', 'tall_grass', 'dead_bush', 'fern', 'dandelion', 'poppy', 'snow'];

    // Find ALL possible spots
    const potentialSpots = bot.findBlocks({
        matching: (b) => {
            if (!b || !b.position) return false;
            // Must be solid
            if (replaceableBlocks.includes(b.name)) return false;
            
            // Must have space above it (air or replaceable)
            const blockAbove = bot.blockAt(b.position.offset(0, 1, 0));
            if (!blockAbove || !replaceableBlocks.includes(blockAbove.name)) return false;
            
            // CRITICAL: Must be at least 2 blocks away to avoid "placing on self"
            // And not too far to reach
            const dist = b.position.distanceTo(botPos);
            if (dist < 2 || dist > 4.5) return false;

            return true;
        },
        maxDistance: 5,
        count: 10 // Get more candidates
    });

    if (potentialSpots.length > 0) {
        for (const spotPos of potentialSpots) {
            const referenceBlock = bot.blockAt(spotPos);
            if (!referenceBlock) continue;

            try {
                this.botController.log(`Trying to place table on ${referenceBlock.name} at ${spotPos}...`, 'info');
                
                // Goto near the block
                await bot.pathfinder.goto(new (require('mineflayer-pathfinder').goals).GoalNear(spotPos.x, spotPos.y + 1, spotPos.z, 2));
                
                // Look at the top face
                await bot.lookAt(spotPos.offset(0.5, 1, 0.5));

                // Equip
                await this.equipItem(tableName);

                // Place
                await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
                this.botController.log(`Placed ${tableName} successfully!`, 'info');

                // Craft
                const tablePosition = spotPos.offset(0, 1, 0);
                const tableBlock = bot.blockAt(tablePosition);
                if (tableBlock && tableBlock.name === tableName) {
                    await this.craftUsingTable(tableBlock, itemName);
                    return; // Success, exit loop
                }
            } catch (e: any) {
                this.botController.log(`Failed to place on ${spotPos}: ${e.message}. Trying next spot...`, 'warn');
                continue; // Try next spot
            }
        }
        this.botController.log('Failed to place table on any candidate spot.', 'error');
    } else {
        this.botController.log('No suitable spot found for table. Moving random...', 'warn');
        if (!this.exploration['isExploring']) {
             this.exploration.startExploring();
        }
    }
  }

  private async equipItem(name: string) {
      const bot = this.botController.bot!;
      const item = bot.inventory.items().find(i => i.name === name);
      if (item) {
          try {
              await bot.equip(item, 'hand');
          } catch (e) {
              await new Promise(r => setTimeout(r, 500));
              await bot.equip(item, 'hand');
          }
      }
  }

  private async craftUsingTable(tableBlock: any, itemName: string) {
      const bot = this.botController.bot!;
      // Goto table if far
      if (bot.entity.position.distanceTo(tableBlock.position) > 4) {
          await bot.pathfinder.goto(new (require('mineflayer-pathfinder').goals).GoalNear(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 2));
      }

      const recipes = bot.recipesFor(bot.registry.itemsByName[itemName].id, null, 1, tableBlock);
      if (recipes.length > 0) {
            this.botController.log(`Crafting ${itemName}...`, 'info');
            try {
                await bot.craft(recipes[0], 1, tableBlock);
                this.botController.log(`Crafted ${itemName} successfully!`, 'info');
                
                // Optional: Pick up table
                // await (bot as any).collectBlock.collect(tableBlock);
            } catch (e: any) {
                this.botController.log(`Crafting failed: ${e.message}`, 'error');
            }
      } else {
            this.botController.log(`No recipe for ${itemName}`, 'error');
      }
  }

  private async equipBestTool(block: any) {
    const bot = this.botController.bot!;
    const items = bot.inventory.items();
    
    // Simple tool selection based on block material
    let toolType = 'hand';
    if (block.material === 'wood' || block.name.includes('log') || block.name.includes('plank')) toolType = 'axe';
    if (block.material === 'rock' || block.material === 'stone' || block.name.includes('stone') || block.name.includes('ore')) toolType = 'pickaxe';
    if (block.material === 'dirt' || block.name.includes('dirt') || block.name.includes('grass')) toolType = 'shovel';

    if (toolType !== 'hand') {
        // Find best tool of that type
        const tool = items.find(i => i.name.includes(toolType)); // Just find first one for now, ideally sort by material
        if (tool) {
            try {
                await bot.equip(tool, 'hand');
                this.botController.log(`Equipped ${tool.name}`, 'info');
            } catch (e) {
                this.botController.log(`Failed to equip tool: ${e}`, 'warn');
            }
        }
    }
  }

  private async gatherResource(blockName: string) {
    const bot = this.botController.bot!;
    this.botController.currentTask = `gathering_${blockName}`;
    
    // Find nearest block
    const block = bot.findBlock({
      matching: (b: any) => b.name === blockName,
      maxDistance: 64
    });

    if (block) {
      try {
        this.botController.log(`Found ${blockName}. Collecting...`, 'info');
        
        // Equip best tool
        await this.equipBestTool(block);

        // Use collectBlock to mine
        await (bot as any).collectBlock.collect(block);
        
        // Smart Collection: Look for dropped items nearby
        this.botController.log('Checking for drops...', 'info');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for drops
        
        const drops = bot.nearestEntity(e => 
            e.type === 'object' && 
            e.position.distanceTo(bot.entity.position) < 10 &&
            (e.metadata as any)?.[8]?.itemId // Check if it's an item stack
        );

        if (drops) {
             const p = drops.position;
             this.botController.log(`Picking up drops at ${Math.round(p.x)}, ${Math.round(p.z)}`, 'info');
             const goal = new (require('mineflayer-pathfinder').goals).GoalNear(p.x, p.y, p.z, 1);
             bot.pathfinder.setGoal(goal);
             await new Promise(resolve => setTimeout(resolve, 2000));
        }

        this.botController.currentTask = 'idle';
      } catch (e: any) {
        this.botController.log(`Gathering failed: ${e.message}`, 'error');
        this.botController.currentTask = 'idle';
      }
    } else {
      this.botController.log(`Resource ${blockName} not found nearby. Exploring...`, 'warn');
      this.botController.currentTask = 'exploring';
      this.exploration.startExploring();
    }
  }
}
