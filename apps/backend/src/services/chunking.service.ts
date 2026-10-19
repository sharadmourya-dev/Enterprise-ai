import crypto from 'crypto';
import { env } from '../config/env.js';

export interface IChunkResult {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  vectorId: string;
  charStart: number;
  charEnd: number;
}

export interface IChunkingOptions {
  chunkSize?: number; // In approximate tokens (default 500)
  chunkOverlap?: number; // In approximate tokens (default 50)
}

// RFC 4122 DNS namespace UUID for deterministic vector ID generation
const VECTOR_ID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function generateRFC4122UuidV5(name: string, namespace = VECTOR_ID_NAMESPACE): string {
  const nsBuffer = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBuffer = Buffer.from(name, 'utf8');

  const hash = crypto.createHash('sha1').update(nsBuffer).update(nameBuffer).digest();

  // Set version to 5 (0101)
  hash[6] = (hash[6] & 0x0f) | 0x50;
  // Set variant to RFC 4122 (10xx)
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString('hex').substring(0, 32);
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

export class ChunkerService {
  /**
   * Approximates token count using the standard ~4 characters per token heuristic.
   *
   * LIMITATION & ARCHITECTURAL SPECIFICATION:
   * This is a heuristic character-based approximation (Math.ceil(chars / 4)), NOT an exact
   * model tokenizer (such as tiktoken, SentencePiece, or Gemini tokenizer). Actual token counts
   * in downstream LLMs may deviate depending on language, whitespace, emojis, or code syntax.
   */
  public static estimateTokens(text: string): number {
    return Math.max(1, Math.ceil(text.trim().length / 4));
  }

  /**
   * Generates a deterministic UUIDv5 for Qdrant vector point ID.
   * Incorporates documentId, chunkIndex, and revision to guarantee distinct vector IDs per revision.
   */
  public static generateVectorId(documentId: string, chunkIndex: number, revision: number = 1): string {
    const seed = revision > 1 ? `${documentId}_r${revision}_chunk_${chunkIndex}` : `${documentId}_chunk_${chunkIndex}`;
    return generateRFC4122UuidV5(seed, VECTOR_ID_NAMESPACE);
  }

  /**
   * Deterministically splits text into chunks adhering to sentence/paragraph boundaries
   * using character windows derived from heuristic token limits (maxChars = maxTokens * 4).
   * Note: Character-derived chunk boundaries bound the heuristic token estimate (estimateTokens <= maxTokens),
   * but do not guarantee strict model-specific BPE token ceilings.
   */
  public static chunkText(
    documentId: string,
    text: string,
    options?: IChunkingOptions,
    revision: number = 1
  ): IChunkResult[] {
    const cleanText = text.trim();
    if (!cleanText) {
      return [];
    }

    const maxTokens = Math.max(1, options?.chunkSize ?? env.CHUNK_SIZE);
    let overlapTokens = Math.max(0, options?.chunkOverlap ?? env.CHUNK_OVERLAP);

    // Safety guard: overlap must be strictly less than chunk size to prevent infinite loops
    if (overlapTokens >= maxTokens) {
      overlapTokens = Math.max(0, Math.floor(maxTokens * 0.2)); // 20% fallback
    }

    // Convert token limits to approximate character limits (~4 chars / token)
    const maxChars = maxTokens * 4;
    const overlapChars = overlapTokens * 4;

    const chunks: IChunkResult[] = [];
    let currentStartIndex = 0;
    let chunkIndex = 0;

    while (currentStartIndex < cleanText.length) {
      let targetEndIndex = currentStartIndex + maxChars;

      if (targetEndIndex >= cleanText.length) {
        // Last chunk reaches the end
        let chunkContent = cleanText.substring(currentStartIndex).trim();
        if (chunkContent.length > maxChars) {
          chunkContent = chunkContent.substring(0, maxChars).trim();
        }
        if (chunkContent.length > 0) {
          chunks.push({
            chunkIndex,
            content: chunkContent,
            tokenCount: this.estimateTokens(chunkContent),
            vectorId: this.generateVectorId(documentId, chunkIndex, revision),
            charStart: currentStartIndex,
            charEnd: cleanText.length,
          });
        }
        break;
      }

      // Find natural boundary before targetEndIndex (paragraph break -> sentence break -> space)
      let splitIndex = -1;

      // 1. Check for paragraph boundary (\n\n) within lookback window
      const searchWindowStart = Math.max(currentStartIndex + overlapChars, targetEndIndex - Math.floor(maxChars * 0.3));
      const lookbackSubstr = cleanText.substring(searchWindowStart, targetEndIndex);

      const paragraphBreak = lookbackSubstr.lastIndexOf('\n\n');
      if (paragraphBreak !== -1) {
        splitIndex = searchWindowStart + paragraphBreak + 2;
      } else {
        // 2. Check for sentence boundary (period, question mark, exclamation mark followed by space or newline)
        const sentenceMatch = /[.?!]\s+/g;
        let match: RegExpExecArray | null;
        let lastSentenceEnd = -1;

        while ((match = sentenceMatch.exec(lookbackSubstr)) !== null) {
          lastSentenceEnd = match.index + match[0].length;
        }

        if (lastSentenceEnd !== -1) {
          splitIndex = searchWindowStart + lastSentenceEnd;
        } else {
          // 3. Fallback: check for word boundary (space)
          const spaceIndex = lookbackSubstr.lastIndexOf(' ');
          if (spaceIndex !== -1) {
            splitIndex = searchWindowStart + spaceIndex + 1;
          } else {
            // 4. Hard boundary if no spaces exist in lookback window
            splitIndex = targetEndIndex;
          }
        }
      }

      let chunkContent = cleanText.substring(currentStartIndex, splitIndex).trim();
      if (chunkContent.length > maxChars) {
        chunkContent = chunkContent.substring(0, maxChars).trim();
      }

      if (chunkContent.length > 0) {
        chunks.push({
          chunkIndex,
          content: chunkContent,
          tokenCount: this.estimateTokens(chunkContent),
          vectorId: this.generateVectorId(documentId, chunkIndex, revision),
          charStart: currentStartIndex,
          charEnd: splitIndex,
        });
        chunkIndex++;
      }

      // Calculate next start index with overlap
      const nextStart = Math.max(currentStartIndex + 1, splitIndex - overlapChars);
      if (nextStart <= currentStartIndex) {
        // Prevent zero-step loop
        currentStartIndex = splitIndex;
      } else {
        currentStartIndex = nextStart;
      }
    }

    return chunks;
  }
}
