#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('md-linear-sync')
  .description('Sync Linear tickets to local markdown files with status-based folder organization')
  .version('0.1.7', '--version', 'display version number')
  .helpOption('--help', 'display help for command');

program
  .command('init')
  .description('Initialize configuration and directory structure')
  .action(async () => {
    const { setupCommand } = await import('./cli/setup');
    await setupCommand();
  });

program
  .command('import')
  .description('Import all tickets from Linear')
  .action(async () => {
    const { importCommand } = await import('./cli/import');
    await importCommand();
  });

program
  .command('push')
  .description('Push local changes to Linear')
  .argument('[ticket-id]', 'Specific ticket ID to push')
  .action(async (ticketId?: string) => {
    const { pushCommand } = await import('./cli/sync');
    await pushCommand(ticketId);
  });

program
  .command('pull')
  .description('Pull latest changes from Linear')
  .argument('[ticket-id]', 'Specific ticket ID to pull')
  .action(async (ticketId?: string) => {
    const { pullCommand } = await import('./cli/sync');
    await pullCommand(ticketId);
  });

program
  .command('reset')
  .description('Delete all imported tickets and start fresh')
  .action(async () => {
    const { resetCommand } = await import('./cli/reset');
    await resetCommand();
  });

program
  .command('start-sync')
  .description('Start bidirectional sync (webhooks + file watching)')
  .action(async () => {
    const { startSyncCommand } = await import('./cli/sync-daemon');
    await startSyncCommand();
  });

program
  .command('stop-sync')
  .description('Stop bidirectional sync daemon')
  .action(async () => {
    const { stopSyncCommand } = await import('./cli/sync-daemon');
    await stopSyncCommand();
  });

program
  .command('setup-slack')
  .description('Interactive setup for Slack notifications')
  .action(async () => {
    const { setupSlackCommand } = await import('./cli/slack-setup');
    await setupSlackCommand();
  });

program
  .command('update-config')
  .description('Update md-linear-sync/.linear-sync.json with latest Linear team data (states, labels, etc.)')
  .action(async () => {
    const { updateConfigCommand } = await import('./cli/update-config');
    await updateConfigCommand();
  });

program
  .command('validate')
  .description('Validate markdown files for ticket creation')
  .argument('<file-path>', 'Path to markdown file to validate')
  .option('--json', 'Output validation results as JSON')
  .action(async (filePath: string, options: { json?: boolean }) => {
    const { validateCommand } = await import('./cli/validate');
    await validateCommand(filePath, options);
  });

program
  .command('create')
  .description('Create Linear tickets from markdown files in a directory')
  .argument('[directory]', 'Directory containing markdown files (defaults to current directory)')
  .option('--dry-run', 'Show what would be created without actually creating tickets')
  .action(async (directory: string | undefined, options: { dryRun?: boolean }) => {
    const { createCommand } = await import('./cli/create');
    await createCommand(directory, options);
  });

program.parse();