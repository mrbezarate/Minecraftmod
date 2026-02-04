import mineflayer from 'mineflayer';
import { MemoryManager } from './memory';
import { Item } from 'prismarine-item';
import { Block } from 'prismarine-block';
import Vec3 from 'vec3';

// Define plugin interfaces (simplified versions)
export interface Pathfinder {
  setGoal(goal: any, dynamic?: boolean): void;
  setMovements(movements: any): void;
  goto(goal: any): Promise<void>;
  isMoving(): boolean;
  isMining(): boolean;
  isBuilding(): boolean;
}

export interface CollectBlock {
  collect(block: Block | Block[], options?: any): Promise<void>;
}

export interface AutoEat {
  options: {
    priority: string;
    startAt: number;
    bannedFood: string[];
    eatingTimeout: number;
  };
  enable(): void;
  disable(): void;
  eat(food?: any): Promise<void>;
}

export interface PvP {
  attack(target: any): Promise<void>;
  stop(): void;
}

// Extend the base Bot interface
export interface ExtendedBot extends mineflayer.Bot {
  pathfinder: Pathfinder;
  collectBlock: CollectBlock;
  autoEat: AutoEat;
  pvp: PvP;
  inventory: any; // Refine if needed, mineflayer already has this but sometimes types conflict
}

export interface IBotController {
  bot: ExtendedBot | null; // Use the extended type
  memory: MemoryManager | null;
  currentTask: string;
  log(message: string, type?: 'info' | 'warn' | 'error'): void;
}
