class TranslationWorkbench {
  constructor() {
    this.mirrorId = null;
    this.workbench = null;
    this.ws = null;
    this.filters = {
      showAll: true,
      showOutdated: false,
      showNew: false,
      showDeleted: false,
      showSynced: false
    };
    this.init();
  }

  init() {
    const path = window.location.pathname;
    const pathMatch = path.match(/\/translate\/(\d+)/);
    const urlParams = new URLSearchParams(window.location.search);
    const mirrorIdParam = urlParams.get('mirrorId');

    if (pathMatch) {
      this.mirrorId = parseInt(pathMatch[1]);
    } else if (mirrorIdParam) {
      this.mirrorId = parseInt(mirrorIdParam);
    } else {
      this.showError('找不到镜像ID');
      return;
    }
    this.initWebSocket();
    this.loadWorkbench();
    this.bindEvents();
  }

  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({
        type: 'subscribe_mirror',
        mirrorId: this.mirrorId
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
      'mirror_status',
      'mirror_updated',
      'master_updated',
      'mirror_workbench_updated',
      'paragraph_translated',
      'paragraph_deletion_confirmed',
      'mirror_version_created'
    ];

    if (refreshEvents.includes(data.type)) {
      if (data.workbench) {
        this.workbench = data.workbench;
        this.render();
        this.showToast('数据已自动刷新', 'success');
      } else if (data.mappingId) {
        this.loadWorkbench();
      }
    }
  }

  async loadWorkbench() {
    try {
      const res = await fetch(`/api/mirrors/${this.mirrorId}/workbench`);
      if (!res.ok) throw new Error('加载工作台失败');
      this.workbench = await res.json();
      this.render();
    } catch (e) {
      this.showError(e.message);
    }
  }

  render() {
    if (!this.workbench) return;
    this.renderHeader();
    this.renderToolbar();
    this.renderPanels();
  }

