let contractId = null;
let currentContract = null;
let ws = null;
let currentSignerId = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let hasDrawn = false;
let activeTab = 'canvas';
let currentUserSignerId = null;

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function getContractId() {
  const path = window.location.pathname;
  const parts = path.split('/');
  return parseInt(parts[parts.length - 1]);
}

function getUrlParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadContract() {
  try {
    const res = await fetch(`/api/contracts/${contractId}`);
    if (!res.ok) throw new Error('加载失败');
    currentContract = await res.json();
    renderContract();
  } catch (e) {
    console.error('加载合同失败:', e);
    showToast('加载合同失败', 'error');
  }
}

function renderContract() {
  if (!currentContract) return;

  document.getElementById('contractTitle').textContent = '📝 ' + currentContract.title;
  document.getElementById('detailTitle').textContent = currentContract.title;

  const status = statusMap[currentContract.status] || { label: currentContract.status, class: '' };
  const badge = document.getElementById('statusBadge');
  badge.textContent = status.label;
  badge.className = `status-badge ${status.class}`;

  const signedCount = currentContract.signers.filter(s => s.signed_at).length;
  const total = currentContract.signers.length;
  const progress = total > 0 ? (signedCount / total * 100) : 0;

  document.getElementById('progressText').textContent = `${signedCount}/${total} 人`;
  document.getElementById('progressBar').style.width = `${progress}%`;

  renderIdentitySelect();
  renderIdentityHint();
  renderSigners();
  renderDocument();
  renderActions();
  updateCountdown();
}

