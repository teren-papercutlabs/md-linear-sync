import prompts from 'prompts';
import fs from 'fs';
import path from 'path';
import { LinearDiscoveryClient } from '../client';
import { ConfigManager, stateNameToFolderName, getWorkflowTypeOrder } from '../config';
import { LinearSyncConfig, StatusMapping } from '../types';

export async function setupCommand(): Promise<void> {
  console.log('🚀 Setting up md-linear-sync...\n');

  try {
    // Step 1: Get and validate API key
    const apiKey = await getAndValidateApiKey();
    
    // Step 2: Select team
    const discoveryClient = new LinearDiscoveryClient(apiKey);
    const selectedTeam = await selectTeam(discoveryClient);
    
    // Step 3: Select project (optional)
    const selectedProject = await selectProject(discoveryClient, selectedTeam.id);
    
    // Step 4: Get workflow states and labels
    console.log('\n🔍 Fetching workflow states and labels...');
    const [workflowStates, teamLabels] = await Promise.all([
      discoveryClient.getWorkflowStates(selectedTeam.id),
      discoveryClient.getTeamLabels(selectedTeam.id)
    ]);
    console.log(`📋 Found ${workflowStates.length} workflow states for ${selectedTeam.name}:`);
    console.log(`🏷️  Found ${teamLabels.length} team labels`);
    
    // Group states by workflow type and sort
    const statesByType = new Map<string, typeof workflowStates>();
    for (const state of workflowStates) {
      if (!statesByType.has(state.type)) {
        statesByType.set(state.type, []);
      }
      statesByType.get(state.type)!.push(state);
    }
    
    // Sort types by desired order and create status mapping
    const statusMapping: Record<string, StatusMapping> = {};
    const sortedTypes = Array.from(statesByType.keys()).sort((a, b) => {
      return getWorkflowTypeOrder(a) - getWorkflowTypeOrder(b);
    });
    
    for (const type of sortedTypes) {
      const typeOrder = getWorkflowTypeOrder(type);
      const states = statesByType.get(type)!;
      
      // Sort states within type by position
      states.sort((a, b) => a.position - b.position);
      
      for (let i = 0; i < states.length; i++) {
        const state = states[i];
        const folderName = stateNameToFolderName(state.name, state.type, typeOrder, i);
        statusMapping[state.name] = {
          id: state.id,
          folder: folderName,
          type: state.type
        };
        console.log(`   ${state.name} (${state.type}) → ${folderName}/`);
      }
    }
    
    // Step 5: Generate label mapping
    const labelMapping: Record<string, { id: string; color: string; description?: string }> = {};
    for (const label of teamLabels) {
      labelMapping[label.name] = {
        id: label.id,
        color: label.color,
        description: label.description || undefined
      };
    }
    
    // Step 6: Create configuration
    const config: LinearSyncConfig = {
      teamId: selectedTeam.id,
      teamName: selectedTeam.name,
      projectId: selectedProject.id, // Now guaranteed to exist
      projectName: selectedProject.name,
      statusMapping,
      labelMapping,
      timezone: 'Asia/Singapore',
      lastUpdated: new Date().toISOString()
    };
    
    await ConfigManager.saveConfig(config);
    console.log('\n✅ Configuration saved to md-linear-sync/.linear-sync.json');
    
    // Step 6: Create directory structure
    await createDirectoryStructure(Object.values(statusMapping).map(s => s.folder));
    
    // Step 7: Create .env file with the API key
    await createEnvFile(apiKey);
    console.log('✅ Created .env file with your API key');
    
    // Step 8: Also create .env.example for reference
    ConfigManager.createEnvExample();
    console.log('✅ Created .env.example template');
    
    // Step 9: Create ticket templates and AI context
    await createTicketTemplate(config);
    await createTicketCreationCommand(config);
    await createClaudeContext();
    console.log('✅ Created .linear-ticket-format.md template');
    console.log('✅ Created create-linear-ticket.md slash command');
    console.log('✅ Created CLAUDE.md AI context file');
    
    console.log('\n🎉 Setup complete!');
    console.log('\nNext steps:');
    console.log('1. Run "md-linear-sync import" to import existing tickets');
    console.log('2. Start bidirectional sync with "md-linear-sync start-sync"');
    console.log('3. Create new tickets using the .linear-ticket-format.md template');
    console.log('4. Use CLAUDE.md for AI agent context and workflow guidance');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

async function getAndValidateApiKey(): Promise<string> {
  const response = await prompts({
    type: 'password',
    name: 'apiKey',
    message: 'Enter your Linear API key:',
    validate: (value: string) => {
      if (!value || value.trim().length === 0) {
        return 'API key is required';
      }
      return true;
    }
  });
  
  if (!response.apiKey) {
    console.log('\n❌ Setup cancelled');
    process.exit(0);
  }
  
  console.log('\n🔍 Validating API key...');
  const discoveryClient = new LinearDiscoveryClient(response.apiKey);
  const validation = await discoveryClient.validateApiKey();
  
  if (!validation.valid) {
    throw new Error('Invalid API key. Please check your Linear API key and try again.');
  }
  
  console.log(`✅ API key valid! Hello, ${validation.user?.name || 'Linear user'}`);
  return response.apiKey;
}

async function selectTeam(client: LinearDiscoveryClient) {
  console.log('\n👥 Fetching your teams...');
  const teams = await client.getTeams();
  
  if (teams.length === 0) {
    throw new Error('No teams found. You need access to at least one Linear team.');
  }
  
  if (teams.length === 1) {
    console.log(`✅ Using team: ${teams[0].name} (${teams[0].key})`);
    return teams[0];
  }
  
  const response = await prompts({
    type: 'select',
    name: 'teamId',
    message: 'Select a team:',
    choices: teams.map(team => ({
      title: `${team.name} (${team.key})`,
      value: team.id,
      description: `Team ID: ${team.id}`
    }))
  });
  
  if (!response.teamId) {
    console.log('\n❌ Setup cancelled');
    process.exit(0);
  }
  
  const selectedTeam = teams.find(t => t.id === response.teamId)!;
  console.log(`✅ Selected team: ${selectedTeam.name} (${selectedTeam.key})`);
  return selectedTeam;
}

async function selectProject(client: LinearDiscoveryClient, teamId: string) {
  console.log('\n📁 Fetching projects...');
  const projects = await client.getProjects(teamId);
  
  if (projects.length === 0) {
    throw new Error('No projects found for this team. Please create a project in Linear first.');
  }
  
  const choices = projects.map(project => ({
    title: project.name,
    value: project.id,
    description: project.description || `Project ID: ${project.id}`
  }));
  
  const response = await prompts({
    type: 'select',
    name: 'projectId',
    message: 'Select a project:',
    choices
  });
  
  if (!response.projectId) {
    console.log('\n❌ Setup cancelled');
    process.exit(0);
  }
  
  const selectedProject = projects.find(p => p.id === response.projectId)!;
  console.log(`✅ Selected project: ${selectedProject.name}`);
  return selectedProject;
}

async function createDirectoryStructure(folderNames: string[]): Promise<void> {
  // Create md-linear-sync base directory
  const baseDir = path.join(process.cwd(), 'md-linear-sync');
  
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  
  // Create linear-tickets subdirectory
  const linearDir = path.join(baseDir, 'linear-tickets');
  
  if (!fs.existsSync(linearDir)) {
    fs.mkdirSync(linearDir, { recursive: true });
  }
  
  for (const folderName of folderNames) {
    const folderPath = path.join(linearDir, folderName);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  }
  
  // Create new-tickets directory
  const newTicketsDir = path.join(baseDir, 'new-tickets');
  if (!fs.existsSync(newTicketsDir)) {
    fs.mkdirSync(newTicketsDir, { recursive: true });
  }
  
  console.log(`✅ Created directory structure: md-linear-sync/linear-tickets/${folderNames.join('/, md-linear-sync/linear-tickets/')}/`);
  console.log(`✅ Created new-tickets directory: md-linear-sync/new-tickets/`);
  
  // Create a README in the linear-tickets directory
  const readmeContent = `# Linear Tickets

This directory contains Linear tickets organized by status.

Folders:
${folderNames.map(name => `- \`${name}/\` - Tickets in this status`).join('\n')}

## Usage

- Move files between folders to change ticket status
- Run \`md-linear-sync push\` to sync local changes to Linear
- Run \`md-linear-sync pull\` to sync Linear changes to local files
- Run \`md-linear-sync comment PAP-123 "Your comment"\` to add comments to tickets
`;
  
  fs.writeFileSync(path.join(linearDir, 'README.md'), readmeContent);
  
  // Create README in new-tickets directory
  const newTicketsReadme = `# New Tickets

Create markdown files in this directory to create Linear tickets.

## Format

Each file should have YAML frontmatter with ticket metadata:

\`\`\`markdown
---
title: Your ticket title
status: Todo
priority: 2
labels: [Feature, Backend]
parent_id: PAP-123  # Optional parent ticket
---

Your ticket description here...
\`\`\`

## Usage

1. Create markdown files with proper frontmatter
2. Run \`md-linear-sync validate filename.md\` to check format
3. Run \`md-linear-sync create\` to create all tickets in Linear
4. Files automatically move to appropriate status folders
`;
  
  fs.writeFileSync(path.join(newTicketsDir, 'README.md'), newTicketsReadme);
}

