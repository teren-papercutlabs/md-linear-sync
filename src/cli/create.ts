import fs from 'fs/promises';
import path from 'path';
import { ConfigManager } from '../config';
import { LinearSyncClient } from '../client';

interface TicketMetadata {
  title: string;
  status?: string;
  priority?: number;
  labels?: string[];
  parent_id?: string;
}

interface TicketFile {
  filePath: string;
  metadata: TicketMetadata;
  bodyContent: string;
  dependencies: string[];
  linearId?: string;
}

interface CreateOptions {
  dryRun?: boolean;
}

export async function createCommand(directory: string | undefined, options: CreateOptions) {
  try {
    const targetDir = directory || '.';
    console.log(`🎫 Creating Linear tickets from markdown files in: ${targetDir}`);
    
    // Load configuration and environment
    const config = await ConfigManager.loadConfig();
    const envConfig = ConfigManager.loadEnvironmentConfig();
    
    if (!envConfig.linear?.apiKey) {
      console.error('❌ LINEAR_API_KEY not found in environment');
      process.exit(1);
    }
    
    // Find all markdown files in target directory
    const markdownFiles = await findMarkdownFiles(targetDir);
    if (markdownFiles.length === 0) {
      console.log(`ℹ️  No markdown files found in ${targetDir}`);
      return;
    }
    
    console.log(`📄 Found ${markdownFiles.length} markdown files`);
    
    // Parse all files and build ticket objects
    const ticketFiles: TicketFile[] = [];
    for (const filePath of markdownFiles) {
      try {
        const metadata = await parseTicketFile(filePath);
        const bodyContent = await extractBodyContent(filePath);
        
        // Validate metadata
        const validationErrors = validateMetadata(metadata, config);
        if (validationErrors.length > 0) {
          console.error(`❌ Validation errors in ${filePath}:`);
          validationErrors.forEach(error => console.error(`   • ${error}`));
          continue;
        }
        
        // Extract dependencies
        const dependencies = extractDependencies(metadata, filePath);
        
        ticketFiles.push({
          filePath,
          metadata,
          bodyContent,
          dependencies
        });
        
      } catch (error) {
        console.error(`❌ Failed to parse ${filePath}:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    if (ticketFiles.length === 0) {
      console.error('❌ No valid ticket files found');
      process.exit(1);
    }
    
    // Build dependency graph and determine creation order
    const creationOrder = resolveDependencyOrder(ticketFiles);
    console.log(`🔗 Resolved dependency order: ${creationOrder.map(t => path.basename(t.filePath)).join(' → ')}`);
    
    if (options.dryRun) {
      showDryRunOutput(creationOrder, config);
      return;
    }
    
    // Create tickets in dependency order
    const client = new LinearSyncClient(envConfig.linear.apiKey);
    await createTicketsInOrder(creationOrder, config, client);
    
  } catch (error) {
    console.error('❌ Failed to create tickets:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

async function findMarkdownFiles(directory: string): Promise<string[]> {
  const files = await fs.readdir(directory);
  return files
    .filter(file => file.endsWith('.md') && !file.startsWith('.'))
    .map(file => path.join(directory, file));
}

async function parseTicketFile(filePath: string): Promise<TicketMetadata> {
  const content = await fs.readFile(filePath, 'utf-8');
  
  // Parse frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    throw new Error('File must have YAML frontmatter section');
  }
  
  const frontmatter = frontmatterMatch[1];
  const metadata: any = {};
  
  // Simple YAML parsing
  const lines = frontmatter.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      
      if (key === 'labels') {
        const arrayMatch = value.match(/^\[(.*)\]$/);
        if (arrayMatch) {
          metadata[key] = arrayMatch[1]
            .split(',')
            .map(label => label.trim().replace(/['"`]/g, ''))
            .filter(label => label.length > 0);
        } else {
          metadata[key] = [];
        }
      } else if (key === 'priority') {
        metadata[key] = parseInt(value, 10);
      } else {
        metadata[key] = value.trim().replace(/['"`]/g, '');
      }
    }
  }
  
  if (!metadata.title) {
    throw new Error('Title is required in frontmatter');
  }
  
  return metadata as TicketMetadata;
}

async function extractBodyContent(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  const bodyContent = content.replace(/^---[\s\S]*?---\n/, '').trim();
  return bodyContent || 'No description provided.';
}

