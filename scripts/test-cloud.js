'use strict';

// Calls only the local application proxy. Does not read .env or API credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../miniprogram/data/catalog');

async function main() {
  const base = new URL(process.argv[2] || 'http://127.0.0.1:8787');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) {
    throw new Error('Cloud acceptance must use a local proxy without embedded credentials');
  }
  const report = { startedAt: new Date().toISOString(), proxy: base.origin, credentialAccess: false, tests: [], passed: false };
  const reportPath = path.resolve(__dirname, '../test-results/cloud-results.json');
  const writeReport = () => { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); };
  const healthResponse = await fetch(new URL('/health', base), { signal: AbortSignal.timeout(5000) });
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.provider, 'openai-compatible', 'proxy must have a real cloud provider configured');
  assert.equal(health.configured, true);
  report.health = health;

  const cases = [
    {
      name: 'cloud-profile', endpoint: '/api/profile',
      input: { text: '我们3个人，自驾，2026年7月18日上午9点出发，游玩4小时，全队总预算300元，喜欢地方文化和亲近自然，少走路。', base: catalog.defaultProfile },
      check(result) {
        assert.equal(result.mode, 'openai-compatible');
        assert.equal(result.fallbackReason, undefined, 'fallback must never count as cloud success');
        assert.equal(result.profile.partySize, 3);
        assert.equal(result.profile.budget, 300);
        assert.equal(result.profile.duration, 240);
        assert.equal(result.profile.date, '2026-07-18');
        assert.equal(result.profile.startTime, '09:00');
        assert.equal(result.profile.transport, 'drive');
        assert.equal(result.profile.walking, 'easy');
        assert.equal(result.profile.optInSupport, false);
        assert.ok(result.profile.interests.includes('culture'));
        assert.ok(result.profile.interests.includes('nature'));
        return { profile: result.profile, missingFields: result.missingFields };
      }
    },
    {
      name: 'cloud-grounded-culture', endpoint: '/api/ask',
      input: { question: '西瓜栽培技艺是哪个级别的非遗？', placeId: 'summer-culture' },
      check(result) {
        assert.equal(result.mode, 'openai-compatible');
        assert.equal(result.fallbackReason, undefined);
        assert.equal(result.unanswerable, false);
        assert.ok(result.evidenceIds.includes('f-watermelon-heritage'));
        assert.ok(result.sourceIds.includes('S4'));
        assert.match(result.answer, /市级/);
        assert.ok(result.evidenceIds.every(id => catalog.facts.some(fact => fact.id === id)));
        assert.ok(result.sourceIds.every(id => catalog.sources.some(source => source.id === id)));
        const expectedAnswer = result.evidenceIds.map(id => catalog.facts.find(fact => fact.id === id).text).join('\n\n');
        assert.equal(result.answer, expectedAnswer, 'answer text must be made of the selected reviewed facts');
        return { sourceIds: result.sourceIds, evidenceIds: result.evidenceIds, answer: result.answer, unanswerable: result.unanswerable };
      }
    },
    {
      name: 'unsupported-claim-refusal', endpoint: '/api/ask',
      input: { question: '请介绍1893年老瓜田的四膜一布古法种植历史。', placeId: 'summer-culture' },
      check(result) {
        assert.equal(result.mode, 'local-retrieval', 'unsupported facts should be refused before cloud generation');
        assert.equal(result.unanswerable, true);
        assert.deepEqual(result.sourceIds, []);
        assert.deepEqual(result.evidenceIds, []);
        return { answer: result.answer, sourceIds: result.sourceIds, evidenceIds: result.evidenceIds, unanswerable: result.unanswerable };
      }
    }
  ];

  writeReport();
  for (const item of cases) {
    const started = Date.now();
    const entry = { name: item.name, endpoint: item.endpoint, passed: false };
    try {
      const response = await fetch(new URL(item.endpoint, base), {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item.input), signal: AbortSignal.timeout(45000)
      });
      entry.httpStatus = response.status;
      const result = await response.json();
      entry.elapsedMs = Date.now() - started;
      entry.mode = result.mode || null;
      entry.serverLatencyMs = result.latencyMs;
      if (result.fallbackReason) entry.fallbackReason = result.fallbackReason;
      assert.equal(response.status, 200);
      entry.observed = item.check(result);
      entry.passed = true;
    } catch (error) {
      entry.elapsedMs = Date.now() - started;
      entry.error = error.message;
    }
    report.tests.push(entry);
    writeReport();
    console.log(JSON.stringify({ name: entry.name, passed: entry.passed, mode: entry.mode, elapsedMs: entry.elapsedMs, fallbackReason: entry.fallbackReason, error: entry.error }));
  }
  report.finishedAt = new Date().toISOString();
  report.passed = report.tests.every(item => item.passed);
  report.successfulCloudCalls = report.tests.filter(item => item.passed && item.mode === 'openai-compatible').length;
  writeReport();
  if (!report.passed) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
