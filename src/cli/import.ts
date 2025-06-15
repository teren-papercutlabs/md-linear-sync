import fs from 'fs';
import path from 'path';
import { LinearSyncClient } from '../client';
import { ConfigManager } from '../config';
import { TicketFileParser, TimezoneUtils } from '../parsers';
import { TicketFile, TicketMetadata, Comment, LinearSyncConfig } from '../types';

// Create debug log file
const debugLogPath = path.join(process.cwd(), 'linear-import-debug.log');
function debugLog(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logEntry = data 
    ? `[${timestamp}] ${message}\n${JSON.stringify(data, null, 2)}\n\n`
    : `[${timestamp}] ${message}\n\n`;
  fs.appendFileSync(debugLogPath, logEntry);
}

export async function importCommand(): Promise<void> {
  console.log('📥 Importing tickets from Linear...\n');

  try {
    // Clear previous debug log
    if (fs.existsSync(debugLogPath)) {
      fs.unlinkSync(debugLogPath);
    }
    
    debugLog('Starting import command');
    
    // Load configuration
    const config = await ConfigManager.loadConfig();
    debugLog('Loaded config', config);
    
    const envConfig = ConfigManager.loadEnvironmentConfig();
    debugLog('Loaded env config', envConfig);
    
    // Initialize Linear client
    const client = new LinearSyncClient(envConfig.linear.apiKey);
    
    // Fetch issues from the configured team and project (limit to 2 for testing)
    console.log('🔍 Fetching issues from Linear...');
    debugLog(`Fetching issues for team: ${config.teamId}, project: ${config.projectId}`);
    
    const result = await client.getIssues(config.teamId, config.projectId); // Fetch all issues
    const issues = result.issues;
    debugLog(`Fetched ${issues.length} issues from Linear`, {
      apiUsage: result.apiUsage,
      issueCount: issues.length
    });
    
    console.log(`📋 Found ${issues.length} issues to import`);
    
    if (issues.length === 0) {
      console.log('ℹ️  No issues found. Your Linear project might be empty.');
      return;
    }
    
    // Process each issue
    let imported = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const issue of issues) {
      try {
        // Log all issues in detail for debugging (only 2 issues)
        debugLog(`Issue ${issue.identifier} full structure:`, issue);
        
        debugLog(`Processing issue ${issue.identifier}`, {
          id: issue.id,
          title: issue.title,
          state: issue.state,
          hasState: !!issue.state,
          stateName: issue.state?.name,
          stateId: issue.state?.id,
          // Show available properties
          availableProperties: Object.keys(issue).filter(key => !key.startsWith('_'))
        });
        
        const result = await processIssue(issue, client, config);
        if (result.imported) {
          imported++;
          console.log(`✅ ${issue.identifier}: ${issue.title}`);
        } else {
          skipped++;
          console.log(`⏭️  ${issue.identifier}: ${result.reason}`);
        }
      } catch (error) {
        errors++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`❌ ${issue.identifier}: ${errorMsg}`);
        debugLog(`Error processing ${issue.identifier}`, { error: errorMsg, stack: error instanceof Error ? error.stack : undefined });
      }
    }
    
    console.log(`\n🎉 Import complete!`);
    console.log(`📊 Results: ${imported} imported, ${skipped} skipped, ${errors} errors`);
    
    // Show API usage if available
    if (result.apiUsage) {
      const usage = result.apiUsage;
      console.log(`🚦 API Usage:`);
      if (usage.requestsLimit && usage.requestsRemaining) {
        console.log(`   Requests: ${usage.requestsRemaining}/${usage.requestsLimit} remaining`);
      }
      if (usage.complexityLimit && usage.complexityRemaining) {
        console.log(`   Complexity: ${usage.complexityRemaining}/${usage.complexityLimit} remaining`);
      }
      if (usage.requestsResetAt) {
        const resetTime = new Date(usage.requestsResetAt * 1000);
        console.log(`   Resets at: ${resetTime.toLocaleString()}`);
      }
    }
    
    if (imported > 0) {
      console.log('\nNext steps:');
      console.log('- Edit markdown files in the md-linear-sync/linear-tickets/ directory');
      console.log('- Move files between status folders to change ticket status');
      console.log('- Run "md-linear-sync push" to sync changes back to Linear');
    }
    
  } catch (error) {
    console.error('\n❌ Import failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

async function processIssue(
  issue: any, 
  client: LinearSyncClient, 
  config: LinearSyncConfig
): Promise<{ imported: boolean; reason?: string }> {
  
  // Find the status folder for this issue  
  const stateId = issue.state?.id;
  if (!stateId) {
    return { 
      imported: false, 
      reason: 'Issue has no state ID' 
    };
  }
  
  // Find the status name from our config mapping by state ID
  const statusName = findStatusNameByStateId(stateId, config);
  if (!statusName) {
    return { 
      imported: false, 
      reason: `Unknown state ID "${stateId}" not found in config` 
    };
  }
  
  const statusFolder = config.statusMapping[statusName].folder;
  
  // Generate filename
  const filename = TicketFileParser.generateFilename(
    issue.identifier,
    issue.title,
    issue.parent?.identifier
  );
  
  const filePath = path.join(process.cwd(), 'md-linear-sync', 'linear-tickets', statusFolder, filename);
  
  // Skip if file already exists
  if (fs.existsSync(filePath)) {
    return { 
      imported: false, 
      reason: 'File already exists' 
    };
  }
  
  // Comments are now included in the issue data from the GraphQL query
  const comments = issue.comments?.nodes || [];
  
  // Convert Linear issue to our ticket format
  const ticket = await convertLinearIssueToTicket(issue, comments, config);
  
  // Generate markdown content
  debugLog(`Generating file for ${issue.identifier} with ${ticket.comments?.length || 0} comments`, {
    hasComments: !!ticket.comments && ticket.comments.length > 0,
    commentCount: ticket.comments?.length || 0
  });
  
  const content = TicketFileParser.generateFile(ticket);
  
  debugLog(`Generated file content for ${issue.identifier}`, {
    contentLength: content.length,
    hasCommentsSection: content.includes('---comments---'),
    filePath: filePath
  });
  
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Write file
  fs.writeFileSync(filePath, content, 'utf-8');
  
  return { imported: true };
}

function findStatusFolder(stateName: string, config: LinearSyncConfig): string | null {
  for (const [configStateName, mapping] of Object.entries(config.statusMapping)) {
    if (configStateName === stateName) {
      return mapping.folder;
    }
  }
  return null;
}

function findStatusNameByStateId(stateId: string, config: LinearSyncConfig): string | null {
  for (const [statusName, mapping] of Object.entries(config.statusMapping)) {
    if (mapping.id === stateId) {
      return statusName;
    }
  }
  return null;
}

async function convertLinearIssueToTicket(
  issue: any, 
  linearComments: any[], 
  config: LinearSyncConfig
): Promise<TicketFile> {
  
  // Convert timestamps to SGT
  const createdAt = TimezoneUtils.utcToSGT(issue.createdAt);
  const updatedAt = TimezoneUtils.utcToSGT(issue.updatedAt);
  const dueDate = issue.dueDate ? TimezoneUtils.utcToSGT(issue.dueDate) : undefined;
  
  // Get status name from state ID using config mapping
  const stateId = issue.state?.id;
  const statusName = stateId ? findStatusNameByStateId(stateId, config) : null;
  
  if (!statusName) {
    throw new Error(`Unable to determine status for issue ${issue.identifier} with state ID ${stateId}`);
  }
  
  // Build frontmatter metadata
  const frontmatter: TicketMetadata = {
    linear_id: issue.identifier,
    title: issue.title,
    status: statusName as TicketMetadata['status'], // This is safe since statusName comes from our config keys
    assignee: issue.assignee?.email,
    labels: issue.labels?.nodes?.map((label: any) => label.name) || [],
    priority: issue.priority || 0,
    due_date: dueDate,
    url: issue.url,
    created_at: createdAt,
    updated_at: updatedAt
  };
  
  // Convert description (handle null/undefined)
  const content = issue.description || `# ${issue.title}\n\n*No description provided*`;
  
  // Convert comments
  const comments: Comment[] = linearComments.map(comment => ({
    id: comment.id,
    author: comment.user?.email || comment.user?.name || 'Unknown',
    content: comment.body || '',
    created_at: TimezoneUtils.utcToSGT(comment.createdAt),
    // Linear doesn't have nested replies in comments, so we don't include replies
  }));
  
  debugLog(`Converting ${linearComments.length} comments for ${issue.identifier}`, {
    rawComments: linearComments,
    convertedComments: comments
  });
  
  return {
    frontmatter,
    content,
    comments
  };
}

export function getImportStats(directory: string = 'md-linear-sync/linear-tickets'): { 
  totalFiles: number; 
  byStatus: Record<string, number> 
} {
  const linearDir = path.join(process.cwd(), directory);
  
  if (!fs.existsSync(linearDir)) {
    return { totalFiles: 0, byStatus: {} };
  }
  
  const stats = { totalFiles: 0, byStatus: {} as Record<string, number> };
  
  // Get all subdirectories (status folders)
  const statusFolders = fs.readdirSync(linearDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const folder of statusFolders) {
    const folderPath = path.join(linearDir, folder);
    const files = fs.readdirSync(folderPath)
      .filter(file => file.endsWith('.md') && file !== 'README.md');
    
    stats.byStatus[folder] = files.length;
    stats.totalFiles += files.length;
  }
  
  return stats;
}