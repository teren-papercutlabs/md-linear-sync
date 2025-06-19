# md-linear-sync

Sync Linear tickets to local markdown files with status-based folder organization. Features robust bidirectional sync, comment management, and consistent duplicate title handling.

## Installation

```bash
npm install -g md-linear-sync
```

## Quick Start

Get started in 5 minutes:

```bash
# 1. Get your Linear API key from https://linear.app/settings/api

# 2. Initialize in your project directory
md-linear-sync init

# 3. Import existing tickets
md-linear-sync import

# 4. Edit files, then sync changes
md-linear-sync push PAP-431

# 5. Add comments to tickets
md-linear-sync comment PAP-431 "Work completed! ✅"

# 6. Start bidirectional sync (optional)
md-linear-sync start-sync
```

Your Linear tickets are now accessible as markdown files organized by status.

## Core Concepts

### How md-linear-sync Works

md-linear-sync creates a bidirectional bridge between Linear tickets and local markdown files. This tool is designed for **agentic coding workflows** where AI agents read and write tickets programmatically. For manual ticket management, Linear's web interface is more efficient.

**Sync mechanisms:**

- **CLI commands**: Create tickets from markdown files ([see Ticket Creation](#ticket-creation)) and push local changes to Linear ([see CLI Reference](#cli-reference))
- **Webhooks**: Real-time sync from Linear to local files - when tickets are created, edited, deleted, or commented on in Linear, the changes automatically update your local files and move them between status folders

#### The File-Folder Model

Each Linear ticket becomes a markdown file organized by your team's configured statuses:

```
md-linear-sync/
└── linear-tickets/
    ├── todo/
    │   └── PAP-431-implement-auth.md
    ├── in-progress/
    │   ├── PAP-430-user-dashboard.md
    │   └── PAP-430.432-dashboard-layout.md  # Child ticket
    └── done/
        └── PAP-429-setup-database.md
```

**Key principles:**

- **Status = Folder**: Moving files between folders updates Linear ticket status
- **Filename = Identity**: `PAP-431-implement-auth.md` maps to Linear ticket PAP-431
- **Parent-Child**: `PAP-430.432-child.md` shows PAP-432 is a child of PAP-430
- **Folder names match your team's Linear workflow states** (converted to lowercase with hyphens)

#### File Structure

Each ticket file contains three sections: **frontmatter** (ticket metadata), **ticket description**, and **comments**:

```markdown
---
title: Implement user authentication
status: In Progress
priority: 2
labels: [Feature, Backend]
linear_id: PAP-431
created_at: "2025-01-15T09:30:00.000Z"
url: https://linear.app/team/issue/PAP-431
---

## Description

Add JWT-based authentication with password reset flow.

## Acceptance Criteria

- [ ] Login endpoint with email/password
- [ ] JWT token generation and validation
- [ ] Password reset via email

---comments---

- id: comment_123
  author: john@company.com  
  content: "Should we use refresh tokens too?"
  created_at: '2025-01-15T10:15:00.000Z'
```

## Setup Guide

### Prerequisites

- Node.js 18+
- Linear account with API access
- Git repository for storing markdown files

### 1. Get Linear API Key

1. Go to [Linear Settings → API](https://linear.app/settings/api)
2. Create a new Personal API key
3. Copy the key (starts with `lin_api_`)

### 2. Initialize Project

```bash
cd your-project-directory
md-linear-sync init
```

The setup wizard will:

- Prompt for your Linear API key
- Show your available teams (select one)
- Show available projects (select one or skip)
- Discover your team's workflow states
- Create folder structure and configuration files

### 3. Generated Files

After `init`, you'll have:

```
md-linear-sync/
├── .linear-sync.json          # Project configuration
├── linear-tickets/            # Status folders (matches your workflow)
│   ├── backlog/
│   ├── todo/
│   ├── in-progress/
│   └── done/
├── new-tickets/               # For creating new tickets
├── .linear-ticket-format.md   # Template to be filled in with your desired ticket format
├── create-linear-ticket.md    # Claude Code slash command
├── .env                       # API key storage
└── CLAUDE.md                  # AI context file (workflow guidance)
```

### 4. Import Existing Tickets

```bash
md-linear-sync import
```

This fetches all tickets from your Linear project and creates markdown files organized by status.

### 5. Bidirectional Sync Setup (Optional)

For automatic sync in both directions:

```bash
md-linear-sync start-sync
```

This enables:
- **File watching**: Moving files between status folders automatically updates Linear ticket status
- **Webhook sync**: Linear changes automatically update local files
- **Real-time updates**: Comments, status changes, and ticket creation sync immediately

The system uses ngrok tunneling and auto-restarts to handle session limits.

### 6. Slack Notifications (Optional)

Get notified of Linear changes in Slack:

```bash
md-linear-sync setup-slack
```

Follow the wizard to create a Slack app with proper permissions and set up a notification channel.

## Agentic Workflow

This tool is designed for AI agents to programmatically manage tickets:

### 1. Plan tickets with your agent

Work with your AI coding assistant to break down features into tickets.

### 2. Create tickets using the slash command

**Claude Code users**: Use the slash command:

```bash
/create-linear-ticket "Implement user authentication"
```

**Other AI tools**: Feed the contents of `md-linear-sync/create-linear-ticket.md` as a prompt to your agent. This file contains strict validation rules and examples.

**AI Context**: The `CLAUDE.md` file created during setup provides comprehensive workflow guidance for AI agents. Copy this to your AI tool's context files (e.g., .cursorrules, .ai-context) if not using Claude Code.

### 3. Agent validates and creates tickets

The agent should:

1. Write markdown files with proper frontmatter
2. Run `md-linear-sync validate filename.md --json`
3. Fix any validation errors and re-validate - if there are any errors, validate returns them in machine-readable format for the agent to iterate until they pass
4. Only when validation passes: run `md-linear-sync create` (or `md-linear-sync create folder/` if tickets are in a specific folder) to create the tickets in Linear

### 4. Files automatically sync

- Created tickets move to appropriate status folders
- Linear changes sync back to local files via webhooks
- Agents can read ticket status by checking folder location

## CLI Reference

### Core Commands

#### `md-linear-sync init`

Interactive setup wizard. Creates configuration, folder structure, and discovers team settings.

#### `md-linear-sync import`

Import all tickets from Linear project to local markdown files.

#### `md-linear-sync push [ticket-id]`

Sync local file changes to Linear.

```bash
# Push specific ticket
md-linear-sync push PAP-431

# Push all modified files
md-linear-sync push
```

#### `md-linear-sync pull [ticket-id]`

Sync Linear changes to local files.

```bash
# Pull specific ticket
md-linear-sync pull PAP-431

# Reset and re-import all tickets (full refresh from Linear)
md-linear-sync reset
md-linear-sync import
```

#### `md-linear-sync comment <ticket-id> <comment-text>`

Add comments to Linear tickets with full markdown support.

```bash
# Simple comment
md-linear-sync comment PAP-431 "Work completed successfully"

# Markdown comment with formatting
md-linear-sync comment PAP-431 "**Implementation complete!**

- Fixed validation errors ✅
- Added comprehensive tests ✅  
- Updated documentation ✅

Ready for review! 🚀"

# Comments support:
# - Multi-line content
# - Full markdown formatting (bold, lists, code blocks, etc.)
# - Emojis and special characters
# - Automatic sync back to local files via webhook
```

### Ticket Creation

#### `md-linear-sync create [directory]`

Create Linear tickets from markdown files with dependency resolution.

```bash
# Create from md-linear-sync/new-tickets/ folder
md-linear-sync create md-linear-sync/new-tickets/

# Create from any other folder you created to put tickets in
md-linear-sync create features/
```

#### `md-linear-sync validate <file> [--json]`

Validate markdown file before creating ticket. This is used by coding agents in the prompt to ensure created tickets are in valid format.

```bash
# Human-readable validation
md-linear-sync validate md-linear-sync/new-tickets/feature.md

# JSON output for automation - used by agents
md-linear-sync validate md-linear-sync/new-tickets/feature.md --json
```

### Configuration

#### `md-linear-sync update-config`

Refresh configuration with latest Linear team data (workflow states, labels).

### Bidirectional Sync

#### `md-linear-sync start-sync`

Start bidirectional sync daemon that enables:
- **File watching**: Moving files between folders automatically updates Linear ticket status
- **Webhook listener**: Real-time sync from Linear to local files
- **Auto-restart**: Handles ngrok session limits automatically

#### `md-linear-sync stop-sync`

Stop bidirectional sync daemon.

### Utilities

#### `md-linear-sync reset`

Remove all imported files and reset local state.

## Configuration Reference

### md-linear-sync/.linear-sync.json

```json
{
  "teamId": "team_uuid",
  "teamName": "Engineering",
  "projectId": "project_uuid",
  "projectName": "Web App",
  "statusMapping": {
    "Backlog": { "id": "state_uuid", "folder": "backlog" },
    "Todo": { "id": "state_uuid", "folder": "todo" },
    "In Progress": { "id": "state_uuid", "folder": "in-progress" },
    "Done": { "id": "state_uuid", "folder": "done" }
  },
  "labelMapping": {
    "Feature": { "id": "label_uuid", "color": "#0066cc" },
    "Bug": { "id": "label_uuid", "color": "#cc0000" }
  },
  "timezone": "America/New_York",
  "lastUpdated": "2025-01-15T10:00:00.000Z"
}
```

### Environment Variables

```env
LINEAR_API_KEY=lin_api_your_key_here
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token  # Optional
SLACK_WEBHOOK_URL=https://hooks.slack.com/...  # Optional
```

### File Format Reference

#### Frontmatter Fields

```yaml
title: string # Required
status: string # Must match team workflow states
priority: 0-4 # 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
labels: [string] # Must match team labels
parent_id: string # Linear ticket ID or file path
linear_id: string # Auto-generated after creation
created_at: string # Auto-generated (ISO format)
updated_at: string # Auto-generated (ISO format)
url: string # Auto-generated Linear URL
```

## License

MIT License - see [LICENSE](LICENSE) file.