function renderIdentitySelect() {
  const select = document.getElementById('identitySelect');
  select.innerHTML = '<option value="">访客（仅查看）</option>' +
    currentContract.signers.map(s => 
      `<option value="${s.id}" ${s.id === currentUserSignerId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
    ).join('');
}

function switchIdentity(signerId) {
  currentUserSignerId = signerId ? parseInt(signerId) : null;
  
  if (currentUserSignerId) {
    const url = new URL(window.location);
    url.searchParams.set('signer', currentUserSignerId);
    window.history.replaceState({}, '', url);
  } else {
    const url = new URL(window.location);
    url.searchParams.delete('signer');
    window.history.replaceState({}, '', url);
  }
  
  renderIdentityHint();
  renderDocument();
}

function renderIdentityHint() {
  const hintEl = document.getElementById('identityHint');
  
  if (!currentUserSignerId) {
    hintEl.style.display = 'block';
    hintEl.style.background = '#fffbe6';
    hintEl.style.border = '1px solid #ffe58f';
    hintEl.style.color = '#d48806';
    hintEl.innerHTML = '👀 您当前以 <strong>访客</strong> 身份浏览，只能查看不能签署。请在上方选择您的身份后进行签署操作。';
    return;
  }
  
  const userSigner = currentContract.signers.find(s => s.id === currentUserSignerId);
  if (!userSigner) {
    hintEl.style.display = 'none';
    return;
  }
  
  const userIndex = currentContract.signers.findIndex(s => s.id === currentUserSignerId);
  const isSigned = !!userSigner.signed_at;
  const isCurrent = currentContract.status === 'signing' && 
                    currentContract.currentSignerIndex === userIndex;
  
  hintEl.style.display = 'block';
  
  if (isSigned) {
    hintEl.style.background = '#f6ffed';
    hintEl.style.border = '1px solid #b7eb8f';
    hintEl.style.color = '#389e0d';
    hintEl.innerHTML = `✅ 您是 <strong>${escapeHtml(userSigner.name)}</strong>，您已完成签署（${formatDate(userSigner.signed_at)}）。`;
  } else if (isCurrent) {
    hintEl.style.background = '#e6f7ff';
    hintEl.style.border = '1px solid #91d5ff';
    hintEl.style.color = '#096dd9';
    hintEl.innerHTML = `✍️ 您是 <strong>${escapeHtml(userSigner.name)}</strong>，现在轮到您签署了！点击下方签署区域开始签名。`;
  } else if (currentContract.status === 'signing') {
    const currentSigner = currentContract.signers[currentContract.currentSignerIndex];
    hintEl.style.background = '#fff0f6';
    hintEl.style.border = '1px solid #ffadd2';
    hintEl.style.color = '#c41d7f';
    hintEl.innerHTML = `⏳ 您是 <strong>${escapeHtml(userSigner.name)}</strong>，当前正在等待 <strong>${escapeHtml(currentSigner?.name || '未知')}</strong> 签署，请耐心等待轮到您。`;
  } else if (currentContract.status === 'draft') {
    hintEl.style.background = '#e6f7ff';
    hintEl.style.border = '1px solid #91d5ff';
    hintEl.style.color = '#096dd9';
    hintEl.innerHTML = `📝 您是 <strong>${escapeHtml(userSigner.name)}</strong>，合同尚未开始签署。`;
  } else if (currentContract.status === 'expired') {
    hintEl.style.background = '#fff1f0';
    hintEl.style.border = '1px solid #ffa39e';
    hintEl.style.color = '#cf1322';
    hintEl.innerHTML = `⏰ 您是 <strong>${escapeHtml(userSigner.name)}</strong>，合同已过期，无法继续签署。`;
  } else if (currentContract.status === 'completed') {
    hintEl.style.background = '#f6ffed';
    hintEl.style.border = '1px solid #b7eb8f';
    hintEl.style.color = '#389e0d';
    hintEl.innerHTML = `🎉 您是 <strong>${escapeHtml(userSigner.name)}</strong>，所有签署人均已完成签署，合同已生效。`;
  }
}

function renderSigners() {
  const listEl = document.getElementById('signersList');
  listEl.innerHTML = currentContract.signers.map((signer, index) => {
    const isSigned = !!signer.signed_at;
    const isCurrent = currentContract.status === 'signing' && 
                      currentContract.currentSignerIndex === index;
    const isMe = currentUserSignerId === signer.id;
    
    let statusClass = 'waiting';
    let statusText = '等待中';
    let itemClass = '';

    if (isSigned) {
      statusClass = 'signed';
      statusText = `已签署 · ${formatDate(signer.signed_at)}`;
      itemClass = 'signed';
    } else if (isCurrent) {
      statusClass = 'current';
      statusText = '正在签署';
      itemClass = 'current';
    }

    return `
      <div class="signer-item ${itemClass}" style="${isMe ? 'box-shadow: 0 0 0 3px #667eea40;' : ''}">
        <span class="order-badge">${index + 1}</span>
        <div class="signer-name">
          ${escapeHtml(signer.name)}
          ${isMe ? '<span style="font-size: 11px; background: #667eea; color: white; padding: 2px 6px; border-radius: 10px; margin-left: 6px;">我</span>' : ''}
        </div>
        <div class="signer-email">${escapeHtml(signer.email)}</div>
        <div class="signer-status ${statusClass}">${statusText}</div>
      </div>
    `;
  }).join('');
}

function renderDocument() {
  const docEl = document.getElementById('contractDocument');
  docEl.querySelector('.contract-content').textContent = currentContract.content;

  docEl.querySelectorAll('.sign-area').forEach(el => el.remove());

  currentContract.signers.forEach((signer, index) => {
    const area = document.createElement('div');
    const isSigned = !!signer.signed_at;
    const isCurrent = currentContract.status === 'signing' && 
                      currentContract.currentSignerIndex === index;
    const isMe = currentUserSignerId === signer.id;
    const canSign = isCurrent && isMe && !isSigned;

    area.className = `sign-area ${isSigned ? 'signed' : ''} ${!canSign && !isSigned ? 'disabled' : ''}`;
    area.style.left = `${signer.sign_area_x}px`;
    area.style.top = `${signer.sign_area_y}px`;
    area.style.width = `${signer.sign_area_width}px`;
    area.style.height = `${signer.sign_area_height}px`;

    let innerHtml = '';
    if (isSigned) {
      if (signer.signature_type === 'canvas' && signer.signature_data) {
        innerHtml = `<img src="${signer.signature_data}" class="signature-img" alt="签名">`;
      } else if (signer.signature_type === 'text' && signer.signature_data) {
        innerHtml = `<div class="text-signature">${escapeHtml(signer.signature_data)}</div>`;
      }
      innerHtml += `<div class="sign-area-label">${escapeHtml(signer.name)} 已签</div>`;
    } else if (canSign) {
      innerHtml = `<div class="sign-area-label" style="color: #1890ff;">👆 点击签署 · ${escapeHtml(signer.name)}</div>`;
    } else if (isCurrent && !isMe) {
      innerHtml = `<div class="sign-area-label">轮到 TA 签署 · ${escapeHtml(signer.name)}</div>`;
    } else {
      innerHtml = `<div class="sign-area-label">等待签署 · ${escapeHtml(signer.name)}</div>`;
    }

    area.innerHTML = innerHtml;

    if (canSign) {
      area.onclick = () => openSignModal(signer.id);
    }

    docEl.appendChild(area);
  });
}

function renderActions() {
  const actionsEl = document.getElementById('actionButtons');
  let html = '';

  if (currentContract.status === 'draft') {
    html += `<button class="btn btn-primary" onclick="startSigning()">开始签署</button>`;
  }

  actionsEl.innerHTML = html;
}

function updateCountdown() {
  const el = document.getElementById('countdown');
  if (!currentContract.deadline) {
    el.textContent = '⏰ 无截止时间';
    el.className = 'countdown';
    return;
  }

  const diff = currentContract.deadline - Date.now();
  
  if (diff <= 0) {
    el.textContent = '⏰ 已过期';
    el.className = 'countdown danger';
    return;
  }

  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  let text = '';
  if (days > 0) {
    text = `⏰ 剩余 ${days}天 ${hours}小时 ${minutes}分`;
  } else if (hours > 0) {
    text = `⏰ 剩余 ${hours}小时 ${minutes}分 ${seconds}秒`;
  } else {
    text = `⏰ 剩余 ${minutes}分 ${seconds}秒`;
  }

  el.textContent = text;

  if (diff < 3600000) {
    el.className = 'countdown danger';
  } else if (diff < 86400000) {
    el.className = 'countdown warning';
  } else {
    el.className = 'countdown';
  }
}

async function startSigning() {
  if (!confirm('确定要开始签署吗？开始后将无法修改合同内容。')) return;
  
  try {
    const res = await fetch(`/api/contracts/${contractId}/start`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '开始签署失败');
    }
    showToast('签署已开始', 'success');
    loadContract();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openSignModal(signerId) {
  if (signerId !== currentUserSignerId) {
    showToast('这不是您的签署区域', 'error');
    return;
  }

  currentSignerId = signerId;
  
  const signer = currentContract.signers.find(s => s.id === signerId);
  document.getElementById('signerInfo').textContent = `${signer.name} (${signer.email})`;
  
  document.getElementById('signModal').classList.add('active');
  
  setTimeout(() => {
    initCanvas();
  }, 100);
  
  switchTab('canvas');
}

function hideSignModal() {
  document.getElementById('signModal').classList.remove('active');
  currentSignerId = null;
}

function closeSignModalOutside(event) {
  if (event.target.classList.contains('modal-overlay')) {
    hideSignModal();
  }
}

function switchTab(tab) {
  activeTab = tab;
  
  document.getElementById('tabCanvas').classList.toggle('active', tab === 'canvas');
  document.getElementById('tabText').classList.toggle('active', tab === 'text');
  document.getElementById('canvasPanel').style.display = tab === 'canvas' ? 'block' : 'none';
  document.getElementById('textPanel').style.display = tab === 'text' ? 'block' : 'none';
  
  if (tab === 'canvas') {
    setTimeout(initCanvas, 50);
  }
}

function initCanvas() {
  const canvas = document.getElementById('signatureCanvas');
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d');
  
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width * 2) {
    canvas.width = rect.width * 2;
    canvas.height = 180 * 2;
    ctx.scale(2, 2);
  }
  
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, canvas.width / 2, canvas.height / 2);
  
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  hasDrawn = false;
  
  canvas.onmousedown = startDrawing;
  canvas.onmousemove = draw;
  canvas.onmouseup = stopDrawing;
  canvas.onmouseleave = stopDrawing;
  
  canvas.ontouchstart = handleTouchStart;
  canvas.ontouchmove = handleTouchMove;
  canvas.ontouchend = stopDrawing;
}

function getCanvasPos(e) {
  const canvas = document.getElementById('signatureCanvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
}

function startDrawing(e) {
  isDrawing = true;
  const pos = getCanvasPos(e);
  lastX = pos.x;
  lastY = pos.y;
}

function draw(e) {
  if (!isDrawing) return;
  
  const canvas = document.getElementById('signatureCanvas');
  const ctx = canvas.getContext('2d');
  const pos = getCanvasPos(e);
  
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(pos.x, pos.y);
  ctx.stroke();
  
  lastX = pos.x;
  lastY = pos.y;
  hasDrawn = true;
}

function stopDrawing() {
  isDrawing = false;
}

function handleTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const canvas = document.getElementById('signatureCanvas');
  const rect = canvas.getBoundingClientRect();
  
  isDrawing = true;
  lastX = touch.clientX - rect.left;
  lastY = touch.clientY - rect.top;
}

function handleTouchMove(e) {
  e.preventDefault();
  if (!isDrawing) return;
  
  const touch = e.touches[0];
  const canvas = document.getElementById('signatureCanvas');
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  
  const x = touch.clientX - rect.left;
  const y = touch.clientY - rect.top;
  
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.stroke();
  
  lastX = x;
  lastY = y;
  hasDrawn = true;
}

function clearCanvas() {
  const canvas = document.getElementById('signatureCanvas');
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, canvas.width / 2, canvas.height / 2);
  
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  hasDrawn = false;
}

function updateTextPreview() {
  const input = document.getElementById('textSignatureInput').value;
  const preview = document.getElementById('textPreviewText');
  preview.textContent = input || '签名预览';
}

async function submitSignature() {
  if (currentSignerId !== currentUserSignerId) {
    showToast('请用您自己的身份签署', 'error');
    return;
  }

  let signatureType, signatureData;
  
  if (activeTab === 'canvas') {
    if (!hasDrawn) {
      showToast('请先手写签名', 'error');
      return;
    }
    const canvas = document.getElementById('signatureCanvas');
    
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    tempCanvas.width = 180;
    tempCanvas.height = 70;
    
    tempCtx.fillStyle = 'transparent';
    
    tempCtx.drawImage(canvas, 0, 0, canvas.width / 2, canvas.height / 2,
                      0, 0, 180, 70);
    
    signatureType = 'canvas';
    signatureData = tempCanvas.toDataURL('image/png');
  } else {
    const text = document.getElementById('textSignatureInput').value.trim();
    if (!text) {
      showToast('请输入签名文字', 'error');
      return;
    }
    signatureType = 'text';
    signatureData = text;
  }

  try {
    const res = await fetch(`/api/contracts/${contractId}/sign/${currentSignerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureType, signatureData })
    });
    
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || '签署失败');
    }
    
    showToast('签署成功！', 'success');
    hideSignModal();
    loadContract();
  } catch (e) {
    showToast('签署失败: ' + e.message, 'error');
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    document.getElementById('wsStatus').textContent = '实时连接中';
    ws.send(JSON.stringify({ type: 'subscribe', contractId: contractId }));
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (e) {
      console.error('WebSocket消息解析失败:', e);
    }
  };
  
  ws.onclose = () => {
    document.getElementById('wsStatus').textContent = '连接断开，重连中...';
    setTimeout(connectWebSocket, 3000);
  };
  
  ws.onerror = () => {
    document.getElementById('wsStatus').textContent = '连接错误';
  };
}

function handleWsMessage(data) {
  switch (data.type) {
    case 'contract_status':
    case 'contract_updated':
    case 'sign_done':
    case 'signing_started':
      if (data.contract && data.contract.id === contractId) {
        currentContract = data.contract;
        renderContract();
        if (data.type === 'sign_done') {
          showToast('有新的签署完成', 'info');
        }
      }
      break;
    case 'contract_completed':
      if (data.contract && data.contract.id === contractId) {
        currentContract = data.contract;
        renderContract();
        showToast('🎉 所有签署人已完成签署！合同已生效', 'success');
      }
      break;
    case 'contract_deleted':
      showToast('合同已被删除', 'error');
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
      break;
    case 'error':
      console.error('WebSocket错误:', data.message);
      break;
  }
}

function init() {
  contractId = getContractId();
  if (!contractId || isNaN(contractId)) {
    showToast('无效的合同ID', 'error');
    return;
  }

  const signerParam = getUrlParam('signer');
  if (signerParam && !isNaN(parseInt(signerParam))) {
    currentUserSignerId = parseInt(signerParam);
  }

  loadContract();
  connectWebSocket();
  
  setInterval(() => {
    if (currentContract && currentContract.deadline) {
      updateCountdown();
    }
  }, 1000);
}

init();
