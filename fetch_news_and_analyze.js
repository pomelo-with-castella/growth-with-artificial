// Node 脚本：每天抓取 36kr + TechCrunch，调用大模型生成分析，输出 JSON
// 运行方式：双击 run_daily_update.bat 或由任务计划程序每天早上 8 点执行

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');

// === 配置区域 ===
const TECHCRUNCH_RSS = 'https://techcrunch.com/feed/';
const KR36_RSS = 'https://www.36kr.com/feed';
const VENTUREBEAT_AI_RSS = 'https://venturebeat.com/category/ai/feed/';
const ZDNET_AI_RSS = 'https://www.zdnet.com/topic/artificial-intelligence/rss.xml';
const INFOQ_CN_RSS = 'https://www.infoq.cn/feed';
const LEIPHONE_RSS = 'https://www.leiphone.com/feed';

// 使用 DeepSeek Chat 接口（兼容 OpenAI 风格）
// 优先读取 D E E P S E E K_API_KEY，没有则回退到 OPENAI_API_KEY（方便沿用原有变量）
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const HISTORY_FILE = path.join(__dirname, 'news_history.json');
const HISTORY_KEEP_DAYS = 30;
const CORE_TECH_TERMS = [
  '大语言模型',
  '多模态',
  '智能体',
  '检索增强生成(RAG)',
  '计算机视觉',
  '语音与音频',
  '推荐系统',
  'AI基础设施',
  'AI安全与对齐',
  '具身智能/机器人',
  'AIGC应用'
];

// === 工具函数 ===

async function fetchRss(url) {
  const res = await fetch(url, { timeout: 20000 });
  if (!res.ok) {
    throw new Error(`Fetch RSS failed: ${url} status=${res.status}`);
  }
  return res.text();
}

function getFirstText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (Array.isArray(value)) {
    if (value.length === 0) return fallback;
    return getFirstText(value[0], fallback);
  }
  if (typeof value === 'object') {
    if (typeof value._ === 'string') return value._;
    return fallback;
  }
  return String(value);
}

function isAiRelated(title = '', description = '') {
  const aiKeywords = [
    'AI',
    '人工智能',
    'machine learning',
    'deep learning',
    'neural network',
    '大模型',
    'Agent',
    '智能体',
    '生成式AI',
    'AIGC',
    'LLM',
    'GPT',
    '机器学习',
    'DeepSeek',
    '文心',
    '通义',
    'Claude'
  ];
  const t = String(title).toLowerCase();
  const d = String(description).toLowerCase();
  return aiKeywords.some((k) => t.includes(k.toLowerCase()) || d.includes(k.toLowerCase()));
}

function cleanHtmlSummary(html = '') {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().substring(0, 260) + '...';
}

function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}

function normalizeLink(link = '') {
  return String(link || '').trim().replace(/\/+$/, '');
}

function toSafeDate(rawDate) {
  const d = new Date(rawDate);
  if (isNaN(d.getTime())) return null;
  return d;
}

function getNewsKey(news) {
  const source = news && news.source ? String(news.source).trim() : 'unknown';
  const link = normalizeLink(news && news.link ? news.link : '');
  if (link) return `${source}|${link}`;
  const title = news && news.title ? String(news.title).trim() : '';
  const rawDate = news && (news.rawDate || news.date) ? String(news.rawDate || news.date).trim() : '';
  return `${source}|${title}|${rawDate}`;
}

function hashStringToInt(input = '') {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function isWithinLastDays(news, days) {
  const now = new Date();
  const d = toSafeDate(news.rawDate || news.date);
  if (!d) return false;
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= days;
}

function loadNewsHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    const text = fs.readFileSync(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    return [];
  } catch (e) {
    console.warn('[AI Dashboard] 读取 news_history.json 失败，将忽略历史文件：', e.message);
    return [];
  }
}

function sortByDateDesc(items) {
  return [...items].sort((a, b) => {
    const da = toSafeDate(a.rawDate || a.date);
    const db = toSafeDate(b.rawDate || b.date);
    const ta = da ? da.getTime() : 0;
    const tb = db ? db.getTime() : 0;
    return tb - ta;
  });
}

