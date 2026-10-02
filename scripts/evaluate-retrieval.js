'use strict';
// 检索层评测：2×3 因子设计。
//
//   因子一：排序器 —— 词法（BM25）/ 语义（qwen3-vl-embedding）/ 混合（RRF 融合）
//   因子二：是否使用人工审校标注（subject/intent 闸门）
//
// 为什么这样设计：当前检索层 hit@1 是 0.929，但那是靠人工审校的 subject/intent 映射撑起来的。
// 评审完全可能追问「你们的检索质量有多少来自算法，多少来自人工标注」。
// 这六组就是回答——其中「无标注」三组是纯算法基线。
//
// 默认只跑词法两组，**不需要网络与密钥，可离线复现**。
// 加 --dense 才启用语义层（需要 .env 里的 DASHSCOPE_API_KEY，向量会缓存到 .cache/）。
//
// 用法：
//   node scripts/evaluate-retrieval.js            # 离线：词法 2 组
//   node scripts/evaluate-retrieval.js --dense    # 全部 6 组
//   node scripts/evaluate-retrieval.js --dev      # 换 dev 拆分
const fs = require('node:fs');
const path = require('node:path');
const catalog = require('../miniprogram/data/catalog');
const evidence = require('../miniprogram/lib/evidence');
const dataset = require('../evaluation/culture-seed.json');

const argv = process.argv.slice(2);
const split = argv.includes('--dev') ? 'dev' : 'evaluation';
const useDense = argv.includes('--dense');
const rows = dataset.items.filter(row => row.split === split);

function evaluate(name, retrieve) {
  const detail = rows.map(row => {
    for (const id of row.relevantFactIds) if (!catalog.facts.some(f => f.id === id)) throw Error('Unknown labeled fact: ' + id);
    const ids = retrieve(row), rank = ids.findIndex(id => row.relevantFactIds.includes(id)) + 1;
    return { id: row.id, query: row.query, answerable: row.answerable, relevantFactIds: row.relevantFactIds, retrieved: ids, hitAt1: rank === 1, hitAt3: rank > 0 && rank <= 3, reciprocalRank: rank > 0 ? 1 / rank : 0, refused: !ids.length };
  });
  const answerable = detail.filter(row => row.answerable), unknown = detail.filter(row => !row.answerable);
  const mean = (subset, fn) => subset.length ? Math.round(subset.reduce((sum, row) => sum + Number(fn(row)), 0) / subset.length * 1000) / 1000 : null;
  return { name, answerableCount: answerable.length, unanswerableCount: unknown.length, hitAt1: mean(answerable, r => r.hitAt1), hitAt3: mean(answerable, r => r.hitAt3), mrr: mean(answerable, r => r.reciprocalRank), insufficientEvidenceRecall: mean(unknown, r => r.refused), falseRefusalRate: mean(answerable, r => r.refused), detail };
}

function lexicalTop(question, limit) {
  return evidence.rankFacts(question).filter(item => item.score > 0).slice(0, limit).map(item => item.id);
}
function denseTop(ranking, limit) {
  return (ranking || []).slice(0, limit).map(item => item.id);
}
function hybridTop(question, ranking, limit) {
  return evidence.rrf([lexicalTop(question, 31), denseTop(ranking, 31)]).slice(0, limit).map(item => item.id);
}

async function main() {
  const comparisons = [];
  // 因子二 = 否：纯算法，不用任何人工审校标注。
  comparisons.push(evaluate('纯 BM25 top3（无标注）', row => lexicalTop(row.query, 3)));
  // 因子二 = 是：subject/intent 审校闸门决定「能不能答」，同时约束候选集合。
  comparisons.push(evaluate('BM25 + 审校标注闸门', row => evidence.retrieve(row.query, row.placeId).candidates.map(item => item.id)));

  let denseInfo = null;
  if (useDense) {
    const { createDenseRetriever } = require('../server/dense-retrieval');
    const { loadEnv } = require('../server/env');
    loadEnv(path.resolve(__dirname, '..', '.env'));
    const retriever = createDenseRetriever({ apiKey: process.env.DASHSCOPE_API_KEY, model: 'qwen3-vl-embedding' });
    if (!retriever.ready()) throw Error('未配置 DASHSCOPE_API_KEY，无法运行语义层评测');
    const index = await retriever.index(catalog.facts);
    const rankings = await retriever.rank(index, rows.map(row => row.query));
    const byId = new Map(rows.map((row, position) => [row.id, rankings[position]]));

    comparisons.push(evaluate('纯稠密 top3（无标注）', row => denseTop(byId.get(row.id), 3)));
    comparisons.push(evaluate('BM25+稠密 RRF top3（无标注）', row => hybridTop(row.query, byId.get(row.id), 3)));
    comparisons.push(evaluate('稠密 + 审校标注闸门', row => evidence.retrieve(row.query, row.placeId, null, { ranker: 'dense', denseRanking: byId.get(row.id) }).candidates.map(item => item.id)));
    comparisons.push(evaluate('BM25+稠密 RRF + 审校标注闸门', row => evidence.retrieve(row.query, row.placeId, null, { ranker: 'hybrid', denseRanking: byId.get(row.id) }).candidates.map(item => item.id)));
    denseInfo = { model: retriever.embedder.model, dimension: retriever.embedder.dimension, cachedVectors: retriever.embedder.cached() };
  }

  const report = {
    generatedAt: new Date().toISOString(), datasetVersion: dataset.version, catalogVersion: catalog.dataVersion, split, samples: rows.length,
    caveat: dataset.labelStatus, modelTraining: false,
    externalModelCalls: useDense ? 'qwen3-vl-embedding（仅向量，无生成调用；结果缓存在 .cache/embeddings.json）' : 0,
    dense: denseInfo,
    comparisons
  };
  const output = path.resolve(__dirname, '../test-results/retrieval-' + split + '.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report, comparisons: report.comparisons.map(({ detail, ...metrics }) => metrics) }, null, 2));
}

main().catch(error => { console.error('检索评测失败：' + ((error && error.message) || error)); process.exitCode = 1; });
