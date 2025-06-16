const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = 3002;

console.log('🚀 Starting proxy server on port', PORT);

// Route Linear webhooks to md-linear-sync (port 3001)
app.use('/webhook', createProxyMiddleware({
  target: 'http://localhost:3001',
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`📡 Webhook: ${req.method} ${req.url} → localhost:3001`);
  }
}));

// Route health check for webhooks to port 3001
app.use('/health', createProxyMiddleware({
  target: 'http://localhost:3001',
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`💓 Health: ${req.method} ${req.url} → localhost:3001`);
  }
}));

// Route everything else to Slack API (port 3000)
app.use('/', createProxyMiddleware({
  target: 'http://localhost:3000',
  changeOrigin: true,
  onProxyReq: (proxyReq, req, res) => {
    console.log(`🎯 Main: ${req.method} ${req.url} → localhost:3000`);
  }
}));

app.listen(PORT, () => {
  console.log(`✅ Proxy server running on port ${PORT}`);
  console.log(`📡 /webhook → localhost:3001 (md-linear-sync)`);
  console.log(`🎯 /* → localhost:3000 (Slack API)`);
});