async function createEnvFile(apiKey: string): Promise<void> {
  const envPath = path.join(process.cwd(), 'md-linear-sync', '.env');
  
  // Check if .env already exists
  if (fs.existsSync(envPath)) {
    console.log('ℹ️  .env file already exists, not overwriting');
    return;
  }
  
  const envContent = `# Linear API Configuration
LINEAR_API_KEY=${apiKey}

# Optional: Slack Notifications  
# SLACK_WEBHOOK_URL=https://hooks.slack.com/services/your/slack/webhook

# Optional: Webhook Security
# WEBHOOK_SECRET=your_webhook_secret_here
`;

  fs.writeFileSync(envPath, envContent);
}

async function createTicketTemplate(config: any): Promise<void> {
  const templatePath = path.join(process.cwd(), 'md-linear-sync', '.linear-ticket-format.md');
  
  // Check if template already exists
  if (fs.existsSync(templatePath)) {
    console.log('ℹ️  .linear-ticket-format.md already exists, not overwriting');
    return;
  }
  
  const templateContent = `---
title: "Your Ticket Title Here"
status: Todo
priority: 3
labels: [Feature]
parent_id: ""
---

# Ticket Description

Brief description of what this ticket is about.

## Acceptance Criteria

- [ ] First acceptance criteria
- [ ] Second acceptance criteria  
- [ ] Third acceptance criteria

## Additional Details

Any additional context, background information, or implementation notes.

---

**Instructions:** 
- Fill in your own ticket content above
- Remove this instructions section before creating the ticket
- Use \`create-linear-ticket.md\` slash command for Claude Code integration
`;

  fs.writeFileSync(templatePath, templateContent);
}

