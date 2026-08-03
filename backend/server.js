const path = require('path');
const express = require('express');
const cors = require('cors');

const config = require('./lib/config');
const db = require('./lib/db');

async function main() {
  await db.init();

  const authRoutes = require('./routes/auth');
  const loadRoutes = require('./routes/load');
  const redeemRoutes = require('./routes/redeem');
  const systemRoutes = require('./routes/system');
  const disburseRoutes = require('./routes/disburse');
  const pairRoutes = require('./routes/pair');
  const { router: settingsRoutes, seed: seedSettings } = require('./routes/settings');

  await seedSettings();

  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/load', loadRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/disburse', disburseRoutes);
  app.use('/api/pair', pairRoutes);
  app.use('/api', redeemRoutes);
  app.use('/api', systemRoutes);

  const FRONTEND = path.resolve(__dirname, '..', 'frontend');
  app.use(
    express.static(FRONTEND, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('service-worker.js')) {
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Service-Worker-Allowed', '/');
        }
      },
    }),
  );

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(FRONTEND, 'index.html'));
  });

  app.use((err, req, res, _next) => {
    console.error('[error]', err);
    res.status(500).json({ error: err.message || 'internal error' });
  });

  const server = app.listen(config.port, config.host, () => {
    const url = `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    console.log(`\n  ZeroNetPay running at ${url}`);
    console.log(`  Mode:  ${config.isProduction ? 'production' : 'development'}\n`);
  });

  function shutdown(signal) {
    console.log(`[server] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[fatal] server failed to start', err);
  process.exit(1);
});
