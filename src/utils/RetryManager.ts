import { RetryConfig } from '../types';

export class RetryManager {
  private static readonly DEFAULT_CONFIG: RetryConfig = {
    maxAttempts: 3,
    delays: [0, 30000, 120000] // immediate, 30s, 2min
  };

  static async withRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    operationName: string = 'operation'
  ): Promise<T> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    let lastError: Error;

    for (let attempt = 0; attempt < finalConfig.maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          const delay = finalConfig.delays[attempt - 1] || finalConfig.delays[finalConfig.delays.length - 1];
          console.log(`⏱️ Retrying ${operationName} in ${delay}ms (attempt ${attempt + 1}/${finalConfig.maxAttempts})`);
          await this.sleep(delay);
        }

        const result = await operation();
        
        if (attempt > 0) {
          console.log(`✅ ${operationName} succeeded on attempt ${attempt + 1}`);
        }
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if error is retryable
        if (!this.isRetryableError(lastError)) {
          console.log(`❌ ${operationName} failed with non-retryable error: ${lastError.message}`);
          throw lastError;
        }

        console.log(`⚠️ ${operationName} failed (attempt ${attempt + 1}): ${lastError.message}`);
        
        // If this is the last attempt, throw the error
        if (attempt === finalConfig.maxAttempts - 1) {
          console.log(`❌ ${operationName} failed after ${finalConfig.maxAttempts} attempts`);
          throw lastError;
        }
      }
    }

    throw lastError!;
  }

  private static isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    
    // Network errors - retry
    if (message.includes('network') || 
        message.includes('timeout') || 
        message.includes('connection') ||
        message.includes('econnreset') ||
        message.includes('enotfound')) {
      return true;
    }

    // Rate limiting - retry
    if (message.includes('rate limit') || 
        message.includes('too many requests') ||
        message.includes('429')) {
      return true;
    }

    // Server errors (5xx) - retry
    if (message.includes('500') || 
        message.includes('502') || 
        message.includes('503') || 
        message.includes('504') ||
        message.includes('internal server error') ||
        message.includes('bad gateway') ||
        message.includes('service unavailable') ||
        message.includes('gateway timeout')) {
      return true;
    }

    // Authentication/authorization errors - don't retry
    if (message.includes('unauthorized') || 
        message.includes('forbidden') || 
        message.includes('invalid api key') ||
        message.includes('401') || 
        message.includes('403')) {
      return false;
    }

    // Validation errors - don't retry
    if (message.includes('validation') || 
        message.includes('invalid') || 
        message.includes('bad request') ||
        message.includes('400')) {
      return false;
    }

    // File system errors - don't retry (mostly)
    if (message.includes('enoent') || 
        message.includes('permission denied') ||
        message.includes('eacces')) {
      return false;
    }

    // Unknown errors - be conservative and retry
    return true;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}