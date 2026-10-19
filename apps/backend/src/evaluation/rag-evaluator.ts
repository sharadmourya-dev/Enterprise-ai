import {
  IEvaluationDatasetCase,
  IEvaluationRunSummary,
  Role,
  ClearanceLevel,
  IRetrievalCandidate,
} from '@enterprise-ai/shared-types';
import { ContextAssembler } from '../services/rag/context-assembler.js';
import { CitationValidator } from '../services/rag/citation-validator.js';
import { MockLlmProvider } from '../services/llm/mock.llm.js';
import { PromptBuilder } from '../services/rag/prompt-builder.js';

interface ISyntheticChunk {
  chunkId: string;
  documentId: string;
  title: string;
  source: string;
  content: string;
  allowedRoles: string[];
  allowedDepartments: string[];
  minimumClearance: ClearanceLevel;
  keywords: string[];
}

// Canonical synthetic corpus for offline evaluation
const SYNTHETIC_CORPUS: ISyntheticChunk[] = [
  {
    chunkId: 'chunk_deploy_guide_p1',
    documentId: 'doc_deploy_guide_001',
    title: 'Engineering Deployment Guide',
    source: 'deploy_guide.docx',
    content:
      'Standard engineering deployment freeze occurs on Fridays after 2 PM and on official public holidays.',
    allowedRoles: ['user', 'admin'],
    allowedDepartments: ['Engineering'],
    minimumClearance: ClearanceLevel.INTERNAL,
    keywords: ['engineering', 'deployment', 'freeze', 'hours', 'fridays'],
  },
  {
    chunkId: 'chunk_expense_policy_p2',
    documentId: 'doc_expense_policy_002',
    title: 'Corporate Travel and Expense Policy',
    source: 'expense_policy.pdf',
    content:
      'The daily cap for domestic corporate travel reimbursement is $150 per day for meals and incidentals.',
    allowedRoles: ['user', 'admin'],
    allowedDepartments: [],
    minimumClearance: ClearanceLevel.INTERNAL,
    keywords: ['corporate', 'travel', 'reimbursement', 'daily', 'cap', 'domestic'],
  },
  {
    chunkId: 'chunk_mna_restricted_p1',
    documentId: 'doc_mna_restricted_003',
    title: 'Q3 Confidential M&A Strategy',
    source: 'mna_q3.pdf',
    content:
      'Target confidential acquisitions for Q3 include Project Alpha for $50M and Project Beta for $30M.',
    allowedRoles: ['admin'],
    allowedDepartments: ['Executive', 'Finance'],
    minimumClearance: ClearanceLevel.CONFIDENTIAL,
    keywords: ['confidential', 'merger', 'acquisition', 'targets', 'm&a', 'q3'],
  },
  {
    chunkId: 'chunk_master_keys_p1',
    documentId: 'doc_master_keys_admin_004',
    title: 'Database Encryption Master Key Protocol',
    source: 'db_security.pdf',
    content:
      'Database encryption master keys are located in KMS hardware security module vault 9 under multi-party custody.',
    allowedRoles: ['admin', 'super_admin'],
    allowedDepartments: ['Security'],
    minimumClearance: ClearanceLevel.RESTRICTED,
    keywords: ['root', 'system', 'database', 'encryption', 'master', 'keys'],
  },
  {
    chunkId: 'chunk_compensation_p1',
    documentId: 'doc_executive_compensation_hr_005',
    title: 'Executive Compensation Bands',
    source: 'exec_comp.pdf',
    content:
      'Executive compensation bands for Tier 1 executive leadership range between $350k and $500k base salary.',
    allowedRoles: ['admin'],
    allowedDepartments: ['HR'],
    minimumClearance: ClearanceLevel.CONFIDENTIAL,
    keywords: ['proprietary', 'salary', 'compensation', 'bands', 'executives'],
  },
  {
    chunkId: 'chunk_finances_p1',
    documentId: 'doc_finances_restricted_007',
    title: 'Restricted Financial Projections',
    source: 'financial_projections.pdf',
    content:
      'Confidential financial projections indicate 40% margin expansion and $120M gross revenue in FY27.',
    allowedRoles: ['admin'],
    allowedDepartments: ['Finance'],
    minimumClearance: ClearanceLevel.RESTRICTED,
    keywords: ['confidential', 'financial', 'projections', 'margin', 'revenue'],
  },
];

const CLEARANCE_HIERARCHY: Record<ClearanceLevel, number> = {
  [ClearanceLevel.PUBLIC]: 1,
  [ClearanceLevel.INTERNAL]: 2,
  [ClearanceLevel.CONFIDENTIAL]: 3,
  [ClearanceLevel.RESTRICTED]: 4,
};

