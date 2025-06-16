import matter from 'gray-matter';
import yaml from 'js-yaml';
import { TicketFile, TicketMetadata, Comment } from '../types';

export class TicketFileParser {
  private static readonly COMMENTS_SEPARATOR = '---comments---';

  static parseFile(content: string): TicketFile {
    try {
      // Parse frontmatter and content using gray-matter
      const parsed = matter(content);
      
      // Extract frontmatter as metadata
      const frontmatter = parsed.data as TicketMetadata;
      
      // Split content to separate main content from comments
      const parts = parsed.content.split(`\n${this.COMMENTS_SEPARATOR}\n`);
      const mainContent = parts[0].trim();
      
      // Parse comments from backmatter if it exists
      let comments: Comment[] = [];
      if (parts.length > 1 && parts[1].trim()) {
        try {
          const commentsData = yaml.load(parts[1].trim());
          comments = Array.isArray(commentsData) ? commentsData : [];
        } catch (error) {
          console.warn('Failed to parse comments section:', error);
          comments = [];
        }
      }
      
      return {
        frontmatter,
        content: mainContent,
        comments
      };
    } catch (error) {
      throw new Error(`Failed to parse ticket file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static generateFile(ticket: TicketFile): string {
    try {
      // Validate required frontmatter fields
      this.validateFrontmatter(ticket.frontmatter);
      
      // Generate frontmatter section
      const frontmatterYaml = yaml.dump(ticket.frontmatter, {
        sortKeys: true,
        lineWidth: -1 // Prevent line wrapping
      });
      
      // Start with frontmatter
      let content = '---\n' + frontmatterYaml + '---\n\n';
      
      // Add main content
      content += ticket.content;
      
      // Add comments section if comments exist
      if (ticket.comments && ticket.comments.length > 0) {
        content += '\n\n' + this.COMMENTS_SEPARATOR + '\n';
        try {
          const commentsYaml = yaml.dump(ticket.comments, {
            sortKeys: false,
            lineWidth: -1,
            quotingType: '"',
            forceQuotes: true
          });
          content += commentsYaml;
        } catch (yamlError) {
          // Fallback: skip comments section but don't fail the entire file generation
        }
      }
      
      return content;
    } catch (error) {
      throw new Error(`Failed to generate ticket file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  static generateFilename(linearId: string, title: string, parentId?: string): string {
    // Sanitize title for filename
    const sanitizedTitle = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
      .substring(0, 50); // Limit length
    
    // Handle parent-child relationships properly
    if (parentId) {
      // Child ticket: PAP-434.447-child-task.md
      const childNumber = linearId.split('-')[1];
      return `${parentId}.${childNumber}-${sanitizedTitle}.md`;
    } else {
      // Regular ticket: PAP-447-implement-feature.md
      return `${linearId}-${sanitizedTitle}.md`;
    }
  }

  static extractLinearIdFromFilename(filename: string): string | null {
    // Extract Linear ID from filename:
    // PAP-431-implement-feature.md -> PAP-431 (regular)
    // PAP-434.447-child-task.md -> PAP-447 (child ticket, return actual ticket ID)
    const match = filename.match(/^(?:([A-Z]+-\d+)\.(\d+)|([A-Z]+-\d+))/);
    if (match) {
      // If it's a parent.child format, return the child ID (PAP-447)
      if (match[1] && match[2]) {
        const parentPrefix = match[1].split('-')[0]; // PAP
        return `${parentPrefix}-${match[2]}`;
      }
      // Otherwise return the regular ID
      return match[3];
    }
    return null;
  }

  static validateFile(content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    try {
      const ticket = this.parseFile(content);
      
      // Validate frontmatter
      const frontmatterErrors = this.validateFrontmatter(ticket.frontmatter);
      errors.push(...frontmatterErrors);
      
      // Validate content exists
      if (!ticket.content || ticket.content.trim().length === 0) {
        errors.push('Content section is empty');
      }
      
      // Validate comments structure if present
      if (ticket.comments) {
        for (let i = 0; i < ticket.comments.length; i++) {
          const comment = ticket.comments[i];
          if (!comment.id) errors.push(`Comment ${i + 1} missing id`);
          if (!comment.author) errors.push(`Comment ${i + 1} missing author`);
          if (!comment.content) errors.push(`Comment ${i + 1} missing content`);
          if (!comment.created_at) errors.push(`Comment ${i + 1} missing created_at`);
        }
      }
      
    } catch (error) {
      errors.push(`Parse error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  private static validateFrontmatter(frontmatter: TicketMetadata): string[] {
    const errors: string[] = [];
    
    if (!frontmatter.linear_id) errors.push('Missing linear_id');
    if (!frontmatter.status) errors.push('Missing status');
    if (!frontmatter.url) errors.push('Missing url');
    if (!frontmatter.created_at) errors.push('Missing created_at');
    if (!frontmatter.updated_at) errors.push('Missing updated_at');
    
    // Validate priority is valid number
    if (frontmatter.priority && ![1, 2, 3, 4].includes(frontmatter.priority)) {
      errors.push('Priority must be 1, 2, 3, or 4');
    }
    
    // Validate labels is array
    if (frontmatter.labels && !Array.isArray(frontmatter.labels)) {
      errors.push('Labels must be an array');
    }
    
    // Validate dates are valid ISO strings
    if (frontmatter.created_at && !this.isValidISODate(frontmatter.created_at)) {
      errors.push('created_at must be valid ISO date string');
    }
    
    if (frontmatter.updated_at && !this.isValidISODate(frontmatter.updated_at)) {
      errors.push('updated_at must be valid ISO date string');
    }
    
    if (frontmatter.due_date && !this.isValidISODate(frontmatter.due_date)) {
      errors.push('due_date must be valid ISO date string');
    }
    
    return errors;
  }

  private static isValidISODate(dateString: string): boolean {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime()) && dateString.includes('T');
  }
}

// Utility functions for timezone conversion
export class TimezoneUtils {
  static utcToSGT(utcDateString: string): string {
    const utcDate = new Date(utcDateString);
    // Convert to SGT (UTC+8)
    const sgtDate = new Date(utcDate.getTime() + (8 * 60 * 60 * 1000));
    return sgtDate.toISOString().replace('Z', '+08:00');
  }

  static sgtToUTC(sgtDateString: string): string {
    // Remove SGT timezone and parse as if it were UTC, then subtract 8 hours
    const cleanDate = sgtDateString.replace('+08:00', 'Z');
    const date = new Date(cleanDate);
    const utcDate = new Date(date.getTime() - (8 * 60 * 60 * 1000));
    return utcDate.toISOString();
  }

  static now(): string {
    return this.utcToSGT(new Date().toISOString());
  }
}