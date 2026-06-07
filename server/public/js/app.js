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

    return `
      <div class="card contract-card" onclick="viewContract(${c.id})">
        <span class="status-badge ${status.class}">${status.label}</span>
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
}

function hideCreateModal() {
  document.getElementById('createModal').classList.remove('active');
}

function closeModalOutside(event) {
  if (event.target.classList.contains('modal-overlay')) {
    hideCreateModal();
  }
}

async function createContract() {
  const title = document.getElementById('newTitle').value.trim();
  const content = document.getElementById('newContent').value.trim();
  const signersStr = document.getElementById('newSigners').value.trim();

  if (!title) {
    showToast('请输入合同标题', 'error');
    return;
  }
  if (!content) {
    showToast('请输入合同内容', 'error');
    return;
  }
  if (!signersStr) {
    showToast('请输入签署人', 'error');
    return;
  }

  const signers = signersStr.split(',').map((s, i) => {
    const [name, email] = s.trim().split(':');
    return {
      name: name?.trim() || `签署人${i+1}`,
      email: email?.trim() || `signer${i+1}@example.com`,
      order_index: i
    };
  });

  const deadline = Date.now() + 7 * 24 * 60 * 60 * 1000;

  try {
    const res = await fetch('/api/contracts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, signers, deadline })
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
