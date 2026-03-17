require('dotenv').config();

const express = require('express');
const { main: generateDashboard } = require('./fetch_news_and_analyze');

const app = express();

// 统一端口：既提供网页，又提供 API
const PORT = process.env.PORT || 59613;

// CORS：允许 GitHub Pages / 任意前端跨域调用刷新接口和读取 JSON
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 静态资源：index.html / script.js / style.css / daily_ai_dashboard.json 等
app.use(express.static(__dirname));

// 手动刷新：重新抓取 36kr + TechCrunch、调用 DeepSeek，并生成最新 daily_ai_dashboard.json
app.post('/api/refresh-dashboard', async (req, res) => {
  console.log('[API] /api/refresh-dashboard called');
  try {
    const result = await generateDashboard();
    console.log('[API] Dashboard regenerated successfully');
    res.json({ ok: true, message: 'Dashboard refreshed.', result });
  } catch (e) {
    console.error('[API] Failed to regenerate dashboard:', e);
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`AI Dashboard web + API server is running at http://localhost:${PORT}`);
});



