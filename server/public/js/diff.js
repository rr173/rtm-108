let currentDocId = null;
let currentDocument = null;
let selectedOldVersion = null;
let selectedNewVersion = null;
let currentDiffResult = null;
let showOnlyDiff = false;
let currentTagVersionId = null;

let currentReview = null;
let currentReviewId = null;
let reviewComments = [];
let ws = null;
let showCommentPanel = false;
let selectedLineComments = null;
let selectedOldLine = null;
let selectedNewLine = null;
let addCommentLineData = null;
let reviewerName = localStorage.getItem('reviewerName') || '';

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
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function closeModalOutside(event) {
  if (event.target.classList.contains('modal-overlay')) {
    hideCreateDocModal();
    hideEditModal();
    hideTagModal();
    hideCreateReviewModal();
    hideAddCommentModal();
  }
}

async function loadDocuments() {
  try {
    const res = await fetch('/api/documents');
    const docs = await res.json();
    renderDocList(docs);
  } catch (e) {
    console.error('加载文档列表失败:', e);
    document.getElementById('docList').innerHTML = `
      <div class="empty-state-small">加载失败</div>
    `;
  }
}

function renderDocList(docs) {
  const listEl = document.getElementById('docList');
  
  if (!docs || docs.length === 0) {
    listEl.innerHTML = `<div class="empty-state-small">暂无文档</div>`;
    return;
  }

  listEl.innerHTML = docs.map(doc => `
    <div class="doc-item ${currentDocId === doc.id ? 'active' : ''}" onclick="selectDocument(${doc.id})">
      <div class="doc-item-title">${escapeHtml(doc.title)}</div>
      <div class="doc-item-meta">
        <span>v${doc.latestVersion} · ${doc.versionCount} 个版本</span>
      </div>
      <div class="doc-item-time">${formatDate(doc.updated_at)}</div>
    </div>
  `).join('');
}

async function selectDocument(docId) {
  currentDocId = docId;
  selectedOldVersion = null;
  selectedNewVersion = null;
  
  try {
    const res = await fetch(`/api/documents/${docId}`);
    const doc = await res.json();
    currentDocument = doc;
    
    document.getElementById('versionPanel').style.display = 'block';
    document.getElementById('docTitle').textContent = doc.title;
    
    renderVersionTimeline(doc.versions);
    updateSelectedVersionsDisplay();
    loadDocuments();
  } catch (e) {
    console.error('加载文档失败:', e);
    showToast('加载文档失败', 'error');
  }
}

