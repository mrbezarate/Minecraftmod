const { log } = require('./utils')

const TaskQueue = {
  tasks: [],
  currentTask: null,
  isExecuting: false,
  interruptFlag: false,
  priority: {
    CRITICAL: 200,
    COMBAT: 100,
    SURVIVAL: 80,
    USER_COMMAND: 70,
    RESOURCE: 60,
    CRAFT: 63,
    EXPLORE: 30,
    IDLE: 10
  },
  
  add(task) {
    if (task.priority >= this.priority.CRITICAL) {
      if (this.currentTask && this.currentTask.priority < this.priority.CRITICAL) {
        this.interruptFlag = true
        log('⚠️  Interrupting task due to critical threat')
      }
    }
    
    const isDuplicate = this.tasks.some(t => {
      if (t.type !== task.type) return false
      if (t.priority !== task.priority) return false
      
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
      
      return false
    })
    
    if (this.currentTask && this.currentTask.type === task.type) {
      if (task.target && this.currentTask.target && task.target.id === this.currentTask.target.id) {
        return
      }
    }
    
    if (!isDuplicate) {
      this.tasks.push(task)
      this.tasks.sort((a, b) => (b.priority || 0) - (a.priority || 0))
      log(`📋 Added task: ${task.type} (priority: ${task.priority})`)
    }
  },
  
  getNext() {
    if (this.tasks.length === 0) return null
    return this.tasks.shift()
  },
  
  clear() {
    this.tasks = []
    this.currentTask = null
    this.isExecuting = false
    this.interruptFlag = false
  },
  
  hasTasks() {
    return this.tasks.length > 0 || this.currentTask !== null
  },
  
  canInterrupt() {
    return this.interruptFlag && 
           this.currentTask && 
           this.currentTask.priority < this.priority.CRITICAL
  }
}

module.exports = TaskQueue
