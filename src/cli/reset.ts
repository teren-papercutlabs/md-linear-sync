import fs from 'fs';
import path from 'path';

export async function resetCommand(): Promise<void> {
  console.log('🧹 Resetting all imported tickets...\n');

  try {
    const linearDir = path.join(process.cwd(), 'linear-tickets');
    
    if (fs.existsSync(linearDir)) {
      // Count files before deletion
      let totalFiles = 0;
      const statusFolders = fs.readdirSync(linearDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
      
      for (const folder of statusFolders) {
        const folderPath = path.join(linearDir, folder);
        const files = fs.readdirSync(folderPath)
          .filter(file => file.endsWith('.md') && file !== 'README.md');
        totalFiles += files.length;
      }
      
      if (totalFiles === 0) {
        console.log('ℹ️  No imported tickets found to reset');
        return;
      }
      
      // Remove the entire linear directory
      fs.rmSync(linearDir, { recursive: true, force: true });
      console.log(`✅ Removed ${totalFiles} imported tickets`);
      console.log('📁 Deleted linear-tickets/ directory');
    } else {
      console.log('ℹ️  No linear-tickets/ directory found - nothing to reset');
    }
    
    console.log('\n🎉 Reset complete! You can now run import again.');
    
  } catch (error) {
    console.error('\n❌ Reset failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}