function renderVersionTimeline(versions) {
  const timelineEl = document.getElementById('versionTimeline');
  
  const sortedVersions = [...versions].sort((a, b) => b.version_number - a.version_number);
  
  timelineEl.innerHTML = sortedVersions.map((v, index) => {
    const isOld = selectedOldVersion === v.version_number;
    const isNew = selectedNewVersion === v.version_number;
    const tagsHtml = (v.tags || []).map(tag => 
      `<span class="version-tag">${escapeHtml(tag)}</span>`
    ).join('');
    
    return `
      <div class="version-item ${isOld ? 'selected-old' : ''} ${isNew ? 'selected-new' : ''}" 
           onclick="toggleVersionSelection(${v.version_number})"
           data-version="${v.version_number}">
        <div class="version-dot"></div>
        <div class="version-line ${index === sortedVersions.length - 1 ? 'last' : ''}"></div>
        <div class="version-content">
          <div class="version-header">
            <span class="version-number">v${v.version_number}</span>
            <div class="version-actions">
              <button class="version-action-btn" onclick="event.stopPropagation(); showTagModal(${v.id})" title="添加标签">🏷️</button>
              <button class="version-action-btn" onclick="event.stopPropagation(); revertToVersion(${v.version_number})" title="回退到此版本">↩️</button>
            </div>
          </div>
          ${tagsHtml ? `<div class="version-tags">${tagsHtml}</div>` : ''}
          <div class="version-message">${escapeHtml(v.commit_message || '无描述')}</div>
          <div class="version-time">${formatDate(v.created_at)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleVersionSelection(versionNum) {
  if (selectedOldVersion === versionNum) {
    selectedOldVersion = null;
  } else if (selectedNewVersion === versionNum) {
    selectedNewVersion = null;
  } else if (selectedOldVersion === null) {
    selectedOldVersion = versionNum;
  } else if (selectedNewVersion === null) {
    selectedNewVersion = versionNum;
    if (selectedOldVersion > selectedNewVersion) {
      [selectedOldVersion, selectedNewVersion] = [selectedNewVersion, selectedOldVersion];
    }
  } else {
    selectedOldVersion = selectedNewVersion;
    selectedNewVersion = versionNum;
    if (selectedOldVersion > selectedNewVersion) {
      [selectedOldVersion, selectedNewVersion] = [selectedNewVersion, selectedOldVersion];
    }
  }
  
  renderVersionTimeline(currentDocument.versions);
  updateSelectedVersionsDisplay();
}

function updateSelectedVersionsDisplay() {
  const displayEl = document.getElementById('selectedVersions');
  const compareBtn = document.getElementById('compareBtn');
  
  if (selectedOldVersion !== null && selectedNewVersion !== null) {
    displayEl.textContent = `v${selectedOldVersion} → v${selectedNewVersion}`;
    compareBtn.disabled = false;
  } else if (selectedOldVersion !== null) {
    displayEl.textContent = `v${selectedOldVersion} (请再选一个)`;
    compareBtn.disabled = true;
  } else if (selectedNewVersion !== null) {
    displayEl.textContent = `v${selectedNewVersion} (请再选一个)`;
    compareBtn.disabled = true;
  } else {
    displayEl.textContent = '-';
    compareBtn.disabled = true;
  }
}

function clearSelection() {
  selectedOldVersion = null;
  selectedNewVersion = null;
  renderVersionTimeline(currentDocument.versions);
  updateSelectedVersionsDisplay();
}

async function compareVersions() {
  if (!currentDocId || selectedOldVersion === null || selectedNewVersion === null) {
    showToast('请选择两个版本进行对比', 'error');
    return;
  }

  try {
    const res = await fetch(
      `/api/documents/${currentDocId}/diff?old_version=${selectedOldVersion}&new_version=${selectedNewVersion}`
    );
    const result = await res.json();
    currentDiffResult = result;
    
    renderDiffResult(result);
  } catch (e) {
    console.error('对比失败:', e);
    showToast('对比失败: ' + e.message, 'error');
  }
}

function renderDiffResult(result) {
  document.getElementById('diffEmptyState').style.display = 'none';
  document.getElementById('diffResultPanel').style.display = 'block';
  
  document.getElementById('diffTitle').textContent = 
    `${currentDocument.title} - v${selectedOldVersion} vs v${selectedNewVersion}`;
  
  document.getElementById('oldVersionLabel').textContent = `v${selectedOldVersion} (旧版本)`;
  document.getElementById('newVersionLabel').textContent = `v${selectedNewVersion} (新版本)`;
  
  const stats = result.stats;
  document.getElementById('diffStats').innerHTML = `
    <span class="stat-item stat-added">+ ${stats.added} 新增</span>
    <span class="stat-item stat-deleted">- ${stats.deleted} 删除</span>
    <span class="stat-item stat-modified">~ ${stats.modified} 修改</span>
    <span class="stat-item stat-unchanged"> ${stats.unchanged} 未变</span>
  `;
  
  renderDiffContent(result.diff);
}

function renderDiffContent(diff) {
  const oldContent = document.getElementById('oldDiffContent');
  const newContent = document.getElementById('newDiffContent');
  
  let oldHtml = '';
  let newHtml = '';
  
  diff.forEach((item) => {
    const isDiff = item.type !== 'unchanged';
    
    if (showOnlyDiff && !isDiff) {
      return;
    }
    
    switch (item.type) {
      case 'unchanged':
        oldHtml += renderLine('unchanged', item.oldIndex + 1, item.value, null, 'old');
        newHtml += renderLine('unchanged', item.newIndex + 1, item.value, null, 'new');
        break;
      case 'added':
        oldHtml += renderLine('empty', '', '', null, 'old');
        newHtml += renderLine('added', item.newIndex + 1, item.value, null, 'new');
        break;
      case 'deleted':
        oldHtml += renderLine('deleted', item.oldIndex + 1, item.value, null, 'old');
        newHtml += renderLine('empty', '', '', null, 'new');
        break;
      case 'modified':
        oldHtml += renderLine('modified-old', item.oldIndex + 1, item.oldValue, item.charDiff, 'old');
        newHtml += renderLine('modified-new', item.newIndex + 1, item.newValue, item.charDiff, 'new');
        break;
    }
  });
  
  oldContent.innerHTML = oldHtml;
  newContent.innerHTML = newHtml;
}

function renderLine(type, lineNum, content, charDiff = null, side = null) {
  const lineNumStr = lineNum !== '' ? lineNum : '';
  let contentHtml = escapeHtml(content);
  
  if (charDiff && (type === 'modified-old' || type === 'modified-new')) {
    contentHtml = renderCharDiff(charDiff, side);
  }
  
  const prefix = type === 'added' ? '+' : (type === 'deleted' ? '-' : ' ');
  
  return `
    <div class="diff-line diff-line-${type}">
      <span class="line-number">${lineNumStr}</span>
      <span class="line-prefix">${prefix}</span>
      <span class="line-content">${contentHtml || '&nbsp;'}</span>
    </div>
  `;
}

function renderCharDiff(charDiff, side) {
  let html = '';
  
  charDiff.forEach(char => {
    const escaped = escapeHtml(char.value || ' ');
    if (char.type === 'unchanged') {
      html += `<span>${escaped === ' ' ? '&nbsp;' : escaped}</span>`;
    } else if (char.type === 'added' && side === 'new') {
      html += `<span class="char-added">${escaped === ' ' ? '&nbsp;' : escaped}</span>`;
    } else if (char.type === 'deleted' && side === 'old') {
      html += `<span class="char-deleted">${escaped === ' ' ? '&nbsp;' : escaped}</span>`;
    }
  });
  
  return html;
}

function toggleOnlyDiff() {
  showOnlyDiff = document.getElementById('showOnlyDiff').checked;
  if (currentDiffResult) {
    renderDiffContent(currentDiffResult.diff);
  }
}

function showCreateDocModal() {
  document.getElementById('newDocTitle').value = '';
  document.getElementById('newDocDesc').value = '';
  document.getElementById('newDocContent').value = '';
  document.getElementById('createDocModal').classList.add('active');
}

function hideCreateDocModal() {
  document.getElementById('createDocModal').classList.remove('active');
}

async function createDocument() {
  const title = document.getElementById('newDocTitle').value.trim();
  const description = document.getElementById('newDocDesc').value.trim();
  const content = document.getElementById('newDocContent').value;
  
  if (!title) {
    showToast('请输入文档标题', 'error');
    return;
  }
  
  try {
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, description })
    });
    
    if (!res.ok) throw new Error('创建失败');
    
    const doc = await res.json();
    showToast('文档创建成功', 'success');
    hideCreateDocModal();
    loadDocuments();
    selectDocument(doc.id);
  } catch (e) {
    showToast('创建失败: ' + e.message, 'error');
  }
}

function showEditModal() {
  if (!currentDocument || currentDocument.versions.length === 0) {
    showToast('没有可编辑的文档', 'error');
    return;
  }
  
  const latestVersion = currentDocument.versions[currentDocument.versions.length - 1];
  document.getElementById('editContent').value = latestVersion.content;
  document.getElementById('editCommitMsg').value = '';
  document.getElementById('editModal').classList.add('active');
}

function hideEditModal() {
  document.getElementById('editModal').classList.remove('active');
}

async function saveEdit() {
  const content = document.getElementById('editContent').value;
  const commitMessage = document.getElementById('editCommitMsg').value.trim();
  
  if (!currentDocId) {
    showToast('请先选择文档', 'error');
    return;
  }
  
  try {
    const res = await fetch(`/api/documents/${currentDocId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, commit_message: commitMessage })
    });
    
    if (!res.ok) throw new Error('保存失败');
    
    const doc = await res.json();
    currentDocument = doc;
    
    showToast('新版本已保存', 'success');
    hideEditModal();
    renderVersionTimeline(doc.versions);
    loadDocuments();
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

