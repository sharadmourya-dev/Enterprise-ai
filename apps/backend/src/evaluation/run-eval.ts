import fs from 'fs';
import path from 'path';
import { RagEvaluator } from './rag-evaluator.js';
import { IEvaluationDatasetCase } from '@enterprise-ai/shared-types';

async function main() {
  let datasetPath = path.resolve(process.cwd(), 'src/evaluation/data/rag-eval-dataset.json');
  if (!fs.existsSync(datasetPath)) {
    datasetPath = path.resolve(process.cwd(), 'apps/backend/src/evaluation/data/rag-eval-dataset.json');
  }

  if (!fs.existsSync(datasetPath)) {
    console.error(`Evaluation dataset not found at: ${datasetPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(datasetPath, 'utf-8');
  const dataset: IEvaluationDatasetCase[] = JSON.parse(raw);

  console.log('='.repeat(86));
  console.log('  ENTERPRISE AI COPILOT — REPRODUCIBLE OFFLINE RAG EVALUATION SUITE');
  console.log('='.repeat(86));
  console.log(`Loaded ${dataset.length} synthetic evaluation test cases from:`);
  console.log(`  ${datasetPath}\n`);

  const summary = await RagEvaluator.runSuite(dataset);

  console.log('-'.repeat(86));
  console.log(`Run ID:             ${summary.runId}`);
  console.log(`Timestamp:          ${summary.timestamp}`);
  console.log(`Total Cases:        ${summary.totalCases}`);
  console.log(`Passed Cases:       ${summary.passedCases}`);
  console.log(`Overall Pass Rate:  ${summary.passRatePercentage}%`);
  console.log('-'.repeat(86));

  console.log('EVALUATION METRICS:');
  console.log(`  • Retrieval Recall@K (answerable):     ${(summary.metrics.avgRecallAtK * 100).toFixed(1)}%`);
  console.log(`  • Retrieval Precision@K (answerable):  ${(summary.metrics.avgPrecisionAtK * 100).toFixed(1)}%`);
  console.log(`  • Citation Validity Rate (answerable): ${(summary.metrics.citationValidityRate * 100).toFixed(1)}%`);
  console.log(`  • Citation Coverage Rate (answerable): ${(summary.metrics.citationCoverageRate * 100).toFixed(1)}%`);
  console.log(`  • Abstention Accuracy (unanswerable):  ${(summary.metrics.abstentionAccuracyRate * 100).toFixed(1)}%`);
  console.log(`  • Authorization Violations:            ${summary.metrics.authorizationViolationCount} (Goal: 0)`);
  console.log(`  • Simulated Pipeline Latency:          ${summary.metrics.avgLatencyMs} ms (offline mock; not live API latency)`);
  console.log('-'.repeat(86));

  console.log('TEST CASE DETAILS:');
  summary.cases.forEach((c) => {
    const status = c.passed ? '✓ PASS' : '✗ FAIL';
    const expectedStr = c.expectedBehavior === 'answer' ? 'Answer  ' : 'Abstain ';
    const outcomeStr = c.didAbstain ? 'Abstained' : 'Answered ';
    const recallStr = c.expectedBehavior === 'answer' ? c.recallAtK.toFixed(2) : 'N/A ';
    const precStr = c.expectedBehavior === 'answer' ? c.precisionAtK.toFixed(2) : 'N/A ';
    const validStr = c.expectedBehavior === 'answer' ? `${(c.citationValidity * 100).toFixed(0)}%` : 'N/A ';
    const covStr = c.expectedBehavior === 'answer' ? `${(c.citationCoverage * 100).toFixed(0)}%` : 'N/A ';
    const violStr = c.authorizationViolated ? 'YES' : '0';

    console.log(
      `  [${c.id}] ${status} | Expected: ${expectedStr}| Outcome: ${outcomeStr} | Recall: ${recallStr} | Prec: ${precStr} | Valid: ${validStr} | Cov: ${covStr} | Violations: ${violStr} (${c.latencyMs}ms)`
    );
    if (c.notes) {
      console.log(`      Note: ${c.notes}`);
    }
  });

  console.log('='.repeat(86));

  if (summary.metrics.authorizationViolationCount > 0 || summary.passedCases < summary.totalCases) {
    console.error(
      `\nEVALUATION FAILED: Quality or security assertions breached (${summary.totalCases - summary.passedCases} failure(s), ${summary.metrics.authorizationViolationCount} violation(s)).`
    );
    process.exit(1);
  }

  console.log('\nEVALUATION PASSED: All security, retrieval, and abstention criteria satisfied.\n');
}

main().catch((err) => {
  console.error('Fatal evaluation runner error:', err);
  process.exit(1);
});