export class RagEvaluator {
  private static mockLlm = new MockLlmProvider();

  /**
   * Filters the synthetic corpus using the exact authorization rules applied in production Qdrant
   */
  public static filterAuthorizedChunks(
    corpus: ISyntheticChunk[],
    user: { role: string; department?: string; securityClearance: ClearanceLevel }
  ): ISyntheticChunk[] {
    const userClearanceRank = CLEARANCE_HIERARCHY[user.securityClearance] || 1;

    return corpus.filter((chunk) => {
      // 1. Hierarchical Clearance Check
      const requiredRank = CLEARANCE_HIERARCHY[chunk.minimumClearance] || 1;
      if (userClearanceRank < requiredRank) {
        return false;
      }

      // 2. Role Check
      if (
        chunk.allowedRoles.length > 0 &&
        !chunk.allowedRoles.includes(user.role.toLowerCase())
      ) {
        return false;
      }

      // 3. Department Check
      if (
        chunk.allowedDepartments.length > 0 &&
        (!user.department ||
          !chunk.allowedDepartments
            .map((d) => d.toLowerCase())
            .includes(user.department.toLowerCase()))
      ) {
        return false;
      }

      return true;
    });
  }

  private static readonly STOP_WORDS = new Set([
    'what', 'are', 'the', 'and', 'for', 'is', 'in', 'on', 'to', 'of',
    'how', 'do', 'i', 'a', 'an', 'all', 'can', 'with', 'by', 'at'
  ]);