function showTagModal(versionId) {
  currentTagVersionId = versionId;
  document.getElementById('tagNameInput').value = '';
  document.getElementById('tagModal').classList.add('active');
}

function hideTagModal() {
  document.getElementById('tagModal').classList.remove('active');
  currentTagVersionId = null;
}

async function addTag() {
  const name = document.getElementById('tagNameInput').value.trim();
  
  if (!name) {
    showToast('请输入标签名称', 'error');
    return;
  }
  
  if (!currentDocId || !currentTagVersionId) {
    showToast('参数错误', 'error');
    return;
  }
  
  try {
    const res = await fetch(`/api/documents/${currentDocId}/versions/${currentTagVersionId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    
    if (!res.ok) throw new Error('添加失败');
    
    hideTagModal();
    
    const docRes = await fetch(`/api/documents/${currentDocId}`);
    const doc = await docRes.json();
    currentDocument = doc;
    renderVersionTimeline(doc.versions);
    
    showToast('标签添加成功', 'success');
  } catch (e) {
    showToast('添加失败: ' + e.message, 'error');
  }
}

async function revertToVersion(versionNum) {
  if (!confirm(`确定要回退到 v${versionNum} 吗？这将创建一个新版本。`)) {
    return;
  }
  
  try {
    const res = await fetch(`/api/documents/${currentDocId}/revert/${versionNum}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    if (!res.ok) throw new Error('回退失败');
    
    const doc = await res.json();
    currentDocument = doc;
    
    showToast(`已回退到 v${versionNum}，生成新版本`, 'success');
    renderVersionTimeline(doc.versions);
    loadDocuments();
  } catch (e) {
    showToast('回退失败: ' + e.message, 'error');
  }
}

function connectWebSocket() {
  if (ws) return;
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log('WebSocket 已连接');
    if (currentReviewId) {
      subscribeToReview(currentReviewId);
    }
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWsMessage(data);
    } catch (e) {
      console.error('WebSocket 消息解析失败:', e);
    }
  };
  
  ws.onclose = () => {
    console.log('WebSocket 已断开');
    ws = null;
    setTimeout(() => connectWebSocket(), 3000);
  };
  
  ws.onerror = (e) => {
    console.error('WebSocket 错误:', e);
  };
}

