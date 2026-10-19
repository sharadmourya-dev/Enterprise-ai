import fs from 'fs';
import path from 'path';
import { RagEvaluator } from '../src/evaluation/rag-evaluator.js';
import { IEvaluationDatasetCase, ClearanceLevel, Role } from '@enterprise-ai/shared-types';

describe('Phase 6 — Workstream C: RAG Evaluation Framework Unit & Regression Tests', () => {
  let dataset: IEvaluationDatasetCase[];

  beforeAll(() => {
    const datasetPath = path.resolve(
      __dirname,
      '../src/evaluation/data/rag-eval-dataset.json'
    );
    const raw = fs.readFileSync(datasetPath, 'utf-8');
    dataset = JSON.parse(raw);
  });

  describe('C1. Suite Execution & Benchmark Metrics Across 7 Cases', () => {
    it('1. Executes full synthetic suite achieving 100% pass rate with zero authorization violations', async () => {
      const summary = await RagEvaluator.runSuite(dataset);

      expect(summary.totalCases).toBe(7);
      expect(summary.passedCases).toBe(7);
      expect(summary.passRatePercentage).toBe(100);

      // Security & authorization guard: strictly zero violations
      expect(summary.metrics.authorizationViolationCount).toBe(0);

      // Retrieval metrics on answerable cases
      expect(summary.metrics.avgRecallAtK).toBe(1.0);
      expect(summary.metrics.avgPrecisionAtK).toBe(1.0);

      // Citation metrics on answerable cases
      expect(summary.metrics.citationValidityRate).toBe(1.0);
      expect(summary.metrics.citationCoverageRate).toBe(1.0);

      // Abstention accuracy on unanswerable/unauthorized cases
      expect(summary.metrics.abstentionAccuracyRate).toBe(1.0);
    });
  });

  describe('C2. Target Case Verifications (EVAL-001 through EVAL-007)', () => {
    it('2. EVAL-001: Grounded QA succeeds without incorrectly abstaining', async () => {
      const case001 = dataset.find((c) => c.id === 'EVAL-001')!;
      expect(case001).toBeDefined();
      expect(case001.expectedBehavior).toBe('answer');

      const result = await RagEvaluator.evaluateCase(case001);
      expect(result.passed).toBe(true);
      expect(result.didAbstain).toBe(false);
      expect(result.abstainedAsExpected).toBe(true);
      expect(result.recallAtK).toBe(1.0);
      expect(result.precisionAtK).toBe(1.0);
      expect(result.citationValidity).toBe(1.0);
      expect(result.citationCoverage).toBe(1.0);
      expect(result.authorizationViolated).toBe(false);
    });

    it('3. EVAL-002: Lower clearance user is prevented from accessing confidential M&A document', async () => {
      const case002 = dataset.find((c) => c.id === 'EVAL-002')!;
      expect(case002).toBeDefined();
      expect(case002.expectedBehavior).toBe('abstain');

      const result = await RagEvaluator.evaluateCase(case002);
      expect(result.passed).toBe(true);
      expect(result.didAbstain).toBe(true);
      expect(result.abstainedAsExpected).toBe(true);
      expect(result.authorizationViolated).toBe(false);
    });

    it('4. EVAL-003: Clearance Authorized persona successfully retrieves confidential M&A document and answers', async () => {
      const case003 = dataset.find((c) => c.id === 'EVAL-003')!;
      expect(case003).toBeDefined();
      expect(case003.expectedBehavior).toBe('answer');

      const result = await RagEvaluator.evaluateCase(case003);
      expect(result.passed).toBe(true);
      expect(result.didAbstain).toBe(false);
      expect(result.abstainedAsExpected).toBe(true);
      expect(result.recallAtK).toBe(1.0);
      expect(result.precisionAtK).toBe(1.0);
      expect(result.citationValidity).toBe(1.0);
      expect(result.citationCoverage).toBe(1.0);
      expect(result.authorizationViolated).toBe(false);
    });

    it('5. EVAL-004: Role Boundary prevents regular user from retrieving admin-only database master keys', async () => {
      const case004 = dataset.find((c) => c.id === 'EVAL-004')!;
      expect(case004).toBeDefined();
      expect(case004.expectedBehavior).toBe('abstain');

      const result = await RagEvaluator.evaluateCase(case004);
      expect(result.passed).toBe(true);
      expect(result.didAbstain).toBe(true);
      expect(result.authorizationViolated).toBe(false);
    });

    it('6. EVAL-005: Department Boundary prevents Engineering user from retrieving HR executive compensation', async () => {
      const case005 = dataset.find((c) => c.id === 'EVAL-005')!;
      expect(case005).toBeDefined();
      expect(case005.expectedBehavior).toBe('abstain');

      const result = await RagEvaluator.evaluateCase(case005);
      expect(result.passed).toBe(true);
      expect(result.didAbstain).toBe(true);
      expect(result.authorizationViolated).toBe(false);
    });

    it('7. EVAL-006: Unanswerable query correctly abstains with canonical disclaimer when no docs exist', async () => {
      const case006 = dataset.find((c) => c.id === 'EVAL-006')!;
      expect(case006).toBeDefined();
      expect(case006.expectedBehavior).toBe('abstain');

      const result = await RagEvaluator.evaluateCase(case006);
      expect(result.passed).toBe(true);
      expect(result.didAbstain).toBe(true);
      expect(result.authorizationViolated).toBe(false);
    });

    it('8. EVAL-007: Prompt injection attempt is thwarted by server-side ACLs and abstains', async () => {
      const case007 = dataset.find((c) => c.id === 'EVAL-007')!;
      expect(case007).toBeDefined();
      expect(case007.expectedBehavior).toBe('abstain');

      const result = await RagEvaluator.evaluateCase(case007);
      expect(result.passed).toBe(true);
      expect(result.didAbstain).toBe(true);
      expect(result.authorizationViolated).toBe(false);
    });
  });

  describe('C3. Failure Injection & Rejection Controls', () => {
    it('9. Fails when an answerable case incorrectly abstains (e.g. no candidates retrieved)', async () => {
      const failingAnswerableCase: IEvaluationDatasetCase = {
        id: 'FAIL-INCORRECT-ABSTAIN',
        query: 'What is the nonexistent policy that cannot be found?',
        category: 'grounded',
        userRole: 'user',
        userDepartment: 'Engineering',
        userClearance: 'internal',
        expectedDocIds: ['doc_deploy_guide_001'],
        expectedRelevantChunkIds: ['chunk_deploy_guide_p1'],
        expectedBehavior: 'answer',
      };

      const result = await RagEvaluator.evaluateCase(failingAnswerableCase);
      expect(result.passed).toBe(false);
      expect(result.didAbstain).toBe(true);
      expect(result.abstainedAsExpected).toBe(false);
      expect(result.notes).toContain('Incorrect abstention');
    });

    it('10. Fails when unauthorized evidence is leaked to a test persona', async () => {
      // Create a test corpus where a confidential chunk is erroneously returned
      const leakedCorpus = [
        {
          chunkId: 'leaked_confidential_chunk',
          documentId: 'doc_confidential_001',
          title: 'Top Secret Plans',
          source: 'plans.pdf',
          content: 'Confidential strategic roadmap for 2027.',
          allowedRoles: ['admin'],
          allowedDepartments: ['Executive'],
          minimumClearance: ClearanceLevel.RESTRICTED,
          keywords: ['strategic', 'roadmap'],
        },
      ];

      // A user with INTERNAL clearance who should NOT see this
      const victimCase: IEvaluationDatasetCase = {
        id: 'FAIL-LEAKAGE',
        query: 'What is the strategic roadmap?',
        category: 'unauthorized_clearance',
        userRole: 'user',
        userDepartment: 'Sales',
        userClearance: 'internal',
        expectedDocIds: ['doc_confidential_001'],
        expectedRelevantChunkIds: [],
        expectedBehavior: 'abstain',
      };

      // Force retrieval simulation to return the chunk despite lack of authorization
      const originalSimulate = RagEvaluator.simulateRetrieval;
      RagEvaluator.simulateRetrieval = () => [
        {
          vectorId: 'vec_leaked',
          score: 0.95,
          chunkId: 'leaked_confidential_chunk',
          documentId: 'doc_confidential_001',
          revision: 1,
          title: 'Top Secret Plans',
          content: 'Confidential strategic roadmap for 2027.',
          pageNumber: 1,
          minimumClearanceLevel: 4,
          allowedRoles: ['admin'],
          allowedDepartments: ['Executive'],
          allowedUserIds: [],
          isActive: true,
        },
      ];

      try {
        const result = await RagEvaluator.evaluateCase(victimCase, leakedCorpus);
        expect(result.passed).toBe(false);
        expect(result.authorizationViolated).toBe(true);
        expect(result.notes).toContain('Authorization violation detected');
      } finally {
        RagEvaluator.simulateRetrieval = originalSimulate;
      }
    });

    it('11. Suite run fails pass rate and exit condition when an assertion fails', async () => {
      const taintedDataset: IEvaluationDatasetCase[] = [
        ...dataset,
        {
          id: 'EVAL-FAILING-CASE',
          query: 'Query expected to answer but has no docs',
          category: 'grounded',
          userRole: 'user',
          userDepartment: 'Engineering',
          userClearance: 'internal',
          expectedRelevantChunkIds: ['nonexistent_chunk_id'],
          expectedBehavior: 'answer',
        },
      ];

      const summary = await RagEvaluator.runSuite(taintedDataset);
      expect(summary.passedCases).toBe(7); // 7 out of 8 passed
      expect(summary.totalCases).toBe(8);
      expect(summary.passRatePercentage).toBeLessThan(100);
      const failingCase = summary.cases.find((c) => c.id === 'EVAL-FAILING-CASE')!;
      expect(failingCase.passed).toBe(false);
    });
  });
});
