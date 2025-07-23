import type { FileDiscoverer, FileContent } from '../types';
import { logger } from '../utils/logger.util';

/**
 * Browser-compatible file discoverer that works with pre-loaded file contents
 */
export function createDefaultDiscoverer(): FileDiscoverer {
  return {
    async discover(files: FileContent[]): Promise<FileContent[]> {
      logger.debug(`Discovering files from ${files.length} provided files`);
      
      // In browser environment, we work with the files that are already provided
      // Filter out any files that shouldn't be processed
      const validFiles = files.filter(file => {
        // Basic validation
        if (!file.path || !file.content) {
          logger.warn(`Skipping invalid file: ${file.path}`);
          return false;
        }
        
        // Skip binary files (basic heuristic)
        if (file.content.includes('\0')) {
          logger.debug(`Skipping binary file: ${file.path}`);
          return false;
        }
        
        return true;
      });
      
      logger.info(`Discovered ${validFiles.length} valid files for analysis`);
      return validFiles;
    },
  };
}