// 多维新闻数据结构
// 说明：页面展示只以后端生成的 daily_ai_dashboard.json 为准；
// 这里提供空的初始结构，避免“本地示例数据”造成 Past Month 等时间段与 JSON 不一致。
const newsData = {
    today: [],
    yesterday: [],
    week: [],
    month: []
};

// 前端可配置后端地址（用于 GitHub Pages 等静态托管场景）
// 本地运行时留空即可（同源 / 相对路径）。
const DASHBOARD_BACKEND = (typeof window !== 'undefined' && window.__DASHBOARD_BACKEND__)
    ? String(window.__DASHBOARD_BACKEND__).replace(/\/+$/, '')
    : '';

// 渲染标签
function renderTags(tags) {
    let html = '<div class="news-tags">';

    // 领域标签
    if (tags.domain) {
        tags.domain.forEach(domain => {
            html += `<span class="tag tag-domain">${domain}</span>`;
        });
    }

    // 地域标签
    if (tags.region) {
        tags.region.forEach(region => {
            html += `<span class="tag tag-region">${region}</span>`;
        });
    }

    // 类型标签
    if (tags.type) {
        tags.type.forEach(type => {
            html += `<span class="tag tag-type">${type}</span>`;
        });
    }

    // 重要度标签
    if (tags.importance) {
        const importanceClass = `tag-importance-${tags.importance.toLowerCase()}`;
        html += `<span class="tag ${importanceClass}">${tags.importance}重要度</span>`;
    }

    html += '</div>';
    return html;
}

// 渲染商业评分
function renderBusinessScore(score) {
    if (!score) return '';
    let starRating = '';
    const starCount = Math.floor(score / 20); // 5星制
    for (let i = 0; i < 5; i++) {
        if (i < starCount) {
            starRating += '★';
        } else {
            starRating += '☆';
        }
    }
    return `<div class="main-business-score">${score}% ${starRating}</div>`;
}

// 渲染融资信息
function renderFundingInfo(funding, investors) {
    if (!funding) return '';
    let html = `<div class="funding-info">`;
    html += `<strong>💰 融资:</strong> ${funding}`;
    if (investors && investors.length > 0) {
        html += ` | <strong>领投方:</strong> ${investors.join(', ')}`;
    }
    html += `</div>`;
    return html;
}

// 渲染核心技术
function renderCoreTech(coreTech) {
    if (!coreTech) return '';
    return `<div class="core-tech"><strong>🔧 核心技术:</strong> ${coreTech}</div>`;
}

// 全局筛选状态
let currentFilters = {
    region: [],
    importance: []
};

