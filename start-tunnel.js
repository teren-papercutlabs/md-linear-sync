#!/usr/bin/env node

const { spawn } = require('child_process');
const ngrok = require('ngrok');

const NGROK_URL = 'louse-intense-platypus.ngrok-free.app';
const PROXY_PORT = 3002;

let proxyProcess = null;

async function startTunnel() {
  console.log('🚀 Starting unified tunnel setup...');
  
  try {
    // 1. Start proxy server
    console.log(`📡 Starting proxy server on port ${PROXY_PORT}...`);
    proxyProcess = spawn('node', ['proxy-server.js'], {
      stdio: 'inherit',
      cwd: __dirname
    });
    
    // Wait a moment for proxy to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 2. Start ngrok tunnel
    console.log(`🌐 Starting ngrok tunnel: ${NGROK_URL} → localhost:${PROXY_PORT}`);
    const url = await ngrok.connect({
      addr: PROXY_PORT,
      hostname: NGROK_URL
    });
    
    console.log(`✅ Tunnel active: ${url}`);
    console.log(`📡 Webhooks: ${url}/webhook → localhost:3001`);
    console.log(`🎯 Main API: ${url}/* → localhost:3000`);
    
    // Set environment variable for md-linear-sync
    process.env.NGROK_URL = url;
    
    console.log('🎯 Tunnel ready! Press Ctrl+C to stop.');
    
  } catch (error) {
    console.error('❌ Failed to start tunnel:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  
  if (proxyProcess) {
    proxyProcess.kill('SIGINT');
  }
  
  try {
    await ngrok.disconnect();
    console.log('✅ ngrok disconnected');
  } catch (error) {
    console.log('⚠️ ngrok disconnect error:', error);
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down...');
  
  if (proxyProcess) {
    proxyProcess.kill('SIGTERM');
  }
  
  try {
    await ngrok.disconnect();
  } catch (error) {
    console.log('⚠️ ngrok disconnect error:', error);
  }
  
  process.exit(0);
});

startTunnel();