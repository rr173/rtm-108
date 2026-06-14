class MirrorManagement {
  constructor() {
    this.documentId = null;
    this.document = null;
    this.mirrors = [];
    this.languages = [];
    this.ws = null;
    this.init();
  }

  init() {
    const path = window.location.pathname;
    const pathMatch = path.match(/\/mirrors\/(\d+)/);
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
    this.initWebSocket();
    this.loadData();
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
    if (data.type === 'document_mirrors_status' || data.type === 'document_mirrors_updated') {
      if (data.mirrors) {
        this.mirrors = data.mirrors;
        this.render();
      }
    }
  }

  async loadData() {
    try {
      const [docRes, mirrorsRes, langRes] = await Promise.all([
        fetch(`/api/documents/${this.documentId}`),
        fetch(`/api/documents/${this.documentId}/mirrors`),
        fetch('/api/languages')
      ]);

      if (!docRes.ok) throw new Error('加载文档失败');
      if (!mirrorsRes.ok) throw new Error('加载镜像列表失败');
      if (!langRes.ok) throw new Error('加载语言列表失败');

      this.document = await docRes.json();
      this.mirrors = await mirrorsRes.json();
      this.languages = await langRes.json();
      this.render();
    } catch (e) {
      this.showError(e.message);
    }
  }

  render() {
    this.renderHeader();
    this.renderMirrorList();
  }

  renderHeader() {
    const headerEl = document.getElementById('mirrorHeader');
    const doc = this.document;
    if (!doc) return;

    headerEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="breadcrumb">
            <a href="/">文档列表</a>
            <span>›</span>
            <span>${this.escapeHtml(doc.title)} · 多语言镜像管理</span>
          </div>
          <h1 style="margin:8px 0 4px;font-size:24px;">
            🌐 ${this.escapeHtml(doc.title)}
          </h1>
          <div style="margin-top:8px;font-size:14px;color:rgba(255,255,255,0.85);">
            当前主文档版本: <strong>v${doc.versions?.length || doc.latestVersion || 0}</strong>
            ${doc.description ? ` · ${this.escapeHtml(doc.description)}` : ''}
          </div>
        </div>
        <button class="btn btn-primary" id="createMirrorBtn" style="background:white;color:#667eea;border-color:white;">
          ➕ 新建语言镜像
        </button>
      </div>
    `;

    document.getElementById('createMirrorBtn').addEventListener('click', () => this.showCreateModal());
  }

  renderMirrorList() {
    const container = document.getElementById('mirrorList');
    const existingLangs = new Set(this.mirrors.map(m => m.language_code));

    if (this.mirrors.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="emoji">🌍</div>
          <h3>暂无语言镜像</h3>
          <p>点击右上角"新建语言镜像"开始多语言翻译工作</p>
        </div>
      `;
      return;
    }

    let html = `<div class="mirror-list">`;

    this.mirrors.forEach(mirror => {
      const progress = mirror.total_paragraph_count > 0
        ? Math.round(mirror.synchronized_paragraph_count / mirror.total_paragraph_count * 100)
        : 0;

      const syncBadgeClass = mirror.sync_status === 'synced' ? 'synced' :
                             mirror.sync_status === 'outdated' ? 'outdated' : 'pending';
      const syncBadgeText = mirror.sync_status === 'synced' ? '✅ 已同步' :
                            mirror.sync_status === 'outdated' ? '⚠️ 主文档已更新' : '⏳ 待同步';

      html += `
        <div class="mirror-card">
          <div class="mirror-card-header">
            <div class="mirror-language">
              <span class="flag">${mirror.language_flag}</span>
              <div class="info">
                <h3>${this.escapeHtml(mirror.language_name)}</h3>
                <div class="code">${mirror.language_code}</div>
              </div>
            </div>
            <span class="sync-status-badge ${syncBadgeClass}">
              <span class="dot"></span>${syncBadgeText}
            </span>
          </div>

          <div class="mirror-stats">
            <div class="mirror-stat synced">
              <div class="value">${mirror.synchronized_paragraph_count}</div>
              <div class="label">已同步</div>
            </div>
            <div class="mirror-stat pending">
              <div class="value">${mirror.pending_paragraph_count}</div>
              <div class="label">待处理</div>
            </div>
            <div class="mirror-stat outdated">
              <div class="value">${mirror.latest_master_version - mirror.synced_master_version}</div>
              <div class="label">落后版本</div>
            </div>
          </div>

          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${progress}%"></div>
          </div>
          <div class="progress-text">
            <span>同步进度</span>
            <span>${progress}% (${mirror.synchronized_paragraph_count}/${mirror.total_paragraph_count})</span>
          </div>

          <div class="version-info">
            <div class="row">
              <span class="label">镜像版本</span>
              <span>v${mirror.version_count}</span>
            </div>
            <div class="row">
              <span class="label">基于主文档</span>
              <span>v${mirror.synced_master_version}</span>
            </div>
            <div class="row">
              <span class="label">最新主文档</span>
              <span>v${mirror.latest_master_version}</span>
            </div>
            ${mirror.latest_mirror_version ? `
              <div class="row">
                <span class="label">最后更新</span>
                <span>${this.formatTime(mirror.latest_mirror_version.created_at)}</span>
              </div>
              <div class="row">
                <span class="label">提交者</span>
                <span>${this.escapeHtml(mirror.latest_mirror_version.created_by || '-')}</span>
              </div>
            ` : ''}
          </div>

          <div class="mirror-actions">
            <button class="btn btn-primary btn-sm" onclick="location.href='/translate/${mirror.id}'">
              🖊️ 翻译工作台
            </button>
            <button class="btn btn-sm" onclick="window.management.showVersionHistory(${mirror.id})">
              📜 版本历史
            </button>
            <button class="btn btn-danger btn-sm" onclick="window.management.deleteMirror(${mirror.id})">
              🗑️
            </button>
          </div>
        </div>
      `;
    });

    html += `</div>`;
    container.innerHTML = html;
  }

  showCreateModal() {
    const existingLangs = new Set(this.mirrors.map(m => m.language_code));
    const availableLangs = this.languages.filter(l => !existingLangs.has(l.code));

    if (availableLangs.length === 0) {
      this.showToast('所有支持的语言都已创建镜像', 'warning');
      return;
    }

    let optionsHtml = '';
    availableLangs.forEach((lang, idx) => {
      optionsHtml += `
        <label class="language-option ${idx === 0 ? 'selected' : ''}">
          <input type="radio" name="lang" value="${lang.code}" ${idx === 0 ? 'checked' : ''} style="display:none;">
          <span class="flag">${lang.flag}</span>
          <div class="info">
            <div class="name">${lang.name}</div>
            <div class="code">${lang.code}</div>
          </div>
        </label>
      `;
    });

    const modalHtml = `
      <div class="modal-backdrop" id="createModal">
        <div class="modal">
          <div class="modal-header">
            <h3>🌐 新建语言镜像</h3>
            <button class="modal-close" onclick="document.getElementById('createModal').remove()">×</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>选择目标语言</label>
              <div id="languageOptions">${optionsHtml}</div>
            </div>
            <div class="form-group">
              <label>初始译文（可选，逐行对应主文档）</label>
              <textarea id="initialContent" rows="6"
                placeholder="留空则创建空白镜像，逐段翻译..."></textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="document.getElementById('createModal').remove()">取消</button>
            <button class="btn btn-primary" onclick="window.management.confirmCreate()">创建镜像</button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    document.querySelectorAll('#languageOptions .language-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('#languageOptions .language-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        opt.querySelector('input').checked = true;
      });
    });
  }

  async confirmCreate() {
    const selected = document.querySelector('#languageOptions input[name="lang"]:checked');
    if (!selected) {
      this.showToast('请选择语言', 'warning');
      return;
    }
    const languageCode = selected.value;
    const initialContent = document.getElementById('initialContent').value || null;

    try {
      const res = await fetch(`/api/documents/${this.documentId}/mirrors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language_code: languageCode,
          initial_content: initialContent
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');

      document.getElementById('createModal').remove();
      this.showToast('✅ 镜像创建成功！', 'success');
      this.loadData();
    } catch (e) {
      this.showToast('❌ ' + e.message, 'error');
    }
  }

  async showVersionHistory(mirrorId) {
    try {
      const res = await fetch(`/api/mirrors/${mirrorId}/versions`);
      const versions = await res.json();
      if (!res.ok) throw new Error('加载版本历史失败');

      const mirror = this.mirrors.find(m => m.id === mirrorId);

      let historyHtml = '';
      if (versions.length === 0) {
        historyHtml = '<p style="text-align:center;color:#94a3b8;padding:20px;">暂无版本记录</p>';
      } else {
        historyHtml = '<ul class="version-history">';
        [...versions].reverse().forEach(v => {
          historyHtml += `
            <li class="version-history-item">
              <div class="version-dot"></div>
              <div class="version-content">
                <div class="version-title">
                  v${v.version_number} · 基于主文档 v${v.based_on_master_version}
                </div>
                <div class="version-meta">
                  ${this.escapeHtml(v.commit_message)} · ${this.escapeHtml(v.created_by)} · ${this.formatTime(v.created_at)}
                </div>
              </div>
            </li>
          `;
        });
        historyHtml += '</ul>';
      }

      const modalHtml = `
        <div class="modal-backdrop" id="historyModal">
          <div class="modal" style="width:560px;">
            <div class="modal-header">
              <h3>📜 ${mirror?.language_flag || ''} ${mirror?.language_name || ''} · 版本历史</h3>
              <button class="modal-close" onclick="document.getElementById('historyModal').remove()">×</button>
            </div>
            <div class="modal-body">
              ${historyHtml}
            </div>
            <div class="modal-footer">
              <button class="btn" onclick="document.getElementById('historyModal').remove()">关闭</button>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (e) {
      this.showToast('❌ ' + e.message, 'error');
    }
  }

  async deleteMirror(mirrorId) {
    const mirror = this.mirrors.find(m => m.id === mirrorId);
    if (!mirror) return;

    if (!confirm(`确定要删除 ${mirror.language_flag} ${mirror.language_name} 镜像吗？所有翻译内容将丢失。`)) {
      return;
    }

    try {
      const res = await fetch(`/api/mirrors/${mirrorId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '删除失败');
      this.showToast('🗑️ 镜像已删除', 'success');
      this.loadData();
    } catch (e) {
      this.showToast('❌ ' + e.message, 'error');
    }
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  formatTime(timestamp) {
    if (!timestamp) return '-';
    const d = new Date(timestamp);
    return d.toLocaleString('zh-CN');
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
}

document.addEventListener('DOMContentLoaded', () => {
  window.management = new MirrorManagement();
});
