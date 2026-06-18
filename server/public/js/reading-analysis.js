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

    this.recommendations = [];
    this.recommendedParagraphIndices = new Set();
    this.readParagraphsByMe = new Set();

    this.highlights = [];
    this.editingHighlight = null;
    this.selectionState = null;

    this.paragraphDwellTimers = new Map();

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

    document.getElementById('cancelHighlightBtn').addEventListener('click', () => {
      this.hideHighlightPopover();
      window.getSelection().removeAllRanges();
    });

    document.getElementById('saveHighlightBtn').addEventListener('click', () => {
      this.saveNewHighlight();
    });

    document.getElementById('closeDetailModal').addEventListener('click', () => {
      this.closeHighlightDetailModal();
    });

    document.getElementById('cancelEditHighlightBtn').addEventListener('click', () => {
      this.closeHighlightDetailModal();
    });

    document.getElementById('saveEditHighlightBtn').addEventListener('click', () => {
      this.saveHighlightEdit();
    });

    document.getElementById('deleteHighlightBtn').addEventListener('click', () => {
      this.deleteHighlight();
    });

    document.querySelector('#highlightDetailModal .modal-overlay').addEventListener('click', () => {
      this.closeHighlightDetailModal();
    });

    document.addEventListener('selectionchange', () => {
      this.handleTextSelection();
    });

    document.addEventListener('click', (e) => {
      const popover = document.getElementById('highlightPopover');
      if (!popover.contains(e.target) && !e.target.closest('.highlight-span')) {
        this.hideHighlightPopover();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideHighlightPopover();
        this.closeHighlightDetailModal();
      }
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
      await Promise.all([
        this.loadRecommendations(),
        this.loadHighlights()
      ]);
      this.renderDocument();
      this.setupParagraphDwellTracking();
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

      const starHtml = this.recommendedParagraphIndices.has(index) && !this.readParagraphsByMe.has(index)
        ? `<span class="recommendation-star" title="推荐阅读：未读但大家都觉得重要" data-paragraph-index="${index}">⭐</span>`
        : '';

      const readClass = this.readParagraphsByMe.has(index) ? ' read' : '';

      const contentWithHighlights = this.renderParagraphTextWithHighlights(para, index);

      return `
        <div class="heatmap-paragraph ${heatClass}${readClass}" data-paragraph-index="${index}">
          ${starHtml}
          <div class="paragraph-meta">${metaText}</div>
          <p>${contentWithHighlights}</p>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    this.attachParagraphEventListeners();
  }

  renderParagraphTextWithHighlights(text, paragraphIndex) {
    const escapedText = this.escapeHtml(text);
    const paraHighlights = this.highlights.filter(h => h.paragraph_index === paragraphIndex);

    if (paraHighlights.length === 0) {
      return escapedText;
    }

    const segments = [];
    let cursor = 0;
    const textLen = escapedText.length;

    const sortedHighlights = [...paraHighlights].sort((a, b) => a.start_offset - b.start_offset);

    sortedHighlights.forEach(hl => {
      const start = Math.min(hl.start_offset, textLen);
      const end = Math.min(hl.end_offset, textLen);

      if (start >= textLen || start >= end) {
        return;
      }

      if (start > cursor) {
        segments.push({
          type: 'text',
          content: escapedText.substring(cursor, start)
        });
      }

      segments.push({
        type: 'highlight',
        start,
        end,
        highlight: hl,
        content: escapedText.substring(start, end)
      });

      cursor = Math.max(cursor, end);
    });

    if (cursor < textLen) {
      segments.push({
        type: 'text',
        content: escapedText.substring(cursor)
      });
    }

    return segments.map(seg => {
      if (seg.type === 'text') {
        return seg.content;
      }

      const hl = seg.highlight;
      const isOwn = hl.created_by === this.currentUserId;
      const className = isOwn ? 'highlight-span highlight-own' : 'highlight-span highlight-other';
      const visibilityLabel = hl.visibility === 'public' ? '🌐 公开' : '🔒 私有';
      const visibilityClass = hl.visibility === 'public' ? 'tooltip-public' : 'tooltip-private';
      const commentHtml = hl.comment_text 
        ? `<div class="tooltip-comment">${this.escapeHtml(hl.comment_text)}</div>`
        : '';
      const selectedPreview = hl.selected_text && hl.selected_text.length > 60
        ? this.escapeHtml(hl.selected_text.substring(0, 60)) + '...'
        : this.escapeHtml(hl.selected_text || '');
      const authorDisplay = isOwn ? '我' : this.escapeHtml(hl.created_by_username || hl.created_by);

      const tooltipHtml = `
        <div class="highlight-tooltip">
          <div class="tooltip-author">
            ${authorDisplay}
            <span class="tooltip-visibility ${visibilityClass}">${visibilityLabel}</span>
          </div>
          ${commentHtml}
          ${selectedPreview ? `<div class="tooltip-selected">「${selectedPreview}」</div>` : ''}
        </div>
      `;

      return `<span class="${className}" data-highlight-id="${hl.id}" title="">${seg.content}${tooltipHtml}</span>`;
    }).join('');
  }

  attachParagraphEventListeners() {
    const container = document.getElementById('documentContent');

    container.querySelectorAll('.recommendation-star').forEach(star => {
      star.addEventListener('click', (e) => {
        const pIndex = parseInt(e.currentTarget.dataset.paragraphIndex);
        this.scrollToParagraph(pIndex);
      });
    });

    container.querySelectorAll('.highlight-span').forEach(span => {
      span.addEventListener('click', (e) => {
        const hlId = parseInt(e.currentTarget.dataset.highlightId);
        const hl = this.highlights.find(h => h.id === hlId);
        if (hl) {
          e.stopPropagation();
          if (hl.created_by === this.currentUserId) {
            this.openHighlightDetailModal(hl);
          }
        }
      });
    });

    container.querySelectorAll('.heatmap-paragraph').forEach(paraEl => {
      paraEl.addEventListener('mouseenter', (e) => {
        const pIndex = parseInt(e.currentTarget.dataset.paragraphIndex);
        this.startParagraphDwell(pIndex);
      });

      paraEl.addEventListener('mouseleave', (e) => {
        const pIndex = parseInt(e.currentTarget.dataset.paragraphIndex);
        this.endParagraphDwell(pIndex);
      });
    });
  }

  setupParagraphDwellTracking() {
    setInterval(() => {
      this.paragraphDwellTimers.forEach((startTime, pIndex) => {
        const currentDwell = Date.now() - startTime;
        if (currentDwell >= 3000 && !this.readParagraphsByMe.has(pIndex)) {
          this.markParagraphAsRead(pIndex, currentDwell);
        }
      });
    }, 1000);
  }

  startParagraphDwell(paragraphIndex) {
    if (!this.paragraphDwellTimers.has(paragraphIndex)) {
      this.paragraphDwellTimers.set(paragraphIndex, Date.now());
    }
  }

  endParagraphDwell(paragraphIndex) {
    if (this.paragraphDwellTimers.has(paragraphIndex)) {
      const startTime = this.paragraphDwellTimers.get(paragraphIndex);
      const dwellMs = Date.now() - startTime;
      this.paragraphDwellTimers.delete(paragraphIndex);

      if (dwellMs >= 2000 && !this.readParagraphsByMe.has(paragraphIndex)) {
        this.markParagraphAsRead(paragraphIndex, dwellMs);
      }
    }
  }

  markParagraphAsRead(paragraphIndex, dwellMs) {
    if (this.readParagraphsByMe.has(paragraphIndex)) return;
    this.readParagraphsByMe.add(paragraphIndex);

    const paraEl = document.querySelector(`.heatmap-paragraph[data-paragraph-index="${paragraphIndex}"]`);
    if (paraEl) {
      paraEl.classList.add('read');
      const star = paraEl.querySelector('.recommendation-star');
      if (star) {
        star.remove();
      }
    }
    if (this.recommendedParagraphIndices.has(paragraphIndex)) {
      this.recommendedParagraphIndices.delete(paragraphIndex);
      this.recommendations = this.recommendations.filter(r => r.paragraph_index !== paragraphIndex);
      this.renderRecommendations();
    }

    this.reportParagraphProgress(paragraphIndex, dwellMs || 3000);
  }

  async reportParagraphProgress(paragraphIndex, dwellMs) {
    try {
      await this.apiFetch(`/api/documents/${this.documentId}/reading/progress`, {
        method: 'POST',
        body: JSON.stringify({
          paragraph_index: paragraphIndex,
          dwell_time_ms: dwellMs,
          words_read: this.paragraphs[paragraphIndex]?.length || 0
        })
      });
    } catch (e) {
      console.warn('上报段落进度失败(不影响功能):', e);
    }
  }

  async loadRecommendations() {
    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}/reading/recommendations`);
      if (response.ok) {
        const data = await response.json();
        this.recommendations = data.recommendations || [];
        this.readParagraphsByMe = new Set(data.read_paragraph_indices || []);
        this.recommendedParagraphIndices = new Set(this.recommendations.map(r => r.paragraph_index));
        this.renderRecommendations();
      }
    } catch (e) {
      console.error('加载推荐失败:', e);
    }
  }

  renderRecommendations() {
    const countEl = document.getElementById('recCount');
    const listEl = document.getElementById('recommendationList');

    countEl.textContent = this.recommendations.length;

    if (this.recommendations.length === 0) {
      listEl.innerHTML = '<div class="empty-tip">暂无推荐。继续阅读，或等待其他读者反馈产生更多推荐内容。</div>';
      return;
    }

    const html = this.recommendations.slice(0, 10).map(rec => {
      const preview = this.paragraphs[rec.paragraph_index] || '';
      const previewText = preview.length > 80 ? preview.substring(0, 80) + '...' : preview;
      return `
        <div class="recommendation-item" data-paragraph-index="${rec.paragraph_index}">
          <span class="rec-star">⭐</span>
          <div class="rec-content">
            <div class="rec-header">
              <span class="rec-para-label">第 ${rec.paragraph_index + 1} 段</span>
              <span class="rec-heat">🔥 ${rec.heat_score}</span>
            </div>
            <div class="rec-preview">${this.escapeHtml(previewText)}</div>
            <div class="rec-readers">👥 ${rec.unique_reader_count} 人认为重要</div>
          </div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;

    listEl.querySelectorAll('.recommendation-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const pIndex = parseInt(e.currentTarget.dataset.paragraphIndex);
        this.scrollToParagraph(pIndex);
      });
    });
  }

  scrollToParagraph(paragraphIndex) {
    const paraEl = document.querySelector(`.heatmap-paragraph[data-paragraph-index="${paragraphIndex}"]`);
    if (paraEl) {
      paraEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      paraEl.style.outline = '2px solid #f59e0b';
      paraEl.style.transition = 'outline 0.3s';
      setTimeout(() => {
        paraEl.style.outline = 'none';
      }, 2000);
    }
  }

  async loadHighlights() {
    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}/highlights`);
      if (response.ok) {
        const data = await response.json();
        this.highlights = Array.isArray(data) ? data : (data.highlights || []);
        this.renderMyHighlights();
      }
    } catch (e) {
      console.error('加载划线失败:', e);
    }
  }

  renderMyHighlights() {
    const countEl = document.getElementById('highlightCount');
    const listEl = document.getElementById('myHighlightsList');

    const sortedHighlights = [...this.highlights].sort((a, b) => {
      if (a.paragraph_index !== b.paragraph_index) {
        return a.paragraph_index - b.paragraph_index;
      }
      return a.start_offset - b.start_offset;
    });

    const myCount = sortedHighlights.filter(h => h.created_by === this.currentUserId).length;
    const visibleOthersCount = sortedHighlights.filter(h => h.created_by !== this.currentUserId && h.visibility === 'public').length;
    countEl.textContent = myCount + visibleOthersCount > 0
      ? `${myCount + visibleOthersCount}`
      : '0';

    if (sortedHighlights.length === 0) {
      listEl.innerHTML = '<div class="empty-tip">暂无划线。选中文本后会弹出「添加批注」浮层，创建你的第一条划线吧！</div>';
      return;
    }

    const html = sortedHighlights.map(hl => {
      const isOwn = hl.created_by === this.currentUserId;
      const itemClass = isOwn ? 'highlight-own' : 'highlight-other';
      const visibilityClass = hl.visibility === 'public' ? 'vis-public' : 'vis-private';
      const visibilityLabel = hl.visibility === 'public' ? '🌐 公开' : '🔒 私有';
      const authorDisplay = isOwn ? '我' : this.escapeHtml(hl.created_by_username || hl.created_by);
      const comment = hl.comment_text ? this.escapeHtml(hl.comment_text) : '<span style="opacity:0.5;">（无批注）</span>';
      const selectedPreview = hl.selected_text && hl.selected_text.length > 50
        ? this.escapeHtml(hl.selected_text.substring(0, 50)) + '...'
        : this.escapeHtml(hl.selected_text || '');

      return `
        <div class="highlight-item ${itemClass}" data-highlight-id="${hl.id}" data-paragraph-index="${hl.paragraph_index}">
          <div class="highlight-item-top">
            <span class="highlight-location">📍 第 ${hl.paragraph_index + 1} 段 · 字${hl.start_offset}-${hl.end_offset}</span>
            <span class="highlight-visibility-tag ${visibilityClass}">${visibilityLabel}</span>
          </div>
          <div class="highlight-author">👤 ${authorDisplay}</div>
          <div class="highlight-comment-preview">${comment}</div>
          <div class="highlight-selected-text">${selectedPreview}</div>
        </div>
      `;
    }).join('');

    listEl.innerHTML = html;

    listEl.querySelectorAll('.highlight-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const hlId = parseInt(e.currentTarget.dataset.highlightId);
        const pIndex = parseInt(e.currentTarget.dataset.paragraphIndex);
        const hl = this.highlights.find(h => h.id === hlId);
        if (hl && hl.created_by === this.currentUserId) {
          this.openHighlightDetailModal(hl);
        }
        this.scrollToParagraph(pIndex);
      });
    });
  }

  handleTextSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    const range = selection.getRangeAt(0);
    const selectedText = selection.toString().trim();

    if (!selectedText || selectedText.length < 2) {
      this.hideHighlightPopover();
      return;
    }

    const container = document.getElementById('documentContent');
    if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
      this.hideHighlightPopover();
      return;
    }

    const paraEl = range.startContainer.parentElement.closest('.heatmap-paragraph');
    const endParaEl = range.endContainer.parentElement.closest('.heatmap-paragraph');

    if (!paraEl || paraEl !== endParaEl) {
      this.hideHighlightPopover();
      return;
    }

    const paragraphIndex = parseInt(paraEl.dataset.paragraphIndex);
    const paragraphText = this.paragraphs[paragraphIndex] || '';
    const preRange = document.createRange();
    preRange.selectNodeContents(paraEl.querySelector('p'));
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = this.countActualTextOffset(paraEl.querySelector('p'), preRange.toString());
    preRange.setEnd(range.endContainer, range.endOffset);
    const endOffset = this.countActualTextOffset(paraEl.querySelector('p'), preRange.toString());

    if (startOffset < 0 || endOffset <= startOffset) {
      return;
    }

    const actualSelected = paragraphText.substring(startOffset, endOffset);
    this.selectionState = {
      paragraphIndex,
      startOffset,
      endOffset,
      selectedText: actualSelected || selectedText,
      range
    };

    this.showHighlightPopover(range);
  }

  countActualTextOffset(paragraphPElement, textUntilSelection) {
    let cleanText = '';
    const walker = document.createTreeWalker(
      paragraphPElement,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (walker.nextNode()) {
      cleanText += walker.currentNode.nodeValue;
    }

    const targetLen = Math.min(textUntilSelection.length, cleanText.length);
    return targetLen;
  }

  showHighlightPopover(range) {
    const popover = document.getElementById('highlightPopover');
    const rect = range.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    popover.classList.remove('hidden');
    const popoverRect = popover.getBoundingClientRect();

    let left = rect.left + scrollX + rect.width / 2 - popoverRect.width / 2;
    let top = rect.top + scrollY - popoverRect.height - 12;

    if (left < 10) left = 10;
    if (left + popoverRect.width > window.innerWidth - 10) {
      left = window.innerWidth - popoverRect.width - 10;
    }
    if (top < scrollY + 10) {
      top = rect.bottom + scrollY + 12;
      popover.querySelector('.popover-arrow').style.top = '-6px';
      popover.querySelector('.popover-arrow').style.transform = 'rotate(45deg)';
    } else {
      popover.querySelector('.popover-arrow').style.top = 'auto';
      popover.querySelector('.popover-arrow').style.bottom = '-6px';
      popover.querySelector('.popover-arrow').style.transform = 'rotate(225deg)';
    }

    popover.style.left = left + 'px';
    popover.style.top = top + 'px';

    document.getElementById('highlightComment').value = '';
    document.getElementById('highlightComment').focus();
  }

  hideHighlightPopover() {
    document.getElementById('highlightPopover').classList.add('hidden');
    this.selectionState = null;
  }

  async saveNewHighlight() {
    if (!this.selectionState) return;

    const commentText = document.getElementById('highlightComment').value.trim();
    const visibility = document.querySelector('input[name="visibility"]:checked')?.value || 'public';

    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}/highlights`, {
        method: 'POST',
        body: JSON.stringify({
          paragraph_index: this.selectionState.paragraphIndex,
          start_offset: this.selectionState.startOffset,
          end_offset: this.selectionState.endOffset,
          selected_text: this.selectionState.selectedText,
          comment_text: commentText,
          visibility,
          created_by_username: this.currentUserName
        })
      });

      if (response.ok) {
        const newHl = await response.json();
        this.highlights.push(newHl);
        this.renderDocument();
        this.renderMyHighlights();
        this.hideHighlightPopover();
        window.getSelection().removeAllRanges();
        this.showToast('划线保存成功', 'success');
      } else {
        const err = await response.json().catch(() => ({}));
        this.showToast('保存失败：' + (err.error || '未知错误'), 'error');
      }
    } catch (e) {
      console.error('保存划线失败:', e);
      this.showToast('保存失败，请重试', 'error');
    }
  }

  openHighlightDetailModal(highlight) {
    this.editingHighlight = highlight;

    const modal = document.getElementById('highlightDetailModal');
    modal.classList.remove('hidden');

    const isOwn = highlight.created_by === this.currentUserId;

    document.getElementById('detailModalTitle').textContent = isOwn ? '编辑我的划线' : '划线详情';
    document.getElementById('detailSelectedText').textContent = highlight.selected_text || '';

    const metaItems = [
      `<span class="meta-item">📍 第 ${highlight.paragraph_index + 1} 段</span>`,
      `<span class="meta-item">👤 ${this.escapeHtml(highlight.created_by_username || highlight.created_by || '匿名')}</span>`,
      `<span class="meta-item">🕐 ${this.formatTime(highlight.created_at)}</span>`
    ];
    document.getElementById('detailMeta').innerHTML = metaItems.join('');

    document.getElementById('detailCommentText').value = highlight.comment_text || '';
    document.getElementById('detailCommentText').disabled = !isOwn;

    const pubRadio = document.querySelector('input[name="detailVisibility"][value="public"]');
    const privRadio = document.querySelector('input[name="detailVisibility"][value="private"]');
    if (highlight.visibility === 'public') {
      pubRadio.checked = true;
    } else {
      privRadio.checked = true;
    }
    pubRadio.disabled = !isOwn;
    privRadio.disabled = !isOwn;

    document.getElementById('deleteHighlightBtn').style.display = isOwn ? 'inline-block' : 'none';
    document.getElementById('saveEditHighlightBtn').style.display = isOwn ? 'inline-block' : 'none';
  }

  closeHighlightDetailModal() {
    document.getElementById('highlightDetailModal').classList.add('hidden');
    this.editingHighlight = null;
  }

  async saveHighlightEdit() {
    if (!this.editingHighlight) return;

    const commentText = document.getElementById('detailCommentText').value.trim();
    const visibility = document.querySelector('input[name="detailVisibility"]:checked')?.value || 'public';

    try {
      const response = await this.apiFetch(`/api/highlights/${this.editingHighlight.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          comment_text: commentText,
          visibility
        })
      });

      if (response.ok) {
        const updated = await response.json();
        const idx = this.highlights.findIndex(h => h.id === updated.id);
        if (idx >= 0) {
          this.highlights[idx] = updated;
        }
        this.renderDocument();
        this.renderMyHighlights();
        this.closeHighlightDetailModal();
        this.showToast('划线已更新', 'success');
      } else {
        this.showToast('更新失败', 'error');
      }
    } catch (e) {
      console.error('更新划线失败:', e);
      this.showToast('更新失败，请重试', 'error');
    }
  }

  async deleteHighlight() {
    if (!this.editingHighlight) return;
    if (!confirm('确定要删除这条划线吗？此操作不可撤销。')) return;

    try {
      const response = await this.apiFetch(`/api/highlights/${this.editingHighlight.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const hlId = this.editingHighlight.id;
        this.highlights = this.highlights.filter(h => h.id !== hlId);
        this.renderDocument();
        this.renderMyHighlights();
        this.closeHighlightDetailModal();
        this.showToast('划线已删除', 'success');
      } else {
        this.showToast('删除失败', 'error');
      }
    } catch (e) {
      console.error('删除划线失败:', e);
      this.showToast('删除失败，请重试', 'error');
    }
  }

  formatTime(timestamp) {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
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
    if (this.paragraphs.length > 0 && this.highlights.length !== undefined) {
      this.renderDocument();
    }
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
      this.ws.send(JSON.stringify({
        type: 'subscribe_highlights',
        documentId: this.documentId
      }));
      this.ws.send(JSON.stringify({
        type: 'subscribe_user_highlights',
        documentId: this.documentId
      }));
      this.ws.send(JSON.stringify({
        type: 'subscribe_recommendations',
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
          if (this.paragraphs.length > 0) {
            this.renderDocument();
          }
        }
        break;

      case 'highlight_created':
      case 'highlight_updated':
        if (data.highlight && data.documentId === this.documentId) {
          const hl = data.highlight;
          const isVisible = hl.visibility === 'public' || hl.created_by === this.currentUserId;
          if (!isVisible) break;

          const idx = this.highlights.findIndex(h => h.id === hl.id);
          if (idx >= 0) {
            this.highlights[idx] = hl;
          } else {
            this.highlights.push(hl);
            if (data.type === 'highlight_created' && hl.created_by !== this.currentUserId) {
              this.showToast(`👥 ${hl.created_by_username || '有用户'} 在第${hl.paragraph_index + 1}段新增了划线`, 'info');
            }
          }
          this.renderDocument();
          this.renderMyHighlights();
        }
        break;

      case 'highlight_deleted':
        if (data.documentId === this.documentId) {
          const hlId = data.highlight_id;
          const beforeLen = this.highlights.length;
          this.highlights = this.highlights.filter(h => h.id !== hlId);
          if (this.highlights.length !== beforeLen) {
            this.renderDocument();
            this.renderMyHighlights();
          }
        }
        break;

      case 'recommendations_updated':
        if (data.recommendations) {
          this.recommendations = data.recommendations;
          this.recommendedParagraphIndices = new Set(this.recommendations.map(r => r.paragraph_index));
          if (data.read_paragraph_indices) {
            this.readParagraphsByMe = new Set(data.read_paragraph_indices);
          }
          this.renderRecommendations();
          if (this.paragraphs.length > 0) {
            this.renderDocument();
          }
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
