const fs = require('fs')
const path = require('path')
const { log } = require('./utils')

const MEMORY_FILE = path.join(__dirname, '../memory.json')

const Memory = {
  // Persistent Data
  data: {
    home: null, // {x, y, z}
    hasShelter: false,
    knownLocations: {},   // {name: {x, y, z, type, timestamp}}
    resourceLocations: {}, // {blockType: [{x, y, z, count, timestamp}]}
    chests: {}, // { "x,y,z": { content: [], lastCheck: ts } }
    dangerousAreas: [], // ["x,y,z"]
    stats: {
        mobsKilled: 0,
        itemsCrafted: 0,
        blocksMined: 0
    },
    achievedGoals: [],
    // New Advanced Memory
    goals: [], // Active Goal Objects { id, type, params, status, subGoals: [] }
    zones: {}, // { "zoneName": { type, min: {x,y,z}, max: {x,y,z}, center: {x,y,z} } }
    blueprints: {}, // { "name": { structure: [], dimensions: {} } }
    inventoryState: {} // { "chest_x_y_z": { items: [], lastUpdated } }
  },

  // Runtime only
  pathHistory: [],
  stuckPositions: new Set(),
  
  init() {
    this.load()
    log('🧠 Memory system initialized with persistence (v2 Upgrade)')
    
    // Auto-save every minute
    setInterval(() => this.save(), 60000)
  },

  // ... (existing load/save)

  // --- ZONE MANAGEMENT ---
  saveZone(name, center, radius = 10, type = 'generic') {
      this.data.zones[name] = {
          type,
          center: { x: center.x, y: center.y, z: center.z },
          min: { x: center.x - radius, y: center.y - 10, z: center.z - radius },
          max: { x: center.x + radius, y: center.y + 10, z: center.z + radius }
      }
      this.save()
  },

  getZone(name) {
      return this.data.zones[name]
  },

  // --- GOAL MANAGEMENT ---
  addGoal(goal) {
      // Check if goal already exists
      const exists = this.data.goals.some(g => g.id === goal.id)
      if (!exists) {
          this.data.goals.push(goal)
          this.save()
      }
  },

  getGoals() {
      return this.data.goals
  },

  updateGoal(id, updates) {
      const goal = this.data.goals.find(g => g.id === id)
      if (goal) {
          Object.assign(goal, updates)
          this.save()
      }
  },

  removeGoal(id) {
      this.data.goals = this.data.goals.filter(g => g.id !== id)
      this.save()
  },

  load() {
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            const raw = fs.readFileSync(MEMORY_FILE, 'utf8')
            const loaded = JSON.parse(raw)
            // Merge to ensure structure
            this.data = { ...this.data, ...loaded }
            log(`🧠 Loaded memory from file. Known locations: ${Object.keys(this.data.knownLocations).length}`)
        }
    } catch (e) {
        log(`⚠️ Could not load memory: ${e.message}`)
    }
  },

  save() {
    try {
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.data, null, 2))
        // log('💾 Memory saved')
    } catch (e) {
        log(`⚠️ Could not save memory: ${e.message}`)
    }
  },
  
  setHome(pos) {
      this.data.home = { x: pos.x, y: pos.y, z: pos.z }
      this.save()
  },
  
  getHome() {
      if (!this.data.home) return null
      const Vec3 = require('vec3')
      return new Vec3(this.data.home.x, this.data.home.y, this.data.home.z)
  },

  saveLocation(name, pos, type = 'point') {
    this.data.knownLocations[name] = {
      x: pos.x, y: pos.y, z: pos.z,
      type: type,
      timestamp: Date.now()
    }
    this.save()
  },
  
  getNearestLocation(pos, type = null) {
    let nearest = null
    let minDist = Infinity
    
    for (const [name, loc] of Object.entries(this.data.knownLocations)) {
      if (type && loc.type !== type) continue
      const locVec = { x: loc.x, y: loc.y, z: loc.z }
      const dist = pos.distanceTo(locVec)
      if (dist < minDist) {
        minDist = dist
        nearest = { name, ...loc, pos: locVec }
      }
    }
    return nearest
  },
  
  saveResource(blockType, pos) {
    if (!this.data.resourceLocations[blockType]) {
      this.data.resourceLocations[blockType] = []
    }
    const resources = this.data.resourceLocations[blockType]
    const exists = resources.some(r => Math.abs(r.x - pos.x) < 2 && Math.abs(r.z - pos.z) < 2) // Simple check
    if (!exists) {
      resources.push({
        x: pos.x, y: pos.y, z: pos.z,
        count: 1,
        timestamp: Date.now()
      })
      if (resources.length > 50) resources.shift()
      this.save()
    }
  },
  
  getNearestResource(blockType, currentPos) {
    const resources = this.data.resourceLocations[blockType]
    if (!resources || resources.length === 0) return null
    
    let nearest = null
    let minDist = Infinity
    
    for (const resource of resources) {
      const rPos = { x: resource.x, y: resource.y, z: resource.z }
      const dist = currentPos.distanceTo(rPos)
      if (dist < minDist && dist < 128) {
        minDist = dist
        nearest = { ...resource, pos: rPos }
      }
    }
    return nearest
  },
  
  markDangerous(pos) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
    if (!this.data.dangerousAreas.includes(key)) {
        this.data.dangerousAreas.push(key)
        this.save()
    }
  },
  
  isDangerous(pos) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
    return this.data.dangerousAreas.includes(key)
  },
  
  addGoalAchievement(goalName) {
      if (!this.data.achievedGoals.includes(goalName)) {
          this.data.achievedGoals.push(goalName)
          this.save()
      }
  },
  
  hasAchieved(goalName) {
      return this.data.achievedGoals.includes(goalName)
  }
}

module.exports = Memory
