import { ConfigManager } from '../config';
import { LinearDiscoveryClient } from '../client';
import path from 'path';
import fs from 'fs/promises';

interface UpdatedConfig {
  teamId: string;
  teamName: string;
  projectId?: string;
  projectName?: string;
  statusMapping: Record<string, { id: string; folder: string; type: string }>;
  labelMapping: Record<string, { id: string; color: string; description?: string }>;
  timezone: string;
  lastUpdated: string;
}

export async function updateConfigCommand() {
  try {
    console.log('🔄 Updating Linear configuration...');
    
    // 1. Load existing configuration and environment
    const envConfig = ConfigManager.loadEnvironmentConfig();
    if (!envConfig.linear?.apiKey) {
      console.error('❌ LINEAR_API_KEY not found in environment');
      process.exit(1);
    }
    
    let existingConfig;
    try {
      existingConfig = await ConfigManager.loadConfig();
    } catch (error) {
      console.error('❌ No existing .linear-sync.json found. Run "md-linear-sync init" first.');
      process.exit(1);
    }
    
    // 2. Fetch latest data from Linear
    const client = new LinearDiscoveryClient(envConfig.linear.apiKey);
    
    // Get team details
    const teams = await client.getTeams();
    const currentTeam = teams.find(team => team.id === existingConfig.teamId);
    
    if (!currentTeam) {
      console.error(`❌ Team ${existingConfig.teamId} not found. You may have lost access.`);
      process.exit(1);
    }
    
    // Get workflow states and labels
    console.log('🔍 Fetching workflow states...');
    const workflowStates = await client.getWorkflowStates(existingConfig.teamId);
    console.log(`📊 Found ${workflowStates.length} workflow states`);
    
    console.log('🔍 Fetching team labels...');
    const teamLabels = await client.getTeamLabels(existingConfig.teamId);
    console.log(`🏷️  Found ${teamLabels.length} team labels`);
    
    // Get project details if configured
    let currentProject;
    if (existingConfig.projectId) {
      try {
        const projects = await client.getProjects(existingConfig.teamId);
        currentProject = projects.find(p => p.id === existingConfig.projectId);
      } catch (error) {
        console.warn('⚠️  Could not fetch project information:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    // 3. Generate updated configuration
    const updatedConfig: UpdatedConfig = {
      teamId: existingConfig.teamId,
      teamName: currentTeam.name,
      projectId: existingConfig.projectId,
      projectName: currentProject?.name,
      statusMapping: generateStatusMapping(workflowStates),
      labelMapping: generateLabelMapping(teamLabels),
      timezone: existingConfig.timezone || 'Asia/Singapore',
      lastUpdated: new Date().toISOString()
    };
    
    // 4. Backup and write new configuration
    const backupPath = `.linear-sync.json.backup`;
    try {
      await fs.copyFile('.linear-sync.json', backupPath);
    } catch (error) {
      // Backup might fail if it's the first time, that's okay
    }
    
    await fs.writeFile('.linear-sync.json', JSON.stringify(updatedConfig, null, 2));
    
    // 5. Update folder structure
    await updateFolderStructure(updatedConfig.statusMapping);
    
    // 6. Update slash command file with new statuses and labels
    await updateTicketCreationCommand(updatedConfig);
    
    console.log('✅ Configuration updated successfully');
    console.log(`📊 ${Object.keys(updatedConfig.statusMapping).length} workflow states`);
    console.log(`🏷️  ${Object.keys(updatedConfig.labelMapping).length} team labels`);
    console.log(`💾 Backup saved to ${backupPath}`);
    console.log('🔄 Updated linear-ticket-creation.md with latest data');
    
  } catch (error) {
    console.error('❌ Configuration update failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

function generateStatusMapping(workflowStates: any[]) {
  const statusMapping: Record<string, { id: string; folder: string; type: string }> = {};
  
  // Group states by type
  const statesByType = workflowStates.reduce((acc, state) => {
    if (!acc[state.type]) acc[state.type] = [];
    acc[state.type].push(state);
    return acc;
  }, {});
  
  // Generate folder names with type prefixes
  const typeOrder = ['unstarted', 'started', 'completed', 'canceled'];
  let typeIndex = 1;
  
  for (const type of typeOrder) {
    const states = statesByType[type] || [];
    let stateIndex = 1;
    
    for (const state of states) {
      const folderName = `${typeIndex}.${stateIndex}-${state.name.toLowerCase().replace(/\s+/g, '-')}`;
      statusMapping[state.name] = {
        id: state.id,
        folder: folderName,
        type: state.type
      };
      stateIndex++;
    }
    
    if (states.length > 0) typeIndex++;
  }
  
  return statusMapping;
}

function generateLabelMapping(teamLabels: any[]) {
  const labelMapping: Record<string, { id: string; color: string; description?: string }> = {};
  
  for (const label of teamLabels) {
    labelMapping[label.name] = {
      id: label.id,
      color: label.color,
      description: label.description || undefined
    };
  }
  
  return labelMapping;
}

async function updateFolderStructure(statusMapping: any) {
  // Create all status folders
  for (const stateName of Object.keys(statusMapping)) {
    const folderPath = path.join('linear-tickets', statusMapping[stateName].folder);
    try {
      await fs.mkdir(folderPath, { recursive: true });
    } catch (error) {
      // Folder might already exist
    }
  }
}

async function updateTicketCreationCommand(config: UpdatedConfig) {
  const commandPath = path.join(process.cwd(), 'create-linear-ticket.md');
  
  // Check if command file exists
  try {
    await fs.access(commandPath);
  } catch {
    // File doesn't exist, skip update
    return;
  }
  
  // Generate available statuses and labels for strict validation
  const availableStatuses = Object.keys(config.statusMapping);
  const availableLabels = Object.keys(config.labelMapping);
  
  const commandContent = `# Linear Ticket Creation

This command creates Linear tickets from markdown files with strict frontmatter validation and automatic dependency resolution.

## Usage

When user asks to create a Linear ticket from a markdown file:

1. **Validate Prerequisites**:
   \`\`\`bash
   cd /home/teren41/environment/weaver-base/md-linear-sync && npm run build
   cd /home/teren41/environment/weaver-base/test-md-linear-sync
   \`\`\`

2. **Create/Validate Files**:
   - Files must be located in current directory or subdirectories
   - Use \`.linear-ticket-format.md\` as content template reference
   - Validate before creation: \`npx md-linear-sync validate filename.md\`
   - Preview creation: \`npx md-linear-sync create filename.md --dry-run\`
   - Create ticket: \`npx md-linear-sync create filename.md\`

## STRICT Frontmatter Requirements

### Required Fields:
- **title**: String - The ticket title (cannot be empty)

### Optional Fields:
- **status**: Must be exactly one of: ${availableStatuses.join(', ')}
- **priority**: Integer 0-4 (0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low)
- **labels**: Array containing only: ${availableLabels.join(', ')}
- **parent_id**: Either Linear ticket ID (format: [A-Z]+-\\d+) or relative file path

### Frontmatter Format:
\`\`\`yaml
---
title: "Exact title string"
status: Todo
priority: 3
labels: [Feature, Improvement]
parent_id: "PAP-123"
---
\`\`\`

## File Location Rules

- **Current directory**: \`filename.md\`
- **Subdirectories**: \`subdir/filename.md\`
- **Parent references**: \`../parent-file.md\` (for parent_id)

## Automatic Processing

1. **Validation**: Checks frontmatter against current Linear configuration
2. **Dependency Resolution**: 
   - Linear ticket IDs verified to exist
   - File paths resolved and checked for linear_id metadata
   - Missing dependencies result in warnings, not errors
3. **Ticket Creation**: Full metadata applied including labels, status, priority, parent
4. **File Updates**: Linear metadata added (linear_id, created_at, updated_at, url)
5. **File Movement**: Automatically moved to appropriate status folder (\`md-linear-sync/linear-tickets/{status-folder}/\`)

## Error Handling

- Invalid frontmatter values prevent ticket creation
- Missing parent dependencies generate warnings but don't block creation
- Files are only moved after successful Linear ticket creation
- All validation errors are reported before any API calls

## Integration Commands

- \`npx md-linear-sync validate filename.md\` - Check file validity
- \`npx md-linear-sync validate filename.md --json\` - JSON validation output
- \`npx md-linear-sync create filename.md --dry-run\` - Preview what would be created
- \`npx md-linear-sync create filename.md\` - Create the ticket

## Content Template Reference

Refer to \`.linear-ticket-format.md\` for proper ticket content structure including:
- Description format
- Acceptance criteria layout
- Additional details sections
`;

  await fs.writeFile(commandPath, commandContent);
}