function buildRefreshIssueMessage(refreshSummary, analysisStatus, analysisError) {
    const issues = [];
    if (refreshSummary && typeof refreshSummary === 'object') {
        const failedCount = Number(refreshSummary.failedCount || 0);
        const successCount = Number(refreshSummary.successCount || 0);
        if (failedCount > 0) {
            issues.push(`本次刷新已展示成功新闻 ${successCount} 条，存在问题条目 ${failedCount} 条。`);
        }
        if (refreshSummary.errorByType && typeof refreshSummary.errorByType === 'object') {
            const byTypeText = Object.entries(refreshSummary.errorByType)
                .map(([k, v]) => `${k}:${v}`)
                .join('，');
            if (byTypeText) issues.push(`错误分类：${byTypeText}`);
        }
        if (Array.isArray(refreshSummary.sampleErrors) && refreshSummary.sampleErrors.length > 0) {
            issues.push(`示例：${refreshSummary.sampleErrors.slice(0, 3).join(' | ')}`);
        }
    }
    if (analysisStatus === 'failed') {
        issues.push(`BA Insights 失败：${analysisError || '未知错误'}`);
    }
    return issues.join('\n');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRefreshCompletion() {
    const timeoutMs = 6 * 60 * 1000; // 6 minutes for cold start + refresh
    const pollMs = 2500;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        const res = await fetch(`${DASHBOARD_BACKEND}/api/refresh-status?ts=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) {
            throw new Error(`读取刷新状态失败，status=${res.status}`);
        }
        const status = await res.json();
        if (status.running) {
            await sleep(pollMs);
            continue;
        }
        if (status.status === 'succeeded') {
            return status;
        }
        if (status.status === 'failed') {
            throw new Error(`后台刷新失败：${status.lastError || '未知错误'}`);
        }
        await sleep(pollMs);
    }
    throw new Error('等待刷新结果超时，请稍后重试');
}

// 应用筛选条件
function applyFilters(newsItems) {
    if (!newsItems) return [];

    console.log('应用筛选条件:', {
        currentFilters,
        newsItemsCount: newsItems.length
    });

    const filtered = newsItems.filter(item => {
        // 地域筛选
        if (currentFilters.region.length > 0 && item.tags && item.tags.region) {
            const hasRegion = currentFilters.region.some(region =>
                item.tags.region.includes(region)
            );
            if (!hasRegion) {
                console.log(`新闻"${item.title.substring(0, 30)}..."被地域筛选过滤掉，需要: ${currentFilters.region}, 实际: ${item.tags.region}`);
                return false;
            }
        }

        // 重要度筛选
        if (currentFilters.importance.length > 0 && item.tags && item.tags.importance) {
            const hasImportance = currentFilters.importance.includes(item.tags.importance);
            if (!hasImportance) {
                console.log(`新闻"${item.title.substring(0, 30)}..."被重要度筛选过滤掉，需要: ${currentFilters.importance}, 实际: ${item.tags.importance}`);
                return false;
            }
        }

        return true;
    });

    console.log(`筛选结果: ${filtered.length}条新闻`);
    return filtered;
}

// 更新筛选状态
function updateFilter(filterType, value, isActive) {
    console.log(`更新筛选: ${filterType}=${value}, isActive=${isActive}, 当前:`, currentFilters[filterType]);

    if (isActive) {
        // 添加筛选
        if (!currentFilters[filterType].includes(value)) {
            currentFilters[filterType].push(value);
        }
    } else {
        // 移除筛选
        currentFilters[filterType] = currentFilters[filterType].filter(v => v !== value);
    }

    console.log(`筛选更新后 ${filterType}:`, currentFilters[filterType]);

    // 重新渲染当前时间线的新闻
    const activeBtn = document.querySelector('.timeframe-btn.active');
    if (activeBtn) {
        const timeframe = activeBtn.getAttribute('data-timeframe');
        renderNewsList(timeframe);
    }
}


// 渲染新闻列表
function renderNewsList(timeframe) {
    console.log('渲染新闻列表:', timeframe, '数据条数:', newsData[timeframe] ? newsData[timeframe].length : 0);
    const newsList = document.querySelector(`#${timeframe}-section .news-list`);
    if (!newsList) {
        console.error('未找到新闻列表容器:', `#${timeframe}-section .news-list`);
        return;
    }

    newsList.innerHTML = '';

    let newsItems = newsData[timeframe] || [];

    // 应用筛选
    newsItems = applyFilters(newsItems);

    if (newsItems.length === 0) {
        newsList.innerHTML = '<div class="no-news">该时间段内未找到符合条件的AI新闻。</div>';
        return;
    }

    newsItems.forEach(news => {
        const newsItem = document.createElement('div');
        newsItem.className = 'news-item';
        newsItem.dataset.id = news.id;

        let html = '';

        // 商业评分
        html += renderBusinessScore(news.businessScore);

        // 标题
        html += `<h3>${news.title}</h3>`;

        // 元信息
        html += `<div class="news-meta">`;
        html += `<span><i class="far fa-calendar"></i> ${news.date}</span>`;
        html += `<span><i class="fas fa-newspaper"></i> ${news.source}</span>`;
        html += `</div>`;

        // 标签
        if (news.tags) {
            html += renderTags(news.tags);
        }

        // AI洞察：仅当 DeepSeek 调用成功才显示正文，否则明确提示未调用成功
        html += `<div class="insight-box">`;
        html += `<div class="insight-title">🤖 一句话提炼</div>`;
        if (news.insightStatus === 'ok' && news.insight) {
            html += `<p>${news.insight.replace('💡 AI Insight:', '').replace('🤖 TL;DR:', '').trim()}</p>`;
        } else {
            html += `<p>未调用成功</p>`;
        }
        html += `</div>`;

        // 摘要
        html += `<p class="news-summary">${news.summary}</p>`;

        // 融资信息
        if (news.funding) {
            html += renderFundingInfo(news.funding, news.investors);
        }

        // 核心技术
        if (news.coreTech) {
            html += renderCoreTech(news.coreTech);
        }

        // 原文链接
        html += `<a href="${news.link}" target="_blank" class="news-link">`;
        html += `<i class="fas fa-external-link-alt"></i> 阅读原文`;
        html += `</a>`;

        newsItem.innerHTML = html;
        newsList.appendChild(newsItem);

        // 添加点击事件
        newsItem.addEventListener('click', (e) => {
            // 防止点击链接时触发
            if (!e.target.closest('a')) {
                showNewsDetail(news.id);
            }
        });
    });

    // 更新统计数据
    updateStats(timeframe, newsItems.length);
}

// 更新统计数据
function updateStats(timeframe, count) {
    // 更新头部总新闻数
    const totalNews = Object.values(newsData).reduce((sum, arr) => sum + arr.length, 0);
    const totalNewsEl = document.getElementById('total-news');
    if (totalNewsEl) {
        totalNewsEl.textContent = totalNews;
    }

    // 更新今天新闻数量
    if (timeframe === 'today') {
        const todayCountEl = document.getElementById('today-news');
        if (todayCountEl) {
            todayCountEl.textContent = count;
        }
    }
}

// 计算趋势数据
function calculateTrends() {
    const allNews = [...newsData.today, ...newsData.yesterday, ...newsData.week, ...newsData.month];

    // 计算商业潜力分布（与 importance 映射一致：>=85 高，78-84 中，<78 低）
    const scores = {
        high: allNews.filter(n => n.businessScore >= 85).length,
        medium: allNews.filter(n => n.businessScore >= 78 && n.businessScore < 85).length,
        low: allNews.filter(n => n.businessScore < 78).length,
        veryLow: 0
    };

    // 计算领域分布
    const domains = {};
    const regionStats = { 国内: 0, 海外: 0 };
    allNews.forEach(news => {
        if (news.tags && news.tags.domain) {
            news.tags.domain.forEach(domain => {
                domains[domain] = (domains[domain] || 0) + 1;
            });
        }
        if (news.tags && news.tags.region) {
            news.tags.region.forEach(region => {
                regionStats[region] = (regionStats[region] || 0) + 1;
            });
        }
    });

    return { scores, domains, regionStats, totalCount: allNews.length };
}

// 更新图表
function updateCharts() {
    const { scores, domains, regionStats, totalCount } = calculateTrends();
    const total = Object.values(scores).reduce((sum, val) => sum + val, 0);

    // 计算新闻数量趋势
    const todayCount = newsData.today.length;
    const weekCount = newsData.today.length + newsData.yesterday.length + newsData.week.length;
    const monthCount = weekCount + newsData.month.length;

    // 计算最大数量用于比例计算
    const maxCount = Math.max(todayCount, weekCount, monthCount, 1);

    // 更新新闻数量趋势图表
    const monthBar = document.getElementById('month-bar');
    const monthValue = document.getElementById('month-value');
    const weekBar = document.getElementById('week-bar');
    const weekValue = document.getElementById('week-value');
    const todayBar = document.getElementById('today-bar');
    const todayValue = document.getElementById('today-value');

    if (monthBar && monthValue) {
        const monthHeight = Math.round((monthCount / maxCount) * 100);
        monthBar.style.height = `${monthHeight}%`;
        monthValue.textContent = monthCount;
    }

    if (weekBar && weekValue) {
        const weekHeight = Math.round((weekCount / maxCount) * 100);
        weekBar.style.height = `${weekHeight}%`;
        weekValue.textContent = weekCount;
    }

    if (todayBar && todayValue) {
        const todayHeight = Math.round((todayCount / maxCount) * 100);
        todayBar.style.height = `${todayHeight}%`;
        todayValue.textContent = todayCount;
    }

    // 更新顶部 Domestic Share
    const domesticShareEl = document.getElementById('domestic-share');
    if (domesticShareEl && totalCount > 0) {
        const domestic = regionStats['国内'] || 0;
        const share = Math.round((domestic / totalCount) * 100);
        domesticShareEl.textContent = `${share}%`;
        domesticShareEl.title = `国内新闻条数 ${domestic} / 总条数 ${totalCount}`;
    }

    // 更新商业潜力分布图表
    const scoreDistribution = document.querySelector('.score-distribution');
    if (scoreDistribution) {
        const scoreItems = scoreDistribution.querySelectorAll('.score-item');

        // 高潜力
        const highPercent = total > 0 ? Math.round((scores.high / total) * 100) : 0;
        scoreItems[0].querySelector('.score-fill').style.width = `${highPercent}%`;
        scoreItems[0].querySelector('.score-count').textContent = scores.high;

        // 中等
        const mediumPercent = total > 0 ? Math.round((scores.medium / total) * 100) : 0;
        scoreItems[1].querySelector('.score-fill').style.width = `${mediumPercent}%`;
        scoreItems[1].querySelector('.score-count').textContent = scores.medium;

        // 一般
        const lowPercent = total > 0 ? Math.round((scores.low / total) * 100) : 0;
        scoreItems[2].querySelector('.score-fill').style.width = `${lowPercent}%`;
        scoreItems[2].querySelector('.score-count').textContent = scores.low;

        // 观察
        const veryLowPercent = total > 0 ? Math.round((scores.veryLow / total) * 100) : 0;
        scoreItems[3].querySelector('.score-fill').style.width = `${veryLowPercent}%`;
        scoreItems[3].querySelector('.score-count').textContent = scores.veryLow;
    }

    // 更新领域分布图表
    const domainChart = document.querySelector('.domain-chart');
    if (domainChart) {
        const domainEntries = Object.entries(domains);
        const totalDomains = Object.values(domains).reduce((sum, val) => sum + val, 0);

        // 清空现有内容
        domainChart.innerHTML = '';

        // 排序并取前5个
        domainEntries.sort((a, b) => b[1] - a[1]).slice(0, 5).forEach(([domain, count]) => {
            const percent = totalDomains > 0 ? Math.round((count / totalDomains) * 100) : 0;
            const item = document.createElement('div');
            item.className = 'domain-item';
            item.innerHTML = `
                <span class="domain-label">${domain}</span>
                <div class="domain-bar">
                    <div class="domain-fill" style="width: ${percent}%"></div>
                </div>
                <span class="domain-percent">${percent}%</span>
            `;
            domainChart.appendChild(item);
        });
    }

    // 更新分析内容
    updateAnalysisContent();
}

// 显示新闻详情
function showNewsDetail(newsId) {
    const allNews = [...newsData.today, ...newsData.yesterday, ...newsData.week, ...newsData.month];
    const news = allNews.find(n => n.id === newsId);

    if (!news) return;

    // 创建详情弹窗或更新右侧面板
    const detailPanel = document.createElement('div');
    detailPanel.className = 'news-detail-overlay';
    detailPanel.innerHTML = `
        <div class="news-detail-modal">
            <div class="detail-header">
                <h2>${news.title}</h2>
                <button class="close-detail">&times;</button>
            </div>
            <div class="detail-content">
                <div class="detail-meta">
                    <span><i class="far fa-calendar"></i> ${news.date}</span>
                    <span><i class="fas fa-newspaper"></i> ${news.source}</span>
                </div>
                <div class="detail-tags">
                    ${renderTags(news.tags)}
                </div>
                <div class="detail-insight">
                    <h3>${news.insight.includes('💡') ? '💡 AI商业洞察' : '🤖 一句话提炼'}</h3>
                    <p>${news.insight.replace('💡 AI Insight:', '').replace('🤖 TL;DR:', '').trim()}</p>
                </div>
                <div class="detail-summary">
                    <h3>详细摘要</h3>
                    <p>${news.summary}</p>
                </div>
                ${news.funding ? renderFundingInfo(news.funding, news.investors) : ''}
                ${news.coreTech ? renderCoreTech(news.coreTech) : ''}
                <div class="detail-analysis">
                    <h3>深入分析</h3>
                    <p class="analysis-score">商业潜力评分：<strong>${news.businessScore}%</strong></p>
                    ${news.deepAnalysis ? `<p class="analysis-text">${news.deepAnalysis}</p>` : ''}
                </div>
                <a href="${news.link}" target="_blank" class="detail-link">
                    <i class="fas fa-external-link-alt"></i> 阅读原文报道
                </a>
            </div>
        </div>
    `;

    document.body.appendChild(detailPanel);

    // 添加关闭事件
    detailPanel.querySelector('.close-detail').addEventListener('click', () => {
        document.body.removeChild(detailPanel);
    });

    // 点击遮罩层关闭
    detailPanel.addEventListener('click', (e) => {
        if (e.target === detailPanel) {
            document.body.removeChild(detailPanel);
        }
    });
}

// 切换右侧分析面板
function switchAnalysisTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.nav-btn[data-tab="${tabName}"]`).classList.add('active');

    // 这里可以添加不同标签的内容切换逻辑
    console.log(`切换到 ${tabName} 标签`);
}

// 切换时间线
function switchTimeline(timeframe) {
    console.log('切换时间线:', timeframe);
    // 更新按钮状态
    document.querySelectorAll('.timeframe-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`.timeframe-btn[data-timeframe="${timeframe}"]`).classList.add('active');

    // 更新时间线部分
    document.querySelectorAll('.timeline-section').forEach(section => {
        section.classList.remove('active');
    });
    document.querySelector(`#${timeframe}-section`).classList.add('active');

    // 渲染新闻列表
    renderNewsList(timeframe);
}

// 初始化页面（优先读取后端每日生成的 JSON，没有则前端自行抓 RSS）
document.addEventListener('DOMContentLoaded', function() {
    (async () => {
        // 设置当前日期
        const currentDate = new Date();
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        document.getElementById('current-date').textContent = currentDate.toLocaleDateString('en-US', options);

        // 初始化筛选按钮
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const filterType = this.getAttribute('data-filter');
                const filterValue = this.getAttribute('data-value');
                const isActive = this.classList.contains('active');

                // 切换按钮状态
                if (isActive) {
                    // 如果按钮已经是active状态，点击则取消选择
                    this.classList.remove('active');
                    updateFilter(filterType, filterValue, false);
                } else {
                    // 如果按钮不是active状态
                    if (filterType === 'importance' || filterType === 'region') {
                        // 对于单选类型的筛选
                        // 先移除同组的其他按钮的active状态
                        document.querySelectorAll(`.filter-btn[data-filter="${filterType}"]`).forEach(b => {
                            b.classList.remove('active');
                        });
                        // 清空该类型的筛选值
                        currentFilters[filterType] = [];
                    }
                    // 添加当前按钮的active状态
                    this.classList.add('active');
                    // 添加筛选
                    updateFilter(filterType, filterValue, true);
                }
            });
        });

        // 根据初始高亮的地域 Tab 同步默认筛选（默认“海外”）
        const activeRegionButtons = document.querySelectorAll('.filter-btn[data-filter="region"].active');
        activeRegionButtons.forEach(btn => {
            const filterValue = btn.getAttribute('data-value');
            updateFilter('region', filterValue, true);
        });

        let analysisHtmlFromJson = null;
        let analysisErrorFromJson = null;
        let loadedFromJson = false;

        // 尝试读取后端每日生成的 JSON
        try {
            const res = await fetch(`${DASHBOARD_BACKEND}/daily_ai_dashboard.json`, { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                // 即使是空数组也要覆盖，避免 Past Month 保留旧的模拟数据
                newsData.today = Array.isArray(data.newsBuckets.today) ? data.newsBuckets.today : [];
                newsData.yesterday = Array.isArray(data.newsBuckets.yesterday) ? data.newsBuckets.yesterday : [];
                newsData.week = Array.isArray(data.newsBuckets.week) ? data.newsBuckets.week : [];
                newsData.month = Array.isArray(data.newsBuckets.month) ? data.newsBuckets.month : [];
                loadedFromJson = true;
                if (data.analysisHtml) {
                    analysisHtmlFromJson = data.analysisHtml;
                }
                analysisErrorFromJson = data.analysisError || null;
                console.log(`已从 daily_ai_dashboard.json 加载最新新闻与分析数据。来源: ${DASHBOARD_BACKEND || 'same-origin'}`);
            }
        } catch (e) {
            console.warn('读取 daily_ai_dashboard.json 失败：', e);
        }

        // 默认激活 Today 时间段（此时已应用默认地域筛选）
        switchTimeline('today');

        // 初始化统计数据和图表（基于当前 newsData）
        updateStats('today', newsData.today.length);
        updateCharts();

        // 更新右侧分析内容：优先用后端大模型生成的 HTML，没有则用本地统计分析
        updateAnalysisContent(analysisHtmlFromJson, analysisErrorFromJson);

        // 更新时间线按钮事件监听（点击时才渲染对应时间段的新闻）
        document.querySelectorAll('.timeframe-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const timeframe = this.getAttribute('data-timeframe');
                switchTimeline(timeframe);
            });
        });

        // 刷新按钮：调用后端 API 重新抓取并生成 JSON，然后重渲染当前视图
        const refreshBtn = document.getElementById('refresh-dashboard');
        const refreshModal = document.getElementById('refresh-modal');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                console.log('手动刷新：调用 /api/refresh-dashboard 并重新加载 daily_ai_dashboard.json');
                const btnTextEl = refreshBtn.querySelector('.btn-text');
                const originalText = btnTextEl ? btnTextEl.textContent : refreshBtn.textContent;
                refreshBtn.disabled = true;
                refreshBtn.classList.add('is-loading');
                if (btnTextEl) {
                    btnTextEl.textContent = 'Syncing...';
                } else {
                    refreshBtn.textContent = 'Syncing...';
                }
                if (refreshModal) refreshModal.setAttribute('aria-hidden', 'false');
                try {
                    // 1）先请求后端启动后台刷新任务（202 Accepted）
                    const refreshRes = await fetch(`${DASHBOARD_BACKEND}/api/refresh-dashboard`, { method: 'POST' });
                    if (!refreshRes.ok) {
                        const errText = await refreshRes.text().catch(() => '');
                        throw new Error(`/api/refresh-dashboard 失败: ${refreshRes.status} ${errText}`);
                    }
                    const accepted = await refreshRes.json().catch(() => ({}));
                    if (!accepted.ok) {
                        throw new Error(`刷新任务未被接受: ${accepted.error || '未知错误'}`);
                    }

                    // 2）轮询后端刷新状态，等待后台任务完成
                    await waitForRefreshCompletion();

                    // 3）读取最新 daily_ai_dashboard.json
                    const res = await fetch(`${DASHBOARD_BACKEND}/daily_ai_dashboard.json?ts=` + Date.now(), { cache: 'no-store' });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.newsBuckets) {
                            newsData.today = Array.isArray(data.newsBuckets.today) ? data.newsBuckets.today : [];
                            newsData.yesterday = Array.isArray(data.newsBuckets.yesterday) ? data.newsBuckets.yesterday : [];
                            newsData.week = Array.isArray(data.newsBuckets.week) ? data.newsBuckets.week : [];
                            newsData.month = Array.isArray(data.newsBuckets.month) ? data.newsBuckets.month : [];
                        }
                        // 右侧分析
                        updateAnalysisContent(data.analysisHtml || null, data.analysisError || null);
                        // 重新渲染当前时间段
                        const activeBtn = document.querySelector('.timeframe-btn.active');
                        const currentTimeframe = activeBtn ? activeBtn.getAttribute('data-timeframe') : 'today';
                        switchTimeline(currentTimeframe);
                        const issueMessage = buildRefreshIssueMessage(data.refreshSummary, data.analysisStatus, data.analysisError);
                        if (issueMessage) {
                            window.alert(`刷新完成（部分异常）\n${issueMessage}`);
                        }
                        console.log(`手动刷新完成，已应用最新 daily_ai_dashboard.json。来源: ${DASHBOARD_BACKEND || 'same-origin'}`);
                    } else {
                        throw new Error(`刷新失败：无法读取 daily_ai_dashboard.json，status=${res.status}`);
                    }
                } catch (e) {
                    console.error('刷新失败：', e);
                    window.alert(`刷新失败：${e.message || e}\n请查看后端控制台日志定位具体报错。`);
                } finally {
                    if (refreshModal) refreshModal.setAttribute('aria-hidden', 'true');
                    refreshBtn.disabled = false;
                    refreshBtn.classList.remove('is-loading');
                    if (btnTextEl) {
                        btnTextEl.textContent = originalText;
                    } else {
                        refreshBtn.textContent = originalText;
                    }
                }
            });
        }

        console.log('AI Insight Pro 初始化成功');
        console.log('数据源: daily_ai_dashboard.json（后端预处理结果）');
    })();
});

