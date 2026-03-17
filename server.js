require('dotenv').config();

const express = require('express');
const { main: generateDashboard } = require('./fetch_news_and_analyze');

const app = express();
const refreshJobState = {
  running: false,
  status: 'idle', // idle | running | succeeded | failed
  jobId: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastResult: null
};

function startRefreshJob(jobId) {
  setImmediate(async () => {
    try {
      const result = await generateDashboard();
      refreshJobState.status = 'succeeded';
      refreshJobState.lastResult = result || null;
      refreshJobState.lastError = null;
      console.log('[API] Dashboard regenerated successfully');
    } catch (e) {
      refreshJobState.status = 'failed';
      refreshJobState.lastError = e && e.message ? e.message : String(e);
      refreshJobState.lastResult = null;
      console.error('[API] Failed to regenerate dashboard:', e);
    } finally {
      refreshJobState.running = false;
      refreshJobState.lastFinishedAt = new Date().toISOString();
      console.log(`[API] Refresh job finished: ${jobId} (${refreshJobState.status})`);
    }
  });
}

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
app.post('/api/refresh-dashboard', (req, res) => {
  console.log('[API] /api/refresh-dashboard called');
  if (refreshJobState.running) {
    return res.status(202).json({
      ok: true,
      accepted: true,
      message: 'Refresh job is already running.',
      jobId: refreshJobState.jobId,
      status: refreshJobState.status
    });
  }

  const jobId = `job_${Date.now()}`;
  refreshJobState.running = true;
  refreshJobState.status = 'running';
  refreshJobState.jobId = jobId;
  refreshJobState.lastStartedAt = new Date().toISOString();
  refreshJobState.lastFinishedAt = null;
  refreshJobState.lastError = null;
  refreshJobState.lastResult = null;

  startRefreshJob(jobId);
  return res.status(202).json({
    ok: true,
    accepted: true,
    message: 'Refresh job accepted and running in background.',
    jobId,
    status: refreshJobState.status
  });
});

app.get('/api/refresh-status', (req, res) => {
  res.json({
    ok: true,
    running: refreshJobState.running,
    status: refreshJobState.status,
    jobId: refreshJobState.jobId,
    lastStartedAt: refreshJobState.lastStartedAt,
    lastFinishedAt: refreshJobState.lastFinishedAt,
    lastError: refreshJobState.lastError,
    lastResult: refreshJobState.lastResult
  });
});

app.listen(PORT, () => {
  console.log(`AI Dashboard web + API server is running at http://localhost:${PORT}`);
});