function handleWsMessage(data) {
  switch (data.type) {
    case 'review_status':
      if (data.review) {
        currentReview = data.review;
        updateReviewPanel();
      }
      if (data.comments) {
        reviewComments = data.comments;
        refreshCommentBubbles();
        if (selectedLineComments) {
          updateCommentPanelContent();
        }
      }
      break;
    case 'review_updated':
    case 'review_status_updated':
      if (data.review) {
        currentReview = data.review;
        updateReviewPanel();
        loadReviewList();
      }
      break;
    case 'new_comment':
      if (data.reviewId === currentReviewId && data.comment) {
        loadReviewComments();
      }
      break;
    case 'comment_resolved':
    case 'comment_unresolved':
      if (data.reviewId === currentReviewId && data.comment) {
        loadReviewComments();
      }
      break;
    case 'error':
      showToast(data.message, 'error');
      break;
  }
}

function subscribeToReview(reviewId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'subscribe_review',
      reviewId: reviewId
    }));
  }
}

function unsubscribeFromReview(reviewId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'unsubscribe_review',
      reviewId: reviewId
    }));
  }
}

async function loadReviewList() {
  if (!currentDocId) return;
  
  try {
    const res = await fetch(`/api/documents/${currentDocId}/reviews`);
    const reviews = await res.json();
    renderReviewList(reviews);
  } catch (e) {
    console.error('加载评审列表失败:', e);
  }
}

function renderReviewList(reviews) {
  const listEl = document.getElementById('reviewList');
  
  if (!reviews || reviews.length === 0) {
    listEl.innerHTML = '<div class="empty-state-small">暂无评审</div>';
    return;
  }
  
  listEl.innerHTML = reviews.map(review => {
    const statusClass = `review-status-${review.status}`;
    const statusText = {
      pending: '待处理',
      approved: '已通过',
      rejected: '已拒绝'
    }[review.status] || review.status;
    
    return `
      <div class="review-item ${currentReviewId === review.id ? 'active' : ''}" 
           onclick="joinReview(${review.id})">
        <div class="review-item-title">${escapeHtml(review.title)}</div>
        <div class="review-item-meta">
          <span>v${review.old_version} → v${review.new_version}</span>
          <span class="review-item-badge ${statusClass}">${statusText}</span>
        </div>
        <div class="review-item-time">
          ${review.top_level_comment_count || 0} 条评论 · ${formatDate(review.created_at)}
        </div>
      </div>
    `;
  }).join('');
}

