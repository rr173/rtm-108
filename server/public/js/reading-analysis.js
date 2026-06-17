class ReadingAnalysis {
  constructor() {
    this.documentId = null;
    this.document = null;
    this.summary = null;
    this.readingStats = null;
    this.heatmapData = [];
    this.activeReaders = [];
    this.ws = null;
    this.currentUserId = localStorage.getItem('currentUserId') || 'user-admin';
    this.currentUserName = localStorage.getItem('currentUserName') || '当前用户';
    this.currentTab = 'overall';
    this.paragraphs = [];

    if (!localStorage.getItem('currentUserId')) {
      localStorage.setItem('currentUserId', 'user-admin');
    }

    this.init();
  }

  apiFetch(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (this.currentUserId) {
      headers['X-User-Id'] = this.currentUserId;
    }
    return fetch(url, { ...options, headers });
  }

  init() {
    const urlParams = new URLSearchParams(window.location.search);
    const pathMatch = window.location.pathname.match(/\/reading-analysis\/(\d+)/);
    this.documentId = pathMatch ? parseInt(pathMatch[1]) : parseInt(urlParams.get('docId') || urlParams.get('id'));

    if (!this.documentId) {
      alert('无效的文档ID');
      window.location.href = '/';
      return;
    }

    this.bindEvents();
    this.loadDocument();
    this.loadSummary();
    this.loadReadingStats();
    this.loadReadingGoal();
    this.connectWebSocket();
  }

  bindEvents() {
    document.getElementById('backBtn').addEventListener('click', () => {
      window.location.href = '/';
    });

    document.getElementById('viewDocBtn').addEventListener('click', () => {
      window.location.href = `/document/${this.documentId}`;
    });

    document.getElementById('refreshSummaryBtn').addEventListener('click', () => {
      this.loadSummary(true);
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    document.getElementById('setGoalBtn').addEventListener('click', () => {
      this.setReadingGoal();
    });
  }

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    this.renderSummary();
  }

  async loadDocument() {
    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}`);
      const data = await response.json();
      this.document = data;
      document.getElementById('documentTitle').textContent = data.title;
      this.parseParagraphs();
      this.renderDocument();
    } catch (e) {
      console.error('加载文档失败:', e);
      document.getElementById('documentContent').innerHTML = 
        '<div class="loading">加载失败，请刷新重试</div>';
    }
  }

  parseParagraphs() {
    if (!this.document || !this.document.versions || this.document.versions.length === 0) {
      return;
    }
    const content = this.document.versions[this.document.versions.length - 1].content;
    this.paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
  }

  renderDocument() {
    const container = document.getElementById('documentContent');
    if (this.paragraphs.length === 0) {
      container.innerHTML = '<div class="empty-state">文档内容为空</div>';
      return;
    }

    const heatmapMap = {};
    this.heatmapData.forEach(h => {
      heatmapMap[h.paragraph_index] = h;
    });

    let maxDwellTime = 0;
    this.heatmapData.forEach(h => {
      maxDwellTime = Math.max(maxDwellTime, h.total_dwell_time);
    });

    const html = this.paragraphs.map((para, index) => {
      const heatData = heatmapMap[index];
      let heatClass = 'cold';
      let dwellTime = 0;
      let readCount = 0;

      if (heatData) {
        dwellTime = heatData.total_dwell_time;
        readCount = heatData.read_count;
        const ratio = maxDwellTime > 0 ? dwellTime / maxDwellTime : 0;
        if (ratio > 0.8) {
          heatClass = 'hot';
        } else if (ratio > 0.6) {
          heatClass = 'warm';
        } else if (ratio > 0.4) {
          heatClass = 'mild';
        } else if (ratio > 0.2) {
          heatClass = 'cool';
        }
      }

      const minutes = Math.round(dwellTime / 60000);
      const metaText = heatData 
        ? `${readCount}人阅读 · ${minutes}分钟` 
        : '暂未阅读';

      return `
        <div class="heatmap-paragraph ${heatClass}" data-paragraph-index="${index}">
          <div class="paragraph-meta">${metaText}</div>
          <p>${this.escapeHtml(para)}</p>
        </div>
      `;
    }).join('');

    container.innerHTML = html;
  }

  async loadSummary(force = false) {
    try {
      const url = force 
        ? `/api/documents/${this.documentId}/summary?force=true` 
        : `/api/documents/${this.documentId}/summary`;
      const response = await this.apiFetch(url);
      this.summary = await response.json();
      this.renderSummary();
    } catch (e) {
      console.error('加载摘要失败:', e);
      document.getElementById('summaryContent').innerHTML = 
        '<div class="loading">生成摘要失败</div>';
    }
  }

  renderSummary() {
    const container = document.getElementById('summaryContent');
    if (!this.summary) {
      container.innerHTML = '<div class="loading">生成摘要中...</div>';
      return;
    }

    switch (this.currentTab) {
      case 'overall':
        this.renderOverallSummary(container);
        break;
      case 'sections':
        this.renderSectionSummaries(container);
        break;
      case 'paragraphs':
        this.renderParagraphSummaries(container);
        break;
    }
  }

  renderOverallSummary(container) {
    const stats = this.summary.stats || {};
    container.innerHTML = `
      <div class="overall-summary">
        <p>${this.escapeHtml(this.summary.overallSummary || '暂无摘要')}</p>
      </div>
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #e5e7eb; font-size: 11px; color: #9ca3af;">
        全文共 ${stats.totalParagraphs || 0} 段，${stats.totalSentences || 0} 句，${stats.totalWords || 0} 词
        <br>
        摘要抽取 ${stats.summarySentenceCount || 0} 句
      </div>
    `;
  }

  renderSectionSummaries(container) {
    const sections = this.summary.sectionSummaries || [];
    if (sections.length === 0) {
      container.innerHTML = '<div class="empty-state">未检测到章节结构</div>';
      return;
    }

    const html = sections.map(section => `
      <div class="section-summary-item">
        <div class="section-summary-title">${this.escapeHtml(section.title || '未命名章节')}</div>
        <div class="section-summary-text">${this.escapeHtml(section.summary || '')}</div>
      </div>
    `).join('');

    container.innerHTML = html;
  }

  renderParagraphSummaries(container) {
    const paragraphs = this.summary.paragraphSummaries || [];
    if (paragraphs.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无段落关键句</div>';
      return;
    }

    const html = paragraphs.map(para => `
      <div class="paragraph-summary-item">
        <div class="paragraph-index">${para.paragraphIndex + 1}</div>
        <div class="paragraph-key-sentence">${this.escapeHtml(para.keySentence || '')}</div>
      </div>
    `).join('');

    container.innerHTML = html;
  }

  async loadReadingStats() {
    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}/reading/stats`);
      this.readingStats = await response.json();
      this.renderReadingStats();
      this.renderParagraphChart();
    } catch (e) {
      console.error('加载阅读统计失败:', e);
    }
  }

  renderReadingStats() {
    if (!this.readingStats) return;

    document.getElementById('totalReaders').textContent = this.readingStats.total_readers || 0;
    document.getElementById('avgReadingTime').textContent = 
      (this.readingStats.avg_reading_time_minutes || 0).toFixed(1);
    document.getElementById('completionRate').textContent = 
      Math.round((this.readingStats.completion_rate || 0) * 100) + '%';
    document.getElementById('totalSessions').textContent = this.readingStats.total_sessions || 0;

    this.heatmapData = this.readingStats.heatmap || [];
    this.activeReaders = this.readingStats.active_readers || [];
    this.renderDocument();
    this.renderActiveReaders();
  }

  renderActiveReaders() {
    const countEl = document.getElementById('activeReadersCount');
    const listEl = document.getElementById('activeReadersList');

    countEl.textContent = this.activeReaders.length;

    const html = this.activeReaders.map(reader => {
      const initial = (reader.user_name || 'U').charAt(0).toUpperCase();
      const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
      const colorIndex = this.hashCode(reader.user_id || reader.user_name) % colors.length;
      return `
        <div class="reader-avatar" 
             data-name="${this.escapeHtml(reader.user_name || '匿名用户')}"
             style="background-color: ${colors[colorIndex]}">
          ${initial}
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;
  }

  renderParagraphChart() {
    const container = document.getElementById('paragraphChart');
    const heatmap = this.readingStats?.heatmap || [];

    if (heatmap.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无阅读数据</div>';
      return;
    }

    const maxDwellTime = Math.max(...heatmap.map(h => h.total_dwell_time), 1);

    const html = `
      <div class="chart-container">
        ${heatmap.slice(0, 20).map(h => {
          const percent = (h.total_dwell_time / maxDwellTime) * 100;
          const minutes = Math.round(h.total_dwell_time / 60000);
          return `
            <div class="chart-bar-item">
              <div class="chart-bar-label">第${h.paragraph_index + 1}段</div>
              <div class="chart-bar-wrapper">
                <div class="chart-bar-fill" style="width: ${percent}%"></div>
              </div>
              <div class="chart-bar-value">${minutes}分钟</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.innerHTML = html;
  }

  async loadReadingGoal() {
    try {
      const response = await this.apiFetch('/api/reading/goal');
      const goal = await response.json();
      
      document.getElementById('dailyGoalInput').value = goal.daily_words_goal || 2000;
      this.renderReadingProgress();
    } catch (e) {
      console.error('加载阅读目标失败:', e);
    }
  }

  async setReadingGoal() {
    const goalInput = document.getElementById('dailyGoalInput');
    const goalValue = parseInt(goalInput.value);

    if (isNaN(goalValue) || goalValue <= 0) {
      alert('请输入有效的目标字数');
      return;
    }

    try {
      const response = await this.apiFetch('/api/reading/goal', {
        method: 'PUT',
        body: JSON.stringify({ daily_words_goal: goalValue })
      });

      if (response.ok) {
        this.renderReadingProgress();
        this.showToast('目标设置成功');
      }
    } catch (e) {
      console.error('设置阅读目标失败:', e);
    }
  }

  async renderReadingProgress() {
    try {
      const response = await this.apiFetch('/api/reading/progress');
      const progress = await response.json();

      document.getElementById('wordsReadToday').textContent = progress.words_read_today || 0;
      document.getElementById('dailyGoal').textContent = progress.daily_goal || 2000;
      document.getElementById('goalProgressBar').style.width = progress.progress_percent + '%';
      document.getElementById('streakDays').textContent = `🔥 连续 ${progress.streak_days || 0} 天`;
      document.getElementById('estimatedTime').textContent = 
        `⏳ 预计剩余 ${progress.estimated_minutes_remaining?.toFixed(0) || 0} 分钟`;
    } catch (e) {
      console.error('加载阅读进度失败:', e);
    }
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.updateConnectionStatus(true);
      this.ws.send(JSON.stringify({
        type: 'subscribe_reading',
        documentId: this.documentId
      }));
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleWebSocketMessage(data);
      } catch (e) {
        console.error('WebSocket 消息解析失败:', e);
      }
    };

    this.ws.onclose = () => {
      this.updateConnectionStatus(false);
      setTimeout(() => this.connectWebSocket(), 3000);
    };

    this.ws.onerror = () => {
      this.updateConnectionStatus(false);
    };
  }

  handleWebSocketMessage(data) {
    switch (data.type) {
      case 'reading_status':
      case 'reading_updated':
        if (data.stats) {
          this.readingStats = data.stats;
          this.renderReadingStats();
          this.renderParagraphChart();
        }
        if (data.active_readers) {
          this.activeReaders = data.active_readers;
          this.renderActiveReaders();
        }
        if (data.heatmap) {
          this.heatmapData = data.heatmap;
          this.renderDocument();
        }
        break;
      case 'error':
        console.error('WebSocket 错误:', data.message);
        break;
    }
  }

  updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    const dotEl = statusEl.querySelector('.status-dot');
    const textEl = statusEl.querySelector('.status-text');

    if (connected) {
      dotEl.style.background = '#10b981';
      textEl.textContent = '已连接';
    } else {
      dotEl.style.background = '#ef4444';
      textEl.textContent = '连接断开';
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  showToast(message, type = 'info') {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ReadingAnalysis();
});
