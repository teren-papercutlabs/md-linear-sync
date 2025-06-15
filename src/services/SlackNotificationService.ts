import fs from 'fs';
import path from 'path';
import * as Diff from 'diff';

interface SlackNotificationService {
  sendWebhookNotification(event: WebhookSyncEvent): Promise<void>;
}

interface WebhookSyncEvent {
  type: 'issue_updated' | 'comment_added' | 'issue_created' | 'issue_deleted';
  ticketId: string;
  ticketTitle: string;
  ticketUrl: string;
  changes?: TicketChanges;
  comment?: CommentInfo;
  timestamp: string;
}

interface TicketChanges {
  status?: { from: string; to: string };
  assignee?: { from?: string; to?: string };
  title?: { from: string; to: string };
  description?: { from: string; to: string };
  labels?: { added: string[]; removed: string[] };
  priority?: { from: number; to: number };
}

interface CommentInfo {
  author: string;
  content: string;
  id: string;
}

export class SlackNotificationServiceImpl implements SlackNotificationService {
  private botToken: string;
  private channel: string;

  constructor() {
    this.botToken = process.env.SLACK_BOT_TOKEN || '';
    this.channel = process.env.SLACK_CHANNEL || 'md-linear-sync-notifications';
    
    if (!this.botToken) {
      console.warn('⚠️  SLACK_BOT_TOKEN not configured - Slack notifications disabled');
    }
  }

  async sendWebhookNotification(event: WebhookSyncEvent): Promise<void> {
    if (!this.botToken) {
      return; // Silently skip if not configured
    }

    try {
      const message = this.formatWebhookMessage(event);
      await this.sendToSlack(message);
    } catch (error) {
      console.error('Failed to send Slack notification:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private formatWebhookMessage(event: WebhookSyncEvent): any {
    const { ticketId, ticketTitle, ticketUrl, type, changes, comment } = event;

    if (type === 'comment_added' && comment) {
      return {
        text: `New comment on ${ticketId}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `New comment on ${ticketId}`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*<${ticketUrl}|${ticketTitle}>*`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${comment.author}* commented:\n${this.truncateText(comment.content, 200)}`
            }
          },
        ]
      };
    }

    if (type === 'issue_created') {
      return {
        text: `${ticketId} created`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${ticketId} created`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*<${ticketUrl}|${ticketTitle}>*`
            }
          }
        ]
      };
    }

    if (type === 'issue_deleted') {
      return {
        text: `${ticketId} deleted`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${ticketId} deleted`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${ticketTitle}*`
            }
          }
        ]
      };
    }

    if (type === 'issue_updated' && changes) {
      const changeTexts = this.formatChanges(changes);
      
      return {
        text: `${ticketId} updated`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${ticketId} updated`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*<${ticketUrl}|${ticketTitle}>*`
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: changeTexts.join('\n')
            }
          },
        ]
      };
    }

    // Fallback simple message
    return {
      text: `${ticketId} synced from Linear`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*<${ticketUrl}|${ticketId}>* synced from Linear`
          }
        }
      ]
    };
  }

  private formatChanges(changes: TicketChanges): string[] {
    const changeTexts: string[] = [];

    if (changes.status) {
      if (changes.status.from) {
        changeTexts.push(`Status: \`${changes.status.from}\` → \`${changes.status.to}\``);
      } else {
        changeTexts.push(`Status: \`${changes.status.to}\``);
      }
    }

    if (changes.assignee && changes.assignee.from !== changes.assignee.to) {
      const fromText = changes.assignee.from || 'Unassigned';
      const toText = changes.assignee.to || 'Unassigned';
      changeTexts.push(`Assignee: \`${fromText}\` → \`${toText}\``);
    }

    if (changes.title && changes.title.from !== changes.title.to) {
      changeTexts.push(`Title: \`${this.truncateText(changes.title.from, 30)}\` → \`${this.truncateText(changes.title.to, 30)}\``);
    }

    if (changes.description && changes.description.from !== changes.description.to) {
      const diff = this.generateDiff(changes.description.from, changes.description.to);
      changeTexts.push(`Description:\n\`\`\`\n${diff}\n\`\`\``);
    }

    if (changes.labels) {
      if (changes.labels.added.length > 0) {
        changeTexts.push(`Labels added: ${changes.labels.added.map(l => `\`${l}\``).join(', ')}`);
      }
      if (changes.labels.removed.length > 0) {
        changeTexts.push(`Labels removed: ${changes.labels.removed.map(l => `\`${l}\``).join(', ')}`);
      }
    }

    if (changes.priority && changes.priority.from !== changes.priority.to) {
      const priorityNames = ['No Priority', 'Urgent', 'High', 'Normal', 'Low'];
      const fromPriority = priorityNames[changes.priority.from] || `Priority ${changes.priority.from}`;
      const toPriority = priorityNames[changes.priority.to] || `Priority ${changes.priority.to}`;
      changeTexts.push(`Priority: \`${fromPriority}\` → \`${toPriority}\``);
    }

    return changeTexts;
  }

  private getStatusEmoji(status: string): string {
    const statusMap: Record<string, string> = {
      'Todo': '📋',
      'Backlog': '📚',
      'In Progress': '🔄',
      'In Development': '💻',
      'In Review': '👀',
      'Code Review': '🔍',
      'Done': '✅',
      'Completed': '✅',
      'Cancelled': '❌'
    };
    return statusMap[status] || '📝';
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  private generateDiff(oldText: string, newText: string): string {
    // Use proper diff library for better results
    const diff = Diff.diffLines(oldText, newText);
    const diffLines: string[] = [];
    let changeCount = 0;
    const maxChanges = 15; // Limit diff size for Slack
    
    for (const part of diff) {
      if (changeCount >= maxChanges) break;
      
      if (part.added) {
        const lines = part.value.trim().split('\n');
        for (const line of lines) {
          if (changeCount < maxChanges && line.trim()) {
            diffLines.push(`+ ${line}`);
            changeCount++;
          }
        }
      } else if (part.removed) {
        const lines = part.value.trim().split('\n');
        for (const line of lines) {
          if (changeCount < maxChanges && line.trim()) {
            diffLines.push(`- ${line}`);
            changeCount++;
          }
        }
      }
      // Skip unchanged parts for brevity
    }
    
    if (changeCount >= maxChanges) {
      diffLines.push('... (truncated for display)');
    }
    
    return diffLines.length > 0 ? diffLines.join('\n') : 'No significant changes detected';
  }

  private async sendToSlack(message: any): Promise<void> {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channel: this.channel.replace('#', ''),
        ...message
      })
    });

    const result = await response.json();
    
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }
  }

  static getInstance(): SlackNotificationServiceImpl {
    return new SlackNotificationServiceImpl();
  }
}