async function createTicketCreationCommand(config: any): Promise<void> {
  const commandPath = path.join(process.cwd(), 'md-linear-sync', 'create-linear-ticket.md');
  
  // Check if command already exists
  if (fs.existsSync(commandPath)) {
    console.log('ℹ️  create-linear-ticket.md already exists, not overwriting');
    return;
  }
  
  // Generate available statuses and labels for strict validation
  const availableStatuses = Object.keys(config.statusMapping);
  const availableLabels = Object.keys(config.labelMapping);
  
  const commandContent = `# Create Linear Ticket

This slash command helps create Linear tickets from Claude Code conversations.

## Workflow

When you've discussed a feature/bug/task with Claude Code and are ready to create a Linear ticket:

1. **Create the ticket file**:
   - Claude Code should create a new markdown file in \`md-linear-sync/new-tickets/\`
   - Use the content template from \`md-linear-sync/.linear-ticket-format.md\`
   - Fill in the frontmatter and content based on the conversation

2. **Validate and create** (run from installation directory, default \`md-linear-sync\`):
   - Validate: \`npx md-linear-sync validate new-tickets/filename.md\`
   - Create: \`npx md-linear-sync create new-tickets\`

## File Locations

- **Ticket template**: \`md-linear-sync/.linear-ticket-format.md\` (reference for content structure)
- **New tickets**: \`md-linear-sync/new-tickets/\` (where Claude Code creates new ticket files)
- **Synced tickets**: \`md-linear-sync/linear-tickets/{status-folder}/\` (tickets automatically move here after creation)

## Frontmatter Requirements

### Required:
- **title**: String - The ticket title

### Optional:
- **status**: One of: ${availableStatuses.join(', ')}
- **priority**: Integer 0-4 (0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low)  
- **labels**: Array from: ${availableLabels.join(', ')}
- **parent_id**: Linear ticket ID (e.g., "PAP-123") or path to parent markdown file

### Example:
\`\`\`yaml
---
title: "Implement user authentication"
status: Todo
priority: 2
labels: [Feature, Backend]
parent_id: "PAP-456"
---
\`\`\`

## Commands

**Note**: All commands must be run from the installation directory (default \`md-linear-sync\`)

- \`npx md-linear-sync validate filename.md\` - Validate frontmatter
- \`npx md-linear-sync create new-tickets\` - Create Linear tickets from directory
- \`npx md-linear-sync create new-tickets --dry-run\` - Preview without creating
- \`npx md-linear-sync comment PAP-123 "Your comment"\` - Add comments to tickets

## What Happens After Creation

1. Linear ticket is created with metadata
2. File gets Linear ID, URL, timestamps added
3. File automatically moves to appropriate status folder
4. Ticket is now synced bidirectionally with Linear
`;

  fs.writeFileSync(commandPath, commandContent);
}

async function createClaudeContext(): Promise<void> {
  const claudePath = path.join(process.cwd(), 'CLAUDE.md');
  
  // Check if CLAUDE.md already exists
  if (fs.existsSync(claudePath)) {
    console.log('ℹ️  CLAUDE.md already exists, not overwriting');
    return;
  }
  
  // Read the template
  const templatePath = path.join(__dirname, '..', '..', 'CLAUDEMD-template.md');
  
  if (!fs.existsSync(templatePath)) {
    console.log('⚠️  CLAUDEMD-template.md not found, skipping CLAUDE.md creation');
    return;
  }
  
  const templateContent = fs.readFileSync(templatePath, 'utf8');
  fs.writeFileSync(claudePath, templateContent);
}