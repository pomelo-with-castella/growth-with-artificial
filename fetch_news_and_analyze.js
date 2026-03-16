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

// 使用 DeepSeek Chat 接口（兼容 OpenAI 风格）
// 优先读取 D E E P S E E K_API_KEY，没有则回退到 OPENAI_API_KEY（方便沿用原有变量）
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';

// === 工具函数 ===

async function fetchRss(url) {
  const res = await fetch(url, { timeout: 20000 });
  if (!res.ok) {
    throw new Error(`Fetch RSS failed: ${url} status=${res.status}`);
  }
  return res.text();
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
    '生成式AI'
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

async function parseRss(xmlText, region) {
  const xml = await parseStringPromise(xmlText);
  const items = xml.rss && xml.rss.channel && xml.rss.channel[0].item ? xml.rss.channel[0].item : [];

  const newsItems = [];
  let idCounter = region === '国内' ? 2000 : 1000;

  for (const item of items) {
    const title = item.title ? item.title[0] : '';
    const link = item.link ? item.link[0] : '#';
    const pubDate = item.pubDate ? item.pubDate[0] : new Date().toISOString();
    const description = item.description ? item.description[0] : '';

    if (!isAiRelated(title, description)) continue;

    const summary = cleanHtmlSummary(description);
    const businessScore = 70 + Math.floor(Math.random() * 25);

    const tags = {
      domain: getDomainTags(title, description),
      region: [region],
      type: getTypeTags(title),
      importance: Math.random() > 0.7 ? '高' : Math.random() > 0.5 ? '中' : '低'
    };

    newsItems.push({
      id: idCounter++,
      title,
      summary,
      insight: generateInsight(title, region), // 先生成一个本地兜底版，后面再用大模型覆盖
      link,
      date: formatDate(pubDate),
      rawDate: pubDate,
      source: region === '国内' ? '36kr.com' : 'TechCrunch',
      tags,
      businessScore,
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

// 使用 DeepSeek 为单条新闻生成 1-2 句精准提炼/商业洞察
async function generateInsightWithLlm(news) {
  if (!DEEPSEEK_API_KEY) return news.insight;

  const rolePrefix = news.tags && news.tags.region && news.tags.region.includes('国内')
    ? '你是一个深耕中国AI产业十几年的商业分析顾问团队，'
    : 'You are a senior AI industry strategy consultant team, ';

  const prompt = `
${rolePrefix}长期为大型科技公司和投资机构提供决策支持。

请阅读下面这条新闻的「标题 + 概要」，并基于这条新闻本身，给出**两句高度凝练的中文商业洞察**。
格式要求（非常重要）：
1. 固定输出两句，不多不少。
   - 第一句：用一句话极简描述这条新闻的核心事件 / 变化（发生了什么）。
   - 第二句：用一句话点出此事件对产业链关键角色的商业或行业价值（机会或风险），说明「对谁」「有什么影响」。
2. 总字数建议控制在 40~80 字之间，避免空洞形容词和套话。
3. 不要出现“本文”“这条新闻”“该报道”等指代词，直接陈述事实和判断。
4. 不要自带任何前缀标签，如“AI商业洞察：”“总结：”“TL;DR：”，只输出两句话的正文内容。
5. 只返回中文内容，不要解释，不要添加项目符号、序号或换行标题。

【新闻标题】
${news.title}

【新闻概要】
${news.summary}
`;

  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: '你是一支具有十多年咨询经验、专注AI与科技行业的商业分析团队。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.5
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
      console.warn('DeepSeek 单条新闻洞察生成失败，保持原 insight。status=', res.status);
      return news.insight;
    }

    const data = await res.json();
    const content =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (!content) return news.insight;

    // 前缀标签由前端标题负责，这里只返回两句正文（核心内容 + 行业价值）
    return content.trim();
  } catch (e) {
    console.warn('调用 DeepSeek 生成单条新闻洞察异常，保持原 insight。', e.message);
    return news.insight;
  }
}

function extractCoreTech(description) {
  const desc = description.toLowerCase();
  if (desc.includes('自然语言') || desc.includes('nlp')) return '自然语言处理';
  if (desc.includes('计算机视觉') || desc.includes('cv')) return '计算机视觉';
  if (desc.includes('强化学习')) return '强化学习';
  if (desc.includes('生成') || desc.includes('generative')) return '生成模型';
  if (desc.includes('多模态')) return '多模态学习';
  if (desc.includes('深度')) return '深度学习';
  const techs = ['深度学习', '神经网络', '自然语言处理', '计算机视觉', '强化学习', '生成模型', '多模态学习'];
  return techs[Math.floor(Math.random() * techs.length)];
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

// 批量为新闻补充/覆盖 DeepSeek 生成的洞察（为控制调用次数，只处理前 N 条）
async function enrichInsightsWithLlm(allNews, maxItems = 30) {
  if (!DEEPSEEK_API_KEY) return;

  const targets = allNews.slice(0, maxItems);

  for (const news of targets) {
    news.insight = await generateInsightWithLlm(news);
  }
}

async function callLlmForAnalysis(allNews, buckets) {
  if (!DEEPSEEK_API_KEY) {
    console.warn('未设置 DEEPSEEK_API_KEY（或 OPENAI_API_KEY），跳过大模型分析，前端将使用内置统计分析。');
    return null;
  }

  const total = allNews.length;
  const domestic = allNews.filter((n) => n.tags.region.includes('国内')).length;
  const overseas = allNews.filter((n) => n.tags.region.includes('海外')).length;

  const sampleNews = allNews
    .slice(0, 30)
    .map((n) => `- [${n.tags.region.join('/')}] ${n.date} | ${n.title} (${n.source})`)
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

【部分新闻样本】（仅供你判断趋势，不必一条条复述）：
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
  console.log('[AI Dashboard] 开始抓取 36kr 和 TechCrunch RSS...');
  try {
    const [tcXml, krXml] = await Promise.all([fetchRss(TECHCRUNCH_RSS), fetchRss(KR36_RSS)]);
    console.log('[AI Dashboard] RSS 获取成功，开始解析...');

    const [tcNews, krNews] = await Promise.all([parseRss(tcXml, '海外'), parseRss(krXml, '国内')]);
    const allNews = [...tcNews, ...krNews];

    if (allNews.length === 0) {
      console.warn('[AI Dashboard] 未从 RSS 中解析到 AI 相关新闻，保持现有数据不变。');
      return;
    }

    // 先按时间分桶
    const buckets = bucketByTime(allNews);

    // 使用 DeepSeek 为部分新闻生成更精准的提炼/商业洞察（会覆盖默认 insight）
    try {
      await enrichInsightsWithLlm(allNews);
    } catch (e) {
      console.warn('[AI Dashboard] 使用 DeepSeek 生成逐条新闻洞察时出错，将保留默认 insight：', e.message);
    }

    console.log('[AI Dashboard] 调用大模型生成分析文案（如果配置了 OPENAI_API_KEY）...');
    let analysisHtml = null;
    try {
      analysisHtml = await callLlmForAnalysis(allNews, buckets);
    } catch (e) {
      console.error('[AI Dashboard] 调用大模型失败，将在前端使用本地统计分析：', e.message);
    }

    const output = {
      generatedAt: new Date().toISOString(),
      newsBuckets: buckets,
      analysisHtml: analysisHtml
    };

    const outPath = path.join(__dirname, 'daily_ai_dashboard.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

    console.log('[AI Dashboard] 已生成 daily_ai_dashboard.json，可供前端页面使用。');
  } catch (e) {
    console.error('[AI Dashboard] 生成失败：', e);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

// 导出 main，供 server.js / 其他模块调用
module.exports = { main };

