import { run, get, all } from '../database';
import { v4 as uuidv4 } from 'uuid';

export class MemoryManager {
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async saveMemory(type: string, key: string, data: any, importance: number = 0.5) {
    const id = uuidv4();
    await run(
      `INSERT INTO memory_entries (id, session_id, memory_type, key, data, importance) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, this.sessionId, type, key, JSON.stringify(data), importance]
    );
    return id;
  }

  async saveLocation(memoryId: string, x: number, y: number, z: number, dimension: string = 'overworld', metadata: any = {}) {
    const id = uuidv4();
    await run(
      `INSERT INTO location_data (id, memory_id, x, y, z, dimension, metadata) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, memoryId, x, y, z, dimension, JSON.stringify(metadata)]
    );
    return id;
  }

  async getMemories(type?: string) {
    if (type) {
      return await all(
        `SELECT * FROM memory_entries WHERE session_id = ? AND memory_type = ?`,
        [this.sessionId, type]
      );
    }
    return await all(`SELECT * FROM memory_entries WHERE session_id = ?`, [this.sessionId]);
  }

  async getRecentLocations(limit: number = 100) {
    return await all(
      `SELECT l.* FROM location_data l 
       JOIN memory_entries m ON l.memory_id = m.id 
       WHERE m.session_id = ? 
       ORDER BY m.timestamp DESC LIMIT ?`,
      [this.sessionId, limit]
    );
  }

  async logDecision(taskId: string, decisionType: string, context: any, action: any, successRate?: number) {
    const id = uuidv4();
    await run(
      `INSERT INTO decision_logs (id, task_id, decision_type, context, action_taken, success_rate) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, taskId, decisionType, JSON.stringify(context), JSON.stringify(action), successRate]
    );
    return id;
  }

  async startTask(type: string, params: any) {
    const id = uuidv4();
    await run(
      `INSERT INTO task_history (id, session_id, task_type, status, parameters) 
       VALUES (?, ?, ?, ?, ?)`,
      [id, this.sessionId, type, 'in_progress', JSON.stringify(params)]
    );
    return id;
  }

  async endTask(id: string, status: string, result: any) {
    await run(
      `UPDATE task_history SET status = ?, result = ?, end_time = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, JSON.stringify(result), id]
    );
  }
}
