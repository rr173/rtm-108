class MirrorManagement {
  constructor() {
    this.documentId = null;
    this.document = null;
    this.mirrors = [];
    this.languages = [];
    this.claimStats = {};
    this.ws = null;
    this.currentUserId = localStorage.getItem('currentUserId') || 'user-admin';
    if (!localStorage.getItem('currentUserId')) {
      localStorage.setItem('currentUserId', 'user-admin');
    }
    this.currentUserName = '';
    this.currentUserRole = null;
    this.canManage = false;
    this.selectedMirrorId = null;
    this.selectedParagraphIds = [];
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
    await this.loadCurrentUser();
    this.initWebSocket();
    this.loadData();
  }

  async loadCurrentUser() {
    try {
      const res = await this.apiFetch('/api/current-user');
      if (res.ok) {
        const data = await res.json();
        if (data.user_id) {
          this.currentUserId = data.user_id;
        }
        this.currentUserName = data.user_name || this.currentUserId || '匿名用户';
      }
    } catch (e) {
      console.warn('获取当前用户信息失败:', e);
    }
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
        this.loadClaimStats();
        this.render();
      }
    }
  }

  async loadData() {
    try {
      const [docRes, mirrorsRes, langRes] = await Promise.all([
        this.apiFetch(`/api/documents/${this.documentId}`),
        this.apiFetch(`/api/documents/${this.documentId}/mirrors`),
        this.apiFetch('/api/languages')
      ]);

      if (!docRes.ok) throw new Error('加载文档失败');
      if (!mirrorsRes.ok) throw new Error('加载镜像列表失败');
      if (!langRes.ok) throw new Error('加载语言列表失败');

      this.document = await docRes.json();
      this.mirrors = await mirrorsRes.json();
      this.languages = await langRes.json();
      this.currentUserRole = this.document.current_user_role;
      this.canManage = this.document.current_user_role === 'owner';
      this.loadClaimStats();
      this.render();
    } catch (e) {
      this.showError(e.message);
    }
  }

  async loadClaimStats() {
    try {
      const res = await this.apiFetch(`/api/documents/${this.documentId}/claim-stats`);
      if (res.ok) {
        this.claimStats = await res.json();
      }
    } catch (e) {
      console.warn('加载认领统计失败:', e);
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
            ${this.currentUserName ? ` · 当前用户: ${this.escapeHtml(this.currentUserName)}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn" onclick="location.href='/workload/${this.documentId}'">
            📊 翻译负载视图
          </button>
          <button class="btn btn-primary" id="createMirrorBtn" style="background:white;color:#667eea;border-color:white;">
            ➕ 新建语言镜像
          </button>
        </div>
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

      const stats = this.claimStats[mirror.language_code];
      const claimedCount = stats?.claimed_count || 0;
      const unclaimedCount = stats?.unclaimed_count || 0;
      const byUser = stats?.by_user || [];

      html += `
        <div class="mirror-card ${this.selectedMirrorId === mirror.id ? 'selected' : ''}"
             data-mirror-id="${mirror.id}">
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
            <div class="mirror-stat claimed">
              <div class="value">${claimedCount}</div>
              <div class="label">已认领</div>
            </div>
            <div class="mirror-stat unclaimed">
              <div class="value">${unclaimedCount}</div>
              <div class="label">待认领</div>
            </div>
          </div>

          <div class="progress-bar">
            <div class="progress-bar-fill" style="width:${progress}%"></div>
          </div>
          <div class="progress-text">
            <span>同步进度</span>
            <span>${progress}% (${mirror.synchronized_paragraph_count}/${mirror.total_paragraph_count})</span>
          </div>

          ${byUser.length > 0 ? `
            <div class="claim-user-list">
              <div class="claim-user-title">👥 认领情况</div>
              ${byUser.map(u => `
                <div class="claim-user-item">
                  <span class="claim-user-name">${this.escapeHtml(u.user_name)}</span>
                  <span class="claim-user-count">${u.count} 段</span>
                  ${u.expired_count > 0 ? `<span class="claim-user-expired">⏰ ${u.expired_count} 超时</span>` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}

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
            ${this.canManage ? `
              <button class="btn btn-sm" onclick="window.management.showBatchAssignModal(${mirror.id})">
                📋 批量分配
              </button>
            ` : ''}
            <button class="btn btn-sm" onclick="window.management.showVersionHistory(${mirror.id})">
              📜 版本历史
            </button>
            ${this.canManage ? `
              <button class="btn btn-danger btn-sm" onclick="window.management.deleteMirror(${mirror.id})">
                🗑️
              </button>
            ` : ''}
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
      const res = await this.apiFetch(`/api/documents/${this.documentId}/mirrors`, {
        method: 'POST',
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

  async showBatchAssignModal(mirrorId) {
    try {
      const res = await this.apiFetch(`/api/mirrors/${mirrorId}/workbench`);
      if (!res.ok) throw new Error('加载镜像数据失败');
      const workbench = await res.json();

      const pendingParagraphs = workbench.paragraphs.filter(
        p => p.status === 'outdated' || p.status === 'new' || p.status === 'missing' || p.status === 'deleted_need_confirm'
      );

      const mirror = this.mirrors.find(m => m.id === mirrorId);

      let paragraphsHtml = '';
      pendingParagraphs.forEach(p => {
        const isClaimed = p.claim?.is_claimed;
        const claimant = p.claim?.claimed_by_name || p.claim?.claimed_by || '';
        const isExpired = p.claim?.is_expired;

        paragraphsHtml += `
          <label class="paragraph-assign-item">
            <input type="checkbox" class="paragraph-checkbox" value="${p.mapping_id}" 
                   ${!isClaimed || isExpired ? '' : 'disabled'}>
            <div class="paragraph-assign-content">
              <div class="paragraph-assign-header">
                <span class="line-num">L${p.master_line_index + 1}</span>
                <span class="status-tag ${p.status}">${this.getStatusText(p.status)}</span>
                ${isClaimed ? `
                  <span class="claim-tag ${isExpired ? 'expired' : ''}">
                    ${isExpired ? '⏰ 已超时' : `👤 ${claimant} 认领中`}
                  </span>
                ` : '<span class="claim-tag unclaimed">📭 待认领</span>'}
              </div>
              <div class="paragraph-assign-text">${this.escapeHtml(p.master_content)}</div>
            </div>
          </label>
        `;
      });

      if (pendingParagraphs.length === 0) {
        paragraphsHtml = '<p style="text-align:center;color:#94a3b8;padding:20px;">没有待处理的段落</p>';
      }

      const modalHtml = `
        <div class="modal-backdrop" id="batchAssignModal">
          <div class="modal" style="width:600px;max-height:80vh;">
            <div class="modal-header">
              <h3>📋 批量分配 - ${mirror?.language_flag || ''} ${mirror?.language_name || ''}</h3>
              <button class="modal-close" onclick="document.getElementById('batchAssignModal').remove()">×</button>
            </div>
            <div class="modal-body" style="max-height:50vh;overflow-y:auto;">
              <div class="form-group">
                <label>分配给</label>
                <input type="text" id="assignUserId" placeholder="输入用户ID" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:6px;">
                <small style="color:#64748b;">输入要分配给的翻译人员用户ID</small>
              </div>
              <div class="form-group">
                <label>选择要分配的段落 (${pendingParagraphs.length} 个待处理)</label>
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                  <button class="btn btn-sm" onclick="window.management.selectAllParagraphs()">全选可分配</button>
                  <button class="btn btn-sm" onclick="window.management.clearParagraphSelection()">清空</button>
                </div>
                <div class="paragraph-assign-list">
                  ${paragraphsHtml}
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn" onclick="document.getElementById('batchAssignModal').remove()">取消</button>
              <button class="btn btn-primary" onclick="window.management.confirmBatchAssign(${mirrorId})">确认分配</button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modalHtml);
    } catch (e) {
      this.showToast('❌ ' + e.message, 'error');
    }
  }

  selectAllParagraphs() {
    document.querySelectorAll('.paragraph-checkbox:not(:disabled)').forEach(cb => {
      cb.checked = true;
    });
  }

  clearParagraphSelection() {
    document.querySelectorAll('.paragraph-checkbox').forEach(cb => {
      cb.checked = false;
    });
  }

  async confirmBatchAssign(mirrorId) {
    const userId = document.getElementById('assignUserId').value.trim();
    if (!userId) {
      this.showToast('请输入用户ID', 'warning');
      return;
    }

    const selectedIds = Array.from(document.querySelectorAll('.paragraph-checkbox:checked'))
      .map(cb => parseInt(cb.value));

    if (selectedIds.length === 0) {
      this.showToast('请至少选择一个段落', 'warning');
      return;
    }

    try {
      const res = await this.apiFetch(`/api/mirrors/${mirrorId}/batch-assign`, {
        method: 'POST',
        body: JSON.stringify({
          user_id: userId,
          user_name: userId,
          mapping_ids: selectedIds
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '分配失败');

      this.showToast(`✅ 已成功分配 ${data.assigned_count} 个段落`, 'success');
      document.getElementById('batchAssignModal').remove();
      this.loadData();
    } catch (e) {
      this.showToast('❌ ' + e.message, 'error');
    }
  }

  async showVersionHistory(mirrorId) {
    try {
      const res = await this.apiFetch(`/api/mirrors/${mirrorId}/versions`);
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
      const res = await this.apiFetch(`/api/mirrors/${mirrorId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '删除失败');
      this.showToast('🗑️ 镜像已删除', 'success');
      this.loadData();
    } catch (e) {
      this.showToast('❌ ' + e.message, 'error');
    }
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