function validateMetadata(metadata: TicketMetadata, config: any): string[] {
  const errors: string[] = [];
  
  // Validate status
  if (metadata.status && !config.statusMapping[metadata.status]) {
    errors.push(`Invalid status "${metadata.status}". Available: ${Object.keys(config.statusMapping).join(', ')}`);
  }
  
  // Validate priority
  if (metadata.priority !== undefined && (metadata.priority < 0 || metadata.priority > 4)) {
    errors.push('Priority must be between 0-4');
  }
  
  // Validate labels
  if (metadata.labels) {
    const availableLabels = Object.keys(config.labelMapping);
    const invalidLabels = metadata.labels.filter(label => !availableLabels.includes(label));
    if (invalidLabels.length > 0) {
      errors.push(`Invalid labels: ${invalidLabels.join(', ')}. Available: ${availableLabels.join(', ')}`);
    }
  }
  
  return errors;
}

function extractDependencies(metadata: TicketMetadata, filePath: string): string[] {
  const dependencies: string[] = [];
  
  if (metadata.parent_id) {
    const linearIdPattern = /^[A-Z]+-\d+$/;
    
    if (!linearIdPattern.test(metadata.parent_id)) {
      // It's a file path - resolve it relative to current file
      const resolvedPath = path.resolve(path.dirname(filePath), metadata.parent_id);
      const relativePath = path.relative('.', resolvedPath);
      dependencies.push(relativePath);
    }
  }
  
  return dependencies;
}

function resolveDependencyOrder(ticketFiles: TicketFile[]): TicketFile[] {
  const fileMap = new Map<string, TicketFile>();
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: TicketFile[] = [];
  
  // Create file map
  for (const file of ticketFiles) {
    fileMap.set(file.filePath, file);
  }
  
  // Topological sort with cycle detection
  function visit(filePath: string): void {
    if (visiting.has(filePath)) {
      throw new Error(`Circular dependency detected involving ${filePath}`);
    }
    
    if (visited.has(filePath)) {
      return;
    }
    
    const file = fileMap.get(filePath);
    if (!file) {
      console.warn(`⚠️  Dependency file not found: ${filePath}`);
      return;
    }
    
    visiting.add(filePath);
    
    // Visit dependencies first
    for (const dep of file.dependencies) {
      visit(dep);
    }
    
    visiting.delete(filePath);
    visited.add(filePath);
    result.push(file);
  }
  
  // Process all files
  for (const file of ticketFiles) {
    visit(file.filePath);
  }
  
  return result;
}

function showDryRunOutput(ticketFiles: TicketFile[], config: any) {
  console.log('\n🔍 DRY RUN - Would create tickets in this order:');
  
  for (let i = 0; i < ticketFiles.length; i++) {
    const file = ticketFiles[i];
    console.log(`\n${i + 1}. ${path.basename(file.filePath)}`);
    console.log(`   Title: ${file.metadata.title}`);
    
    if (file.metadata.status) {
      console.log(`   Status: ${file.metadata.status}`);
    }
    
    if (file.metadata.priority !== undefined) {
      const priorityLabels = ['No priority', 'Urgent', 'High', 'Normal', 'Low'];
      console.log(`   Priority: ${file.metadata.priority} (${priorityLabels[file.metadata.priority]})`);
    }
    
    if (file.metadata.labels && file.metadata.labels.length > 0) {
      console.log(`   Labels: ${file.metadata.labels.join(', ')}`);
    }
    
    if (file.metadata.parent_id) {
      console.log(`   Parent: ${file.metadata.parent_id}`);
    }
    
    if (file.dependencies.length > 0) {
      console.log(`   Dependencies: ${file.dependencies.map(d => path.basename(d)).join(', ')}`);
    }
  }
}