// 从真实源获取AI新闻
async function fetchRealNews() {
    console.log('开始从真实源获取AI新闻...');

    // 使用CORS代理 - 尝试多个代理以防某个失效
    const proxyUrls = [
        'https://api.allorigins.win/raw?url=',
        'https://corsproxy.io/?',
        'https://api.codetabs.com/v1/proxy/?quest='
    ];
    const techcrunchRss = 'https://techcrunch.com/feed/';
    const kr36Rss = 'https://www.36kr.com/feed';

    // 选择第一个代理
    const proxyUrl = proxyUrls[0];

    try {
        // 尝试从TechCrunch获取
        const techcrunchResponse = await fetch(`${proxyUrl}${encodeURIComponent(techcrunchRss)}`);
        if (!techcrunchResponse.ok) {
            throw new Error(`TechCrunch fetch failed: ${techcrunchResponse.status}`);
        }
        const techcrunchText = await techcrunchResponse.text();
        console.log('成功获取TechCrunch RSS');

        // 尝试从36kr获取
        const kr36Response = await fetch(`${proxyUrl}${encodeURIComponent(kr36Rss)}`);
        if (!kr36Response.ok) {
            console.log('36kr RSS获取失败，使用模拟数据');
            // 使用模拟数据作为回退
            return useSimulatedData();
        }
        const kr36Text = await kr36Response.text();
        console.log('成功获取36kr RSS');

        // 解析RSS
        const techcrunchNews = parseRSS(techcrunchText, '海外');
        const kr36News = parseRSS(kr36Text, '国内');

        // 按真实发布时间拆分到 Today / Yesterday / Week / Month（近 30 天）
        const now = new Date();
        const newToday = [];
        const newYesterday = [];
        const newWeek = [];
        const newMonth = [];

        const allFetched = [...techcrunchNews, ...kr36News];

        allFetched.forEach(item => {
            let raw = item.rawDate ? new Date(item.rawDate) : new Date(item.date);
            if (isNaN(raw.getTime())) {
                // 无法解析日期的，放到近一月桶里兜底
                newMonth.push(item);
                return;
            }
            const diffDays = Math.floor((now - raw) / (1000 * 60 * 60 * 24));

            if (diffDays === 0) {
                newToday.push(item);
            } else if (diffDays === 1) {
                newYesterday.push(item);
            } else if (diffDays < 7) {
                newWeek.push(item);
            } else if (diffDays < 30) {
                newMonth.push(item);
            }
        });

        // 如果某个时间段数据为空，用原来的模拟数据兜底
        if (newToday.length > 0) newsData.today = newToday;
        if (newYesterday.length > 0) newsData.yesterday = newYesterday;
        if (newWeek.length > 0) newsData.week = newWeek;
        if (newMonth.length > 0) newsData.month = newMonth;

        // 重新渲染
        const activeBtn = document.querySelector('.timeframe-btn.active');
        if (activeBtn) {
            const timeframe = activeBtn.getAttribute('data-timeframe');
            renderNewsList(timeframe);
            updateCharts();
            updateAnalysisContent(); // 更新分析内容
        }

        console.log(`成功更新新闻数据: ${techcrunchNews.length}条海外新闻, ${kr36News.length}条国内新闻`);

    } catch (error) {
        console.error('获取真实新闻失败:', error);
        console.log('使用模拟数据');
        useSimulatedData();
    }
}