function mergeNewsPool(historyItems, latestItems) {
  const pool = new Map();
  for (const item of historyItems) {
    if (!item) continue;
    pool.set(getNewsKey(item), item);
  }
  for (const item of latestItems) {
    if (!item) continue;
    const key = getNewsKey(item);
    const old = pool.get(key);
    if (!old) {
      pool.set(key, item);
      continue;
    }
    // 同一条新闻优先保留新抓取字段（摘要/洞察可能更完整）
    pool.set(key, { ...old, ...item });
  }
  const merged = Array.from(pool.values()).filter((n) => isWithinLastDays(n, HISTORY_KEEP_DAYS));
  return sortByDateDesc(merged);
}

function saveNewsHistory(items) {
  const payload = {
    updatedAt: new Date().toISOString(),
    keepDays: HISTORY_KEEP_DAYS,
    count: items.length,
    items
  };
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

async function parseRss(xmlText, region, sourceName, idStart) {
  const xml = await parseStringPromise(xmlText);
  const items = xml.rss && xml.rss.channel && xml.rss.channel[0].item ? xml.rss.channel[0].item : [];

  const newsItems = [];
  let idCounter = idStart;

  for (const item of items) {
    const title = getFirstText(item.title, '');
    const link = getFirstText(item.link, '#');
    const pubDate = getFirstText(item.pubDate, new Date().toISOString());
    const description = getFirstText(item.description, '');

    if (!isAiRelated(title, description)) continue;

    const summary = cleanHtmlSummary(description);

    const tags = {
      domain: getDomainTags(title, description),
      region: [region],
      type: getTypeTags(title),
      importance: '中'
    };

    const stableId = hashStringToInt(`${sourceName}|${normalizeLink(link)}`) || idCounter++;
    newsItems.push({
      id: stableId,
      title,
      summary,
      insight: '',
      insightStatus: 'pending',
      insightError: null,
      link,
      date: formatDate(pubDate),
      rawDate: pubDate,
      source: sourceName,
      tags,
      businessScore: 0,
      deepAnalysis: '',
      funding: null,
      coreTech: extractCoreTech(description)
    });
  }

  // 为了覆盖最近一个月的更多动态，这里适当放宽单源上限
  // 例如：最多保留 120 条 AI 相关新闻，后续再由时间分桶和摘要逻辑过滤
  return newsItems.slice(0, 120);
}

function getDomainTags(title, description) {
  const domains = [];
  if (title.includes('大模型') || description.includes('大模型')) domains.push('大模型');
  if (title.includes('Agent') || description.includes('Agent') || title.includes('智能体')) domains.push('Agent');
  if (title.includes('多模态') || description.includes('多模态')) domains.push('多模态');
  if (title.includes('企业服务') || description.includes('企业服务') || title.includes('enterprise')) domains.push('企业服务');
  if (title.includes('安全') || description.includes('安全') || title.includes('safety')) domains.push('AI安全');
  if (title.includes('开发工具') || description.includes('开发工具') || title.includes('development tool')) domains.push('开发工具');
  if (domains.length === 0) domains.push('其他');
  return domains;
}

function getTypeTags(title) {
  const types = [];
  if (title.includes('融资') || title.toLowerCase().includes('funding') || title.toLowerCase().includes('raise')) types.push('融资');
  if (title.includes('发布') || title.toLowerCase().includes('launch') || title.toLowerCase().includes('release')) types.push('产品发布');
  if (title.includes('研究') || title.toLowerCase().includes('research')) types.push('研究突破');
  if (title.includes('政策') || title.toLowerCase().includes('policy') || title.toLowerCase().includes('regulation')) types.push('政策');
  if (types.length === 0) types.push('新闻');
  return types;
}

function generateInsight(title, region) {
  const base = title.substring(0, 40);
  const candidates = [
    `💡 AI Insight: ${region === '国内' ? '国内AI市场' : '全球AI生态'}正在加速演进，${base}...`,
    `🤖 TL;DR: ${base}... 反映了AI产业的技术迭代与商业重心变化。`,
    `💡 AI商业洞察: 从${title.substring(0, 20)}...看${region === '国内' ? '中国AI' : '全球AI'}发展趋势。`
  ];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function scoreToImportance(score) {
  if (score >= 85) return '高';
  if (score >= 78) return '中';
  return '低';
}

function normalizeScore(score) {
  if (!Number.isFinite(score)) return 0;
  const rounded = Math.round(score);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

function normalizeNewsScoreAndImportance(newsList) {
  for (const news of newsList) {
    const normalizedScore = normalizeScore(Number(news.businessScore));
    news.businessScore = normalizedScore;
    if (!news.tags || typeof news.tags !== 'object') news.tags = {};
    news.tags.importance = scoreToImportance(normalizedScore);
    if (typeof news.deepAnalysis !== 'string') news.deepAnalysis = '';
  }
}

function classifyPipelineError(message = '') {
  const msg = String(message || '').toLowerCase();
  if (msg.includes('未配置 deepseek_api_key')) return 'NO_API_KEY';
  if (msg.includes('401') || msg.includes('403') || msg.includes('auth') || msg.includes('api key')) return 'API_AUTH';
  if (msg.includes('429')) return 'API_RATE_LIMIT';
  if (/5\d\d/.test(msg)) return 'API_SERVER';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return 'NETWORK_TIMEOUT';
  if (msg.includes('enotfound') || msg.includes('eai_again') || msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('network')) return 'NETWORK_ERROR';
  if (msg.includes('解析') || msg.includes('json') || msg.includes('字段缺失') || msg.includes('coretech') || msg.includes('score') || msg.includes('格式')) return 'PARSE_ERROR';
  if (msg.includes('rss')) return 'RSS_FETCH_ERROR';
  return 'UNKNOWN';
}

function addErrorCount(counter, code) {
  counter[code] = (counter[code] || 0) + 1;
}

async function callDeepSeek(messages, temperature = 0.4) {
  if (!DEEPSEEK_API_KEY) {
    return { ok: false, error: '未配置 DEEPSEEK_API_KEY' };
  }

  const body = {
    model: DEEPSEEK_MODEL,
    messages,
    temperature
  };

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      return { ok: false, error: `DeepSeek HTTP ${res.status}` };
    }

    const data = await res.json();
    const content =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (!content) return { ok: false, error: 'DeepSeek 返回空内容' };
    return { ok: true, content: content.trim() };
  } catch (e) {
    return { ok: false, error: e.message || '调用异常' };
  }
}

async function generateInsightWithLlm(news) {
  const rolePrefix = news.tags && news.tags.region && news.tags.region.includes('国内')
    ? '你是一个深耕中国AI产业十几年的商业分析顾问团队，'
    : 'You are a senior AI industry strategy consultant team, ';
  const prompt = `
${rolePrefix}长期为大型科技公司和投资机构提供决策支持。

请阅读下面这条新闻的「标题 + 概要」，输出两句中文商业洞察：
1) 第一句：核心事件/变化（发生了什么）。
2) 第二句：该事件对产业链关键角色的商业价值或风险（对谁 + 有何影响）。

要求：
- 总字数 40~80 字；
- 只输出两句话正文，不要标签、序号、解释。

【新闻标题】
${news.title}

【新闻概要】
${news.summary}
`;
  const result = await callDeepSeek(
    [
      { role: 'system', content: '你是一支具有十多年咨询经验、专注AI与科技行业的商业分析团队。' },
      { role: 'user', content: prompt }
    ],
    0.5
  );
  if (!result.ok) return result;
  if (!result.content) return { ok: false, error: '洞察返回为空' };
  return { ok: true, content: result.content };
}

async function generateScoreWithLlm(news) {
  const termText = CORE_TECH_TERMS.map((t) => `- ${t}`).join('\n');
  const prompt = `
请基于这条 AI 新闻输出两个字段：
1) 商业潜力评分 score（1~100整数）
2) 核心技术 coreTech（必须从词条中选一个）

评分规则：
- 1 到 100 的整数；
- 85-100 为高，78-84 为中，0-77 为低。

可选核心技术词条（只能选其一）：
${termText}

请严格按以下 JSON 返回，不要任何其他文字：
{"score":85,"coreTech":"多模态"}

【新闻标题】
${news.title}

【新闻概要】
${news.summary}
`;
  const result = await callDeepSeek(
    [
      { role: 'system', content: '你是资深AI行业商业分析师。' },
      { role: 'user', content: prompt }
    ],
    0.2
  );
  if (!result.ok) return result;
  let parsed;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return { ok: false, error: `评分/核心技术解析失败: ${result.content.slice(0, 80)}` };
  }
  if (typeof parsed.score !== 'number' || typeof parsed.coreTech !== 'string') {
    return { ok: false, error: '评分/核心技术字段缺失' };
  }
  const score = normalizeScore(parsed.score);
  const coreTech = parsed.coreTech.trim();
  if (!CORE_TECH_TERMS.includes(coreTech)) {
    return { ok: false, error: `核心技术不在词条中: ${coreTech}` };
  }
  return { ok: true, score, coreTech };
}

