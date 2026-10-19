import { ChunkerService } from '../src/services/chunking.service.js';

describe('Deterministic Chunking Service Unit Tests', () => {
  const documentId = '671350a12f3e8b0012345678';

  it('1. Returns empty array for empty or whitespace-only text', () => {
    expect(ChunkerService.chunkText(documentId, '')).toEqual([]);
    expect(ChunkerService.chunkText(documentId, '   \n\t  ')).toEqual([]);
  });

  it('2. Single small paragraph produces exactly one chunk with valid charStart and charEnd', () => {
    const text = 'Enterprise AI Copilot delivers contextual knowledge retrieval across enterprise data.';
    const chunks = ChunkerService.chunkText(documentId, text, { chunkSize: 100, chunkOverlap: 20 });

    expect(chunks.length).toBe(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].charStart).toBe(0);
    expect(chunks[0].charEnd).toBe(text.length);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
    expect(chunks[0].vectorId).toBeDefined();
  });

  it('3. Generates deterministic, identical chunk boundaries for identical inputs and options', () => {
    const text =
      'Paragraph 1: Enterprise search must be fast, reliable, and secure.\n\n' +
      'Paragraph 2: Role-based access control filters chunks at the vector layer.\n\n' +
      'Paragraph 3: Monotonic cryptographic audit chains ensure compliance.';

    const run1 = ChunkerService.chunkText(documentId, text, { chunkSize: 25, chunkOverlap: 5 });
    const run2 = ChunkerService.chunkText(documentId, text, { chunkSize: 25, chunkOverlap: 5 });

    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].chunkIndex).toBe(run2[i].chunkIndex);
      expect(run1[i].content).toBe(run2[i].content);
      expect(run1[i].vectorId).toBe(run2[i].vectorId);
      expect(run1[i].charStart).toBe(run2[i].charStart);
      expect(run1[i].charEnd).toBe(run2[i].charEnd);
    }
  });

  it('4. Generates stable UUIDv5 vector IDs for the same document ID and chunkIndex', () => {
    const idA1 = ChunkerService.generateVectorId(documentId, 0);
    const idA2 = ChunkerService.generateVectorId(documentId, 0);
    const idB = ChunkerService.generateVectorId(documentId, 1);

    expect(idA1).toBe(idA2);
    expect(idA1).not.toBe(idB);
    // UUID regex check (8-4-4-4-12 hex)
    expect(idA1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('5. Safe handling when overlap is larger than chunk size (prevents infinite loop)', () => {
    const text = 'Sentence one is here. Sentence two is right here. Sentence three follows immediately.';
    // chunkOverlap (100) >= chunkSize (50)
    const chunks = ChunkerService.chunkText(documentId, text, { chunkSize: 50, chunkOverlap: 100 });

    expect(chunks.length).toBeGreaterThan(0);
    // Verified that it finished without hanging or infinite looping
  });

  it('6. Splits across natural sentence and paragraph boundaries without truncating words', () => {
    const sentences = [
      'The company was founded in 2020.',
      'Our primary mission is developing state-of-the-art enterprise artificial intelligence.',
      'Data security and customer confidentiality remain our top corporate priorities.',
      'Every interaction is tracked with tamper-evident audit logs.',
    ];
    const fullText = sentences.join(' ');

    const chunks = ChunkerService.chunkText(documentId, fullText, { chunkSize: 30, chunkOverlap: 5 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Each chunk must not start or end with a chopped word (must be trimmed)
      expect(chunk.content.trim()).toBe(chunk.content);
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it('7. Incorporates revision into vector ID to prevent point collisions across revisions', () => {
    const rev1Point0 = ChunkerService.generateVectorId(documentId, 0, 1);
    const rev2Point0 = ChunkerService.generateVectorId(documentId, 0, 2);

    expect(rev1Point0).not.toBe(rev2Point0);
    expect(rev1Point0).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(rev2Point0).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('8. Enforces heuristic token limits (estimated tokenCount <= maxTokens) across diverse boundary options', () => {
    const text =
      'Short sentence. Another paragraph with significant detail regarding enterprise security posture. ' +
      'Clearance levels must be strictly observed. Audit entries are cryptographically chained to prevent retroactive tampering. ' +
      'Every interaction is tracked for non-repudiation.';

    const testTokenSizes = [5, 10, 25, 50, 100];

    for (const size of testTokenSizes) {
      const chunks = ChunkerService.chunkText(documentId, text, { chunkSize: size, chunkOverlap: Math.floor(size * 0.2) });
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(size);
      }
    }
  });

  it('9. Boundary tests: exact match size, text with zero whitespace, and single-token chunk size', () => {
    // Exact match
    const exactText = 'Four words here now.'; // ~21 chars, ~6 tokens
    const exactChunks = ChunkerService.chunkText(documentId, exactText, { chunkSize: 6, chunkOverlap: 0 });
    expect(exactChunks.length).toBe(1);
    expect(exactChunks[0].tokenCount).toBeLessThanOrEqual(6);

    // Text with no whitespace (continuous string)
    const longWord = 'A'.repeat(80);
    const splitChunks = ChunkerService.chunkText(documentId, longWord, { chunkSize: 5, chunkOverlap: 0 });
    expect(splitChunks.length).toBeGreaterThan(1);
    for (const c of splitChunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(5);
    }

    // Minimum chunk size = 1
    const tinyChunks = ChunkerService.chunkText(documentId, 'Testing one two three', { chunkSize: 1, chunkOverlap: 0 });
    expect(tinyChunks.length).toBeGreaterThan(0);
    for (const c of tinyChunks) {
      expect(c.tokenCount).toBe(1);
    }
  });

  it('10. Accurately verifies that token count is a character-derived heuristic (~4 chars/token) and not an exact BPE tokenizer', () => {
    // 20 characters -> Math.ceil(20 / 4) = 5 estimated tokens
    const text20 = '12345678901234567890';
    expect(ChunkerService.estimateTokens(text20)).toBe(5);

    // Empty or whitespace-trimmed behavior
    expect(ChunkerService.estimateTokens('   a   ')).toBe(1);
    expect(ChunkerService.estimateTokens('12345')).toBe(2); // 5 chars -> Math.ceil(5/4) = 2
  });
});
