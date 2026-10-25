import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REQUIRED_JOB_IDS, CONDITIONAL_JOBS } from './ci-impact-registry.mjs';
import { validatePlan } from './ci-impact.mjs';

export function validateResults(plan, needs, expectedSha) {
  if (!needs || needs.impact?.result !== 'success')
    throw new Error('Impact selection did not succeed.');
  validatePlan(plan);
  if (plan.provenance.testSha !== expectedSha)
    throw new Error('Impact plan belongs to another workflow commit.');
  if (
    JSON.stringify(Object.keys(needs).sort()) !==
    JSON.stringify([...REQUIRED_JOB_IDS].sort())
  )
    throw new Error('Required job inventory is incomplete or unexpected.');
  const errors = [];
  for (const job of REQUIRED_JOB_IDS) {
    const selected = !CONDITIONAL_JOBS.includes(job) || plan.jobs[job];
    const expected = selected ? 'success' : 'skipped';
    if (needs[job]?.result !== expected)
      errors.push(
        `${job}: expected ${expected}, received ${needs[job]?.result || 'missing'}`,
      );
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return 'Every required job succeeded; every skip is explicitly justified by the verified impact plan.';
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const message = validateResults(
    JSON.parse(process.env.CI_IMPACT_PLAN || 'null'),
    JSON.parse(process.env.CI_NEEDS || 'null'),
    process.env.GITHUB_SHA,
  );
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Required CI result\n\n${message}\n`,
    );
}