async function createTicketsInOrder(ticketFiles: TicketFile[], config: any, client: LinearSyncClient) {
  const createdTickets = new Map<string, any>();
  
  for (let i = 0; i < ticketFiles.length; i++) {
    const file = ticketFiles[i];
    console.log(`\n🚀 Creating ticket ${i + 1}/${ticketFiles.length}: ${path.basename(file.filePath)}`);
    
    try {
      // Resolve parent ID if it's a file dependency
      let parentId: string | undefined;
      
      if (file.metadata.parent_id) {
        const linearIdPattern = /^[A-Z]+-\d+$/;
        
        if (linearIdPattern.test(file.metadata.parent_id)) {
          // It's already a Linear ticket ID - verify it exists
          console.log(`🔍 Verifying parent ticket: ${file.metadata.parent_id}`);
          const parentTicket = await client.findIssueByIdentifier(file.metadata.parent_id);
          
          if (parentTicket) {
            parentId = parentTicket.id;
            console.log(`✅ Parent ticket found: ${parentTicket.title}`);
          } else {
            console.warn(`⚠️  Parent ticket ${file.metadata.parent_id} not found - creating without parent`);
          }
        } else {
          // It's a file path - look up the created ticket
          const parentFilePath = path.resolve(path.dirname(file.filePath), file.metadata.parent_id);
          const relativePath = path.relative('.', parentFilePath);
          const parentTicket = createdTickets.get(relativePath);
          
          if (parentTicket) {
            parentId = parentTicket.id;
            console.log(`✅ Parent resolved from file: ${parentTicket.identifier} (${parentTicket.title})`);
          } else {
            console.warn(`⚠️  Parent file ${relativePath} not processed yet - creating without parent`);
          }
        }
      }
      
      // Create the ticket
      const ticket = await createTicket(file, config, client, parentId);
      createdTickets.set(file.filePath, ticket);
      
      // Update file with Linear metadata
      await updateFileWithLinearMetadata(file.filePath, ticket);
      
      // Move file to status folder
      await moveFileToStatusFolder(file.filePath, file.metadata.status || 'Todo', config, ticket);
      
      console.log(`✅ Created: ${ticket.identifier} - ${ticket.title}`);
      console.log(`🔗 ${ticket.url}`);
      
    } catch (error) {
      console.error(`❌ Failed to create ticket for ${file.filePath}:`, error instanceof Error ? error.message : 'Unknown error');
    }
  }
}

async function createTicket(file: TicketFile, config: any, client: LinearSyncClient, parentId?: string) {
  // Resolve label IDs
  const labelIds = file.metadata.labels 
    ? file.metadata.labels.map(labelName => config.labelMapping[labelName]?.id).filter(Boolean)
    : [];
  
  // Resolve status ID
  const stateId = file.metadata.status 
    ? config.statusMapping[file.metadata.status]?.id 
    : undefined;
  
  const ticket = await client.createIssue(
    config.teamId,
    file.metadata.title,
    file.bodyContent,
    stateId,
    config.projectId,
    labelIds,
    parentId,
    file.metadata.priority
  );
  
  return ticket;
}

async function updateFileWithLinearMetadata(filePath: string, ticket: any) {
  const content = await fs.readFile(filePath, 'utf-8');
  
  // Update frontmatter with Linear data
  const linearMetadata = [
    `linear_id: ${ticket.identifier}`,
    `created_at: '${ticket.createdAt}'`,
    `updated_at: '${ticket.updatedAt}'`,
    `url: ${ticket.url}`
  ].join('\n');
  
  const frontmatterMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (frontmatterMatch) {
    const updatedFrontmatter = frontmatterMatch[2] + '\n' + linearMetadata;
    const updatedContent = content.replace(
      /^---\n[\s\S]*?\n---/,
      `---\n${updatedFrontmatter}\n---`
    );
    await fs.writeFile(filePath, updatedContent);
  }
}

async function moveFileToStatusFolder(filePath: string, status: string, config: any, ticket: any) {
  const statusInfo = config.statusMapping[status];
  if (!statusInfo) return;
  
  // Generate filename using the same logic as import/sync
  const sanitizedTitle = ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 50); // Limit length
  
  let filename: string;
  if (ticket.parent?.identifier) {
    // Child ticket: PAP-434.447-child-task.md
    const childNumber = ticket.identifier.split('-')[1];
    filename = `${ticket.parent.identifier}.${childNumber}-${sanitizedTitle}.md`;
  } else {
    // Regular ticket: PAP-447-implement-feature.md
    filename = `${ticket.identifier}-${sanitizedTitle}.md`;
  }
  
  const statusFolder = path.join('linear', statusInfo.folder);
  const newPath = path.join(statusFolder, filename);
  
  // Create status folder if it doesn't exist
  await fs.mkdir(statusFolder, { recursive: true });
  
  // Move file to status folder
  await fs.rename(filePath, newPath);
  console.log(`📁 Moved to: ${newPath}`);
}