async function joinReview(reviewId) {
  try {
    const res = await fetch(`/api/reviews/${reviewId}`);
    const review = await res.json();
    if (!review) {
      showToast('评审不存在', 'error');
      return;
    }
    
    if (currentReviewId && currentReviewId !== reviewId) {
      unsubscribeFromReview(currentReviewId);
    }
    
    currentReview = review;
    currentReviewId = reviewId;
    selectedOldVersion = review.old_version;
    selectedNewVersion = review.new_version;
    
    document.getElementById('reviewPanel').style.display = 'block';
    updateReviewPanel();
    
    await loadDiffForReview();
    await loadReviewComments();
    loadReviewList();
    
    connectWebSocket();
    subscribeToReview(reviewId);
    
  } catch (e) {
    showToast('加入评审失败: ' + e.message, 'error');
  }
}

async function loadDiffForReview() {
  if (!currentDocId || !currentReview) return;
  
  try {
    const res = await fetch(
      `/api/documents/${currentDocId}/diff?old_version=${currentReview.old_version}&new_version=${currentReview.new_version}`
    );
    const result = await res.json();
    currentDiffResult = result;
    renderDiffResult(result);
  } catch (e) {
    console.error('加载对比结果失败:', e);
    showToast('加载对比结果失败', 'error');
  }
}

async function loadReviewComments() {
  if (!currentReviewId) return;
  
  try {
    const res = await fetch(`/api/reviews/${currentReviewId}/comments`);
    const comments = await res.json();
    reviewComments = comments;
    refreshCommentBubbles();
    if (selectedLineComments !== null) {
      selectedLineComments = getCommentsForLine(selectedOldLine, selectedNewLine);
      updateCommentPanelContent();
    }
  } catch (e) {
    console.error('加载评论失败:', e);
  }
}

function refreshCommentBubbles() {
  if (!currentDiffResult) return;
  renderDiffContent(currentDiffResult.diff);
}

function updateReviewPanel() {
  if (!currentReview) return;
  
  document.getElementById('reviewTitle').textContent = currentReview.title;
  document.getElementById('reviewMeta').textContent = 
    `${currentReview.created_by} 创建于 ${formatDate(currentReview.created_at)}`;
  
  const statusBadge = document.getElementById('reviewStatusBadge');
  const statusMap = {
    pending: { text: '待处理', class: 'status-pending' },
    approved: { text: '已通过', class: 'status-approved' },
    rejected: { text: '已拒绝', class: 'status-rejected' }
  };
  const status = statusMap[currentReview.status] || statusMap.pending;
  statusBadge.textContent = status.text;
  statusBadge.className = `review-status-badge ${status.class}`;
  
  document.getElementById('reviewStats').innerHTML = `
    <span class="review-stat">💬 ${currentReview.top_level_comment_count || 0} 条评论</span>
    <span class="review-stat">✅ ${currentReview.resolved_count || 0} 已解决</span>
  `;
  
  const infoBar = document.getElementById('reviewInfoBar');
  infoBar.style.display = 'block';
  document.getElementById('reviewInfoText').textContent = 
    `当前评审: ${currentReview.title} (${status.text})`;
}

function showCreateReviewModal() {
  if (selectedOldVersion === null || selectedNewVersion === null) {
    showToast('请先选择两个版本', 'error');
    return;
  }
  
  document.getElementById('reviewOldVersion').textContent = `v${selectedOldVersion}`;
  document.getElementById('reviewNewVersion').textContent = `v${selectedNewVersion}`;
  document.getElementById('reviewTitleInput').value = 
    `v${selectedOldVersion} vs v${selectedNewVersion} 评审`;
  document.getElementById('reviewerNameInput').value = reviewerName;
  document.getElementById('createReviewModal').classList.add('active');
}