async function generateDeepAnalysisWithLlm(news, score) {
  const prompt = `
请基于这条 AI 新闻和评分结果，输出 2-3 句中文“深入分析”。

要求：
- 站在顶尖咨询师视角；
- 结合评分 ${score} 解释其行业含义；
- 给出趋势/竞争格局/投资或战略启示；
- 只输出正文，不要标题和前缀标签。

【新闻标题】
${news.title}

【新闻概要】
${news.summary}
`;
  const result = await callDeepSeek(
    [
      { role: 'system', content: '你是顶尖咨询公司的AI行业合伙人。' },
      { role: 'user', content: prompt }
    ],
    0.45
  );
  if (!result.ok) return result;
  if (!result.content) return { ok: false, error: '深入分析返回为空' };
  return { ok: true, content: result.content };
}

function extractCoreTech(description) {
  const desc = description.toLowerCase();
  if (desc.includes('agent') || desc.includes('智能体')) return '智能体';
  if (desc.includes('rag') || desc.includes('检索增强')) return '检索增强生成(RAG)';
  if (desc.includes('多模态')) return '多模态';
  if (desc.includes('视觉') || desc.includes('cv')) return '计算机视觉';
  if (desc.includes('语音') || desc.includes('音频')) return '语音与音频';
  if (desc.includes('机器人') || desc.includes('具身')) return '具身智能/机器人';
  if (desc.includes('安全') || desc.includes('对齐')) return 'AI安全与对齐';
  if (desc.includes('infra') || desc.includes('算力') || desc.includes('芯片')) return 'AI基础设施';
  if (desc.includes('推荐')) return '推荐系统';
  if (desc.includes('大模型') || desc.includes('llm') || desc.includes('gpt')) return '大语言模型';
  return 'AIGC应用';
}

