/**
 * Content processing utilities for markdown ticket files
 */

/**
 * Removes duplicate H1 title from markdown content if it matches the given title
 * 
 * @param content - The markdown content to process
 * @param title - The title to match against (from frontmatter)
 * @returns The processed content with duplicate title removed
 */
export function removeDuplicateTitle(content: string, title?: string): string {
  if (!title || !content) {
    return content;
  }

  // Remove duplicate H1 title if it matches the frontmatter title
  const h1Pattern = new RegExp(`^#\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\n`, 'i');
  return content.replace(h1Pattern, '').trim();
}

/**
 * Removes frontmatter from markdown content and optionally removes duplicate title
 * 
 * @param content - The full markdown content including frontmatter
 * @param title - Optional title to check for duplicates
 * @returns The body content with frontmatter removed and optional duplicate title removal
 */
export function extractBodyContent(content: string, title?: string): string {
  // Remove frontmatter section
  let bodyContent = content.replace(/^---[\s\S]*?---\n/, '').trim();
  
  // Remove duplicate title if provided
  bodyContent = removeDuplicateTitle(bodyContent, title);
  
  return bodyContent || 'No description provided.';
}