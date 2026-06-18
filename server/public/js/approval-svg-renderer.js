const NODE_WIDTH = 160;
const NODE_HEIGHT = 60;
const NODE_GAP_X = 220;
const NODE_GAP_Y = 120;
const NODE_RADIUS = 8;

const NODE_COLORS = {
  passed: { fill: '#10b981', stroke: '#059669', text: '#fff' },
  current: { fill: '#3b82f6', stroke: '#2563eb', text: '#fff' },
  pending: { fill: '#e2e8f0', stroke: '#94a3b8', text: '#475569' },
  error: { fill: '#ef4444', stroke: '#dc2626', text: '#fff' }
};

const NODE_TYPE_STYLE = {
  start: { shape: 'circle', width: 80, height: 80, icon: '▶' },
  end: { shape: 'double_circle', width: 80, height: 80, icon: '⏹' },
  approval: { shape: 'rect', width: NODE_WIDTH, height: NODE_HEIGHT, icon: '✓' },
  countersign: { shape: 'rect_double', width: NODE_WIDTH, height: NODE_HEIGHT, icon: '✦' },
  condition: { shape: 'diamond', width: 120, height: 100, icon: '◆' }
};

class ApprovalSvgRenderer {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    if (!this.container) throw new Error('容器不存在');
    this.options = {
      interactive: false,
      onNodeClick: null,
      showStatus: true,
      scale: 1,
      ...options
    };
    this.template = null;
    this.instance = null;
    this.nodePositions = {};
    this.svg = null;
  }

  render(template, instance = null) {
    this.template = template;
    this.instance = instance;
    this.container.innerHTML = '';
    if (!template || !template.nodes || template.nodes.length === 0) {
      this.container.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">暂无流程图数据</div>';
      return;
    }
    this._calculateLayout();
    this._draw();
  }

  getNodeStatus(nodeId) {
    if (!this.options.showStatus || !this.instance) return 'pending';
    const activePath = this.instance.active_path || [];
    const currentNodes = this.instance.current_node_ids || [];
    if (currentNodes.includes(nodeId)) return 'current';
    if (activePath.includes(nodeId)) return 'passed';
    return 'pending';
  }

  _calculateLayout() {
    this.nodePositions = {};
    const { nodes, edges } = this.template;
    const startNode = nodes.find(n => n.type === 'start');
    if (!startNode) return;

    const levels = {};
    const visited = new Set();
    const queue = [{ id: startNode.id, level: 0 }];
    levels[0] = [startNode.id];
    visited.add(startNode.id);

    while (queue.length > 0) {
      const { id, level } = queue.shift();
      const nextIds = this._getNextNodeIds(id);
      for (const nextId of nextIds) {
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        if (!levels[level + 1]) levels[level + 1] = [];
        if (!levels[level + 1].includes(nextId)) {
          levels[level + 1].push(nextId);
        }
        queue.push({ id: nextId, level: level + 1 });
      }
    }

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        let placed = false;
        for (let lv = 0; lv < Object.keys(levels).length; lv++) {
          if (!levels[lv] || levels[lv].length < 2) {
            if (!levels[lv]) levels[lv] = [];
            if (!levels[lv].includes(node.id)) {
              levels[lv].push(node.id);
            }
            placed = true;
            break;
          }
        }
        if (!placed) {
          const maxLv = Math.max(...Object.keys(levels).map(Number), 0);
          if (!levels[maxLv + 1]) levels[maxLv + 1] = [];
          levels[maxLv + 1].push(node.id);
        }
      }
    }

    const sortedLevels = Object.keys(levels)
      .map(Number)
      .sort((a, b) => a - b);

    let maxCols = 1;
    sortedLevels.forEach(lv => {
      maxCols = Math.max(maxCols, levels[lv].length);
    });

    const colWidth = NODE_GAP_X;
    const rowHeight = NODE_GAP_Y;

    sortedLevels.forEach((lv, li) => {
      const nodeIds = levels[lv];
      const levelWidth = colWidth * (nodeIds.length - 1);
      const totalWidth = (sortedLevels.length) * colWidth;
      const startX = 60 + Math.max(0, (totalWidth - levelWidth) / 2);
      nodeIds.forEach((nid, ci) => {
        const style = NODE_TYPE_STYLE[nodes.find(n => n.id === nid)?.type] || NODE_TYPE_STYLE.approval;
        this.nodePositions[nid] = {
          x: startX + ci * colWidth,
          y: 60 + li * rowHeight,
          w: style.width,
          h: style.height,
          style,
          cx: 0, cy: 0
        };
        const pos = this.nodePositions[nid];
        pos.cx = pos.x + pos.w / 2;
        pos.cy = pos.y + pos.h / 2;
      });
    });
  }

  _getNextNodeIds(fromNodeId) {
    const { nodes, edges } = this.template;
    const fromNode = nodes.find(n => n.id === fromNodeId);
    if (!fromNode) return [];
    if (fromNode.type === 'condition' && fromNode.branches) {
      return fromNode.branches.map(b => b.target_node_id).filter(Boolean);
    }
    return (edges || [])
      .filter(e => e.from === fromNodeId)
      .map(e => e.to);
  }

  _draw() {
    const maxX = Math.max(...Object.values(this.nodePositions).map(p => p.x + p.w), 100);
    const maxY = Math.max(...Object.values(this.nodePositions).map(p => p.y + p.h), 100);
    const svgWidth = maxX + 60;
    const svgHeight = maxY + 60;

    const scale = this.options.scale;

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `overflow:auto;max-width:100%;border-radius:12px;background:#f8fafc;padding:12px;`;

    const svgNS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(svgNS, 'svg');
    this.svg.setAttribute('width', svgWidth * scale);
    this.svg.setAttribute('height', svgHeight * scale);
    this.svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
    this.svg.style.cssText = 'display:block;min-width:100%;';

    const defs = document.createElementNS(svgNS, 'defs');
    defs.innerHTML = `
      <marker id="arrow-head" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />
      </marker>
      <marker id="arrow-head-active" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#3b82f6" />
      </marker>
      <marker id="arrow-head-passed" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L0,6 L9,3 z" fill="#10b981" />
      </marker>
      <filter id="node-shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.08"/>
      </filter>
      <style>
        @keyframes currentPulse {
          0%, 100% { filter: drop-shadow(0 0 6px rgba(59,130,246,0.6)); opacity: 1; }
          50% { filter: drop-shadow(0 0 18px rgba(59,130,246,0.9)); opacity: 0.85; }
        }
        @keyframes currentBorder {
          0%, 100% { stroke: #3b82f6; stroke-width: 3; }
          50% { stroke: #60a5fa; stroke-width: 4.5; }
        }
        .node-current { animation: currentPulse 1.5s ease-in-out infinite; }
        .node-current-shape { animation: currentBorder 1.5s ease-in-out infinite; }
        .node-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .edge-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 11px; }
      </style>
    `;
    this.svg.appendChild(defs);

    this._drawEdges(svgNS);
    this._drawNodes(svgNS);

    wrapper.appendChild(this.svg);
    this.container.appendChild(wrapper);
  }

  _drawEdges(svgNS) {
    const { nodes, edges } = this.template;
    const activePath = this.instance?.active_path || [];
    const currentNodes = this.instance?.current_node_ids || [];

    const drawnEdges = new Set();

    const drawEdge = (fromId, toId, label = null, isCondition = false, branchIdx = 0) => {
      const edgeKey = `${fromId}->${toId}${label || ''}`;
      if (drawnEdges.has(edgeKey)) return;
      drawnEdges.add(edgeKey);

      const from = this.nodePositions[fromId];
      const to = this.nodePositions[toId];
      if (!from || !to) return;

      const fromCenter = { x: from.cx, y: from.cy };
      const toCenter = { x: to.cx, y: to.cy };

      const exitPoint = this._getExitPoint(from, toCenter);
      const entryPoint = this._getEntryPoint(to, fromCenter);

      let midX = (exitPoint.x + entryPoint.x) / 2;
      let midY = (exitPoint.y + entryPoint.y) / 2;

      if (isCondition) {
        const offset = (branchIdx - 0.5) * 40;
        if (Math.abs(entryPoint.x - exitPoint.x) < 30) {
          midX = exitPoint.x + offset;
          midY = (exitPoint.y + entryPoint.y) / 2;
        } else {
          midY = exitPoint.y + offset;
        }
      }

      const isPassed = activePath.includes(fromId) && activePath.includes(toId);
      const isCurrent = currentNodes.includes(toId) && activePath.includes(fromId);

      let strokeColor = '#cbd5e1';
      let strokeWidth = 2;
      let markerId = 'arrow-head';
      if (isPassed) {
        strokeColor = '#10b981';
        strokeWidth = 2.5;
        markerId = 'arrow-head-passed';
      }
      if (isCurrent) {
        strokeColor = '#3b82f6';
        strokeWidth = 3;
        markerId = 'arrow-head-active';
      }

      const pathD = `M ${exitPoint.x} ${exitPoint.y} Q ${midX} ${midY} ${entryPoint.x} ${entryPoint.y}`;

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', pathD);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', strokeColor);
      path.setAttribute('stroke-width', strokeWidth);
      path.setAttribute('marker-end', `url(#${markerId})`);
      this.svg.appendChild(path);

      if (label) {
        const labelBg = document.createElementNS(svgNS, 'rect');
        const labelX = midX - label.length * 4 - 8;
        const labelY = midY - 10;
        labelBg.setAttribute('x', labelX);
        labelBg.setAttribute('y', labelY);
        labelBg.setAttribute('width', label.length * 8 + 16);
        labelBg.setAttribute('height', 20);
        labelBg.setAttribute('rx', 10);
        labelBg.setAttribute('fill', '#fff');
        labelBg.setAttribute('stroke', isPassed ? '#10b98140' : (isCurrent ? '#3b82f640' : '#e2e8f0'));
        labelBg.setAttribute('stroke-width', 1);
        this.svg.appendChild(labelBg);

        const labelText = document.createElementNS(svgNS, 'text');
        labelText.setAttribute('x', midX);
        labelText.setAttribute('y', midY + 4);
        labelText.setAttribute('text-anchor', 'middle');
        labelText.setAttribute('fill', isPassed ? '#059669' : (isCurrent ? '#2563eb' : '#64748b'));
        labelText.setAttribute('class', 'edge-label');
        labelText.setAttribute('font-weight', '500');
        labelText.textContent = label;
        this.svg.appendChild(labelText);
      }
    };

    for (const node of nodes) {
      if (node.type === 'condition' && node.branches) {
        node.branches.forEach((branch, idx) => {
          if (branch.target_node_id) {
            let label = '';
            if (branch.condition === null || branch.condition === '') {
              label = '默认';
            } else if (branch.label) {
              label = branch.label;
            } else {
              label = branch.condition.length > 16 ? branch.condition.slice(0, 16) + '…' : branch.condition;
            }
            drawEdge(node.id, branch.target_node_id, label, true, idx);
          }
        });
      }
    }

    for (const edge of edges || []) {
      drawEdge(edge.from, edge.to, edge.label || null, false);
    }
  }

  _getExitPoint(fromPos, toCenter) {
    const { x, y, w, h, cx, cy } = fromPos;
    const dx = toCenter.x - cx;
    const dy = toCenter.y - cy;

    if (Math.abs(dx) > Math.abs(dy)) {
      return {
        x: dx > 0 ? x + w : x,
        y: cy
      };
    }
    return {
      x: cx,
      y: dy > 0 ? y + h : y
    };
  }

  _getEntryPoint(toPos, fromCenter) {
    const { x, y, w, h, cx, cy } = toPos;
    const dx = cx - fromCenter.x;
    const dy = cy - fromCenter.y;

    if (Math.abs(dx) > Math.abs(dy)) {
      return {
        x: dx > 0 ? x : x + w,
        y: cy
      };
    }
    return {
      x: cx,
      y: dy > 0 ? y : y + h
    };
  }

  _drawNodes(svgNS) {
    const { nodes } = this.template;
    for (const node of nodes) {
      const pos = this.nodePositions[node.id];
      if (!pos) continue;
      const status = this.getNodeStatus(node.id);
      const colors = NODE_COLORS[status] || NODE_COLORS.pending;
      const style = pos.style;

      const group = document.createElementNS(svgNS, 'g');
      group.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      if (status === 'current') {
        group.setAttribute('class', 'node-current');
      }
      if (this.options.interactive) {
        group.style.cursor = 'pointer';
        group.addEventListener('click', () => {
          if (this.options.onNodeClick) {
            this.options.onNodeClick(node, status);
          }
        });
      }

      this._drawNodeShape(svgNS, group, style, colors, status);
      this._drawNodeContent(svgNS, group, node, style, colors, status);

      this.svg.appendChild(group);
    }
  }

  _drawNodeShape(svgNS, group, style, colors, status) {
    let shape;
    const w = style.width;
    const h = style.height;
    const extraClass = status === 'current' ? ' node-current-shape' : '';

    switch (style.shape) {
      case 'circle':
        shape = document.createElementNS(svgNS, 'circle');
        shape.setAttribute('cx', w / 2);
        shape.setAttribute('cy', h / 2);
        shape.setAttribute('r', Math.min(w, h) / 2 - 4);
        break;
      case 'double_circle':
        const outer = document.createElementNS(svgNS, 'circle');
        outer.setAttribute('cx', w / 2);
        outer.setAttribute('cy', h / 2);
        outer.setAttribute('r', Math.min(w, h) / 2 - 4);
        outer.setAttribute('fill', colors.fill);
        outer.setAttribute('stroke', colors.stroke);
        outer.setAttribute('stroke-width', status === 'current' ? 4 : 3);
        outer.setAttribute('filter', 'url(#node-shadow)');
        if (status === 'current') outer.setAttribute('class', 'node-current-shape');
        group.appendChild(outer);
        shape = document.createElementNS(svgNS, 'circle');
        shape.setAttribute('cx', w / 2);
        shape.setAttribute('cy', h / 2);
        shape.setAttribute('r', Math.min(w, h) / 2 - 12);
        break;
      case 'diamond':
        shape = document.createElementNS(svgNS, 'polygon');
        const cx = w / 2;
        const cy = h / 2;
        shape.setAttribute('points', `${cx},8 ${w - 8},${cy} ${cx},${h - 8} 8,${cy}`);
        break;
      case 'rect_double':
        shape = document.createElementNS(svgNS, 'g');
        const r1 = document.createElementNS(svgNS, 'rect');
        r1.setAttribute('x', 0);
        r1.setAttribute('y', 0);
        r1.setAttribute('width', w);
        r1.setAttribute('height', h);
        r1.setAttribute('rx', NODE_RADIUS);
        r1.setAttribute('fill', colors.fill);
        r1.setAttribute('stroke', colors.stroke);
        r1.setAttribute('stroke-width', status === 'current' ? 4 : 3);
        r1.setAttribute('filter', 'url(#node-shadow)');
        if (status === 'current') r1.setAttribute('class', 'node-current-shape');
        shape.appendChild(r1);
        const r2 = document.createElementNS(svgNS, 'rect');
        r2.setAttribute('x', 5);
        r2.setAttribute('y', 5);
        r2.setAttribute('width', w - 10);
        r2.setAttribute('height', h - 10);
        r2.setAttribute('rx', NODE_RADIUS - 3);
        r2.setAttribute('fill', 'none');
        r2.setAttribute('stroke', colors.stroke);
        r2.setAttribute('stroke-width', 1.5);
        r2.setAttribute('stroke-dasharray', 'none');
        shape.appendChild(r2);
        group.appendChild(shape);
        return;
      default:
        shape = document.createElementNS(svgNS, 'rect');
        shape.setAttribute('x', 0);
        shape.setAttribute('y', 0);
        shape.setAttribute('width', w);
        shape.setAttribute('height', h);
        shape.setAttribute('rx', NODE_RADIUS);
    }

    shape.setAttribute('fill', colors.fill);
    shape.setAttribute('stroke', colors.stroke);
    shape.setAttribute('stroke-width', status === 'current' ? 4 : 3);
    shape.setAttribute('filter', 'url(#node-shadow)');
    if (status === 'current' && style.shape !== 'double_circle') {
      shape.setAttribute('class', 'node-current-shape');
    }
    group.appendChild(shape);
  }

  _getNodeDelegationInfo(nodeId) {
    if (!this.instance || !this.instance.records) return null;
    const records = this.instance.records.filter(r => 
      r.node_id === nodeId && 
      r.delegator_id && 
      r.delegator_id !== r.user_id &&
      (r.action === 'approve' || r.action === 'reject')
    );
    if (records.length === 0) return null;
    return {
      delegatorName: records[0].delegator_name,
      agentName: records[0].user_name
    };
  }

  _drawNodeContent(svgNS, group, node, style, colors, status) {
    const w = style.width;
    const h = style.height;
    const name = node.name || getNodeTypeLabel(node.type);
    const approvers = node.approvers || [];
    const delegationInfo = this._getNodeDelegationInfo(node.id);

    if (style.shape === 'circle' || style.shape === 'double_circle') {
      const text = document.createElementNS(svgNS, 'text');
      text.setAttribute('x', w / 2);
      text.setAttribute('y', h / 2 + 5);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', colors.text);
      text.setAttribute('class', 'node-label');
      text.setAttribute('font-size', '13px');
      text.setAttribute('font-weight', '600');
      text.textContent = style.icon + ' ' + name;
      group.appendChild(text);
    } else if (style.shape === 'diamond') {
      const iconText = document.createElementNS(svgNS, 'text');
      iconText.setAttribute('x', w / 2);
      iconText.setAttribute('y', h / 2 - 4);
      iconText.setAttribute('text-anchor', 'middle');
      iconText.setAttribute('fill', colors.text);
      iconText.setAttribute('class', 'node-label');
      iconText.setAttribute('font-size', '16px');
      iconText.setAttribute('font-weight', 'bold');
      iconText.textContent = style.icon;
      group.appendChild(iconText);

      const nameText = document.createElementNS(svgNS, 'text');
      nameText.setAttribute('x', w / 2);
      nameText.setAttribute('y', h / 2 + 14);
      nameText.setAttribute('text-anchor', 'middle');
      nameText.setAttribute('fill', colors.text);
      nameText.setAttribute('class', 'node-label');
      nameText.setAttribute('font-size', '11px');
      nameText.setAttribute('font-weight', '600');
      const displayName = name.length > 8 ? name.slice(0, 7) + '…' : name;
      nameText.textContent = displayName;
      group.appendChild(nameText);
    } else {
      const header = document.createElementNS(svgNS, 'g');
      const iconText = document.createElementNS(svgNS, 'text');
      iconText.setAttribute('x', 14);
      iconText.setAttribute('y', 24);
      iconText.setAttribute('fill', colors.text);
      iconText.setAttribute('class', 'node-label');
      iconText.setAttribute('font-size', '14px');
      iconText.setAttribute('font-weight', 'bold');
      iconText.textContent = style.icon;
      header.appendChild(iconText);

      const nameText = document.createElementNS(svgNS, 'text');
      nameText.setAttribute('x', 34);
      nameText.setAttribute('y', 24);
      nameText.setAttribute('fill', colors.text);
      nameText.setAttribute('class', 'node-label');
      nameText.setAttribute('font-size', '13px');
      nameText.setAttribute('font-weight', '600');
      const displayName = name.length > 12 ? name.slice(0, 11) + '…' : name;
      nameText.textContent = displayName;
      header.appendChild(nameText);
      group.appendChild(header);

      if (approvers.length > 0 && (node.type === 'approval' || node.type === 'countersign')) {
        const approverText = document.createElementNS(svgNS, 'text');
        approverText.setAttribute('x', 14);
        approverText.setAttribute('y', 44);
        approverText.setAttribute('fill', colors.text);
        approverText.setAttribute('opacity', '0.85');
        approverText.setAttribute('class', 'node-label');
        approverText.setAttribute('font-size', '11px');
        const displayApprovers = approvers.map(id => getUserDisplayName(id));
        const approverStr = displayApprovers.join('、');
        approverText.textContent = approverStr.length > 16 ? approverStr.slice(0, 15) + '…' : approverStr;
        group.appendChild(approverText);

        if (node.type === 'countersign') {
          const signText = document.createElementNS(svgNS, 'text');
          signText.setAttribute('x', w - 12);
          signText.setAttribute('y', h - 10);
          signText.setAttribute('text-anchor', 'end');
          signText.setAttribute('fill', colors.text);
          signText.setAttribute('opacity', '0.7');
          signText.setAttribute('class', 'node-label');
          signText.setAttribute('font-size', '10px');
          signText.textContent = `${approvers.length}人会签`;
          group.appendChild(signText);
        }
      }
      
      if (delegationInfo) {
        const delegationBadge = document.createElementNS(svgNS, 'g');
        delegationBadge.setAttribute('transform', `translate(0, ${h + 4})`);
        
        const badgeBg = document.createElementNS(svgNS, 'rect');
        badgeBg.setAttribute('x', 0);
        badgeBg.setAttribute('y', 0);
        badgeBg.setAttribute('width', w);
        badgeBg.setAttribute('height', 22);
        badgeBg.setAttribute('rx', 6);
        badgeBg.setAttribute('fill', '#fef3c7');
        badgeBg.setAttribute('stroke', '#fbbf24');
        badgeBg.setAttribute('stroke-width', 1);
        delegationBadge.appendChild(badgeBg);
        
        const iconText = document.createElementNS(svgNS, 'text');
        iconText.setAttribute('x', 8);
        iconText.setAttribute('y', 15);
        iconText.setAttribute('fill', '#92400e');
        iconText.setAttribute('class', 'node-label delegated-node-icon');
        iconText.textContent = '🤝';
        delegationBadge.appendChild(iconText);
        
        const delegateText = document.createElementNS(svgNS, 'text');
        delegateText.setAttribute('x', 26);
        delegateText.setAttribute('y', 15);
        delegateText.setAttribute('fill', '#92400e');
        delegateText.setAttribute('class', 'node-label delegated-node-label');
        const delegateDisplay = `${delegationInfo.agentName}代签`;
        delegateText.textContent = delegateDisplay.length > 12 ? delegateDisplay.slice(0, 11) + '…' : delegateDisplay;
        delegateText.setAttribute('font-size', '10px');
        delegateText.setAttribute('font-weight', '600');
        delegationBadge.appendChild(delegateText);
        
        const title = document.createElementNS(svgNS, 'title');
        title.textContent = `委托来源：${delegationInfo.delegatorName}，代签人：${delegationInfo.agentName}`;
        delegationBadge.appendChild(title);
        
        group.appendChild(delegationBadge);
      }
    }

    if (status === 'current') {
      const badge = document.createElementNS(svgNS, 'g');
      badge.setAttribute('transform', `translate(${w - 14}, -8)`);
      const badgeCircle = document.createElementNS(svgNS, 'circle');
      badgeCircle.setAttribute('r', 10);
      badgeCircle.setAttribute('fill', '#ef4444');
      badgeCircle.setAttribute('stroke', '#fff');
      badgeCircle.setAttribute('stroke-width', 2);
      badge.appendChild(badgeCircle);
      const badgeText = document.createElementNS(svgNS, 'text');
      badgeText.setAttribute('y', 4);
      badgeText.setAttribute('text-anchor', 'middle');
      badgeText.setAttribute('fill', '#fff');
      badgeText.setAttribute('class', 'node-label');
      badgeText.setAttribute('font-size', '11px');
      badgeText.setAttribute('font-weight', 'bold');
      badgeText.textContent = '!';
      badge.appendChild(badgeText);
      group.appendChild(badge);
    }
  }

  setScale(scale) {
    this.options.scale = scale;
    if (this.template) this.render(this.template, this.instance);
  }
}

function getNodeTypeLabel(type) {
  const map = {
    start: '开始',
    end: '结束',
    approval: '审批',
    countersign: '会签',
    condition: '条件'
  };
  return map[type] || type;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ApprovalSvgRenderer, NODE_COLORS, NODE_TYPE_STYLE };
}