function bucketByTime(allNews) {
  const now = new Date();
  const today = [];
  const yesterday = [];
  const week = [];
  const month = [];

  for (const item of allNews) {
    const raw = new Date(item.rawDate || item.date);
    if (isNaN(raw.getTime())) continue;
    const diffDays = Math.floor((now - raw) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) {
      today.push(item);
    } else if (diffDays === 1) {
      yesterday.push(item);
    } else if (diffDays < 7) {
      week.push(item);
    } else if (diffDays < 30) {
      month.push(item);
    }
  }

  return { today, yesterday, week, month };
}

function dedupeById(newsList) {
  const seen = new Set();
  const result = [];
  for (const n of newsList) {
    if (!n) continue;
    const key = getNewsKey(n);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(n);
  }
  return result;
}

// 全量为“计划上网页”的新闻生成提炼；单条失败不拖垮全局
async function enrichInsightsWithLlm(allNews) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('未配置 DEEPSEEK_API_KEY');
  }

  const failed = [];
  const errorByType = {};
  const successNews = [];
  for (const news of allNews) {
    const insightResult = await generateInsightWithLlm(news);
    const scoreResult = insightResult.ok ? await generateScoreWithLlm(news) : { ok: false, error: '洞察失败，评分/核心技术未执行' };
    const deepResult = scoreResult.ok ? await generateDeepAnalysisWithLlm(news, scoreResult.score) : { ok: false, error: '评分失败，深度分析未执行' };

    if (insightResult.ok && scoreResult.ok && deepResult.ok) {
      news.insight = insightResult.content;
      news.businessScore = scoreResult.score;
      news.coreTech = scoreResult.coreTech;
      news.deepAnalysis = deepResult.content;
      news.tags.importance = scoreToImportance(scoreResult.score);
      news.insightStatus = 'ok';
      news.insightError = null;
      console.log(`[AI Dashboard][LLM OK] ${news.source} | ${news.title.slice(0, 36)} | score=${news.businessScore} | importance=${news.tags.importance} | coreTech=${news.coreTech}`);
      successNews.push(news);
    } else {
      news.insight = '未调用成功';
      news.insightStatus = 'failed';
      news.deepAnalysis = '';
      news.businessScore = 0;
      news.tags.importance = '低';
      const stageError = [
        !insightResult.ok ? `洞察失败: ${insightResult.error}` : null,
        !scoreResult.ok ? `评分/核心技术失败: ${scoreResult.error}` : null,
        !deepResult.ok ? `深度分析失败: ${deepResult.error}` : null
      ].filter(Boolean).join(' | ');
      news.insightError = stageError || '调用失败';
      const errorType = classifyPipelineError(news.insightError);
      addErrorCount(errorByType, errorType);
      failed.push({
        source: news.source,
        title: news.title.slice(0, 80),
        errorType,
        errorDetail: news.insightError
      });
    }
  }

  if (successNews.length === 0) {
    throw new Error(`全部新闻调用失败 ${failed.length}/${allNews.length}`);
  }
  return {
    successNews,
    failedNews: failed,
    failedCount: failed.length,
    successCount: successNews.length,
    totalCount: allNews.length,
    errorByType
  };
}

