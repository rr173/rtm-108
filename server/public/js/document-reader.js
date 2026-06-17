function showToast(message, type = 'info') {
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

function formatDate(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

class DocumentReader {
  constructor() {
    this.documentId = null;
    this.document = null;
    this.annotations = [];
    this.relations = [];
    this.ws = null;
    this.selectedText = null;
    this.selectionRange = null;
    this.currentAnnotationId = null;
    this.currentAnnotation = null;
    this.currentUserId = localStorage.getItem('currentUserId') || 'user-admin';
    this.pendingAnnotationId = null;
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
    const pathMatch = window.location.pathname.match(/\/document\/(\d+)/);
    this.documentId = pathMatch ? parseInt(pathMatch[1]) : parseInt(urlParams.get('docId') || urlParams.get('id'));
    this.pendingAnnotationId = parseInt(urlParams.get('annotation')) || null;

    if (!this.documentId) {
      alert('无效的文档ID');
      window.location.href = '/';
      return;
    }

    this.bindEvents();
    this.loadDocument();
    this.connectWebSocket();
  }

  bindEvents() {
    document.getElementById('backBtn').addEventListener('click', () => {
      window.location.href = '/';
    });

    document.getElementById('viewGraphBtn').addEventListener('click', () => {
      window.location.href = `/graph/${this.documentId}`;
    });

    document.getElementById('documentContent').addEventListener('mouseup', (e) => {
      this.handleTextSelection(e);
    });

    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.selection-toolbar') && !e.target.closest('#documentContent')) {
        this.hideSelectionToolbar();
      }
      if (!e.target.closest('.annotation-detail') && !e.target.closest('.annotation-highlight')) {
        this.hideAnnotationDetail();
      }
    });

    document.querySelectorAll('.selection-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        this.showAnnotationModal(type);
      });
    });

    document.getElementById('modalClose').addEventListener('click', () => {
      this.hideAnnotationModal();
    });
    document.getElementById('modalCancel').addEventListener('click', () => {
      this.hideAnnotationModal();
    });
    document.getElementById('modalSave').addEventListener('click', () => {
      this.saveAnnotation();
    });

    document.getElementById('detailClose').addEventListener('click', () => {
      this.hideAnnotationDetail();
    });

    document.getElementById('addRelationBtn').addEventListener('click', () => {
      this.showRelationModal();
    });

    document.getElementById('deleteAnnotationBtn').addEventListener('click', () => {
      this.deleteAnnotation();
    });

    document.getElementById('relationModalClose').addEventListener('click', () => {
      this.hideRelationModal();
    });
    document.getElementById('relationModalCancel').addEventListener('click', () => {
      this.hideRelationModal();
    });
    document.getElementById('relationModalSave').addEventListener('click', () => {
      this.saveRelation();
    });
  }

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.updateConnectionStatus(true);
      this.ws.send(JSON.stringify({
        type: 'subscribe_annotations',
        documentId: this.documentId
      }));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleWebSocketMessage(data);
    };

    this.ws.onclose = () => {
      this.updateConnectionStatus(false);
      setTimeout(() => this.connectWebSocket(), 3000);
    };

    this.ws.onerror = () => {
      this.updateConnectionStatus(false);
    };
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

  handleWebSocketMessage(data) {
    switch (data.type) {
      case 'annotations_status':
        this.annotations = data.graph.annotations;
        this.relations = data.graph.relations;
        this.updateAnnotationList();
        this.renderHighlights();
        this.updateStats();
        break;
      case 'annotation_created':
        if (!this.annotations.find(a => a.id === data.annotation.id)) {
          this.annotations.push(data.annotation);
          this.updateAnnotationList();
          this.renderHighlights();
          this.updateStats();
        }
        break;
      case 'annotation_updated':
        const updateIdx = this.annotations.findIndex(a => a.id === data.annotation.id);
        if (updateIdx !== -1) {
          this.annotations[updateIdx] = data.annotation;
          this.updateAnnotationList();
          this.renderHighlights();
        }
        break;
      case 'annotation_deleted':
        this.annotations = this.annotations.filter(a => a.id !== data.annotation.id);
        this.relations = this.relations.filter(
          r => r.from_annotation_id !== data.annotation.id && r.to_annotation_id !== data.annotation.id
        );
        this.updateAnnotationList();
        this.renderHighlights();
        this.updateStats();
        this.hideAnnotationDetail();
        break;
      case 'relation_created':
        if (!this.relations.find(r => r.id === data.relation.id)) {
          this.relations.push(data.relation);
          this.updateStats();
          if (this.currentAnnotationId) {
            this.showAnnotationDetail(this.currentAnnotationId);
          }
        }
        break;
      case 'relation_updated':
        const relIdx = this.relations.findIndex(r => r.id === data.relation.id);
        if (relIdx !== -1) {
          this.relations[relIdx] = data.relation;
          if (this.currentAnnotationId) {
            this.showAnnotationDetail(this.currentAnnotationId);
          }
        }
        break;
      case 'relation_deleted':
        this.relations = this.relations.filter(r => r.id !== data.relation.id);
        this.updateStats();
        if (this.currentAnnotationId) {
          this.showAnnotationDetail(this.currentAnnotationId);
        }
        break;
    }
  }

  async loadDocument() {
    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}`);
      this.document = await response.json();
      document.getElementById('documentTitle').textContent = this.document.title;
      this.renderContent();
      this.loadAnnotations();
    } catch (error) {
      console.error('加载文档失败:', error);
      document.getElementById('documentContent').innerHTML = `
        <div class="error">加载文档失败: ${error.message}</div>
      `;
    }
  }

  async loadAnnotations() {
    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}/annotations`);
      this.annotations = await response.json();

      const relResponse = await this.apiFetch(`/api/documents/${this.documentId}/relations`);
      this.relations = await relResponse.json();

      this.updateAnnotationList();
      this.renderHighlights();
      this.updateStats();

      if (this.pendingAnnotationId) {
        setTimeout(() => {
          this.jumpToAnnotation(this.pendingAnnotationId);
          this.showAnnotationDetail(this.pendingAnnotationId);
          this.pendingAnnotationId = null;
        }, 200);
      }
    } catch (error) {
      console.error('加载标注失败:', error);
    }
  }

  renderContent() {
    const contentEl = document.getElementById('documentContent');
    const latestVersion = this.document.versions[this.document.versions.length - 1];
    const content = latestVersion.content;

    contentEl.innerHTML = `<div class="document-text" id="documentText">${this.escapeHtml(content)}</div>`;
  }

  renderHighlights() {
    const textEl = document.getElementById('documentText');
    if (!textEl) return;

    const latestVersion = this.document.versions[this.document.versions.length - 1];
    const content = latestVersion.content;

    const sortedAnnotations = [...this.annotations].sort((a, b) => a.start_offset - b.start_offset);

    let html = '';
    let lastIndex = 0;

    sortedAnnotations.forEach((annotation, idx) => {
      if (annotation.start_offset > lastIndex) {
        html += this.escapeHtml(content.substring(lastIndex, annotation.start_offset));
      }

      html += `<span class="annotation-highlight" 
                   data-id="${annotation.id}" 
                   data-type="${annotation.type}"
                   style="background-color: ${annotation.color}; border-color: ${annotation.border_color};">
                ${this.escapeHtml(annotation.text)}
              </span>`;

      lastIndex = annotation.end_offset;
    });

    if (lastIndex < content.length) {
      html += this.escapeHtml(content.substring(lastIndex));
    }

    textEl.innerHTML = html;

    textEl.querySelectorAll('.annotation-highlight').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(el.dataset.id);
        this.showAnnotationDetail(id);
      });
    });
  }

  updateAnnotationList() {
    const listEl = document.getElementById('annotationList');

    if (this.annotations.length === 0) {
      listEl.innerHTML = '<div class="empty-state">暂无标注</div>';
      return;
    }

    const grouped = this.annotations.reduce((acc, ann) => {
      acc[ann.type] = acc[ann.type] || [];
      acc[ann.type].push(ann);
      return acc;
    }, {});

    let html = '';
    const typeLabels = { person: '人物', location: '地点', event: '事件', concept: '概念' };
    const typeOrder = ['person', 'location', 'event', 'concept'];

    typeOrder.forEach(type => {
      if (grouped[type] && grouped[type].length > 0) {
        html += `<div class="annotation-group">
                  <div class="group-title">${typeLabels[type]} (${grouped[type].length})</div>`;
        grouped[type].forEach(ann => {
          html += `<div class="annotation-item" data-id="${ann.id}">
                    <span class="item-color" style="background: ${ann.color}; border-color: ${ann.border_color};"></span>
                    <span class="item-text" title="${ann.text}">${ann.text.length > 15 ? ann.text.substring(0, 15) + '...' : ann.text}</span>
                  </div>`;
        });
        html += '</div>';
      }
    });

    listEl.innerHTML = html;

    listEl.querySelectorAll('.annotation-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.id);
        this.jumpToAnnotation(id);
      });
    });
  }

  updateStats() {
    document.getElementById('annotationCount').textContent = `${this.annotations.length} 个标注`;
    document.getElementById('relationCount').textContent = `${this.relations.length} 条关系`;
  }

  handleTextSelection(e) {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();

    if (text.length === 0) {
      this.hideSelectionToolbar();
      return;
    }

    const docTextEl = document.getElementById('documentText');
    if (!docTextEl || !docTextEl.contains(range.commonAncestorContainer)) {
      this.hideSelectionToolbar();
      return;
    }

    const preRange = document.createRange();
    preRange.selectNodeContents(docTextEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = preRange.toString().length;
    const endOffset = startOffset + text.length;

    this.selectedText = text;
    this.selectionRange = { start_offset: startOffset, end_offset: endOffset };

    const rect = range.getBoundingClientRect();
    const toolbar = document.getElementById('selectionToolbar');
    toolbar.style.left = `${rect.left + rect.width / 2 - toolbar.offsetWidth / 2}px`;
    toolbar.style.top = `${rect.top - toolbar.offsetHeight - 10 + window.scrollY}px`;
    toolbar.classList.remove('hidden');
  }

  hideSelectionToolbar() {
    document.getElementById('selectionToolbar').classList.add('hidden');
    window.getSelection().removeAllRanges();
  }

  showAnnotationModal(type) {
    this.hideSelectionToolbar();

    document.getElementById('selectedTextPreview').textContent = this.selectedText;
    document.getElementById('annotationType').value = type;
    document.getElementById('annotationDescription').value = '';
    document.getElementById('annotationModal').classList.remove('hidden');
  }

  hideAnnotationModal() {
    document.getElementById('annotationModal').classList.add('hidden');
  }

  async saveAnnotation() {
    const type = document.getElementById('annotationType').value;
    const description = document.getElementById('annotationDescription').value;

    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}/annotations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          start_offset: this.selectionRange.start_offset,
          end_offset: this.selectionRange.end_offset,
          text: this.selectedText,
          type,
          description
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '创建标注失败');
      }

      const newAnnotation = await response.json();
      
      if (!this.annotations.find(a => a.id === newAnnotation.id)) {
        this.annotations.push(newAnnotation);
        this.updateAnnotationList();
        this.renderHighlights();
        this.updateStats();
      }

      this.hideAnnotationModal();
      this.selectedText = null;
      this.selectionRange = null;
      
      showToast('标注创建成功', 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  showAnnotationDetail(annotationId) {
    const annotation = this.annotations.find(a => a.id === annotationId);
    if (!annotation) return;

    this.currentAnnotationId = annotationId;
    this.currentAnnotation = annotation;

    document.getElementById('detailType').textContent = annotation.type_label;
    document.getElementById('detailType').style.background = annotation.color;
    document.getElementById('detailType').style.borderColor = annotation.border_color;
    document.getElementById('detailText').textContent = annotation.text;
    document.getElementById('detailDescription').textContent = annotation.description || '暂无描述';
    document.getElementById('detailCreator').textContent = annotation.created_by;
    document.getElementById('detailTime').textContent = new Date(annotation.created_at).toLocaleString();

    const relatedRelations = this.relations.filter(
      r => r.from_annotation_id === annotationId || r.to_annotation_id === annotationId
    );

    const relListEl = document.getElementById('relationList');
    if (relatedRelations.length === 0) {
      relListEl.innerHTML = '<div class="empty-state">暂无关联</div>';
    } else {
      relListEl.innerHTML = relatedRelations.map(rel => {
        const isFrom = rel.from_annotation_id === annotationId;
        const otherAnn = isFrom
          ? this.annotations.find(a => a.id === rel.to_annotation_id)
          : this.annotations.find(a => a.id === rel.from_annotation_id);

        if (!otherAnn) return '';

        const direction = isFrom ? '→' : '←';
        return `<div class="relation-item">
                  <span class="relation-direction">${direction}</span>
                  <span class="relation-type">${rel.type_label}</span>
                  <span class="relation-target" 
                        style="background: ${otherAnn.color}; border-color: ${otherAnn.border_color};"
                        data-id="${otherAnn.id}">
                    ${otherAnn.text}
                  </span>
                  <button class="delete-relation" data-id="${rel.id}" title="删除关系">×</button>
                </div>`;
      }).join('');

      relListEl.querySelectorAll('.relation-target').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = parseInt(el.dataset.id);
          this.jumpToAnnotation(id);
          this.showAnnotationDetail(id);
        });
      });

      relListEl.querySelectorAll('.delete-relation').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = parseInt(el.dataset.id);
          this.deleteRelation(id);
        });
      });
    }

    const detailEl = document.getElementById('annotationDetail');
    detailEl.classList.remove('hidden');

    const highlightEl = document.querySelector(`.annotation-highlight[data-id="${annotationId}"]`);
    if (highlightEl) {
      const rect = highlightEl.getBoundingClientRect();
      detailEl.style.top = `${rect.bottom + 10 + window.scrollY}px`;
      detailEl.style.left = `${Math.min(rect.left, window.innerWidth - detailEl.offsetWidth - 20)}px`;
    }
  }

  hideAnnotationDetail() {
    document.getElementById('annotationDetail').classList.add('hidden');
    this.currentAnnotationId = null;
    this.currentAnnotation = null;
  }

  async deleteAnnotation() {
    if (!this.currentAnnotationId) return;
    if (!confirm('确定要删除这个标注吗？相关的关系也会被删除。')) return;

    try {
      const response = await this.apiFetch(`/api/annotations/${this.currentAnnotationId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '删除失败');
      }
    } catch (error) {
      alert(error.message);
    }
  }

  showRelationModal() {
    if (!this.currentAnnotation) return;

    document.getElementById('fromAnnotationPreview').textContent = this.currentAnnotation.text;

    const selectEl = document.getElementById('toAnnotationSelect');
    const otherAnnotations = this.annotations.filter(a => a.id !== this.currentAnnotationId);

    if (otherAnnotations.length === 0) {
      selectEl.innerHTML = '<option value="">暂无其他标注</option>';
    } else {
      selectEl.innerHTML = otherAnnotations.map(a =>
        `<option value="${a.id}">${a.type_label}: ${a.text}</option>`
      ).join('');
    }

    document.getElementById('relationType').value = 'participates';
    document.getElementById('relationDescription').value = '';
    document.getElementById('relationModal').classList.remove('hidden');
  }

  hideRelationModal() {
    document.getElementById('relationModal').classList.add('hidden');
  }

  async saveRelation() {
    const toAnnotationId = parseInt(document.getElementById('toAnnotationSelect').value);
    const type = document.getElementById('relationType').value;
    const description = document.getElementById('relationDescription').value;

    if (!toAnnotationId) {
      alert('请选择目标标注');
      return;
    }

    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}/relations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from_annotation_id: this.currentAnnotationId,
          to_annotation_id: toAnnotationId,
          type,
          description
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '创建关系失败');
      }

      this.hideRelationModal();
    } catch (error) {
      alert(error.message);
    }
  }

  async deleteRelation(relationId) {
    if (!confirm('确定要删除这条关系吗？')) return;

    try {
      const response = await this.apiFetch(`/api/relations/${relationId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '删除失败');
      }
    } catch (error) {
      alert(error.message);
    }
  }

  jumpToAnnotation(annotationId) {
    const annotation = this.annotations.find(a => a.id === annotationId);
    if (!annotation) return;

    const highlightEl = document.querySelector(`.annotation-highlight[data-id="${annotationId}"]`);
    if (highlightEl) {
      highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightEl.style.animation = 'none';
      highlightEl.offsetHeight;
      highlightEl.style.animation = 'pulse 1s ease-in-out 2';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new DocumentReader();
});
