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

loadContracts();
