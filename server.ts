import express from 'express';
import https from 'https';
import honoApp from './api/index.js';

const app = express();
const PORT = 3000;

// Mount Hono app onto Express
app.all('/api/*', async (req, res) => {
  const url = new URL(req.originalUrl, `http://${req.headers.host}`);
  const fetchReq = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as any,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
  });
  const fetchRes = await honoApp.fetch(fetchReq);
  fetchRes.headers.forEach((value, key) => res.setHeader(key, value));
  res.status(fetchRes.status);
  const buffer = await fetchRes.arrayBuffer();
  res.send(Buffer.from(buffer));
});

// Vite middleware for development
if (process.env.NODE_ENV !== 'production') {
  import('vite').then(async ({ createServer }) => {
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  });
} else {
  const path = require('path');
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