async function callLlmForAnalysis(allNews, buckets) {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('未配置 DEEPSEEK_API_KEY');
  }

  const total = allNews.length;
  const domestic = allNews.filter((n) => n.tags.region.includes('国内')).length;
  const overseas = allNews.filter((n) => n.tags.region.includes('海外')).length;

  const sampleNews = allNews
    .map((n) => `- [${n.tags.region.join('/')}] ${n.date} | ${n.title} (${n.source}) | 链接: ${n.link} | 摘要: ${(n.summary || '').slice(0, 140)}`)
    .join('\n');

  const prompt = `
你是一名偏商业和产品视角的AI行业分析师。
我会给你最近一个月国内外与AI相关的新闻样本，以及一些统计信息。

请你输出一段**结构清晰、重点突出的分析文案**，分为四个小节，对应：
1）产品形态演变（从通用模型 → 垂直场景 / Agent 等）
2）商业重心 / 侧重点（ToB / ToC、降本增效、行业优先级）
3）能力迭代主线（模型、多模态、安全、算力等技术方向）
4）综合判断（未来 1-3 个月的趋势、机会与风险）

严格排版要求（非常重要）：
1. 每个小节使用如下 HTML 结构：
   <div class="analysis-section">
     <h3>小节标题（简短有力）</h3>
     <div class="analysis-item">
       <ul>
         <li><strong>一句话核心结论：</strong>最多 30 个字，先给结论。</li>
         <li>1 个关键现象或代表性案例。</li>
         <li>1 个具体的商业含义（对谁 + 有什么影响）。</li>
       </ul>
     </div>
   </div>
2. 每个 <ul> 内最多 3 条 <li>，不要再嵌套子列表。
3. 尽量用短句和要点式表达，避免长段落堆砌叙述。
4. 语言风格接近咨询报告摘要，偏中文读者，可以夹少量英文名词。
5. 只输出完整的 HTML 片段，不要多余说明文字，不要包含 <html>/<body> 标签。

【数据摘要】
- 统计周期：最近 30 天
- 新闻总数：${total}
- 国内新闻条数：${domestic}
- 海外新闻条数：${overseas}

【计划上网页的全部新闻样本 + 链接】（请完整阅读后再判断趋势）：
${sampleNews}
`;

  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: 'You are an expert AI industry analyst and product strategist.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.4
  };

  const res = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`DeepSeek API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return content || null;
}

async function main() {
  console.log('[AI Dashboard] 开始抓取 RSS 源（36kr / InfoQ CN / 雷峰网 / TechCrunch / VentureBeat AI / ZDNet AI）...');
  const sourceConfigs = [
    { url: TECHCRUNCH_RSS, region: '海外', sourceName: 'TechCrunch', idStart: 1000 },
    { url: VENTUREBEAT_AI_RSS, region: '海外', sourceName: 'VentureBeat', idStart: 1300 },
    { url: ZDNET_AI_RSS, region: '海外', sourceName: 'ZDNet AI', idStart: 1600 },
    { url: KR36_RSS, region: '国内', sourceName: '36kr.com', idStart: 2000 },
    { url: INFOQ_CN_RSS, region: '国内', sourceName: 'InfoQ CN', idStart: 2300 },
    { url: LEIPHONE_RSS, region: '国内', sourceName: '雷峰网', idStart: 2600 }
  ];

  const errorByType = {};
  const sampleErrors = [];

  const rssResults = await Promise.allSettled(sourceConfigs.map((s) => fetchRss(s.url)));
  const xmlBySource = [];
  rssResults.forEach((r, idx) => {
    const source = sourceConfigs[idx];
    if (r.status === 'fulfilled') {
      xmlBySource.push({ ...source, xmlText: r.value });
    } else {
      const msg = `RSS抓取失败: ${source.sourceName} | ${r.reason && r.reason.message ? r.reason.message : String(r.reason)}`;
      const type = classifyPipelineError(msg);
      addErrorCount(errorByType, type);
      sampleErrors.push(msg);
    }
  });
  console.log(`[AI Dashboard] RSS 获取成功：${xmlBySource.length}/${sourceConfigs.length} 个源，开始解析...`);
  if (xmlBySource.length === 0) throw new Error('全部 RSS 源抓取失败');

  const parseResults = await Promise.allSettled(
    xmlBySource.map((s) => parseRss(s.xmlText, s.region, s.sourceName, s.idStart))
  );
  const allNews = [];
  parseResults.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      allNews.push(...r.value);
    } else {
      const source = xmlBySource[idx];
      const msg = `RSS解析失败: ${source.sourceName} | ${r.reason && r.reason.message ? r.reason.message : String(r.reason)}`;
      const type = classifyPipelineError(msg);
      addErrorCount(errorByType, type);
      sampleErrors.push(msg);
    }
  });

  // 与历史池合并，保留最近 30 天，避免仅靠当天 RSS 导致 week/month 过空
  const historyItems = loadNewsHistory();
  const mergedRecentNews = mergeNewsPool(historyItems, allNews);
  console.log(`[AI Dashboard] 历史池已更新：历史 ${historyItems.length} + 当次 ${allNews.length} => 最近30天 ${mergedRecentNews.length}`);
  if (mergedRecentNews.length === 0) throw new Error('抓取完成但无可用新闻数据（历史池与当次抓取均为空）');

  const enrichResult = await enrichInsightsWithLlm(mergedRecentNews);
  Object.entries(enrichResult.errorByType).forEach(([k, v]) => {
    errorByType[k] = (errorByType[k] || 0) + v;
  });
  enrichResult.failedNews.slice(0, 10).forEach((e) => {
    sampleErrors.push(`${e.source} | ${e.title} | ${e.errorType} | ${e.errorDetail}`);
  });

  const successfulNews = enrichResult.successNews;
  normalizeNewsScoreAndImportance(successfulNews);
  const buckets = bucketByTime(successfulNews);

  let analysisHtml = null;
  let analysisStatus = 'ok';
  let analysisError = null;
  try {
    console.log('[AI Dashboard] 调用大模型生成分析文案（全量成功新闻+链接）...');
    analysisHtml = await callLlmForAnalysis(successfulNews, buckets);
    if (!analysisHtml) throw new Error('AI Trends Analysis 生成失败：未返回有效内容');
  } catch (e) {
    analysisStatus = 'failed';
    analysisError = e.message || String(e);
    const type = classifyPipelineError(analysisError);
    addErrorCount(errorByType, type);
    sampleErrors.push(`BA Insights 失败 | ${analysisError}`);
  }

  // 只持久化成功新闻，避免失败条目污染历史池
  saveNewsHistory(successfulNews);

  const totalFailures = (sourceConfigs.length - xmlBySource.length) + (parseResults.length - parseResults.filter((r) => r.status === 'fulfilled').length) + enrichResult.failedCount + (analysisStatus === 'failed' ? 1 : 0);
  const refreshSummary = {
    totalCandidates: mergedRecentNews.length,
    successCount: successfulNews.length,
    failedCount: totalFailures,
    llmFailedNewsCount: enrichResult.failedCount,
    errorByType,
    sampleErrors: sampleErrors.slice(0, 12)
  };
  const pipelineStatus = totalFailures > 0 ? 'partial' : 'ok';

  const output = {
    generatedAt: new Date().toISOString(),
    pipelineStatus,
    refreshSummary,
    newsBuckets: buckets,
    analysisHtml,
    analysisStatus,
    analysisError
  };

  const outPath = path.join(__dirname, 'daily_ai_dashboard.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[AI Dashboard] 已生成 daily_ai_dashboard.json。成功新闻 ${successfulNews.length}，问题条目 ${totalFailures}`);
  return { ok: true, pipelineStatus, refreshSummary };
}

if (require.main === module) {
  main().catch((e) => {
    console.error('[AI Dashboard] 生成失败：', e);
    process.exitCode = 1;
  });
}

// 导出 main，供 server.js / 其他模块调用
module.exports = { main };

