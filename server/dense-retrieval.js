'use strict';
// L3 稠密检索：把事实与问题映射到同一向量空间，按余弦相似度排序。
//
// 这一层要回答的不是「再加一层有没有用」，而是一个会被评审追问的问题：
// 当前检索层 hit@1 是 0.929，但那是靠**人工审校过的 subject/intent 标注**撑起来的。
// 去掉人工标注，纯算法能到多少？L3 就是那个「纯算法」对照组。
//
// 因此索引文本**只取资料本身的标题与正文**，绝不掺入 annotations 里的审校关键词——
// 掺进去就等于把人工标注偷偷搬进向量层，对照实验立刻失去意义。
const path = require('node:path');
const { cosine } = require('./embedding');

const CACHE_FILE = path.resolve(__dirname, '../.cache/embeddings.json');

function indexText(fact) {
  return fact.title + '。' + fact.text;
}

async function buildIndex(embedder, facts) {
  const vectors = await embedder.embed(facts.map(indexText));
  return { ids: facts.map(fact => fact.id), vectors };
}

// 一次嵌入全部问题，再在本地算余弦——比逐条调接口省得多（22 条问题 = 1 次调用）。
async function rankQuestions(embedder, index, questions) {
  const queryVectors = await embedder.embed(questions);
  return queryVectors.map(vector => index.ids
    .map((id, position) => ({ id, score: Math.round(cosine(vector, index.vectors[position]) * 1000000) / 1000000 }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)));
}

function createDenseRetriever({ apiKey, model, timeoutMs, cacheFile } = {}) {
  const { createEmbeddingClient } = require('./embedding');
  const embedder = createEmbeddingClient({ apiKey, model, timeoutMs, cacheFile: cacheFile === undefined ? CACHE_FILE : cacheFile });
  return {
    embedder,
    ready: () => Boolean(apiKey),
    index: facts => buildIndex(embedder, facts),
    rank: (index, questions) => rankQuestions(embedder, index, questions)
  };
}

module.exports = { createDenseRetriever, buildIndex, rankQuestions, indexText, CACHE_FILE };
