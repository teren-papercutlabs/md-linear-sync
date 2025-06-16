import ngrok from 'ngrok';
import express from 'express';
import fs from 'fs';
import path from 'path';
import * as chokidar from 'chokidar';
import { LinearSyncClient } from '../client';
import { ConfigManager } from '../config';
import { pullSingleTicket, pushSingleTicket } from './sync';
import { RetryManager } from '../utils/RetryManager';
import { SlackNotificationServiceImpl } from '../services/SlackNotificationService';

class SyncDaemon {
  private ngrokUrl: string = '';
  private webhookId: string = '';
  private server: any;
  private restartTimer: NodeJS.Timeout | null = null;
  private slackService: SlackNotificationServiceImpl;
  private fileWatcher: chokidar.FSWatcher | null = null;
  private moveDebounceMap: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.slackService = SlackNotificationServiceImpl.getInstance();
  }

  async start() {
    console.log('🚀 Starting bidirectional sync daemon...');
    
    // Start initial session
    await this.startSession();
    
    // Auto-restart every 55 minutes
    this.scheduleRestart();
    
    // Save PID for stop command
    this.savePID();
  }

  private async startSession() {
    try {
      // 1. Start ngrok
      this.ngrokUrl = await ngrok.connect(3001);
      console.log(`🌐 Tunnel: ${this.ngrokUrl}`);
      
      // 2. Update Linear webhook
      await this.updateWebhook();
      console.log('✅ Webhook updated');
      
      // 3. Start express server
      this.startServer();
      
    } catch (error) {
      console.error('❌ Failed to start session:', error);
      throw error;
    }
  }

  private scheduleRestart() {
    this.restartTimer = setTimeout(async () => {
      console.log('⏰ Restarting session...');
      try {
        await ngrok.disconnect();
        await this.startSession();
        this.scheduleRestart();
        console.log('✅ Session restarted');
      } catch (error) {
        console.error('❌ Restart failed:', error);
        // Retry in 5 minutes if restart fails
        setTimeout(() => this.scheduleRestart(), 5 * 60 * 1000);
      }
    }, 55 * 60 * 1000); // 55 minutes
  }

  private async updateWebhook() {
    const client = new LinearSyncClient(process.env.LINEAR_API_KEY!);
    const config = await ConfigManager.loadConfig();
    
    const webhookUrl = this.ngrokUrl + '/webhook';
    console.log(`📡 Setting webhook URL: ${webhookUrl}`);
    
    this.webhookId = await client.upsertWebhook({
      url: webhookUrl,
      teamId: config.teamId
    });
  }

  private startServer() {
    const app = express();
    app.use(express.json());

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'healthy', tunnel: this.ngrokUrl });
    });

    // Webhook endpoint
    app.post('/webhook', async (req, res) => {
      try {
        
        const { action, data, type } = req.body;
        
        // Handle issue updates, creates, and removes
        const ticketId = data?.identifier || data?.issue?.identifier;
        
        if ((action === 'update' || action === 'create') && ticketId) {
          console.log(`🔄 ${action}: ${ticketId} (${type || 'Issue'})`);
          
          // Add small delay for comment creation to allow Linear to index
          if (action === 'create' && type === 'Comment') {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          await this.syncTicket(ticketId, req.body);
        } else if (action === 'remove' && ticketId) {
          console.log(`🗑️ ${action}: ${ticketId} (${type || 'Issue'})`);
          await this.handleTicketDeletion(ticketId, req.body);
        }
        
        res.status(200).send('OK');
      } catch (error) {
        console.error('❌ Webhook error:', error);
        res.status(500).send('Error');
      }
    });

    this.server = app.listen(3001, async () => {
      console.log('🎯 Webhook server listening on port 3001');
      // Start file watcher for bidirectional sync
      await this.startFileWatcher();
    });
  }

  private async syncTicket(ticketId: string, webhookPayload: any) {
    await RetryManager.withRetry(async () => {
      const client = new LinearSyncClient(process.env.LINEAR_API_KEY!);
      const config = await ConfigManager.loadConfig();
      
      // This is the genius part - reuse existing sync logic!
      await pullSingleTicket(ticketId, client, config);
      
      // Send Slack notification after successful sync
      await this.sendSlackNotification(ticketId, webhookPayload, client);
      
    }, {}, `sync ticket ${ticketId}`);
  }

  private async sendSlackNotification(ticketId: string, webhookPayload: any, client: LinearSyncClient) {
    try {
      const { action, data, type, updatedFrom } = webhookPayload;
      
      // Get current ticket info for notification
      const ticket = await client.getIssue(ticketId);
      if (!ticket) return;

      const baseEvent = {
        ticketId,
        ticketTitle: ticket.title,
        ticketUrl: ticket.url,
        timestamp: new Date().toISOString()
      };

      if (type === 'Comment' && action === 'create') {
        // Comment notification
        const comment = data;
        await this.slackService.sendWebhookNotification({
          ...baseEvent,
          type: 'comment_added',
          comment: {
            id: comment.id,
            author: comment.user?.email || comment.user?.name || 'Unknown',
            content: comment.body || 'No content'
          }
        });
      } else if (type === 'Issue' && action === 'create') {
        // New issue created notification
        await this.slackService.sendWebhookNotification({
          ...baseEvent,
          type: 'issue_created'
        });
      } else if (type === 'Issue' && action === 'update' && updatedFrom) {
        // Issue update notification with changes
        const changes = this.extractChanges(updatedFrom, data);
        if (Object.keys(changes).length > 0) {
          await this.slackService.sendWebhookNotification({
            ...baseEvent,
            type: 'issue_updated',
            changes
          });
        }
      }
    } catch (error) {
      console.log('⚠️ Slack notification failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private extractChanges(updatedFrom: any, current: any): any {
    const changes: any = {};

    // Status change - Linear includes stateId when state changes
    if ('stateId' in updatedFrom && current.state?.name) {
      changes.status = {
        from: null, // We don't have old state name from webhook
        to: current.state.name
      };
    }

    // Title change - same logic
    if ('title' in updatedFrom && updatedFrom.title !== current.title) {
      changes.title = {
        from: updatedFrom.title || 'Untitled',
        to: current.title || 'Untitled'
      };
    }

    // Description change - this we can diff properly
    if ('description' in updatedFrom && updatedFrom.description !== current.description) {
      changes.description = {
        from: updatedFrom.description || '',
        to: current.description || ''
      };
    }

    // Assignee change
    if ('assigneeId' in updatedFrom || updatedFrom.assignee) {
      const oldEmail = updatedFrom.assignee?.email;
      const newEmail = current.assignee?.email;
      if (oldEmail !== newEmail) {
        changes.assignee = {
          from: oldEmail,
          to: newEmail
        };
      }
    }

    // Priority change
    if ('priority' in updatedFrom && updatedFrom.priority !== current.priority) {
      changes.priority = {
        from: updatedFrom.priority || 0,
        to: current.priority || 0
      };
    }

    // Labels change - Linear provides full label arrays
    if ('labels' in updatedFrom) {
      const oldLabels = (updatedFrom.labels || []).sort();
      const newLabels = (current.labels || []).sort();
      if (JSON.stringify(oldLabels) !== JSON.stringify(newLabels)) {
        const added = newLabels.filter((l: string) => !oldLabels.includes(l));
        const removed = oldLabels.filter((l: string) => !newLabels.includes(l));
        if (added.length > 0 || removed.length > 0) {
          changes.labels = { added, removed };
        }
      }
    }

    return changes;
  }

  private async handleTicketDeletion(ticketId: string, webhookPayload: any) {
    await RetryManager.withRetry(async () => {
      const { data } = webhookPayload;
      
      // Remove local file
      await this.removeLocalTicketFile(ticketId);
      
      // Send Slack notification
      await this.sendDeletionNotification(ticketId, data);
    }, {}, `handle deletion of ${ticketId}`);
  }

  private async removeLocalTicketFile(ticketId: string) {
    try {
      const config = await ConfigManager.loadConfig();
      
      // Search for the ticket file across all status folders
      for (const [statusName, statusConfig] of Object.entries(config.statusMapping)) {
        const folderPath = path.join(process.cwd(), 'linear-tickets', statusConfig.folder);
        
        if (fs.existsSync(folderPath)) {
          const files = fs.readdirSync(folderPath);
          
          // Look for files that match this ticket ID (including parent-child format)
          const matchingFile = files.find(file => {
            const fileTicketId = this.extractTicketIdFromFilename(file);
            return fileTicketId === ticketId;
          });
          
          if (matchingFile) {
            const filePath = path.join(folderPath, matchingFile);
            fs.unlinkSync(filePath);
            return;
          }
        }
      }
      
      console.log(`⚠️ Local file for ${ticketId} not found`);
    } catch (error) {
      console.error(`❌ Failed to remove local file for ${ticketId}:`, error);
    }
  }

  private extractTicketIdFromFilename(filename: string): string {
    // Handle both regular (PAP-123-title.md) and parent-child (PAP-123.456-title.md) formats
    const match = filename.match(/^([A-Z]+-\d+(?:\.\d+)?)-/);
    return match ? match[1] : '';
  }

  private async sendDeletionNotification(ticketId: string, ticketData: any) {
    try {
      await this.slackService.sendWebhookNotification({
        ticketId,
        ticketTitle: ticketData.title || 'Untitled',
        ticketUrl: ticketData.url || '',
        timestamp: new Date().toISOString(),
        type: 'issue_deleted'
      });
    } catch (error) {
      console.log('⚠️ Slack deletion notification failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  savePID() {
    fs.writeFileSync('.webhook-listener.pid', process.pid.toString());
  }

  private async startFileWatcher() {
    const linearTicketsDir = path.join(process.cwd(), 'linear-tickets');
    
    if (!fs.existsSync(linearTicketsDir)) {
      console.log('📁 No linear-tickets directory found, skipping file watcher');
      return;
    }

    console.log('👀 Starting file watcher for local changes...');
    
    this.fileWatcher = chokidar.watch(linearTicketsDir, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true
    });

    this.fileWatcher.on('add', (filePath: string) => this.handleFileMove(filePath, 'added'));
    this.fileWatcher.on('unlink', (filePath: string) => this.handleFileMove(filePath, 'removed'));
    
    console.log('✅ File watcher started - local file moves will sync to Linear');
  }

  private async handleFileMove(filePath: string, action: 'added' | 'removed') {
    // Only process .md files, ignore README.md
    if (!filePath.endsWith('.md') || filePath.endsWith('README.md')) {
      return;
    }

    // Extract ticket ID from filename
    const filename = path.basename(filePath);
    const ticketIdMatch = filename.match(/^([A-Z]+-\d+)/);
    
    if (!ticketIdMatch) {
      return;
    }

    const ticketId = ticketIdMatch[1];
    
    // Debounce moves (wait 2 seconds for bulk operations)
    const debounceKey = ticketId;
    if (this.moveDebounceMap.has(debounceKey)) {
      clearTimeout(this.moveDebounceMap.get(debounceKey)!);
    }

    const timeoutId = setTimeout(async () => {
      this.moveDebounceMap.delete(debounceKey);
      
      if (action === 'added') {
        try {
          const config = await ConfigManager.loadConfig();
          const envConfig = ConfigManager.loadEnvironmentConfig();
          const client = new LinearSyncClient(envConfig.linear.apiKey);
          
          await pushSingleTicket(ticketId, client, config);
        } catch (error) {
          console.error(`❌ Failed to sync ${ticketId}:`, error instanceof Error ? error.message : 'Unknown error');
        }
      }
    }, 2000);

    this.moveDebounceMap.set(debounceKey, timeoutId);
  }

  async stop() {
    console.log('🛑 Stopping sync daemon...');
    
    // Clear timer
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
    }

    // Stop file watcher
    if (this.fileWatcher) {
      await this.fileWatcher.close();
      console.log('🛑 File watcher stopped');
    }

    // Clear debounce timers
    for (const timeout of this.moveDebounceMap.values()) {
      clearTimeout(timeout);
    }
    this.moveDebounceMap.clear();
    
    // Stop server
    if (this.server) {
      this.server.close();
    }
    
    // Disconnect ngrok
    try {
      await ngrok.disconnect();
    } catch (error) {
      console.log('⚠️ ngrok disconnect error:', error);
    }
    
    // Remove webhook from Linear
    if (this.webhookId) {
      try {
        const client = new LinearSyncClient(process.env.LINEAR_API_KEY!);
        await client.deleteWebhook(this.webhookId);
        console.log('🗑️ Webhook removed from Linear');
      } catch (error) {
        console.log('⚠️ Failed to remove webhook:', error);
      }
    }
    
    // Remove PID file
    try {
      fs.unlinkSync('.webhook-listener.pid');
    } catch {}
    
    console.log('✅ Stopped');
  }
}

// Commands
export async function startSyncCommand() {
  const daemon = new SyncDaemon();
  
  // Handle shutdown signals
  process.on('SIGINT', async () => {
    await daemon.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await daemon.stop();
    process.exit(0);
  });
  
  // Save PID for stop command
  daemon.savePID();
  
  await daemon.start();
  
  console.log('🎯 Bidirectional sync active. Press Ctrl+C to stop.');
  
  // Keep process alive
  process.stdin.resume();
}

export async function stopSyncCommand() {
  try {
    const pidContent = fs.readFileSync('.webhook-listener.pid', 'utf8');
    const pid = parseInt(pidContent.trim());
    
    process.kill(pid, 'SIGINT');
    console.log('✅ Stop signal sent to webhook listener');
  } catch (error) {
    console.log('❌ No listener running or failed to stop');
  }
}