function hideCreateReviewModal() {
  document.getElementById('createReviewModal').classList.remove('active');
}

async function createReview() {
  const title = document.getElementById('reviewTitleInput').value.trim();
  const created_by = document.getElementById('reviewerNameInput').value.trim();
  
  if (!title) {
    showToast('请输入评审标题', 'error');
    return;
  }
  if (!created_by) {
    showToast('请输入你的名字', 'error');
    return;
  }
  
  reviewerName = created_by;
  localStorage.setItem('reviewerName', reviewerName);
  
  try {
    const res = await fetch(`/api/documents/${currentDocId}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_version: selectedOldVersion,
        new_version: selectedNewVersion,
        title,
        created_by
      })
    });
    
    if (!res.ok) throw new Error('创建失败');
    
    const review = await res.json();
    hideCreateReviewModal();
    showToast('评审创建成功', 'success');
    
    await joinReview(review.id);
    loadReviewList();
  } catch (e) {
    showToast('创建失败: ' + e.message, 'error');
  }
}

function showAddCommentModal(oldLine, newLine, side) {
  if (!currentReviewId) {
    showToast('请先加入一个评审', 'error');
    return;
  }
  
  addCommentLineData = { oldLine, newLine, side };
  
  let lineInfo = '';
  if (side === 'old' && oldLine) {
    lineInfo = `旧版本第 ${oldLine} 行`;
  } else if (side === 'new' && newLine) {
    lineInfo = `新版本第 ${newLine} 行`;
  }
  
  document.getElementById('commentLineInfo').textContent = lineInfo;
  document.getElementById('commentAuthorInput').value = reviewerName;
  document.getElementById('commentContentInput').value = '';
  document.getElementById('addCommentModal').classList.add('active');
}

function hideAddCommentModal() {
  document.getElementById('addCommentModal').classList.remove('active');
  addCommentLineData = null;
}

async function submitComment() {
  const author = document.getElementById('commentAuthorInput').value.trim();
  const content = document.getElementById('commentContentInput').value.trim();
  
  if (!author) {
    showToast('请输入你的名字', 'error');
    return;
  }
  if (!content) {
    showToast('请输入评论内容', 'error');
    return;
  }
  
  reviewerName = author;
  localStorage.setItem('reviewerName', reviewerName);
  
  try {
    const res = await fetch(`/api/reviews/${currentReviewId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_line: addCommentLineData?.oldLine,
        new_line: addCommentLineData?.newLine,
        content,
        author
      })
    });
    
    if (!res.ok) throw new Error('提交失败');
    
    hideAddCommentModal();
    showToast('评论已添加', 'success');
    await loadReviewComments();
  } catch (e) {
    showToast('提交失败: ' + e.message, 'error');
  }
}

