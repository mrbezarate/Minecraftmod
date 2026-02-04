import { Router } from 'express';
import { MinecraftBot } from '../bot/index';
import { getWss } from '../ws';

const router = Router();
let activeBot: MinecraftBot | null = null;

router.post('/start', async (req, res) => {
  const { username, host, port } = req.body;

  // If there's an active bot, check if it's actually alive
  if (activeBot && activeBot.bot) {
    try {
      // Just a small check if the bot is still responding
      const isAlive = activeBot.bot.entity !== undefined;
      if (isAlive) {
        return res.status(400).json({ error: 'Bot already running' });
      }
    } catch (e) {
      // Bot is dead, continue to start new one
      activeBot = null;
    }
  }

  try {
    // Clear previous instance if any
    if (activeBot) {
      console.log('Stopping existing bot...');
      await activeBot.stop().catch(() => {});
    }
    
    console.log(`Starting bot for ${username} on ${host}:${port}`);
    activeBot = new MinecraftBot({
      username: username || 'BibobBot',
      host: host || 'localhost',
      port: parseInt(port) || 25565
    }, getWss());

    // Listen for bot end to clear activeBot
    activeBot.start().then(() => {
      console.log('Bot started successfully');
      if (activeBot && activeBot.bot) {
        activeBot.bot.on('end', () => {
          console.log('Bot connection ended');
          activeBot = null;
        });
        activeBot.bot.on('kicked', (reason) => {
          console.log('Bot kicked:', reason);
          activeBot = null;
        });
      }
    }).catch(err => {
      console.error('Failed to start bot instance:', err);
    });

    res.json({ success: true, status: 'connecting' });
  } catch (error: any) {
    console.error('Error in /start route:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/stop', async (req, res) => {
  if (!activeBot) {
    return res.status(400).json({ error: 'No bot running' });
  }

  try {
    await activeBot.stop();
    activeBot = null;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/status', (req, res) => {
  console.log('Status request received');
  if (!activeBot || !activeBot.bot) {
    return res.json({ connected: false });
  }

  res.json({
    connected: true,
    health: activeBot.bot.health || 0,
    hunger: activeBot.bot.food || 0,
    position: activeBot.bot.entity?.position || { x: 0, y: 0, z: 0 },
    currentTask: activeBot.currentTask,
    inventory: activeBot.bot.inventory.items().map(item => ({
      name: item.name,
      count: item.count
    }))
  });
});

export default router;
