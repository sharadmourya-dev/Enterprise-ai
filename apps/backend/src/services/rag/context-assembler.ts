import { IRetrievalCandidate, IEvidenceSource } from '@enterprise-ai/shared-types';

export interface IContextAssemblyOptions {
  maxChunks?: number;
  maxCharacters?: number;
  deduplicateContent?: boolean;
}

export interface IAssembledContext {
  evidenceList: IEvidenceSource[];
  evidenceMap: Map<string, IEvidenceSource>;
  formattedContext: string;
  totalCharacters: number;
  estimatedTokens: number;
}

export class ContextAssembler {
  private static readonly DEFAULT_MAX_CHUNKS = 5;
  private static readonly DEFAULT_MAX_CHARACTERS = 8000;

  /**
   * Assembles validated retrieval candidates into structured, numbered evidence items [S1..Sn]
   * enforcing character ceilings and duplicate chunk suppression.
   */
  public static assemble(
    candidates: IRetrievalCandidate[],
    options?: IContextAssemblyOptions
  ): IAssembledContext {
    const maxChunks = options?.maxChunks ?? this.DEFAULT_MAX_CHUNKS;
    const maxCharacters = options?.maxCharacters ?? this.DEFAULT_MAX_CHARACTERS;
    const deduplicate = options?.deduplicateContent ?? true;

    const evidenceList: IEvidenceSource[] = [];
    const evidenceMap = new Map<string, IEvidenceSource>();
    const seenContentHashes = new Set<string>();

    let currentChars = 0;
    let evidenceIndex = 1;

    for (const candidate of candidates) {
      if (evidenceList.length >= maxChunks) {
        break;
      }

      const normalizedContent = candidate.content.trim();
      if (!normalizedContent) {
        continue;
      }

      // Simple content fingerprint for deduplication
      if (deduplicate) {
        const fingerprint = normalizedContent.toLowerCase().replace(/\s+/g, ' ');
        if (seenContentHashes.has(fingerprint)) {
          continue;
        }
        seenContentHashes.add(fingerprint);
      }

      const evidenceId = `S${evidenceIndex}`;
      const safeTitle = candidate.title || 'Enterprise Document';

      const sourceMeta = [
        `[${evidenceId}] Source: ${safeTitle}`,
        `(Doc ID: ${candidate.documentId}, Rev: ${candidate.revision}${candidate.pageNumber ? `, Page: ${candidate.pageNumber}` : ''}${candidate.sectionHeader ? `, Section: ${candidate.sectionHeader}` : ''})`,
      ].join(' ');

      const formattedBlock = `${sourceMeta}\nContent:\n${normalizedContent}\n`;

      // Check if adding this entire block would exceed character bounds
      if (currentChars + formattedBlock.length > maxCharacters && evidenceList.length > 0) {
        // Stop cleanly rather than truncating mid-passage
        break;
      }

      const evidence: IEvidenceSource = {
        evidenceId,
        documentId: candidate.documentId,
        chunkId: candidate.chunkId,
        revision: candidate.revision,
        title: safeTitle,
        content: normalizedContent,
        pageNumber: candidate.pageNumber,
        sectionHeader: candidate.sectionHeader,
        score: candidate.score,
      };

      evidenceList.push(evidence);
      evidenceMap.set(evidenceId, evidence);
      currentChars += formattedBlock.length;
      evidenceIndex++;
    }

    // Build the final delimited context string
    const formattedContext = evidenceList
      .map((ev) => {
        const pageInfo = ev.pageNumber ? ` (Page ${ev.pageNumber})` : '';
        const sectionInfo = ev.sectionHeader ? ` [Section: ${ev.sectionHeader}]` : '';
        return `<<<EVIDENCE [${ev.evidenceId}] - ${ev.title}${pageInfo}${sectionInfo}>>>\n${ev.content}\n<<<END EVIDENCE [${ev.evidenceId}]>>>`;
      })
      .join('\n\n');

    return {
      evidenceList,
      evidenceMap,
      formattedContext,
      totalCharacters: formattedContext.length,
      estimatedTokens: Math.ceil(formattedContext.length / 4),
    };
  }
}