// 解析RSS XML
function parseRSS(xmlText, region) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const items = xmlDoc.querySelectorAll('item');
    const newsItems = [];

    // AI相关关键词
    const aiKeywords = ['AI', '人工智能', 'machine learning', 'deep learning', 'neural network', '大模型', 'Agent', '智能体', '生成式AI'];

    let idCounter = 1000; // 从1000开始避免与现有ID冲突

    items.forEach(item => {
        const title = item.querySelector('title')?.textContent || '';
        const link = item.querySelector('link')?.textContent || '#';
        const pubDate = item.querySelector('pubDate')?.textContent || new Date().toISOString();
        const description = item.querySelector('description')?.textContent || '';

        // 检查是否与AI相关
        const isAI = aiKeywords.some(keyword =>
            title.toLowerCase().includes(keyword.toLowerCase()) ||
            description.toLowerCase().includes(keyword.toLowerCase())
        );

        if (isAI) {
            // 提取摘要（清理HTML标签）
            const summary = description.replace(/<[^>]*>/g, '').substring(0, 200) + '...';

            // 生成商业评分（模拟），importance 由 score 映射：>=85 高，78-84 中，<78 低
            const businessScore = 70 + Math.floor(Math.random() * 25);
            const importance = businessScore >= 85 ? '高' : businessScore >= 78 ? '中' : '低';

            // 生成标签
            const tags = {
                domain: getDomainTags(title, description),
                region: [region],
                type: getTypeTags(title),
                importance
            };

            // 生成AI洞察
            const insight = generateInsight(title, region);

            newsItems.push({
                id: idCounter++,
                title,
                summary,
                insight,
                link,
                date: formatDate(pubDate),
                rawDate: pubDate,
                source: region === '国内' ? '36kr.com' : 'TechCrunch',
                tags,
                businessScore,
                deepAnalysis: '',
                funding: null,
                coreTech: extractCoreTech(description)
            });
        }
    });

    return newsItems.slice(0, 10); // 限制数量
}

