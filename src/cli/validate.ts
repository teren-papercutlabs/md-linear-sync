import fs from 'fs/promises';
import path from 'path';
import { ConfigManager } from '../config';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    title?: string;
    status?: string;
    priority?: number;
    labels?: string[];
    parent_id?: string;
  };
}

export async function validateCommand(filePath: string, options: { json?: boolean }) {
  try {
    const result = await validateFile(filePath);
    
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      outputHumanReadable(result, filePath);
    }
    
    // Exit with error code if validation failed
    if (!result.valid) {
      process.exit(1);
    }
    
  } catch (error) {
    const errorResult: ValidationResult = {
      valid: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      warnings: []
    };
    
    if (options.json) {
      console.log(JSON.stringify(errorResult, null, 2));
    } else {
      console.error('❌ Validation failed:', errorResult.errors[0]);
    }
    
    process.exit(1);
  }
}

async function validateFile(filePath: string): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check if file exists
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }
  
  // Check file extension
  if (!filePath.endsWith('.md')) {
    errors.push('File must have .md extension');
  }
  
  // Read file content
  const content = await fs.readFile(filePath, 'utf-8');
  
  // Load configuration for validation context
  let config;
  try {
    config = await ConfigManager.loadConfig();
  } catch (error) {
    throw new Error('No .linear-sync.json found. Run "md-linear-sync init" first.');
  }
  
  // Parse frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    errors.push('File must have YAML frontmatter section');
    return { valid: false, errors, warnings };
  }
  
  const frontmatter = frontmatterMatch[1];
  const metadata: any = {};
  
  // Parse YAML-like frontmatter manually (simple parsing)
  const lines = frontmatter.split('\n');
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      
      // Handle different value types
      if (key === 'labels') {
        // Parse array format: [label1, label2] or ['label1', 'label2']
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
  
  // Validate required fields
  if (!metadata.title || metadata.title.trim() === '') {
    errors.push('Title is required');
  }
  
  // Validate status against available workflow states
  if (metadata.status) {
    if (!config.statusMapping[metadata.status]) {
      errors.push(`Invalid status "${metadata.status}". Available statuses: ${Object.keys(config.statusMapping).join(', ')}`);
    }
  } else {
    warnings.push('No status specified - ticket will be created with default status');
  }
  
  // Validate priority
  if (metadata.priority !== undefined) {
    if (!Number.isInteger(metadata.priority) || metadata.priority < 0 || metadata.priority > 4) {
      errors.push('Priority must be an integer between 0-4 (0=No priority, 1=Urgent, 2=High, 3=Normal, 4=Low)');
    }
  }
  
  // Validate labels against team labels
  if (metadata.labels && Array.isArray(metadata.labels)) {
    const availableLabels = Object.keys(config.labelMapping);
    const invalidLabels = metadata.labels.filter((label: string) => !availableLabels.includes(label));
    
    if (invalidLabels.length > 0) {
      errors.push(`Invalid labels: ${invalidLabels.join(', ')}. Available labels: ${availableLabels.join(', ')}`);
    }
  }
  
  // Validate parent_id format (if provided)
  if (metadata.parent_id) {
    // Should be either a Linear ticket ID (like PAP-123) or a file path
    const linearIdPattern = /^[A-Z]+-\d+$/;
    const isLinearId = linearIdPattern.test(metadata.parent_id);
    const isFilePath = metadata.parent_id.includes('/') || metadata.parent_id.endsWith('.md');
    
    if (!isLinearId && !isFilePath) {
      errors.push('parent_id must be either a Linear ticket ID (e.g., PAP-123) or a file path (e.g., path/to/file.md)');
    }
    
    // If it's a file path, check if file exists
    if (isFilePath) {
      try {
        const parentPath = path.resolve(path.dirname(filePath), metadata.parent_id);
        await fs.access(parentPath);
      } catch {
        warnings.push(`Parent file "${metadata.parent_id}" not found - ticket will be created without parent`);
      }
    }
  }
  
  // Check for body content
  const bodyContent = content.replace(/^---[\s\S]*?---\n/, '').trim();
  if (!bodyContent) {
    warnings.push('No body content found - ticket will be created with minimal description');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata
  };
}

function outputHumanReadable(result: ValidationResult, filePath: string) {
  console.log(`\n📋 Validation Results for: ${filePath}`);
  
  if (result.valid) {
    console.log('✅ File is valid for ticket creation');
  } else {
    console.log('❌ File has validation errors');
  }
  
  if (result.errors.length > 0) {
    console.log('\n🚨 Errors:');
    result.errors.forEach(error => console.log(`   • ${error}`));
  }
  
  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach(warning => console.log(`   • ${warning}`));
  }
  
  if (result.metadata) {
    console.log('\n📄 Parsed Metadata:');
    if (result.metadata.title) console.log(`   Title: ${result.metadata.title}`);
    if (result.metadata.status) console.log(`   Status: ${result.metadata.status}`);
    if (result.metadata.priority !== undefined) console.log(`   Priority: ${result.metadata.priority}`);
    if (result.metadata.labels && result.metadata.labels.length > 0) {
      console.log(`   Labels: ${result.metadata.labels.join(', ')}`);
    }
    if (result.metadata.parent_id) console.log(`   Parent: ${result.metadata.parent_id}`);
  }
  
  console.log('');
}