  /**
   * Simulates retrieval against the authorized corpus
   */
  public static simulateRetrieval(
    query: string,
    authorizedChunks: ISyntheticChunk[],
    topK = 5
  ): IRetrievalCandidate[] {
    const rawTokens = query.toLowerCase().split(/\W+/).filter(Boolean);
    const queryTokens = rawTokens.filter(
      (token) => token.length > 1 && !this.STOP_WORDS.has(token)
    );

    const scored = authorizedChunks.map((chunk) => {
      let score = 0;
      queryTokens.forEach((token) => {
        if (chunk.keywords.includes(token)) score += 0.35;
        else if (chunk.content.toLowerCase().includes(token)) score += 0.15;
      });
      return { chunk, score: Math.min(score, 0.99) };
    });

    const relevant = scored
      .filter((s) => s.score >= 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return relevant.map((r) => ({
      vectorId: `vec_${r.chunk.chunkId}`,
      score: r.score,
      chunkId: r.chunk.chunkId,
      documentId: r.chunk.documentId,
      revision: 1,
      title: r.chunk.title,
      content: r.chunk.content,
      pageNumber: 1,
      minimumClearanceLevel: CLEARANCE_HIERARCHY[r.chunk.minimumClearance] || 1,
      allowedRoles: r.chunk.allowedRoles,
      allowedDepartments: r.chunk.allowedDepartments,
      allowedUserIds: [],
      isActive: true,
    }));
  }

  /**
   * Evaluates a single test case through the RAG pipeline
   */
  public static async evaluateCase(
    testCase: IEvaluationDatasetCase,
    corpus = SYNTHETIC_CORPUS
  ): Promise<{
    id: string;
    passed: boolean;
    expectedBehavior: 'answer' | 'abstain';
    didAbstain: boolean;
    recallAtK: number;
    precisionAtK: number;
    citationValidity: number;
    citationCoverage: number;
    abstainedAsExpected: boolean;
    authorizationViolated: boolean;
    latencyMs: number;
    notes?: string;
  }> {
    const startTime = Date.now();

    const userClearance =
      (testCase.userClearance as ClearanceLevel) || ClearanceLevel.INTERNAL;
    const user = {
      role: testCase.userRole || Role.USER,
      department: testCase.userDepartment || 'Engineering',
      securityClearance: userClearance,
    };

    // 1. Authorized Filtering
    const authorizedChunks = this.filterAuthorizedChunks(corpus, user);

    // 2. Retrieval Simulation
    const candidates = this.simulateRetrieval(testCase.query, authorizedChunks, 5);
    const retrievedChunkIds = candidates.map((c) => c.chunkId.toString());

    // 3. Authorization Violation Check (Verify no candidate belongs to unauthorized corpus)
    const unauthorizedChunks = corpus.filter(
      (c) => !authorizedChunks.some((a) => a.chunkId === c.chunkId)
    );
    const authorizationViolated = candidates.some((cand) =>
      unauthorizedChunks.some((unauth) => unauth.chunkId === cand.chunkId)
    );

    const isAnswerable = testCase.expectedBehavior === 'answer';
    const expectedIds = testCase.expectedRelevantChunkIds || [];

    let recallAtK = 0.0;
    let precisionAtK = 0.0;
    let citationValidity = 0.0;
    let citationCoverage = 0.0;
    let didAbstain = false;
    let abstainedAsExpected = false;
    let passed = false;
    let notes: string | undefined;

    if (authorizationViolated) {
      notes = 'FATAL: Authorization violation detected (evidence leakage)';
      const latencyMs = Date.now() - startTime;
      return {
        id: testCase.id,
        passed: false,
        expectedBehavior: testCase.expectedBehavior,
        didAbstain: false,
        recallAtK: 0.0,
        precisionAtK: 0.0,
        citationValidity: 0.0,
        citationCoverage: 0.0,
        abstainedAsExpected: false,
        authorizationViolated: true,
        latencyMs,
        notes,
      };
    }

    if (isAnswerable) {
      // -------------------------------------------------------------
      // ANSWERABLE TEST CASE: Must retrieve evidence and answer
      // -------------------------------------------------------------
      if (expectedIds.length > 0) {
        const matched = expectedIds.filter((id) => retrievedChunkIds.includes(id));
        recallAtK = matched.length / expectedIds.length;
        precisionAtK =
          retrievedChunkIds.length > 0 ? matched.length / retrievedChunkIds.length : 0.0;
      } else {
        recallAtK = 1.0;
        precisionAtK = retrievedChunkIds.length > 0 ? 1.0 : 0.0;
      }

      if (candidates.length === 0) {
        // Incorrect abstention because no authorized documents were retrieved
        didAbstain = true;
        abstainedAsExpected = false;
        citationValidity = 0.0;
        citationCoverage = 0.0;
        passed = false;
        notes = 'Incorrect abstention: No authorized candidates retrieved for answerable case';
      } else {
        const assembled = ContextAssembler.assemble(candidates);
        const prompt = PromptBuilder.buildUserPrompt(
          testCase.query,
          assembled.formattedContext
        );

        const llmRes = await this.mockLlm.generateText(prompt);
        const generatedText = llmRes.text;

        const isDisclaimer =
          /insufficient information|do not have sufficient|no relevant documents|cannot answer/i.test(
            generatedText
          );

        didAbstain = isDisclaimer;
        abstainedAsExpected = !isDisclaimer;

        if (isDisclaimer) {
          // Model emitted a disclaimer when it was supposed to answer
          citationValidity = 0.0;
          citationCoverage = 0.0;
          passed = false;
          notes = 'Incorrect abstention: Model emitted disclaimer for answerable query';
        } else {
          // Model produced an answer: validate citations and coverage
          const validation = CitationValidator.validate(
            generatedText,
            assembled.evidenceMap
          );
          citationValidity =
            validation.hasValidCitations && validation.invalidCitationIds.length === 0
              ? 1.0
              : 0.0;

          const citedChunkIds = new Set(validation.validatedCitations.map((c) => c.chunkId));
          const citedExpected = expectedIds.filter((id) => citedChunkIds.has(id));
          citationCoverage =
            expectedIds.length > 0 ? citedExpected.length / expectedIds.length : 1.0;

          passed =
            recallAtK >= 0.8 &&
            precisionAtK > 0 &&
            !didAbstain &&
            citationValidity === 1.0 &&
            citationCoverage === 1.0;

          if (!passed) {
            if (recallAtK < 0.8) notes = `Low recall: ${recallAtK.toFixed(2)}`;
            else if (citationValidity < 1.0) notes = 'Invalid or hallucinated citations in answer';
            else if (citationCoverage < 1.0) notes = `Incomplete citation coverage: ${citationCoverage.toFixed(2)}`;
          }
        }
      }
    } else {
      // -------------------------------------------------------------
      // UNANSWERABLE / UNAUTHORIZED TEST CASE: Must abstain cleanly
      // -------------------------------------------------------------
      recallAtK = retrievedChunkIds.length === 0 ? 1.0 : 0.0;
      precisionAtK = retrievedChunkIds.length === 0 ? 1.0 : 0.0;

      if (candidates.length === 0) {
        didAbstain = true;
        abstainedAsExpected = true;
        citationValidity = 1.0;
        citationCoverage = 1.0;
        passed = true;
      } else {
        // Candidates were retrieved (e.g., query matched non-restricted content or leakage)
        const assembled = ContextAssembler.assemble(candidates);
        const prompt = PromptBuilder.buildUserPrompt(
          testCase.query,
          assembled.formattedContext
        );

        const llmRes = await this.mockLlm.generateText(prompt);
        const generatedText = llmRes.text;

        const isDisclaimer =
          /insufficient information|do not have sufficient|no relevant documents|cannot answer/i.test(
            generatedText
          );

        didAbstain = isDisclaimer;
        abstainedAsExpected = isDisclaimer;
        citationValidity = isDisclaimer ? 1.0 : 0.0;
        citationCoverage = isDisclaimer ? 1.0 : 0.0;
        passed = didAbstain;

        if (!passed) {
          notes = 'Failed to abstain on unanswerable/unauthorized query (hallucinated answer or leaked data)';
        }
      }
    }

    const latencyMs = Date.now() - startTime;

    return {
      id: testCase.id,
      passed,
      expectedBehavior: testCase.expectedBehavior,
      didAbstain,
      recallAtK,
      precisionAtK,
      citationValidity,
      citationCoverage,
      abstainedAsExpected,
      authorizationViolated: false,
      latencyMs,
      notes,
    };
  }

  /**
   * Executes the full evaluation suite across all test cases
   */
  public static async runSuite(
    dataset: IEvaluationDatasetCase[],
    corpus = SYNTHETIC_CORPUS
  ): Promise<IEvaluationRunSummary> {
    const runId = `eval_${Date.now()}`;
    const timestamp = new Date().toISOString();

    const caseResults: Array<{
      id: string;
      passed: boolean;
      expectedBehavior: 'answer' | 'abstain';
      didAbstain: boolean;
      recallAtK: number;
      precisionAtK: number;
      citationValidity: number;
      citationCoverage: number;
      abstainedAsExpected: boolean;
      authorizationViolated: boolean;
      latencyMs: number;
      notes?: string;
    }> = [];

    for (const testCase of dataset) {
      const result = await this.evaluateCase(testCase, corpus);
      caseResults.push(result);
    }

    const totalCases = caseResults.length;
    const passedCases = caseResults.filter((c) => c.passed).length;
    const passRatePercentage =
      totalCases > 0 ? Number(((passedCases / totalCases) * 100).toFixed(1)) : 0;

    const answerableCases = caseResults.filter((c) => c.expectedBehavior === 'answer');
    const unanswerableCases = caseResults.filter((c) => c.expectedBehavior === 'abstain');

    // Retrieval metrics evaluated on answerable cases
    const avgRecallAtK =
      answerableCases.length > 0
        ? Number(
            (
              answerableCases.reduce((acc, c) => acc + c.recallAtK, 0) /
              answerableCases.length
            ).toFixed(3)
          )
        : 1.0;

    const avgPrecisionAtK =
      answerableCases.length > 0
        ? Number(
            (
              answerableCases.reduce((acc, c) => acc + c.precisionAtK, 0) /
              answerableCases.length
            ).toFixed(3)
          )
        : 1.0;

    // Citation validity and coverage evaluated on answerable cases
    const citationValidityRate =
      answerableCases.length > 0
        ? Number(
            (
              answerableCases.reduce((acc, c) => acc + c.citationValidity, 0) /
              answerableCases.length
            ).toFixed(3)
          )
        : 1.0;

    const citationCoverageRate =
      answerableCases.length > 0
        ? Number(
            (
              answerableCases.reduce((acc, c) => acc + c.citationCoverage, 0) /
              answerableCases.length
            ).toFixed(3)
          )
        : 1.0;

    // Abstention accuracy evaluated on unanswerable / unauthorized cases
    const abstentionAccuracyRate =
      unanswerableCases.length > 0
        ? Number(
            (
              unanswerableCases.filter((c) => c.didAbstain).length /
              unanswerableCases.length
            ).toFixed(3)
          )
        : 1.0;

    const authorizationViolationCount = caseResults.filter(
      (c) => c.authorizationViolated
    ).length;

    const avgLatencyMs =
      totalCases > 0
        ? Math.round(
            caseResults.reduce((acc, c) => acc + c.latencyMs, 0) / totalCases
          )
        : 0;

    return {
      runId,
      timestamp,
      totalCases,
      passedCases,
      passRatePercentage,
      metrics: {
        avgRecallAtK,
        avgPrecisionAtK,
        citationValidityRate,
        citationCoverageRate,
        abstentionAccuracyRate,
        authorizationViolationCount,
        avgLatencyMs,
      },
      cases: caseResults,
    };
  }
}