// 辅助函数
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
    if (title.includes('融资') || title.includes('funding') || title.includes('raise')) types.push('融资');
    if (title.includes('发布') || title.includes('launch') || title.includes('release')) types.push('产品发布');
    if (title.includes('研究') || title.includes('research')) types.push('研究突破');
    if (title.includes('政策') || title.includes('policy') || title.includes('regulation')) types.push('政策');
    if (types.length === 0) types.push('新闻');
    return types;
}

function generateInsight(title, region) {
    const insights = [
        `💡 AI Insight: ${region === '国内' ? '国内AI市场' : '全球AI生态'}正在加速演进，${title.substring(0, 30)}...`,
        `🤖 TL;DR: ${title.substring(0, 40)}... 反映了AI产业的技术迭代与商业重心变化。`,
        `💡 AI商业洞察: 从${title.substring(0, 20)}...看${region === '国内' ? '中国AI' : '全球AI'}发展趋势。`
    ];
    return insights[Math.floor(Math.random() * insights.length)];
}

function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
}

function extractCoreTech(description) {
    // 根据描述内容提取核心技术关键词
    const techs = ['深度学习', '神经网络', '自然语言处理', '计算机视觉', '强化学习', '生成模型', '多模态学习'];

    // 检查描述中是否包含特定技术关键词
    const desc = description.toLowerCase();
    if (desc.includes('自然语言') || desc.includes('nlp')) return '自然语言处理';
    if (desc.includes('计算机视觉') || desc.includes('cv')) return '计算机视觉';
    if (desc.includes('强化学习')) return '强化学习';
    if (desc.includes('生成') || desc.includes('generative')) return '生成模型';
    if (desc.includes('多模态')) return '多模态学习';
    if (desc.includes('深度')) return '深度学习';

    return techs[Math.floor(Math.random() * techs.length)];
}

