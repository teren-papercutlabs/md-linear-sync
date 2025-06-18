import fs from 'fs';
import path from 'path';
import { LinearSyncClient } from '../client';
import { ConfigManager } from '../config';
import { TicketFileParser } from '../parsers';

export async function commentCommand(ticketId: string, commentText: string): Promise<void> {
  console.log(`💬 Adding comment to ticket ${ticketId}...\n`);

  try {
    // Load configuration
    const config = await ConfigManager.loadConfig();
    const envConfig = ConfigManager.loadEnvironmentConfig();
    
    if (!envConfig.linear?.apiKey) {
      console.error('❌ LINEAR_API_KEY not found in environment');
      process.exit(1);
    }
    
    // Initialize Linear client
    const client = new LinearSyncClient(envConfig.linear.apiKey);
    
    // Find the ticket file
    const filePath = findTicketFile(ticketId);
    if (!filePath) {
      throw new Error(`Ticket file for ${ticketId} not found`);
    }
    
    console.log(`📄 Found ticket file: ${path.basename(filePath)}`);
    
    // Parse the file to get Linear issue ID
    const content = fs.readFileSync(filePath, 'utf-8');
    const ticket = TicketFileParser.parseFile(content);
    
    if (!ticket.frontmatter.linear_id) {
      throw new Error(`No Linear ID found in ticket file. File may not be synced with Linear yet.`);
    }
    
    // Get the Linear issue to get the internal ID
    const linearIssue = await client.getIssue(ticket.frontmatter.linear_id);
    
    // Create the comment
    console.log(`🚀 Adding comment to Linear issue ${ticket.frontmatter.linear_id}...`);
    const comment = await client.createComment(linearIssue.id, commentText);
    
    console.log(`✅ Comment added successfully!`);
    console.log(`🔗 View ticket: ${ticket.frontmatter.url}`);
    console.log(`ℹ️  Comment will be synced to local file via webhook`);
    
  } catch (error) {
    console.error('\n❌ Failed to add comment:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function findTicketFile(ticketId: string): string | null {
  const linearTicketsDir = 'linear-tickets';
  
  if (!fs.existsSync(linearTicketsDir)) {
    return null;
  }
  
  // Search all status folders for the ticket file
  const statusFolders = fs.readdirSync(linearTicketsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
  
  for (const folder of statusFolders) {
    const folderPath = path.join(linearTicketsDir, folder);
    const files = fs.readdirSync(folderPath);
    
    // Look for files matching the ticket ID pattern
    // Handles both PAP-123-title.md and PAP-434.123-title.md formats
    const matchingFile = files.find(file => {
      return file.includes(ticketId) && file.endsWith('.md');
    });
    
    if (matchingFile) {
      return path.join(folderPath, matchingFile);
    }
  }
  
  return null;
}