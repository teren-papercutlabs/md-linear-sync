import fs from 'fs';
import path from 'path';
import { LinearSyncClient } from '../client';
import { ConfigManager } from '../config';
import { TicketFileParser, TimezoneUtils } from '../parsers';
import { LinearSyncConfig } from '../types';

export async function pushCommand(ticketId?: string): Promise<void> {
  console.log(`🚀 Pushing ${ticketId ? `ticket ${ticketId}` : 'all changes'} to Linear...\n`);

  try {
    // Load configuration
    const config = await ConfigManager.loadConfig();
    const envConfig = ConfigManager.loadEnvironmentConfig();
    
    // Initialize Linear client
    const client = new LinearSyncClient(envConfig.linear.apiKey);
    
    if (ticketId) {
      // Push specific ticket
      await pushSingleTicket(ticketId, client, config);
    } else {
      // Push all modified tickets
      await pushAllTickets(client, config);
    }
    
  } catch (error) {
    console.error('\n❌ Push failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

export async function pullCommand(ticketId?: string): Promise<void> {
  console.log(`📥 Pulling ${ticketId ? `ticket ${ticketId}` : 'all changes'} from Linear...\n`);

  try {
    // Load configuration
    const config = await ConfigManager.loadConfig();
    const envConfig = ConfigManager.loadEnvironmentConfig();
    
    // Initialize Linear client
    const client = new LinearSyncClient(envConfig.linear.apiKey);
    
    if (ticketId) {
      // Pull specific ticket
      await pullSingleTicket(ticketId, client, config);
    } else {
      // Pull all tickets
      await pullAllTickets(client, config);
    }
    
  } catch (error) {
    console.error('\n❌ Pull failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

export async function pushSingleTicket(
  ticketId: string, 
  client: LinearSyncClient, 
  config: LinearSyncConfig
): Promise<void> {
  
  // Find the file for this ticket
  const filePath = findTicketFile(ticketId);
  if (!filePath) {
    throw new Error(`Ticket file for ${ticketId} not found`);
  }
  
  console.log(`📄 Processing ${path.basename(filePath)}...`);
  
  // Parse the file
  const content = fs.readFileSync(filePath, 'utf-8');
  const ticket = TicketFileParser.parseFile(content);
  
  // Validate file
  const validation = TicketFileParser.validateFile(content);
  if (!validation.valid) {
    throw new Error(`Invalid ticket file: ${validation.errors.join(', ')}`);
  }
  
  // Get current status folder
  const currentFolder = path.basename(path.dirname(filePath));
  const newStateId = findStateIdForFolder(currentFolder, config);
  
  if (!newStateId) {
    throw new Error(`Cannot find Linear state ID for folder "${currentFolder}"`);
  }
  
  // Get Linear issue to compare
  const linearIssue = await client.getIssue(ticket.frontmatter.linear_id);
  
  // Build updates object
  const updates: any = {};
  
  // Check if status changed (file moved to different folder)
  if (linearIssue.state.id !== newStateId) {
    updates.stateId = newStateId;
    console.log(`  📁 Status: ${linearIssue.state.name} → ${currentFolder}`);
  }
  
  // Check if title changed (prefer frontmatter title, fallback to filename)
  const titleFromFrontmatter = ticket.frontmatter.title;
  const filename = path.basename(filePath, '.md');
  const titleFromFilename = extractTitleFromFilename(filename, ticket.frontmatter.linear_id);
  const newTitle = titleFromFrontmatter || titleFromFilename;
  
  if (newTitle && linearIssue.title !== newTitle) {
    updates.title = newTitle;
    console.log(`  📝 Title: "${linearIssue.title}" → "${newTitle}"`);
  }
  
  // Check if description changed
  if (ticket.content && linearIssue.description !== ticket.content) {
    updates.description = ticket.content;
    console.log(`  📄 Description updated`);
  }
  
  // Apply updates if any
  if (Object.keys(updates).length > 0) {
    await client.updateIssue(linearIssue.id, updates);
    console.log(`✅ Updated ${ticket.frontmatter.linear_id} in Linear`);
    
    // Update the local file's updated_at timestamp
    ticket.frontmatter.updated_at = TimezoneUtils.now();
    const updatedContent = TicketFileParser.generateFile(ticket);
    fs.writeFileSync(filePath, updatedContent, 'utf-8');
  } else {
    console.log(`ℹ️  No changes detected for ${ticket.frontmatter.linear_id}`);
  }
}

async function pushAllTickets(client: LinearSyncClient, config: LinearSyncConfig): Promise<void> {
  const tickets = getAllTicketFiles();
  
  if (tickets.length === 0) {
    console.log('ℹ️  No ticket files found to push');
    return;
  }
  
  console.log(`📋 Found ${tickets.length} ticket files to check for changes`);
  
  let pushed = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const filePath of tickets) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const ticket = TicketFileParser.parseFile(content);
      
      // Check if file was modified since last sync
      const stats = fs.statSync(filePath);
      const fileModifiedTime = new Date(stats.mtime);
      const lastSyncTime = new Date(ticket.frontmatter.updated_at);
      
      if (fileModifiedTime > lastSyncTime) {
        await pushSingleTicket(ticket.frontmatter.linear_id, client, config);
        pushed++;
      } else {
        skipped++;
      }
    } catch (error) {
      errors++;
      const filename = path.basename(filePath);
      console.error(`❌ ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  console.log(`\n📊 Push complete: ${pushed} updated, ${skipped} unchanged, ${errors} errors`);
}

export async function pullSingleTicket(
  ticketId: string, 
  client: LinearSyncClient, 
  config: LinearSyncConfig
): Promise<void> {
  
  // Get issue from Linear
  const issue = await client.getIssue(ticketId);
  if (!issue) {
    throw new Error(`Ticket ${ticketId} not found in Linear`);
  }
  
  console.log(`📄 Pulling ${issue.identifier}: ${issue.title}`);
  
  // Find current local file if it exists
  const existingFilePath = findTicketFile(issue.identifier);
  
  // Get status folder for current Linear state
  const statusFolder = findStatusFolder(issue.state.name, config);
  if (!statusFolder) {
    throw new Error(`Unknown Linear state "${issue.state.name}" not in config`);
  }
  
  // Generate new filename and path
  const filename = TicketFileParser.generateFilename(
    issue.identifier,
    issue.title,
    issue.parent?.identifier
  );
  const newFilePath = path.join(process.cwd(), 'linear-tickets', statusFolder, filename);
  
  // DEBUG: Log the constructed path
  console.log('🔍 DEBUG - Constructed file path:', newFilePath);
  console.log('🔍 DEBUG - Current working directory:', process.cwd());
  console.log('🔍 DEBUG - Status folder:', statusFolder);
  console.log('🔍 DEBUG - Filename:', filename);
  
  // Get comments from issue response (already included in getIssue query)
  const comments = issue.comments?.nodes || [];
  
  // Convert to ticket format
  const ticket = convertLinearIssueToTicket(issue, comments, config);
  
  // Generate content
  const content = TicketFileParser.generateFile(ticket);
  
  // If file moved to different folder, remove old file
  if (existingFilePath && existingFilePath !== newFilePath) {
    fs.unlinkSync(existingFilePath);
    console.log(`  📁 Moved from ${path.relative(process.cwd(), existingFilePath)} to ${path.relative(process.cwd(), newFilePath)}`);
  }
  
  // Ensure directory exists
  const dir = path.dirname(newFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Write file
  console.log('🔍 DEBUG - Writing file to:', newFilePath);
  fs.writeFileSync(newFilePath, content, 'utf-8');
  console.log('✅ DEBUG - File written successfully');
  console.log(`✅ Updated ${issue.identifier}`);
}

async function pullAllTickets(client: LinearSyncClient, config: LinearSyncConfig): Promise<void> {
  // Get all issues from Linear
  const result = await client.getIssues(config.teamId, config.projectId);
  const issues = result.issues;
  
  console.log(`📋 Found ${issues.length} issues in Linear to sync`);
  
  let updated = 0;
  let errors = 0;
  
  for (const issue of issues) {
    try {
      await pullSingleTicket(issue.identifier, client, config);
      updated++;
    } catch (error) {
      errors++;
      console.error(`❌ ${issue.identifier}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  console.log(`\n📊 Pull complete: ${updated} updated, ${errors} errors`);
}

// Helper functions
function findTicketFile(ticketId: string): string | null {
  const linearDir = path.join(process.cwd(), 'linear-tickets');
  
  if (!fs.existsSync(linearDir)) {
    return null;
  }
  
  // Search all status folders
  const statusFolders = fs.readdirSync(linearDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const folder of statusFolders) {
    const folderPath = path.join(linearDir, folder);
    const files = fs.readdirSync(folderPath)
      .filter(file => file.endsWith('.md'));
    
    for (const file of files) {
      const extractedId = TicketFileParser.extractLinearIdFromFilename(file);
      if (extractedId && extractedId.toLowerCase() === ticketId.toLowerCase()) {
        return path.join(folderPath, file);
      }
    }
  }
  
  return null;
}

function getAllTicketFiles(): string[] {
  const linearDir = path.join(process.cwd(), 'linear-tickets');
  const files: string[] = [];
  
  if (!fs.existsSync(linearDir)) {
    return files;
  }
  
  // Get all markdown files from all status folders
  const statusFolders = fs.readdirSync(linearDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const folder of statusFolders) {
    const folderPath = path.join(linearDir, folder);
    const folderFiles = fs.readdirSync(folderPath)
      .filter(file => file.endsWith('.md') && file !== 'README.md')
      .map(file => path.join(folderPath, file));
    
    files.push(...folderFiles);
  }
  
  return files;
}

function findStateIdForFolder(folder: string, config: LinearSyncConfig): string | null {
  for (const [stateName, mapping] of Object.entries(config.statusMapping)) {
    if (mapping.folder === folder) {
      return mapping.id;
    }
  }
  return null;
}

function findStatusFolder(stateName: string, config: LinearSyncConfig): string | null {
  for (const [configStateName, mapping] of Object.entries(config.statusMapping)) {
    if (configStateName === stateName) {
      return mapping.folder;
    }
  }
  return null;
}

function extractTitleFromFilename(filename: string, linearId: string): string | null {
  // Remove Linear ID prefix and file extension
  const prefix = `${linearId}-`;
  if (!filename.startsWith(prefix)) {
    return null;
  }
  
  const title = filename
    .substring(prefix.length)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase()); // Title case
  
  return title || null;
}

function convertLinearIssueToTicket(issue: any, linearComments: any[], config: LinearSyncConfig): any {
  // Convert timestamps to SGT
  const createdAt = TimezoneUtils.utcToSGT(issue.createdAt);
  const updatedAt = TimezoneUtils.utcToSGT(issue.updatedAt);
  const dueDate = issue.dueDate ? TimezoneUtils.utcToSGT(issue.dueDate) : undefined;
  
  // Build frontmatter metadata
  const frontmatter = {
    linear_id: issue.identifier,
    title: issue.title,
    status: issue.state.name,
    assignee: issue.assignee?.email,
    labels: issue.labels?.nodes?.map((label: any) => label.name) || [],
    priority: issue.priority || 0,
    due_date: dueDate,
    url: issue.url,
    created_at: createdAt,
    updated_at: updatedAt
  };
  
  // Convert description
  const content = issue.description || `# ${issue.title}\n\n*No description provided*`;
  
  // Convert comments
  const comments = linearComments.map(comment => ({
    id: comment.id,
    author: comment.user?.email || comment.user?.name || 'Unknown',
    content: comment.body || '',
    created_at: TimezoneUtils.utcToSGT(comment.createdAt)
  }));
  
  return {
    frontmatter,
    content,
    comments
  };
}