function useSimulatedData() {
    console.log('使用模拟数据展示');
    // 确保today数据包含国内和海外新闻
    const overseasNews = newsData.today.filter(n => n.tags.region.includes('海外'));
    const domesticNews = newsData.today.filter(n => n.tags.region.includes('国内'));

    let dataUpdated = false;

    // 如果缺少某种地域的新闻，从其他时间线补充
    if (domesticNews.length === 0) {
        const allNews = [...newsData.yesterday, ...newsData.week, ...newsData.month];
        const domesticFromOther = allNews.filter(n => n.tags.region.includes('国内')).slice(0, 2);
        if (domesticFromOther.length > 0) {
            newsData.today = [...newsData.today, ...domesticFromOther];
            console.log('添加了模拟的国内新闻到today数据');
            dataUpdated = true;
        }
    }

    if (overseasNews.length === 0) {
        const allNews = [...newsData.yesterday, ...newsData.week, ...newsData.month];
        const overseasFromOther = allNews.filter(n => n.tags.region.includes('海外')).slice(0, 2);
        if (overseasFromOther.length > 0) {
            newsData.today = [...newsData.today, ...overseasFromOther];
            console.log('添加了模拟的海外新闻到today数据');
            dataUpdated = true;
        }
    }

    // 如果数据被更新，重新渲染
    if (dataUpdated) {
        const activeBtn = document.querySelector('.timeframe-btn.active');
        if (activeBtn) {
            const timeframe = activeBtn.getAttribute('data-timeframe');
            renderNewsList(timeframe);
            updateCharts();
            updateAnalysisContent();
        }
    }
}

