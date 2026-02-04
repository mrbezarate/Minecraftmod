/**
 * local server entry file, for local development
 */
import { initWss } from './ws';
import app from './app';
import { initDatabase } from './database';

/**
 * start server with port
 */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, async () => {
  try {
    await initDatabase();
    console.log(`Server ready on port ${PORT}`);
  } catch (error) {
    console.error('Failed to initialize database:', error);
  }
});

// Global error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Initialize WebSocket server
export const wss = initWss(server);

/**
 * close server
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

export default app;