async function submitReply(parentId, content, author) {
  if (!author) {
    showToast('请输入你的名字', 'error');
    return;
  }
  if (!content) {
    showToast('请输入回复内容', 'error');
    return;
  }
  
  try {
    const res = await fetch(`/api/reviews/${currentReviewId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        author,
        parent_id: parentId
      })
    });
    
    if (!res.ok) throw new Error('回复失败');
    
    showToast('回复已添加', 'success');
    await loadReviewComments();
  } catch (e) {
    showToast('回复失败: ' + e.message, 'error');
  }
}

async function resolveComment(commentId) {
  try {
    const res = await fetch(`/api/comments/${commentId}/resolve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!res.ok) throw new Error('操作失败');
    
    showToast('已标记为已解决', 'success');
    await loadReviewComments();
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function unresolveComment(commentId) {
  try {
    const res = await fetch(`/api/comments/${commentId}/unresolve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (!res.ok) throw new Error('操作失败');
    
    showToast('已重新打开', 'success');
    await loadReviewComments();
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function approveReview() {
  if (!currentReviewId) return;
  
  if (!confirm('确定要将此评审标记为"通过"吗？')) return;
  
  try {
    const res = await fetch(`/api/reviews/${currentReviewId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' })
    });
    
    if (!res.ok) throw new Error('操作失败');
    
    const review = await res.json();
    currentReview = review;
    updateReviewPanel();
    showToast('评审已通过', 'success');
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

async function rejectReview() {
  if (!currentReviewId) return;
  
  if (!confirm('确定要将此评审标记为"拒绝"吗？')) return;
  
  try {
    const res = await fetch(`/api/reviews/${currentReviewId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rejected' })
    });
    
    if (!res.ok) throw new Error('操作失败');
    
    const review = await res.json();
    currentReview = review;
    updateReviewPanel();
    showToast('评审已拒绝', 'success');
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
  }
}

function toggleCommentPanel() {
  showCommentPanel = !showCommentPanel;
  const panel = document.getElementById('commentPanel');
  if (showCommentPanel) {
    panel.style.display = 'flex';
    updateCommentPanelContent();
  } else {
    panel.style.display = 'none';
  }
}

function getCommentsForLine(oldLine, newLine) {
  return reviewComments.filter(c => {
    if (oldLine !== null && c.old_line === oldLine) return true;
    if (newLine !== null && c.new_line === newLine) return true;
    return false;
  });
}

function showLineComments(oldLine, newLine) {
  const comments = getCommentsForLine(oldLine, newLine);
  if (comments.length === 0 && !currentReviewId) {
    showToast('请先加入一个评审才能查看评论', 'error');
    return;
  }
  
  selectedOldLine = oldLine;
  selectedNewLine = newLine;
  selectedLineComments = comments;
  
  if (!showCommentPanel) {
    showCommentPanel = true;
    document.getElementById('commentPanel').style.display = 'flex';
  }
  
  updateCommentPanelContent();
}

function updateCommentPanelContent() {
  const contentEl = document.getElementById('commentPanelContent');
  
  if (!currentReviewId) {
    contentEl.innerHTML = '<div class="empty-state-small">请先加入一个评审</div>';
    return;
  }
  
  if (!selectedLineComments || selectedLineComments.length === 0) {
    contentEl.innerHTML = `
      <div class="empty-state-small">
        <p>该位置暂无评论</p>
        <p style="font-size: 12px; color: #999; margin-top: 8px;">点击行号旁的 + 按钮添加评论</p>
      </div>
    `;
    return;
  }
  
  let html = '';
  selectedLineComments.forEach(comment => {
    const resolvedClass = comment.resolved ? 'comment-resolved' : '';
    html += `
      <div class="comment-item ${resolvedClass}">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(comment.author)}</span>
          <span class="comment-time">${formatDate(comment.created_at)}</span>
        </div>
        <div class="comment-content">${escapeHtml(comment.content)}</div>
        <div class="comment-actions">
          ${comment.resolved 
            ? `<button class="comment-action-btn" onclick="unresolveComment(${comment.id})">↩ 重新打开</button>`
            : `<button class="comment-action-btn" onclick="resolveComment(${comment.id})">✓ 标记已解决</button>`
          }
          <button class="comment-action-btn" onclick="toggleReplyForm(${comment.id})">💬 回复</button>
        </div>
        <div id="replyForm-${comment.id}" class="reply-form" style="display: none;">
          <input type="text" id="replyAuthor-${comment.id}" placeholder="你的名字" 
                 value="${escapeHtml(reviewerName)}" class="reply-input">
          <textarea id="replyContent-${comment.id}" placeholder="输入回复内容..." 
                    class="reply-textarea"></textarea>
          <button class="btn btn-primary btn-sm" onclick="submitReply(${comment.id}, 
            document.getElementById('replyContent-${comment.id}').value,
            document.getElementById('replyAuthor-${comment.id}').value)">
            发送回复
          </button>
        </div>
        ${comment.replies && comment.replies.length > 0 ? `
          <div class="comment-replies">
            ${comment.replies.map(reply => `
              <div class="comment-reply">
                <div class="comment-header">
                  <span class="comment-author">${escapeHtml(reply.author)}</span>
                  <span class="comment-time">${formatDate(reply.created_at)}</span>
                </div>
                <div class="comment-content">${escapeHtml(reply.content)}</div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
  });
  
  contentEl.innerHTML = html;
}

function toggleReplyForm(commentId) {
  const form = document.getElementById(`replyForm-${commentId}`);
  if (form) {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
  }
}

function getCommentBubbleCount(oldLine, newLine) {
  const comments = getCommentsForLine(
    oldLine !== undefined ? oldLine : null,
    newLine !== undefined ? newLine : null
  );
  return comments.length;
}

function updateSelectedVersionsDisplay() {
  const displayEl = document.getElementById('selectedVersions');
  const compareBtn = document.getElementById('compareBtn');
  const createReviewBtn = document.getElementById('createReviewBtn');
  
  if (selectedOldVersion !== null && selectedNewVersion !== null) {
    displayEl.textContent = `v${selectedOldVersion} → v${selectedNewVersion}`;
    compareBtn.disabled = false;
    createReviewBtn.disabled = false;
  } else if (selectedOldVersion !== null) {
    displayEl.textContent = `v${selectedOldVersion} (请再选一个)`;
    compareBtn.disabled = true;
    createReviewBtn.disabled = true;
  } else if (selectedNewVersion !== null) {
    displayEl.textContent = `v${selectedNewVersion} (请再选一个)`;
    compareBtn.disabled = true;
    createReviewBtn.disabled = true;
  } else {
    displayEl.textContent = '-';
    compareBtn.disabled = true;
    createReviewBtn.disabled = true;
  }
}

function renderLine(type, lineNum, content, charDiff = null, side = null) {
  const lineNumStr = lineNum !== '' ? lineNum : '';
  let contentHtml = escapeHtml(content);
  
  if (charDiff && (type === 'modified-old' || type === 'modified-new')) {
    contentHtml = renderCharDiff(charDiff, side);
  }
  
  const prefix = type === 'added' ? '+' : (type === 'deleted' ? '-' : ' ');
  
  const oldLine = side === 'old' && lineNum !== '' ? lineNum : null;
  const newLine = side === 'new' && lineNum !== '' ? lineNum : null;
  const bubbleCount = currentReviewId ? getCommentBubbleCount(oldLine, newLine) : 0;
  
  const bubbleHtml = bubbleCount > 0 
    ? `<span class="comment-bubble" onclick="event.stopPropagation(); showLineComments(${oldLine || 'null'}, ${newLine || 'null'})">${bubbleCount}</span>`
    : '';
  
  const addCommentBtn = currentReviewId && lineNum !== ''
    ? `<span class="add-comment-btn" onclick="event.stopPropagation(); showAddCommentModal(${oldLine || 'null'}, ${newLine || 'null'}, '${side}')" title="添加评论">+</span>`
    : '';
  
  return `
    <div class="diff-line diff-line-${type}" onclick="showLineComments(${oldLine || 'null'}, ${newLine || 'null'})">
      ${addCommentBtn}
      <span class="line-number">${lineNumStr}</span>
      <span class="line-prefix">${prefix}</span>
      <span class="line-content">${contentHtml || '&nbsp;'}</span>
      ${bubbleHtml}
    </div>
  `;
}

document.addEventListener('DOMContentLoaded', () => {
  loadDocuments();
  connectWebSocket();
  
  const pathParts = window.location.pathname.split('/');
  const pathType = pathParts[pathParts.length - 2];
  const idFromUrl = pathParts[pathParts.length - 1];
  
  if (idFromUrl && !isNaN(parseInt(idFromUrl))) {
    const id = parseInt(idFromUrl);
    if (pathType === 'review') {
      selectDocumentFromReview(id);
    } else {
      selectDocument(id);
    }
  }
});

async function selectDocumentFromReview(reviewId) {
  try {
    const res = await fetch(`/api/reviews/${reviewId}`);
    const review = await res.json();
    if (!review) {
      showToast('评审不存在', 'error');
      return;
    }
    
    currentDocId = review.document_id;
    
    const docRes = await fetch(`/api/documents/${review.document_id}`);
    const doc = await docRes.json();
    currentDocument = doc;
    
    document.getElementById('versionPanel').style.display = 'block';
    document.getElementById('docTitle').textContent = doc.title;
    renderVersionTimeline(doc.versions);
    loadDocuments();
    loadReviewList();
    
    await joinReview(reviewId);
  } catch (e) {
    console.error('加载评审失败:', e);
    showToast('加载评审失败', 'error');
  }
}