// 基于真实新闻数据生成高级分析
function generateAdvancedAnalysis() {
    const allNews = [...newsData.today, ...newsData.yesterday, ...newsData.week, ...newsData.month];

    if (allNews.length === 0) {
        return `<div class="analysis-section">
            <p>暂无足够数据进行分析。请稍后刷新或检查数据源连接。</p>
        </div>`;
    }

    // 分析数据统计
    const regionStats = { 国内: 0, 海外: 0 };
    const domainStats = {};
    const importanceStats = { 高: 0, 中: 0, 低: 0 };
    const businessScores = allNews.filter(n => n.businessScore).map(n => n.businessScore);
    const avgBusinessScore = businessScores.length > 0 ?
        Math.round(businessScores.reduce((a, b) => a + b, 0) / businessScores.length) : 0;

    allNews.forEach(news => {
        if (news.tags) {
            // 地域统计
            if (news.tags.region) {
                news.tags.region.forEach(region => {
                    regionStats[region] = (regionStats[region] || 0) + 1;
                });
            }

            // 领域统计
            if (news.tags.domain) {
                news.tags.domain.forEach(domain => {
                    domainStats[domain] = (domainStats[domain] || 0) + 1;
                });
            }

            // 重要度统计
            if (news.tags.importance) {
                importanceStats[news.tags.importance] = (importanceStats[news.tags.importance] || 0) + 1;
            }
        }
    });

    // 找出热门领域
    const topDomains = Object.entries(domainStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([domain]) => domain);

    // 找出融资新闻
    const fundingNews = allNews.filter(n => n.funding);
    const totalFunding = fundingNews.length;

    // 生成分析内容
    const analysisHTML = `
        <div class="analysis-section">
            <h3><i class="fas fa-box"></i> 产品形态演变</h3>
            <div class="analysis-item">
                <p><strong>从${topDomains.length > 0 ? topDomains.join('、') : '通用大模型'}向垂直领域深化：</strong>基于${allNews.length}条AI新闻分析，当前产业正从"通用型"技术向"专业化"应用迁移。${
                    topDomains.includes('Agent') ? '以Agent为代表的智能体架构正在重塑企业工作流。' : ''
                }产品设计更强调对特定行业场景的深度理解与自动化，而非单纯的对话能力。</p>
            </div>
        </div>

        <div class="analysis-section">
            <h3><i class="fas fa-bullseye"></i> 商业重心</h3>
            <div class="analysis-item">
                <p><strong>商业化落地与投资回报成为核心：</strong>当前AI新闻中${Math.round((regionStats['国内'] / allNews.length) * 100)}%来自国内市场，${Math.round((regionStats['海外'] / allNews.length) * 100)}%来自海外。${
                    totalFunding > 0 ? `近期共有${totalFunding}起融资事件，显示资本市场对AI赛道的持续关注。` : ''
                }投资流向明确指向：${topDomains.slice(0, 2).map(d => `${d}`).join('、')}等领域。</p>
            </div>
        </div>

        <div class="analysis-section">
            <h3><i class="fas fa-microchip"></i> 能力迭代突破点</h3>
            <div class="analysis-item">
                <p><strong>技术演进呈现多元化特征：</strong>基于商业潜力评分（平均${avgBusinessScore}分），AI技术发展呈现以下特征：1) <strong>精度与效率平衡</strong>成为技术演进主旋律；2) <strong>行业适配性</strong>超越单纯的技术突破；3) <strong>安全合规</strong>${importanceStats['高'] > 5 ? '已成为高优先级议题' : '重要性逐步提升'}。技术演进从"规模竞赛"转向"价值创造"。</p>
            </div>
        </div>

        <div class="analysis-section">
            <h3><i class="fas fa-chess-queen"></i> 战略判断与启示</h3>
            <div class="analysis-item strategic-judgment">
                <h4>未来趋势预测：</h4>
                <ul>
                    <li><strong>地域差异化发展：</strong>国内${regionStats['国内'] > regionStats['海外'] ? '领先' : '追赶'}，海外${regionStats['海外'] > regionStats['国内'] ? '引领' : '并进'}，形成技术、市场、监管的多维度差异格局。</li>
                    <li><strong>垂直整合加速：</strong>随着${topDomains[0] || 'AI'}领域成熟度提升，未来3个月将有更多企业通过并购或转型切入相邻价值环节。</li>
                    <li><strong>算力与应用解耦：</strong>基础设施与应用服务的分离趋势明显，中小厂商可获得更灵活的部署选项。</li>
                </ul>

                <h4>对决策者的借鉴启示：</h4>
                <div class="fit-insight">
                    <p><strong>市场进入策略：</strong>关注${topDomains[0] || 'AI'}领域，结合${regionStats['国内'] > regionStats['海外'] ? '国内市场优势' : '海外技术领先'}，制定差异化竞争策略。</p>
                    <p><strong>技术投资方向：</strong>优先投资于${avgBusinessScore > 80 ? '高商业潜力' : '技术成熟'}领域，平衡短期回报与长期战略价值。</p>
                    <p><strong>风险管控重点：</strong>建立应对${importanceStats['高'] > 3 ? '高重要性议题' : '主要风险'}的预案体系，特别是政策变化与技术迭代带来的不确定性。</p>
                </div>
            </div>
        </div>

        <div class="analysis-footer">
            <p><i class="fas fa-user-tie"></i> <strong>分析视角：</strong>AI产业高级分析师 | 基于${allNews.length}条实时新闻数据生成智能分析</p>
            <p><i class="fas fa-calendar-alt"></i> <strong>分析周期：</strong>${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} | 动态更新频率：实时</p>
        </div>
    `;

    return analysisHTML;
}

