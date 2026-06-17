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

class KnowledgeGraph {
  constructor() {
    this.documentId = null;
    this.document = null;
    this.annotations = [];
    this.relations = [];
    this.nodes = new Map();
    this.edges = [];
    this.ws = null;
    this.svg = null;
    this.nodesGroup = null;
    this.edgesGroup = null;
    this.width = 0;
    this.height = 0;
    this.dragging = null;
    this.simulation = null;

    this.nodeRadius = 40;
    this.forceStrength = 0.5;
    this.linkDistance = 150;
    this.currentUserId = localStorage.getItem('currentUserId') || 'user-admin';
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
    const pathMatch = window.location.pathname.match(/\/graph\/(\d+)/);
    this.documentId = pathMatch ? parseInt(pathMatch[1]) : parseInt(urlParams.get('docId') || urlParams.get('id'));

    if (!this.documentId) {
      alert('无效的文档ID');
      window.location.href = '/';
      return;
    }

    this.svg = document.getElementById('graphSvg');
    this.nodesGroup = document.getElementById('nodesGroup');
    this.edgesGroup = document.getElementById('edgesGroup');

    this.bindEvents();
    this.loadDocument();
    this.connectWebSocket();
    this.updateSize();
  }

  bindEvents() {
    document.getElementById('backBtn').addEventListener('click', () => {
      window.location.href = `/document/${this.documentId}`;
    });

    document.getElementById('resetLayoutBtn').addEventListener('click', () => {
      this.resetLayout();
    });

    document.getElementById('autoLayoutBtn').addEventListener('click', () => {
      this.startForceLayout();
    });

    window.addEventListener('resize', () => {
      this.updateSize();
    });

    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.node') && !e.target.closest('.edge') && !e.target.closest('.node-tooltip')) {
        this.hideTooltip();
      }
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
        this.initNodes();
        this.render();
        this.updateStats();
        break;
      case 'annotation_created':
        if (!this.annotations.find(a => a.id === data.annotation.id)) {
          this.annotations.push(data.annotation);
          this.addNode(data.annotation);
          this.render();
          this.updateStats();
        }
        break;
      case 'annotation_updated':
        const updateIdx = this.annotations.findIndex(a => a.id === data.annotation.id);
        if (updateIdx !== -1) {
          this.annotations[updateIdx] = data.annotation;
          const node = this.nodes.get(data.annotation.id);
          if (node) {
            node.annotation = data.annotation;
            if (data.annotation.position_x !== null && data.annotation.position_y !== null) {
              node.x = data.annotation.position_x;
              node.y = data.annotation.position_y;
              node.fx = data.annotation.position_x;
              node.fy = data.annotation.position_y;
            }
          }
          this.render();
        }
        break;
      case 'annotation_deleted':
        this.annotations = this.annotations.filter(a => a.id !== data.annotation.id);
        this.relations = this.relations.filter(
          r => r.from_annotation_id !== data.annotation.id && r.to_annotation_id !== data.annotation.id
        );
        this.nodes.delete(data.annotation.id);
        this.render();
        this.updateStats();
        break;
      case 'relation_created':
        if (!this.relations.find(r => r.id === data.relation.id)) {
          this.relations.push(data.relation);
          this.render();
          this.updateStats();
        }
        break;
      case 'relation_updated':
        const relIdx = this.relations.findIndex(r => r.id === data.relation.id);
        if (relIdx !== -1) {
          this.relations[relIdx] = data.relation;
          this.render();
        }
        break;
      case 'relation_deleted':
        this.relations = this.relations.filter(r => r.id !== data.relation.id);
        this.render();
        this.updateStats();
        break;
    }
  }

  async loadDocument() {
    try {
      const response = await this.apiFetch(`/api/documents/${this.documentId}`);
      this.document = await response.json();
      document.getElementById('documentTitle').textContent = this.document.title;
    } catch (error) {
      console.error('加载文档失败:', error);
    }
  }

  updateSize() {
    const container = document.getElementById('graphContainer');
    this.width = container.clientWidth;
    this.height = container.clientHeight;
    this.svg.setAttribute('width', this.width);
    this.svg.setAttribute('height', this.height);
  }

  initNodes() {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const radius = Math.min(this.width, this.height) * 0.35;

    this.annotations.forEach((annotation, idx) => {
      if (!this.nodes.has(annotation.id)) {
        let x, y;

        if (annotation.position_x !== null && annotation.position_y !== null) {
          x = annotation.position_x;
          y = annotation.position_y;
        } else {
          const angle = (idx / this.annotations.length) * Math.PI * 2;
          x = centerX + Math.cos(angle) * radius;
          y = centerY + Math.sin(angle) * radius;
        }

        this.nodes.set(annotation.id, {
          id: annotation.id,
          annotation,
          x,
          y,
          vx: 0,
          vy: 0,
          fx: annotation.position_x !== null ? annotation.position_x : null,
          fy: annotation.position_y !== null ? annotation.position_y : null
        });
      }
    });
  }

  addNode(annotation) {
    const centerX = this.width / 2;
    const centerY = this.height / 2;

    const x = annotation.position_x !== null ? annotation.position_x : centerX + (Math.random() - 0.5) * 200;
    const y = annotation.position_y !== null ? annotation.position_y : centerY + (Math.random() - 0.5) * 200;

    this.nodes.set(annotation.id, {
      id: annotation.id,
      annotation,
      x,
      y,
      vx: 0,
      vy: 0,
      fx: annotation.position_x !== null ? annotation.position_x : null,
      fy: annotation.position_y !== null ? annotation.position_y : null
    });
  }

  render() {
    this.renderEdges();
    this.renderNodes();
  }

  renderEdges() {
    this.edgesGroup.innerHTML = '';

    this.relations.forEach(relation => {
      const fromNode = this.nodes.get(relation.from_annotation_id);
      const toNode = this.nodes.get(relation.to_annotation_id);

      if (!fromNode || !toNode) return;

      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist === 0) return;

      const startX = fromNode.x + (dx / dist) * this.nodeRadius;
      const startY = fromNode.y + (dy / dist) * this.nodeRadius;
      const endX = toNode.x - (dx / dist) * this.nodeRadius;
      const endY = toNode.y - (dy / dist) * this.nodeRadius;

      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;

      const edgeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      edgeGroup.setAttribute('class', 'edge');
      edgeGroup.setAttribute('data-id', relation.id);

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      path.setAttribute('x1', startX);
      path.setAttribute('y1', startY);
      path.setAttribute('x2', endX);
      path.setAttribute('y2', endY);
      path.setAttribute('class', 'edge-line');
      path.setAttribute('marker-end', 'url(#arrowhead)');

      const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      labelBg.setAttribute('x', midX - 30);
      labelBg.setAttribute('y', midY - 10);
      labelBg.setAttribute('width', 60);
      labelBg.setAttribute('height', 20);
      labelBg.setAttribute('rx', 4);
      labelBg.setAttribute('class', 'edge-label-bg');

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', midX);
      label.setAttribute('y', midY + 4);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'edge-label');
      label.textContent = relation.type_label;

      edgeGroup.appendChild(path);
      edgeGroup.appendChild(labelBg);
      edgeGroup.appendChild(label);

      edgeGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showRelationTooltip(relation, e.clientX, e.clientY);
      });

      edgeGroup.addEventListener('mouseenter', () => {
        path.setAttribute('class', 'edge-line edge-line-hover');
        path.setAttribute('marker-end', 'url(#arrowhead-hover)');
      });

      edgeGroup.addEventListener('mouseleave', () => {
        path.setAttribute('class', 'edge-line');
        path.setAttribute('marker-end', 'url(#arrowhead)');
      });

      this.edgesGroup.appendChild(edgeGroup);
    });
  }

  renderNodes() {
    this.nodesGroup.innerHTML = '';

    this.nodes.forEach(node => {
      const annotation = node.annotation;

      const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      nodeGroup.setAttribute('class', 'node');
      nodeGroup.setAttribute('data-id', node.id);
      nodeGroup.setAttribute('transform', `translate(${node.x}, ${node.y})`);

      const glowCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      glowCircle.setAttribute('r', this.nodeRadius + 5);
      glowCircle.setAttribute('class', 'node-glow');
      glowCircle.style.fill = annotation.color;
      glowCircle.style.opacity = '0.3';

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', this.nodeRadius);
      circle.setAttribute('class', 'node-circle');
      circle.style.fill = annotation.color;
      circle.style.stroke = annotation.border_color;

      const typeLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      typeLabel.setAttribute('y', -10);
      typeLabel.setAttribute('text-anchor', 'middle');
      typeLabel.setAttribute('class', 'node-type-label');
      typeLabel.textContent = annotation.type_label;

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('y', 10);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'node-text');
      const displayText = annotation.text.length > 8
        ? annotation.text.substring(0, 8) + '...'
        : annotation.text;
      text.textContent = displayText;

      nodeGroup.appendChild(glowCircle);
      nodeGroup.appendChild(circle);
      nodeGroup.appendChild(typeLabel);
      nodeGroup.appendChild(text);

      nodeGroup.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.startDrag(node, e);
      });

      nodeGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showNodeTooltip(node, e.clientX, e.clientY);
      });

      nodeGroup.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.jumpToDocument(node.id);
      });

      nodeGroup.addEventListener('mouseenter', () => {
        circle.setAttribute('filter', 'url(#glow)');
      });

      nodeGroup.addEventListener('mouseleave', () => {
        circle.removeAttribute('filter');
      });

      this.nodesGroup.appendChild(nodeGroup);
    });
  }

  startDrag(node, e) {
    this.dragging = {
      node,
      offsetX: e.clientX,
      offsetY: e.clientY
    };

    node.fx = node.x;
    node.fy = node.y;

    document.addEventListener('mousemove', this.handleDrag);
    document.addEventListener('mouseup', this.endDrag);
  }

  handleDrag = (e) => {
    if (!this.dragging) return;

    const dx = e.clientX - this.dragging.offsetX;
    const dy = e.clientY - this.dragging.offsetY;

    this.dragging.node.fx = Math.max(this.nodeRadius, Math.min(this.width - this.nodeRadius, this.dragging.node.x + dx));
    this.dragging.node.fy = Math.max(this.nodeRadius, Math.min(this.height - this.nodeRadius, this.dragging.node.y + dy));

    this.dragging.offsetX = e.clientX;
    this.dragging.offsetY = e.clientY;

    this.render();
  }

  endDrag = async () => {
    if (this.dragging) {
      try {
        await this.apiFetch(`/api/annotations/${this.dragging.node.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            position_x: this.dragging.node.fx,
            position_y: this.dragging.node.fy
          })
        });
      } catch (error) {
        console.error('保存位置失败:', error);
      }

      this.dragging = null;
    }

    document.removeEventListener('mousemove', this.handleDrag);
    document.removeEventListener('mouseup', this.endDrag);
  }

  resetLayout() {
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const radius = Math.min(this.width, this.height) * 0.35;

    const annotations = Array.from(this.nodes.values());
    annotations.forEach((node, idx) => {
      const angle = (idx / annotations.length) * Math.PI * 2;
      node.x = centerX + Math.cos(angle) * radius;
      node.y = centerY + Math.sin(angle) * radius;
      node.vx = 0;
      node.vy = 0;
      node.fx = null;
      node.fy = null;
    });

    this.render();
  }

  startForceLayout() {
    if (this.simulation) {
      clearInterval(this.simulation);
    }

    const nodes = Array.from(this.nodes.values());

    this.simulation = setInterval(() => {
      this.applyForces(nodes);
      this.render();
    }, 16);

    setTimeout(() => {
      if (this.simulation) {
        clearInterval(this.simulation);
        this.simulation = null;
      }
    }, 3000);
  }

  applyForces(nodes) {
    const repulsionStrength = 5000;
    const attractionStrength = 0.01;
    const damping = 0.9;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const force = repulsionStrength / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (nodes[i].fx === null) {
          nodes[i].vx -= fx;
          nodes[i].vy -= fy;
        }
        if (nodes[j].fx === null) {
          nodes[j].vx += fx;
          nodes[j].vy += fy;
        }
      }
    }

    this.relations.forEach(relation => {
      const fromNode = this.nodes.get(relation.from_annotation_id);
      const toNode = this.nodes.get(relation.to_annotation_id);

      if (!fromNode || !toNode) return;

      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const force = (dist - this.linkDistance) * attractionStrength;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (fromNode.fx === null) {
        fromNode.vx += fx;
        fromNode.vy += fy;
      }
      if (toNode.fx === null) {
        toNode.vx -= fx;
        toNode.vy -= fy;
      }
    });

    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const centerStrength = 0.005;

    nodes.forEach(node => {
      if (node.fx === null) {
        node.vx += (centerX - node.x) * centerStrength;
        node.vy += (centerY - node.y) * centerStrength;
      }
    });

    nodes.forEach(node => {
      if (node.fx === null) {
        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;

        node.x = Math.max(this.nodeRadius, Math.min(this.width - this.nodeRadius, node.x));
        node.y = Math.max(this.nodeRadius, Math.min(this.height - this.nodeRadius, node.y));
      } else {
        node.x = node.fx;
        node.y = node.fy;
        node.vx = 0;
        node.vy = 0;
      }
    });
  }

  showNodeTooltip(node, clientX, clientY) {
    const annotation = node.annotation;
    const tooltip = document.getElementById('nodeTooltip');

    document.getElementById('tooltipType').textContent = annotation.type_label;
    document.getElementById('tooltipType').style.background = annotation.color;
    document.getElementById('tooltipType').style.borderColor = annotation.border_color;
    document.getElementById('tooltipText').textContent = annotation.text;
    document.getElementById('tooltipDescription').textContent = annotation.description || '暂无描述';

    tooltip.classList.remove('hidden');

    const tooltipRect = tooltip.getBoundingClientRect();
    let left = clientX + 15;
    let top = clientY + 15;

    if (left + tooltipRect.width > window.innerWidth) {
      left = clientX - tooltipRect.width - 15;
    }
    if (top + tooltipRect.height > window.innerHeight) {
      top = clientY - tooltipRect.height - 15;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  showRelationTooltip(relation, clientX, clientY) {
    const tooltip = document.getElementById('nodeTooltip');

    document.getElementById('tooltipType').textContent = '关系';
    document.getElementById('tooltipType').style.background = '#e5e7eb';
    document.getElementById('tooltipType').style.borderColor = '#6b7280';
    document.getElementById('tooltipText').textContent = `${relation.from_annotation?.text || ''} → ${relation.type_label} → ${relation.to_annotation?.text || ''}`;
    document.getElementById('tooltipDescription').textContent = relation.description || '暂无描述';

    tooltip.classList.remove('hidden');

    const tooltipRect = tooltip.getBoundingClientRect();
    let left = clientX + 15;
    let top = clientY + 15;

    if (left + tooltipRect.width > window.innerWidth) {
      left = clientX - tooltipRect.width - 15;
    }
    if (top + tooltipRect.height > window.innerHeight) {
      top = clientY - tooltipRect.height - 15;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  hideTooltip() {
    document.getElementById('nodeTooltip').classList.add('hidden');
  }

  jumpToDocument(annotationId) {
    window.location.href = `/document/${this.documentId}?annotation=${annotationId}`;
  }

  updateStats() {
    document.getElementById('statAnnotations').textContent = this.annotations.length;
    document.getElementById('statRelations').textContent = this.relations.length;

    const typeCounts = this.annotations.reduce((acc, a) => {
      acc[a.type] = (acc[a.type] || 0) + 1;
      return acc;
    }, {});

    const typeLabels = { person: '人物', location: '地点', event: '事件', concept: '概念' };
    const typeColors = {
      person: { bg: '#fef3c7', border: '#f59e0b' },
      location: { bg: '#dbeafe', border: '#3b82f6' },
      event: { bg: '#fce7f3', border: '#ec4899' },
      concept: { bg: '#d1fae5', border: '#10b981' }
    };

    const typeStatsEl = document.getElementById('typeStats');
    typeStatsEl.innerHTML = Object.entries(typeLabels).map(([type, label]) => {
      const count = typeCounts[type] || 0;
      const colors = typeColors[type];
      return `<div class="type-stat-item">
                <span class="type-stat-color" style="background: ${colors.bg}; border-color: ${colors.border};"></span>
                <span class="type-stat-label">${label}</span>
                <span class="type-stat-count">${count}</span>
              </div>`;
    }).join('');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new KnowledgeGraph();
});
