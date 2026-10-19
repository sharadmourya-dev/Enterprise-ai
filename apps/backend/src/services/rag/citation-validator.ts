import { ICitation, IEvidenceSource } from '@enterprise-ai/shared-types';

export interface ICitationValidationResult {
  validatedCitations: ICitation[];
  invalidCitationIds: string[];
  sanitizedAnswer: string;
  hasValidCitations: boolean;
}

export class CitationValidator {
  private static readonly CITATION_REGEX = /\[(S\d+)\]/g;

  /**
   * Validates citations in generated answer text against the supplied evidence context.
   * Resolves valid evidence IDs to rich source metadata, strips unknown/hallucinated citation tags,
   * and preserves source document traceability.
   *
   * IMPORTANT ARCHITECTURAL & SECURITY NOTE:
   * Deterministic citation validation verifies that a cited identifier (e.g. [S1]) strictly matches
   * an authorized evidence chunk supplied to the model in the current query's context.
   * However, syntactic citation validity does NOT by itself prove semantic entailment (i.e. that
   * the text passage logically entails the claimed statement). Full natural-language inference (NLI)
   * or automated claim verification requires a dedicated semantic entailment verification model.
   * A syntactically valid citation guarantees traceability to retrieved context, but not factual infallibility.
   */
  public static validate(
    answerText: string,
    evidenceMap: Map<string, IEvidenceSource>
  ): ICitationValidationResult {
    if (!answerText || typeof answerText !== 'string') {
      return {
        validatedCitations: [],
        invalidCitationIds: [],
        sanitizedAnswer: '',
        hasValidCitations: false,
      };
    }

    const foundMatches = Array.from(answerText.matchAll(this.CITATION_REGEX));
    const uniqueCitedIds = Array.from(new Set(foundMatches.map((m) => m[1])));

    const validatedCitations: ICitation[] = [];
    const invalidCitationIds: string[] = [];
    const seenEvidenceIds = new Set<string>();

    for (const citedId of uniqueCitedIds) {
      const sourceEvidence = evidenceMap.get(citedId);
      if (sourceEvidence) {
        if (!seenEvidenceIds.has(citedId)) {
          seenEvidenceIds.add(citedId);
          validatedCitations.push({
            evidenceId: citedId,
            documentId: sourceEvidence.documentId,
            source: sourceEvidence.title,
            chunkId: sourceEvidence.chunkId,
            revision: sourceEvidence.revision,
            page: sourceEvidence.pageNumber,
            section: sourceEvidence.sectionHeader,
          });
        }
      } else {
        invalidCitationIds.push(citedId);
      }
    }

    // Strip hallucinated / unknown citation tags from answer text
    let sanitizedAnswer = answerText;
    for (const invalidId of invalidCitationIds) {
      const tagPattern = new RegExp(`\\[${invalidId}\\]`, 'g');
      sanitizedAnswer = sanitizedAnswer.replace(tagPattern, '');
    }
    // Clean up any double spaces and orphaned spaces before punctuation
    sanitizedAnswer = sanitizedAnswer
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();

    return {
      validatedCitations,
      invalidCitationIds,
      sanitizedAnswer,
      hasValidCitations: validatedCitations.length > 0,
    };
  }
}