// 更新分析内容（仅展示后端 analysisHtml；无内容时显示失败原因，不做本地兜底）
function updateAnalysisContent(externalHtml, externalError) {
    const analysisContainer = document.getElementById('dynamic-analysis');
    if (!analysisContainer) return;

    if (externalHtml) {
        analysisContainer.innerHTML = externalHtml;
    } else {
        analysisContainer.innerHTML = `
            <div class="analysis-empty-state">
                <h3><i class="fas fa-triangle-exclamation"></i> BA Insights 生成失败</h3>
                <p>当前未获取到后端生成的分析内容（analysisHtml 为空）。</p>
                <p>错误信息：${externalError || '后端未返回具体错误，请查看后端日志。'}</p>
                <p>常见原因：</p>
                <ul>
                    <li>刷新接口 <code>/api/refresh-dashboard</code> 调用失败；</li>
                    <li>后端调用模型失败或返回空内容；</li>
                    <li>当前读取到旧的 <code>daily_ai_dashboard.json</code>。</li>
                </ul>
                <p>请查看后端控制台日志后重新刷新。</p>
            </div>
        `;
    }
}

// 模拟未来可能的API集成
function simulateAPIIntegration() {
    console.log('In a production environment, this would:');
    console.log('1. Fetch from 36kr.com and TechCrunch RSS feeds every 24 hours');
    console.log('2. Parse and categorize AI-related articles');
    console.log('3. Store in database with timestamps');
    console.log('4. Update frontend via WebSocket or periodic refresh');
    console.log('5. Generate trend analysis using NLP models');
}

// 调用模拟函数
simulateAPIIntegration();