class TranslationWorkload {
  constructor() {
    this.documentId = null;
    this.document = null;
    this.claimStats = {};
    this.ws = null;
    this.currentUserId = localStorage.getItem('currentUserId') || 'user-admin';
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

  async init() {
    const path = window.location.pathname;
    const pathMatch = path.match(/\/workload\/(\d+)/);
    const urlParams = new URLSearchParams(window.location.search);
    const docIdParam = urlParams.get('docId');

    if (pathMatch) {
      this.documentId = parseInt(pathMatch[1]);
    } else if (docIdParam) {
      this.documentId = parseInt(docIdParam);
    } else {
      this.showError('找不到文档ID');
      return;
    }

    this.initUserSelector();
    this.initWebSocket();
    await this.loadData();
    this.startAutoRefresh();
  }

  initUserSelector() {
    const selector = document.getElementById('currentUserSelect');
    if (selector) {
      selector.value = this.currentUserId;
    }
    window.changeCurrentUser = (userId) => {
      this.currentUserId = userId || '';
      localStorage.setItem('currentUserId', this.currentUserId);
      this.showToast(userId ? `已切换为用户: ${userId}` : '已切换为匿名用户', 'info');
      this.loadData();
    };
  }

  showToast(msg, type = 'success') {
    let container = document.getElementById('toastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toastContainer';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'subscribe_document_mirrors',
        documentId: this.documentId
      }));
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleWsMessage(data);
      } catch (e) {
        console.error('WebSocket消息解析失败:', e);
      }
    };
  }

  handleWsMessage(data) {
    const refreshEvents = [
      'document_mirrors_status',
      'document_mirrors_updated'
    ];

    if (refreshEvents.includes(data.type)) {
      this.loadClaimStats();
    }
  }

  async loadData() {
    return Promise.all([
      this.loadDocument(),
      this.loadClaimStats()
    ]).then(() => {
      this.render();
    });
  }

  async loadDocument() {
    try {
      const res = await this.apiFetch(`/api/documents/${this.documentId}`);
      if (res.ok) {
        this.document = await res.json();
      }
    } catch (e) {
      console.error('加载文档失败:', e);
    }
  }

  async loadClaimStats() {
    try {
      const res = await this.apiFetch(`/api/documents/${this.documentId}/claim-stats`);
      if (res.ok) {
        this.claimStats = await res.json();
        this.render();
      }
    } catch (e) {
      console.error('加载认领统计失败:', e);
    }
  }

  startAutoRefresh() {
    setInterval(() => {
      this.loadClaimStats();
    }, 30000);
  }

  render() {
    this.renderHeader();
    this.renderWorkload();
  }

  renderHeader() {
    const headerEl = document.getElementById('workloadHeader');
    if (!headerEl || !this.document) return;

    headerEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="breadcrumb">
            <a href="/">文档列表</a>
            <span>›</span>
            <a href="/mirrors/${this.documentId}">镜像管理</a>
            <span>›</span>
            <span>翻译负载视图</span>
          </div>
          <h1 style="margin:8px 0 4px;font-size:24px;">
            📊 ${this.escapeHtml(this.document.title)} · 翻译负载
          </h1>
          <div style="margin-top:8px;font-size:14px;color:#64748b;">
            实时查看各语言翻译人员的工作负载和超时情况
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" onclick="location.reload()">
            🔄 刷新
          </button>
          <button class="btn btn-primary" onclick="location.href='/mirrors/${this.documentId}'">
            ← 返回镜像管理
          </button>
        </div>
      </div>
    `;
  }

  renderWorkload() {
    const container = document.getElementById('workloadContainer');
    if (!container) return;

    const languages = Object.values(this.claimStats);
    
    if (languages.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="emoji">📭</div>
          <h3>暂无翻译数据</h3>
          <p>还没有创建任何语言镜像</p>
        </div>
      `;
      return;
    }

    let allUsers = {};
    languages.forEach(lang => {
      if (lang.by_user) {
        lang.by_user.forEach(user => {
          if (!allUsers[user.user_id]) {
            allUsers[user.user_id] = {
              user_id: user.user_id,
              user_name: user.user_name,
              total_count: 0,
              total_expired: 0,
              languages: []
            };
          }
          allUsers[user.user_id].total_count += user.count;
          allUsers[user.user_id].total_expired += user.expired_count;
          allUsers[user.user_id].languages.push({
            language_code: lang.language_code,
            language_name: lang.language_name,
            language_flag: lang.language_flag,
            count: user.count,
            expired_count: user.expired_count,
            avg_remaining_ms: user.avg_remaining_ms
          });
        });
      }
    });

    const userList = Object.values(allUsers).sort((a, b) => b.total_count - a.total_count);

    let html = `
      <div class="workload-summary">
        <div class="workload-summary-card">
          <div class="summary-icon">🌍</div>
          <div class="summary-info">
            <div class="summary-value">${languages.length}</div>
            <div class="summary-label">语言数量</div>
          </div>
        </div>
        <div class="workload-summary-card">
          <div class="summary-icon">👥</div>
          <div class="summary-info">
            <div class="summary-value">${userList.length}</div>
            <div class="summary-label">翻译人员</div>
          </div>
        </div>
        <div class="workload-summary-card">
          <div class="summary-icon">📝</div>
          <div class="summary-info">
            <div class="summary-value">${languages.reduce((sum, l) => sum + (l.claimed_count || 0), 0)}</div>
            <div class="summary-label">已认领段落</div>
          </div>
        </div>
        <div class="workload-summary-card warning">
          <div class="summary-icon">⏰</div>
          <div class="summary-info">
            <div class="summary-value">${languages.reduce((sum, l) => {
              const expired = l.by_user?.reduce((s, u) => s + u.expired_count, 0) || 0;
              return sum + expired;
            }, 0)}</div>
            <div class="summary-label">超时段落</div>
          </div>
        </div>
      </div>

      <h2 style="margin:24px 0 16px;font-size:18px;color:#1e293b;">👥 按人员统计</h2>
      <div class="user-workload-list">
    `;

    if (userList.length === 0) {
      html += `
        <div class="empty-state" style="padding:40px;">
          <div class="emoji">👤</div>
          <h3>暂无认领数据</h3>
          <p>还没有翻译人员认领段落</p>
        </div>
      `;
    } else {
      userList.forEach(user => {
        const workloadLevel = user.total_count > 10 ? 'high' : user.total_count > 5 ? 'medium' : 'low';
        const hasExpired = user.total_expired > 0;

        html += `
          <div class="user-workload-card ${hasExpired ? 'has-expired' : ''}">
            <div class="user-workload-header">
              <div class="user-info">
                <div class="user-avatar">${this.getAvatar(user.user_name)}</div>
                <div class="user-details">
                  <h3>${this.escapeHtml(user.user_name)}</h3>
                  <span class="user-id">${this.escapeHtml(user.user_id)}</span>
                </div>
              </div>
              <div class="user-stats">
                <div class="user-stat ${workloadLevel}">
                  <span class="stat-value">${user.total_count}</span>
                  <span class="stat-label">认领中</span>
                </div>
                ${hasExpired ? `
                  <div class="user-stat expired">
                  <span class="stat-value">${user.total_expired}</span>
                  <span class="stat-label">超时</span>
                </div>
                ` : ''}
              </div>
            </div>
            <div class="user-language-list">
              ${user.languages.map(lang => `
                <div class="user-language-item">
                  <span class="lang-flag">${lang.language_flag}</span>
                  <span class="lang-name">${lang.language_name}</span>
                  <span class="lang-count">${lang.count} 段</span>
                  ${lang.expired_count > 0 ? `
                    <span class="lang-expired">⏰ ${lang.expired_count} 超时</span>
                  ` : ''}
                  <div class="lang-time">
                    平均剩余: ${this.formatDuration(lang.avg_remaining_ms)}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      });
    }

    html += `</div>`;

    html += `<h2 style="margin:32px 0 16px;font-size:18px;color:#1e293b;">🌐 按语言统计</h2>`;
    html += `<div class="language-workload-list">`;

    languages.forEach(lang => {
      html += `
        <div class="language-workload-card">
          <div class="lang-header">
            <span class="lang-flag-large">${lang.language_flag}</span>
            <div class="lang-info">
              <h3>${lang.language_name}</h3>
              <span class="lang-code">${lang.language_code}</span>
            </div>
          </div>
          <div class="lang-stats-row">
            <div class="lang-stat">
              <span class="lang-value">${lang.total_pending || 0}</span>
              <span class="lang-stat-label">待处理</span>
            </div>
            <div class="lang-stat">
              <span class="lang-value claimed">${lang.claimed_count || 0}</span>
              <span class="lang-stat-label">已认领</span>
            </div>
            <div class="lang-stat">
              <span class="lang-value unclaimed">${lang.unclaimed_count || 0}</span>
              <span class="lang-stat-label">待认领</span>
            </div>
          </div>
          ${lang.by_user && lang.by_user.length > 0 ? `
            <div class="lang-user-list">
              <div class="lang-user-title">认领人员</div>
              ${lang.by_user.map(user => `
                <div class="lang-user-item">
                <span class="lang-user-name">${this.escapeHtml(user.user_name)}</span>
                <span class="lang-user-count">${user.count} 段</span>
                ${user.expired_count > 0 ? `<span class="lang-user-expired">⏰ ${user.expired_count}</span>` : ''}
              </div>
              `).join('')}
            </div>
          ` : '<div class="lang-no-users">暂无认领人员</div>'}
          <div class="lang-actions">
            <button class="btn btn-sm btn-primary" onclick="location.href='/translate/${lang.mirror_id}'">
              进入工作台
            </button>
          </div>
        </div>
      `;
    });

    html += `</div>`;

    container.innerHTML = html;
  }

  getAvatar(name) {
    if (!name) return '👤';
    return name.charAt(0).toUpperCase();
  }

  formatDuration(ms) {
    if (!ms || ms <= 0) return '已超时';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}小时${minutes}分`;
    } else {
      return `${minutes}分钟`;
    }
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  showError(msg) {
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <div class="empty-state">
        <div class="emoji">😢</div>
        <h3>出错了</h3>
        <p>${this.escapeHtml(msg)}</p>
        <a class="btn btn-primary" href="/" style="margin-top:16px;">返回首页</a>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.workload = new TranslationWorkload();
});
