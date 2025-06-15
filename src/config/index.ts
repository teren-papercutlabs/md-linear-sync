import fs from 'fs';
import path from 'path';
import { LinearSyncConfig, LinearApiConfig, SlackConfig } from '../types';

export class ConfigManager {
  private static readonly CONFIG_FILE = 'md-linear-sync/.linear-sync.json';
  private static readonly ENV_EXAMPLE_FILE = 'md-linear-sync/.env.example';
  
  static async loadConfig(projectPath: string = process.cwd()): Promise<LinearSyncConfig> {
    const configPath = path.join(projectPath, this.CONFIG_FILE);
    
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file ${this.CONFIG_FILE} not found. Run 'md-linear-sync init' to create it.`);
    }
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent) as LinearSyncConfig;
      
      this.validateConfig(config);
      return config;
    } catch (error) {
      throw new Error(`Failed to load configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  static async saveConfig(config: LinearSyncConfig, projectPath: string = process.cwd()): Promise<void> {
    const configPath = path.join(projectPath, this.CONFIG_FILE);
    
    this.validateConfig(config);
    
    try {
      const configContent = JSON.stringify(config, null, 2);
      fs.writeFileSync(configPath, configContent, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  static createDefaultConfig(): LinearSyncConfig {
    return {
      teamId: '',
      teamName: '',
      projectId: '',
      projectName: '',
      statusMapping: {
        'Todo': { id: '', folder: 'todo' },
        'In Progress': { id: '', folder: 'in-progress' },
        'In Review': { id: '', folder: 'in-review' },
        'Backlog': { id: '', folder: 'backlog' },
        'Done': { id: '', folder: 'done' },
        'Cancelled': { id: '', folder: 'cancelled' }
      },
      labelMapping: {},
      timezone: 'Asia/Singapore',
      lastUpdated: new Date().toISOString()
    };
  }
  
  static createEnvExample(projectPath: string = process.cwd()): void {
    const envExamplePath = path.join(projectPath, this.ENV_EXAMPLE_FILE);
    const envContent = `# Linear API Configuration
LINEAR_API_KEY=your_linear_api_key_here

# Optional: Slack Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your/slack/webhook

# Optional: Webhook Security
WEBHOOK_SECRET=your_webhook_secret_here
`;
    
    fs.writeFileSync(envExamplePath, envContent, 'utf-8');
  }
  
  static loadEnvironmentConfig(): { linear: LinearApiConfig; slack: SlackConfig } {
    const linearApiKey = process.env.LINEAR_API_KEY;
    
    if (!linearApiKey) {
      throw new Error('LINEAR_API_KEY environment variable is required');
    }
    
    return {
      linear: {
        apiKey: linearApiKey,
        teamId: '', // Will be populated from config file
        webhookSecret: process.env.WEBHOOK_SECRET
      },
      slack: {
        webhookUrl: process.env.SLACK_WEBHOOK_URL
      }
    };
  }
  
  private static validateConfig(config: LinearSyncConfig): void {
    if (!config.teamId) {
      throw new Error('teamId is required in configuration');
    }
    
    if (!config.statusMapping) {
      throw new Error('statusMapping is required in configuration');
    }
    
    if (!config.timezone) {
      throw new Error('timezone is required in configuration');
    }
    
    // Validate status mapping structure
    for (const [stateName, mapping] of Object.entries(config.statusMapping)) {
      if (!mapping.id || !mapping.folder) {
        throw new Error(`statusMapping for '${stateName}' must have both 'id' and 'folder' properties`);
      }
      // Type is optional for backward compatibility with existing configs
    }
  }
}

// Define the desired workflow order
const WORKFLOW_TYPE_ORDER = ['started', 'unstarted', 'backlog', 'completed', 'canceled'];

export function getWorkflowTypeOrder(type: string): number {
  const index = WORKFLOW_TYPE_ORDER.indexOf(type);
  return index === -1 ? 999 : index; // Unknown types go to the end
}

export function stateNameToFolderName(stateName: string, type: string, typeOrder: number, stateIndex: number): string {
  const baseName = stateName
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  
  // Add numbered prefix with subcategory: major.minor-name
  return `${typeOrder + 1}.${stateIndex + 1}-${baseName}`;
}

export { LinearSyncConfig, LinearApiConfig, SlackConfig };