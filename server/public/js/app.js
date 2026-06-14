let signerCounter = 0;

const statusMap = {
  draft: { label: '草稿', class: 'status-draft' },
  signing: { label: '签署中', class: 'status-signing' },
  completed: { label: '已完成', class: 'status-completed' },
  expired: { label: '已过期', class: 'status-expired' }
};

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

async function loadContracts() {
  try {
    const res = await fetch('/api/contracts');
    const contracts = await res.json();
    renderContracts(contracts);
  } catch (e) {
    console.error('加载合同失败:', e);
    document.getElementById('contractList').innerHTML = `
      <div class="empty-state">
        <h3>加载失败</h3>
        <p>请刷新页面重试</p>
      </div>
    `;
  }
}

function renderContracts(contracts) {
  const listEl = document.getElementById('contractList');
  
  if (!contracts || contracts.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <h3>暂无合同</h3>
        <p>点击右上角「新建合同」创建第一份合同</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = contracts.map(c => {
    const status = statusMap[c.status] || { label: c.status, class: '' };
    const progress = c.totalSigners > 0 ? (c.signedCount / c.totalSigners * 100) : 0;
    
    let deadlineText = '-';
    if (c.deadline) {
      const diff = c.deadline - Date.now();
      if (diff <= 0) {
        deadlineText = '已过期';
      } else {
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        deadlineText = days > 0 ? `剩余 ${days} 天 ${hours} 小时` : `剩余 ${hours} 小时`;
      }
    }

    const unreadCount = c.unreadNotificationCount || 0;
    
    return `
      <div class="card contract-card" onclick="viewContract(${c.id})" style="position: relative;">
        <span class="status-badge ${status.class}">${status.label}</span>
        ${unreadCount > 0 ? `<span class="notification-badge">${unreadCount}</span>` : ''}
        <div class="card-title">${escapeHtml(c.title)}</div>
        <div class="contract-meta">
          <span>签署进度: ${c.signedCount}/${c.totalSigners} 人</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress}%"></div>
        </div>
        <div class="contract-meta" style="margin-top: 12px;">
          <span>截止: ${deadlineText}</span>
          <span>创建: ${formatDate(c.created_at)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function viewContract(id) {
  window.location.href = `/contract/${id}`;
}

function showCreateModal() {
  document.getElementById('createModal').classList.add('active');
  signerCounter = 0;
  document.getElementById('signersFormList').innerHTML = '';
  document.getElementById('newTitle').value = '';
  document.getElementById('newContent').value = '';
  document.getElementById('newDeadlineDays').value = '7';
  addSignerRow();
  addSignerRow();
  addSignerRow();
}

function hideCreateModal() {
  document.getElementById('createModal').classList.remove('active');
}

function closeModalOutside(event) {
  if (event.target.classList.contains('modal-overlay')) {
    hideCreateModal();
  }
}

function addSignerRow() {
  signerCounter++;
  const idx = signerCounter;
  const listEl = document.getElementById('signersFormList');
  
  const defaultX = 60;
  const defaultY = 100 + (idx - 1) * 100;
  
  const row = document.createElement('div');
  row.className = 'signer-form-row';
  row.dataset.index = idx;
  row.style.cssText = 'border: 1px solid #e8e8e8; border-radius: 10px; padding: 12px; background: #fafafa;';
  
  row.innerHTML = `
    <div style="display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px;">
      <span style="background: #667eea; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0; margin-top: 4px;">${idx}</span>
      <div style="flex: 1; display: flex; flex-direction: column; gap: 6px;">
        <input type="text" class="signer-name" placeholder="姓名" 
               style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
        <input type="email" class="signer-email" placeholder="邮箱" 
               style="padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
      </div>
      <button onclick="removeSignerRow(${idx})" 
              style="background: none; border: none; color: #ff4d4f; cursor: pointer; font-size: 18px; padding: 4px 8px;">×</button>
    </div>
    <div style="margin-left: 34px;">
      <button type="button" onclick="toggleSignArea(${idx})" 
              style="background: none; border: none; color: #667eea; cursor: pointer; font-size: 12px; padding: 0;">
        ▾ 签署区域设置
      </button>
      <div class="sign-area-settings" id="signArea-${idx}" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #e0e0e0;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>
            <label style="font-size: 11px; color: #999;">X 坐标 (px)</label>
            <input type="number" class="signer-x" value="${defaultX}" min="0" 
                   style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;">
          </div>
          <div>
            <label style="font-size: 11px; color: #999;">Y 坐标 (px)</label>
            <input type="number" class="signer-y" value="${defaultY}" min="0" 
                   style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;">
          </div>
          <div>
            <label style="font-size: 11px; color: #999;">宽度 (px)</label>
            <input type="number" class="signer-width" value="180" min="50" 
                   style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;">
          </div>
          <div>
            <label style="font-size: 11px; color: #999;">高度 (px)</label>
            <input type="number" class="signer-height" value="70" min="30" 
                   style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 6px; font-size: 12px;">
          </div>
        </div>
      </div>
    </div>
  `;
  
  listEl.appendChild(row);
}

function removeSignerRow(idx) {
  const rows = document.querySelectorAll('.signer-form-row');
  if (rows.length <= 1) {
    showToast('至少需要一位签署人', 'error');
    return;
  }
  const row = document.querySelector(`.signer-form-row[data-index="${idx}"]`);
  if (row) row.remove();
  updateSignerOrder();
}

function toggleSignArea(idx) {
  const settings = document.getElementById(`signArea-${idx}`);
  if (settings) {
    settings.style.display = settings.style.display === 'none' ? 'block' : 'none';
  }
}

function updateSignerOrder() {
  const rows = document.querySelectorAll('.signer-form-row');
  rows.forEach((row, i) => {
    const badge = row.querySelector('span');
    if (badge) badge.textContent = i + 1;
  });
}

async function createContract() {
  const title = document.getElementById('newTitle').value.trim();
  const content = document.getElementById('newContent').value.trim();
  const days = parseInt(document.getElementById('newDeadlineDays').value) || 7;
  const reminderHours = parseFloat(document.getElementById('newReminderHours').value);

  if (!title) {
    showToast('请输入合同标题', 'error');
    return;
  }
  if (!content) {
    showToast('请输入合同内容', 'error');
    return;
  }

  const rows = document.querySelectorAll('.signer-form-row');
  const signers = [];
  
  rows.forEach((row, i) => {
    const name = row.querySelector('.signer-name').value.trim();
    const email = row.querySelector('.signer-email').value.trim();
    const x = parseFloat(row.querySelector('.signer-x').value) || 60;
    const y = parseFloat(row.querySelector('.signer-y').value) || 100;
    const w = parseFloat(row.querySelector('.signer-width').value) || 180;
    const h = parseFloat(row.querySelector('.signer-height').value) || 70;
    
    signers.push({
      name: name || `签署人${i+1}`,
      email: email || `signer${i+1}@example.com`,
      order_index: i,
      signArea: { x, y, width: w, height: h }
    });
  });

  if (signers.length === 0) {
    showToast('请至少添加一位签署人', 'error');
    return;
  }

  const deadline = Date.now() + days * 24 * 60 * 60 * 1000;

  try {
    const res = await fetch('/api/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, signers, deadline, reminderHours })
    });
    
    if (!res.ok) throw new Error('创建失败');
    
    const contract = await res.json();
    
    await fetch(`/api/contracts/${contract.id}/start`, { method: 'POST' });
    
    showToast('合同创建成功', 'success');
    hideCreateModal();
    loadContracts();
  } catch (e) {
    showToast('创建失败: ' + e.message, 'error');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  ['contracts', 'documents', 'i18n-demo'].forEach(tab => {
    const el = document.getElementById('tab-' + tab);
    if (el) {
      el.style.display = tab === tabName ? 'block' : 'none';
    }
  });

  if (tabName === 'documents' && !window._docsLoaded) {
    loadDocuments();
    window._docsLoaded = true;
  }
  if (tabName === 'i18n-demo' && !window._i18nLoaded) {
    loadI18nDemo();
    window._i18nLoaded = true;
  }
}

function showCreateDocModal() {
  document.getElementById('createDocModal').classList.add('active');
  document.getElementById('newDocTitle').value = '';
  document.getElementById('newDocDesc').value = '';
  document.getElementById('newDocContent').value = '';
}

function hideCreateDocModal() {
  document.getElementById('createDocModal').classList.remove('active');
}

async function loadDocuments() {
  try {
    const res = await fetch('/api/documents');
    const docs = await res.json();
    renderDocuments(docs);
  } catch (e) {
    console.error('加载文档失败:', e);
    document.getElementById('documentList').innerHTML = `
      <div class="empty-state">
        <h3>加载失败</h3>
        <p>请刷新页面重试</p>
      </div>
    `;
  }
}

function renderDocuments(docs) {
  const listEl = document.getElementById('documentList');

  if (!docs || docs.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state" style="grid-column: 1/-1;">
        <h3>暂无文档</h3>
        <p>点击「新建文档」创建第一份文档</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = docs.map(d => {
    const latestVer = d.versions && d.versions.length > 0 ? d.versions[d.versions.length - 1] : null;
    return `
      <div class="card contract-card" style="cursor:pointer;" onclick="viewDocument(${d.id})">
        <div class="card-title">${escapeHtml(d.title)}</div>
        ${d.description ? `<div style="font-size:13px;color:#64748b;margin-bottom:12px;">${escapeHtml(d.description)}</div>` : ''}
        <div class="contract-meta">
          <span>📝 v${d.latestVersion || d.versionCount || 0} 版本</span>
        </div>
        <div class="contract-meta" style="margin-top: 8px;">
          <span>最后更新: ${formatDate(d.updated_at)}</span>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <a class="btn btn-sm" href="/diff/${d.id}"
             onclick="event.stopPropagation();"
             style="padding:6px 12px;font-size:12px;">
            📜 版本管理
          </a>
          <a class="btn btn-sm btn-primary" href="/mirrors/${d.id}"
             onclick="event.stopPropagation();"
             style="padding:6px 12px;font-size:12px;background:#667eea;border-color:#667eea;">
            🌐 镜像管理
          </a>
        </div>
      </div>
    `;
  }).join('');
}

function viewDocument(id) {
  window.location.href = `/diff/${id}`;
}

async function createDocument() {
  const title = document.getElementById('newDocTitle').value.trim();
  const content = document.getElementById('newDocContent').value;
  const description = document.getElementById('newDocDesc').value.trim();

  if (!title) {
    showToast('请输入文档标题', 'error');
    return;
  }
  if (!content) {
    showToast('请输入文档内容', 'error');
    return;
  }

  try {
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        content,
        description,
        is_public: true
      })
    });

    if (!res.ok) throw new Error('创建失败');

    showToast('文档创建成功', 'success');
    hideCreateDocModal();
    loadDocuments();
  } catch (e) {
    showToast('创建失败: ' + e.message, 'error');
  }
}

let demoWs = null;

async function loadI18nDemo() {
  try {
    const demoDocId = 1;
    const [mirrorsRes, docRes] = await Promise.all([
      fetch(`/api/documents/${demoDocId}/mirrors`),
      fetch(`/api/documents/${demoDocId}`)
    ]);

    const mirrors = await mirrorsRes.json();
    let doc = null;
    if (docRes.ok) doc = await docRes.json();

    initDemoWs(demoDocId);
    renderDemoMirrors(mirrors, doc);
  } catch (e) {
    console.error('加载演示镜像失败:', e);
    document.getElementById('demoMirrorList').innerHTML = `
      <p style="text-align:center;color:#ef4444;">加载演示数据失败: ${escapeHtml(e.message)}</p>
    `;
  }
}

function initDemoWs(docId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  demoWs = new WebSocket(`${protocol}//${window.location.host}/ws`);

  demoWs.onopen = () => {
    demoWs.send(JSON.stringify({
      type: 'subscribe_document_mirrors',
      documentId: docId
    }));
  };

  demoWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'document_mirrors_status' || data.type === 'document_mirrors_updated') {
        if (data.mirrors) {
          fetch(`/api/documents/${docId}`).then(r => r.ok ? r.json() : null).then(doc => {
            renderDemoMirrors(data.mirrors, doc);
          });
        }
      }
    } catch (e) {
      console.error('WS消息解析失败:', e);
    }
  };
}