  renderHeader() {
    const { mirror, master_document, stats } = this.workbench;
    const headerEl = document.getElementById('workbenchHeader');

    const syncBadgeClass = mirror.sync_status === 'synced' ? 'synced' :
                           mirror.sync_status === 'outdated' ? 'outdated' : 'pending';
    const syncBadgeText = mirror.sync_status === 'synced' ? '已同步' :
                          mirror.sync_status === 'outdated' ? '主文档已更新' : '待同步';

    headerEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <div class="breadcrumb">
            <a href="/">文档列表</a>
            <span>›</span>
            <a href="/mirrors/${master_document.id}">镜像管理</a>
            <span>›</span>
            <span>${mirror.language_flag} ${mirror.language_name} 翻译工作台</span>
          </div>
          <h1 style="margin:8px 0 4px;font-size:24px;">
            ${mirror.language_flag} ${mirror.language_name} · ${master_document.title}
          </h1>
          <div style="display:flex;align-items:center;gap:16px;margin-top:8px;font-size:14px;color:#64748b;">
            <span class="sync-status-badge ${syncBadgeClass}">
              <span class="dot"></span>${syncBadgeText}
            </span>
            <span>主文档版本: v${master_document.latest_version}</span>
            <span>同步到: v${mirror.synced_master_version}</span>
            <span>镜像版本: v${mirror.version_count}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" onclick="location.reload()">
            🔄 刷新
          </button>
          <button class="btn btn-success" id="submitVersionBtn"
                  ${stats.pending > 0 ? 'disabled' : ''}>
            ✅ 发布同步版本
          </button>
        </div>
      </div>
    `;

    document.getElementById('submitVersionBtn')?.addEventListener('click', () => this.submitVersion());
  }

  renderToolbar() {
    const { stats } = this.workbench;
    const toolbar = document.getElementById('workbenchToolbar');

    const isActive = (key) => this.filters[key] ? 'active' : '';

    toolbar.innerHTML = `
      <div class="filter-group">
        <label>筛选:</label>
        <button class="filter-toggle ${isActive('showAll')}" data-filter="showAll">
          全部
        </button>
        <button class="filter-toggle ${isActive('showOutdated')}" data-filter="showOutdated">
          🔴 过期 (${stats.outdated})
        </button>
        <button class="filter-toggle ${isActive('showNew')}" data-filter="showNew">
          🔵 新增 (${stats.new})
        </button>
        <button class="filter-toggle ${isActive('showDeleted')}" data-filter="showDeleted">
          🟣 删除确认 (${stats.deleted_need_confirm})
        </button>
        <button class="filter-toggle ${isActive('showSynced')}" data-filter="showSynced">
          🟢 已同步 (${stats.synchronized})
        </button>
      </div>
      <div class="stats-summary" style="margin-left:auto;">
        <div class="stat-chip total">总计: ${stats.total}</div>
        <div class="stat-chip pending">待处理: ${stats.pending}</div>
        <div class="stat-chip done">完成: ${stats.synchronized}</div>
      </div>
    `;

    toolbar.querySelectorAll('.filter-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        if (filter === 'showAll') {
          Object.keys(this.filters).forEach(k => this.filters[k] = k === 'showAll');
        } else {
          this.filters.showAll = false;
          this.filters[filter] = !this.filters[filter];
          const anyActive = ['showOutdated', 'showNew', 'showDeleted', 'showSynced']
            .some(k => this.filters[k]);
          if (!anyActive) this.filters.showAll = true;
        }
        this.renderToolbar();
        this.renderPanels();
      });
    });
  }

  shouldShowParagraph(p) {
    if (this.filters.showAll) return true;
    if (this.filters.showOutdated && p.status === 'outdated') return true;
    if (this.filters.showNew && (p.status === 'new' || p.status === 'missing')) return true;
    if (this.filters.showDeleted && p.status === 'deleted_need_confirm') return true;
    if (this.filters.showSynced && p.status === 'synchronized') return true;
    return false;
  }

  renderPanels() {
    const { paragraphs, stats } = this.workbench;
    const masterPanel = document.getElementById('masterPanel');
    const targetPanel = document.getElementById('targetPanel');

    const filteredParagraphs = paragraphs.filter(p => this.shouldShowParagraph(p));

    if (filteredParagraphs.length === 0) {
      const empty = `
        <div class="empty-state">
          <div class="emoji">🎉</div>
          <h3>没有符合筛选条件的段落</h3>
          <p>请调整筛选条件查看更多内容</p>
        </div>
      `;
      masterPanel.innerHTML = empty;
      targetPanel.innerHTML = empty;
      return;
    }

    let masterHtml = '';
    let targetHtml = '';

    filteredParagraphs.forEach(p => {
      const statusClass = `status-${p.status}`;
      const statusText = this.getStatusText(p.status);
      const tagClass = p.status;

      masterHtml += `
        <div class="paragraph-row ${statusClass}">
          <div class="paragraph-cell">
            <div class="paragraph-meta">
              <span class="line-number">L${p.master_line_index + 1}</span>
              <span class="paragraph-tag ${tagClass}">${statusText}</span>
            </div>
            ${p.previous_master_content ? `
              <div class="paragraph-text previous-content">
                ${this.escapeHtml(p.previous_master_content)}
              </div>
            ` : ''}
            <div class="paragraph-text">${this.escapeHtml(p.master_content)}</div>
          </div>
        </div>
      `;

      targetHtml += `
        <div class="paragraph-row ${statusClass}">
          <div class="paragraph-cell">
            <div class="paragraph-meta">
              <span class="line-number">L${p.master_line_index + 1}</span>
              <span class="paragraph-tag ${tagClass}">${statusText}</span>
            </div>
            ${this.renderTargetCell(p)}
          </div>
        </div>
      `;
    });

    masterPanel.innerHTML = masterHtml;
    targetPanel.innerHTML = targetHtml;

    this.bindTranslationEvents();
  }

  renderTargetCell(p) {
    if (p.status === 'synchronized') {
      return `
        <div class="paragraph-text">${this.escapeHtml(p.translated_content || '(空)')}</div>
        ${p.translator ? `<div class="translator-info">由 ${this.escapeHtml(p.translator)} 翻译 · ${this.formatTime(p.translated_at)}</div>` : ''}
      `;
    }

    if (p.status === 'deleted_need_confirm') {
      return `
        <div class="paragraph-text" style="margin-bottom:8px;">
          ${this.escapeHtml(p.translated_content || '(已翻译，主文档已删除此段)')}
        </div>
        <div class="translation-actions">
          <button class="btn btn-sm btn-danger" data-action="confirm-delete" data-id="${p.mapping_id}">
            确认删除
          </button>
          <button class="btn btn-sm" data-action="cancel-delete" data-id="${p.mapping_id}">
            保留并重新翻译
          </button>
        </div>
        ${p.translator ? `<div class="translator-info">原翻译: ${this.escapeHtml(p.translator)}</div>` : ''}
      `;
    }

    const inputClass = p.status === 'outdated' ? 'outdated' : (p.status === 'new' || p.status === 'missing' ? 'new' : '');
    const placeholder = p.status === 'outdated'
      ? '主文档已更新，请重新翻译此段...'
      : '请输入译文...';

    return `
      ${p.previous_translation ? `
        <div class="paragraph-text previous-content">
          原译文: ${this.escapeHtml(p.previous_translation)}
        </div>
      ` : ''}
      <textarea class="translation-input ${inputClass}"
                data-id="${p.mapping_id}"
                placeholder="${placeholder}"
                rows="3">${this.escapeHtml(p.translated_content || '')}</textarea>
      <div class="translation-actions">
        <button class="btn btn-sm btn-primary" data-action="submit-translation" data-id="${p.mapping_id}">
          ✅ 提交译文
        </button>
      </div>
    `;
  }

  bindTranslationEvents() {
    document.querySelectorAll('[data-action="submit-translation"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        const textarea = document.querySelector(`textarea[data-id="${id}"]`);
        const content = textarea?.value || '';
        this.submitTranslation(id, content);
      });
    });

    document.querySelectorAll('[data-action="confirm-delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        this.confirmDelete(id, true);
      });
    });

    document.querySelectorAll('[data-action="cancel-delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        this.confirmDelete(id, false);
      });
    });

    document.querySelectorAll('.translation-input').forEach(textarea => {
      textarea.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
          e.preventDefault();
          const id = parseInt(textarea.dataset.id);
          this.submitTranslation(id, textarea.value);
        }
      });
    });
  }

  async submitTranslation(mappingId, content) {
    try {
      const res = await fetch(`/api/mirrors/${this.mirrorId}/paragraphs/${mappingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ translated_content: content })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '提交失败');
      this.showToast('✅ 译文已提交', 'success');
      this.loadWorkbench();
    } catch (e) {
      this.showToast('❌ ' + e.message, 'error');
    }
  }

  async confirmDelete(mappingId, confirm) {
    try {
      const res = await fetch(`/api/mirrors/${this.mirrorId}/paragraphs/${mappingId}/confirm-delete`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '操作失败');
      this.showToast(confirm ? '🗑️ 已确认删除' : '📝 已转为待翻译', 'success');
      this.loadWorkbench();
    } catch (e) {
      this.showToast('❌ ' + e.message, 'error');
    }
  }

  async submitVersion() {
    const message = prompt('请输入版本提交说明（可选）:', '');
    if (message === null) return;

    try {
      const res = await fetch(`/api/mirrors/${this.mirrorId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commit_message: message })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.pending_count !== undefined) {
          throw new Error(`还有 ${data.pending_count} 个段落待同步`);
        }
        throw new Error(data.error || '提交失败');
      }
      this.showToast('🎉 新版本已发布！', 'success');
      this.loadWorkbench();
    } catch (e) {
      this.showToast('❌ ' + e.message, 'error');
    }
  }

  bindEvents() {
  }

  getStatusText(status) {
    const map = {
      'synchronized': '已同步',
      'outdated': '已过期',
      'new': '新增',
      'missing': '新增',
      'deleted_need_confirm': '待确认删除',
      'deleted': '已删除'
    };
    return map[status] || status;
  }

  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  formatTime(timestamp) {
    if (!timestamp) return '';
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
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.workbench = new TranslationWorkbench();
});
