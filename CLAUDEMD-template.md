# CLAUDE.md - Linear Ticket Management

## CRITICAL: Commands Must Run From This Directory

**ALWAYS cd to the project directory before running md-linear-sync commands:**

```bash
cd /path/to/your/project
# Then run commands
```

## Status Management - The Key Concept

**Status = Folder Location + Frontmatter**. To change a ticket's status:
1. **Edit the frontmatter status field**
2. **Move the file to the corresponding status folder**

```bash
# Example folder structure (varies by project)
linear-tickets/
├── status-folder-1/    # Maps to team's workflow states
├── status-folder-2/    
├── status-folder-3/    
└── status-folder-4/    
```

## Essential Workflows

### Creating New Tickets

1. **Write ticket markdown in `new-tickets/` folder**
2. **Validate the ticket format:**
   ```bash
   npx md-linear-sync validate new-tickets/filename.md
   ```
3. **Create tickets in Linear:**
   ```bash
   npx md-linear-sync create new-tickets
   ```
4. **Files automatically move to appropriate status folders**

### Changing Ticket Status

**Two-Step Process:**
1. **Edit frontmatter status in the file**
2. **Move file to corresponding status folder**

```bash
# Step 1: Edit file frontmatter
# Change status: "Todo" to "In Progress"

# Step 2: Move file to corresponding folder
mv linear-tickets/todo-folder/PAP-123-ticket.md linear-tickets/in-progress-folder/

# Example: Cancel a ticket
# Edit frontmatter: status: "Canceled"
# Then move: mv linear-tickets/todo-folder/PAP-456.md linear-tickets/canceled-folder/
```

### Syncing Status Changes to Linear

**Option 1: Automatic Sync (Recommended)**
```bash
# Start bidirectional sync daemon
npx md-linear-sync start-sync
# Now file moves automatically sync to Linear!
# Linear changes automatically sync to local files!
```

**Option 2: Manual Push (After moving files between folders)**
```bash
# Push specific ticket status change
npx md-linear-sync push PAP-123

# Push multiple tickets  
npx md-linear-sync push PAP-456
npx md-linear-sync push PAP-789
```

### Pulling Latest Changes from Linear

```bash
# Pull specific ticket updates
npx md-linear-sync pull PAP-123

# Pull all updates (full refresh)
npx md-linear-sync reset
npx md-linear-sync import
```

### Adding Comments to Tickets

```bash
# Add progress updates
npx md-linear-sync comment PAP-123 "Implementation completed successfully"

# Markdown formatted comments
npx md-linear-sync comment PAP-123 "**Status Update:**
- Backend API endpoints ✅
- Frontend integration ✅
- Tests passing ✅

Ready for review!"

# Quick status updates
npx md-linear-sync comment PAP-456 "Blocked - waiting for design approval"
npx md-linear-sync comment PAP-789 "Work in progress - ETA 2 hours"
```

## Ticket Creation Frontmatter Requirements

### Required Fields
```yaml
---
title: "Your ticket title"
---
```

### Optional Fields
```yaml
---
title: "Your ticket title"
status: "Todo"                    # Will determine initial folder
priority: 2                       # 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
labels: [Feature, Improvement]     # Must match Linear team labels
parent_id: "PAP-434"              # Parent ticket ID for subtasks
---
```

## Common Operations

### Move Tickets to In Progress
```bash
# Step 1: Edit frontmatter in each file (status: "In Progress")
# Step 2: Move files to in-progress folder
mv linear-tickets/todo-folder/PAP-XXX-ticket.md linear-tickets/in-progress-folder/

# Step 3: Sync the status changes
npx md-linear-sync push PAP-XXX
```

### Cancel and Replace Old Tickets
```bash
# Step 1: Edit frontmatter (status: "Canceled")
# Step 2: Move to canceled folder
mv linear-tickets/todo-folder/PAP-XXX-old.md linear-tickets/canceled-folder/
# Step 3: Push change
npx md-linear-sync push PAP-XXX

# Create new replacement tickets
npx md-linear-sync create new-tickets
```

### Check Ticket Locations
```bash
# Find a specific ticket
find linear-tickets -name "*PAP-123*" -type f

# List tickets in status folders (folder names vary by project)
ls linear-tickets/*/
```

## Troubleshooting

### File Not Found Errors
- **Always check current directory:** `pwd` should show your project directory
- **Find the ticket:** `find linear-tickets -name "*PAP-XXX*"`

### Status Changes Not Syncing
- **Must do both: edit frontmatter AND move files between folders**
- **Must push specific ticket IDs** - `npx md-linear-sync push PAP-123`
- **Check if file moved successfully:** `ls linear-tickets/target-folder/`

### No Changes Detected
- File might already be in correct status folder
- Check Linear directly to confirm status
- Try pulling latest: `npx md-linear-sync pull PAP-123`

## Configuration

- **Config File**: `.linear-sync.json` (contains team-specific status/label mappings)
- **Folder Structure**: Check `linear-tickets/` to see your project's status folders
- **Status Mapping**: Each project has different folder names based on team workflow

## Quick Reference Commands

```bash
# Essential workflow
cd /path/to/your/project

# Start bidirectional sync (recommended for active work)
npx md-linear-sync start-sync    # File moves auto-sync to Linear
npx md-linear-sync stop-sync     # Stop the sync daemon

# Create tickets
npx md-linear-sync validate new-tickets/filename.md
npx md-linear-sync create new-tickets

# Add comments to tickets
npx md-linear-sync comment PAP-XXX "Work completed! ✅"
npx md-linear-sync comment PAP-XXX "**Status Update:** Ready for review"

# Change status (with auto-sync running, just move files!)
# 1. Edit frontmatter status in file
# 2. Move file between folders (automatically syncs!)
mv linear-tickets/from-folder/PAP-XXX.md linear-tickets/to-folder/

# Manual sync (when not using start-sync)
npx md-linear-sync push PAP-XXX   # Push status changes
npx md-linear-sync pull PAP-XXX   # Pull Linear updates
```