function renderDemoMirrors(mirrors, doc) {
  const container = document.getElementById('demoMirrorList');

  if (!doc) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">📋</div>
        <h3>演示主文档不存在</h3>
        <p>请先确保已正确初始化演示数据</p>
      </div>
    `;
    return;
  }

  const docCard = `
    <div style="padding:16px;background:#f8fafc;border-radius:12px;margin-bottom:20px;border:1px solid #e2e8f0;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-size:13px;color:#64748b;">📄 主文档</div>
          <div style="font-size:18px;font-weight:600;margin-top:4px;">${escapeHtml(doc.title)}</div>
          <div style="font-size:13px;color:#64748b;margin-top:4px;">
            当前版本: <strong>v${doc.versions?.length || doc.latestVersion || 0}</strong> · ${doc.description || ''}
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          <a class="btn btn-sm" href="/diff/${doc.id}">
            📜 版本历史
          </a>
          <a class="btn btn-sm btn-primary" href="/mirrors/${doc.id}">
            🌐 镜像管理
          </a>
        </div>
      </div>
    </div>
  `;

  if (!mirrors || mirrors.length === 0) {
    container.innerHTML = docCard + `
      <div class="empty-state">
        <div class="emoji">🌍</div>
        <h3>暂无语言镜像</h3>
        <p>点击下方按钮去镜像管理页面创建</p>
        <a class="btn btn-primary" href="/mirrors/${doc.id}" style="margin-top:16px;">
          ➕ 创建第一个语言镜像
        </a>
      </div>
    `;
    return;
  }

  let mirrorsHtml = '<div class="mirror-list">';
  mirrors.forEach(m => {
    const progress = m.total_paragraph_count > 0
      ? Math.round(m.synchronized_paragraph_count / m.total_paragraph_count * 100)
      : 0;

    const syncBadgeClass = m.sync_status === 'synced' ? 'synced' :
                           m.sync_status === 'outdated' ? 'outdated' : 'pending';
    const syncBadgeText = m.sync_status === 'synced' ? '✅ 已同步' :
                          m.sync_status === 'outdated' ? '⚠️ 主文档已更新' : '⏳ 待同步';

    mirrorsHtml += `
      <div class="mirror-card">
        <div class="mirror-card-header">
          <div class="mirror-language">
            <span class="flag">${m.language_flag}</span>
            <div class="info">
              <h3>${escapeHtml(m.language_name)}</h3>
              <div class="code">${m.language_code}</div>
            </div>
          </div>
          <span class="sync-status-badge ${syncBadgeClass}">
            <span class="dot"></span>${syncBadgeText}
          </span>
        </div>

        <div class="mirror-stats">
          <div class="mirror-stat synced">
            <div class="value">${m.synchronized_paragraph_count}</div>
            <div class="label">已同步</div>
          </div>
          <div class="mirror-stat pending">
            <div class="value">${m.pending_paragraph_count}</div>
            <div class="label">待处理</div>
          </div>
          <div class="mirror-stat outdated">
            <div class="value">${m.latest_master_version - m.synced_master_version}</div>
            <div class="label">落后版本</div>
          </div>
        </div>

        <div class="progress-bar">
          <div class="progress-bar-fill" style="width:${progress}%"></div>
        </div>
        <div class="progress-text">
          <span>同步进度</span>
          <span>${progress}% (${m.synchronized_paragraph_count}/${m.total_paragraph_count})</span>
        </div>

        <div class="version-info">
          <div class="row">
            <span class="label">基于主文档</span>
            <span>v${m.synced_master_version}</span>
          </div>
          <div class="row">
            <span class="label">最新主文档</span>
            <span>v${m.latest_master_version}</span>
          </div>
        </div>

        <div class="mirror-actions">
          <a class="btn btn-primary btn-sm" href="/translate/${m.id}" style="text-decoration:none;flex:1;text-align:center;justify-content:center;display:inline-flex;">
            🖊️ 翻译工作台
          </a>
          <a class="btn btn-sm" href="/mirrors/${m.document_id}" style="text-decoration:none;flex:1;text-align:center;justify-content:center;display:inline-flex;">
            📜 详细
          </a>
        </div>
      </div>
    `;
  });
  mirrorsHtml += '</div>';

  container.innerHTML = docCard + mirrorsHtml;

  if (mirrors.some(m => m.sync_status === 'outdated' || m.pending_paragraph_count > 0)) {
    container.innerHTML += `
      <div style="margin-top:24px;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="font-size:24px;">💡</div>
          <div>
            <div style="font-weight:600;color:#92400e;margin-bottom:4px;">
              提示：当前有待同步内容
            </div>
            <div style="font-size:13px;color:#78350f;line-height:1.7;">
              1. 点击「翻译工作台」进入左右对照界面<br>
              2. 过期段落会高亮显示，只需处理这些待同步段落<br>
              3. 全部处理完成后才能发布新版本镜像<br>
              4. 主文档再次更新时，已同步镜像会自动回到待同步状态
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

loadContracts();
