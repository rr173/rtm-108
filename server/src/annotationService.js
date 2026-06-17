const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'annotations.json');
const conflictFile = path.join(dataDir, 'annotation-conflicts.json');

const ANNOTATION_TYPES = {
  PERSON: 'person',
  LOCATION: 'location',
  EVENT: 'event',
  CONCEPT: 'concept'
};

const ANNOTATION_TYPE_LABELS = {
  [ANNOTATION_TYPES.PERSON]: '人物',
  [ANNOTATION_TYPES.LOCATION]: '地点',
  [ANNOTATION_TYPES.EVENT]: '事件',
  [ANNOTATION_TYPES.CONCEPT]: '概念'
};

const ANNOTATION_COLORS = {
  [ANNOTATION_TYPES.PERSON]: '#fef3c7',
  [ANNOTATION_TYPES.LOCATION]: '#dbeafe',
  [ANNOTATION_TYPES.EVENT]: '#fce7f3',
  [ANNOTATION_TYPES.CONCEPT]: '#d1fae5'
};

const ANNOTATION_BORDER_COLORS = {
  [ANNOTATION_TYPES.PERSON]: '#f59e0b',
  [ANNOTATION_TYPES.LOCATION]: '#3b82f6',
  [ANNOTATION_TYPES.EVENT]: '#ec4899',
  [ANNOTATION_TYPES.CONCEPT]: '#10b981'
};

const RELATION_TYPES = {
  PARTICIPATES: 'participates',
  OCCURS_AT: 'occurs_at',
  RELATED_TO: 'related_to',
  CREATED: 'created'
};

const RELATION_TYPE_LABELS = {
  [RELATION_TYPES.PARTICIPATES]: '参与',
  [RELATION_TYPES.OCCURS_AT]: '发生于',
  [RELATION_TYPES.RELATED_TO]: '关联',
  [RELATION_TYPES.CREATED]: '创建'
};

const CONFLICT_STATUS = {
  PENDING: 'pending',
  RESOLVED: 'resolved'
};

const RESOLUTION_TYPE = {
  KEEP_FIRST: 'keep_first',
  KEEP_SECOND: 'keep_second',
  MERGE: 'merge',
  SHORTEN: 'shorten',
  KEEP_BOTH: 'keep_both'
};

let data = {
  annotations: [],
  relations: [],
  nextAnnotationId: 1,
  nextRelationId: 1
};

let conflictData = {
  conflicts: [],
  nextConflictId: 1
};

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadData() {
  ensureDataDir();
  if (fs.existsSync(dataFile)) {
    try {
      const raw = fs.readFileSync(dataFile, 'utf8');
      const loaded = JSON.parse(raw);
      data = {
        annotations: loaded.annotations || [],
        relations: loaded.relations || [],
        nextAnnotationId: loaded.nextAnnotationId || 1,
        nextRelationId: loaded.nextRelationId || 1
      };
    } catch (e) {
      console.warn('标注数据文件损坏，使用空数据:', e.message);
    }
  }
}

function saveData() {
  ensureDataDir();
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function loadConflictData() {
  ensureDataDir();
  if (fs.existsSync(conflictFile)) {
    try {
      const raw = fs.readFileSync(conflictFile, 'utf8');
      const loaded = JSON.parse(raw);
      conflictData = {
        conflicts: loaded.conflicts || [],
        nextConflictId: loaded.nextConflictId || 1
      };
    } catch (e) {
      console.warn('冲突数据文件损坏，使用空数据:', e.message);
    }
  }
}

function saveConflictData() {
  ensureDataDir();
  fs.writeFileSync(conflictFile, JSON.stringify(conflictData, null, 2), 'utf8');
}

function now() {
  return Date.now();
}

function isOverlapping(a, b) {
  return a.start_offset < b.end_offset && b.start_offset < a.end_offset;
}

function getOverlapRange(a, b) {
  return {
    start: Math.max(a.start_offset, b.start_offset),
    end: Math.min(a.end_offset, b.end_offset)
  };
}

function detectConflicts(documentId) {
  loadData();
  loadConflictData();

  const docAnnotations = data.annotations
    .filter(a => a.document_id === parseInt(documentId))
    .sort((a, b) => a.start_offset - b.start_offset);
  const docAnnotationIds = new Set(docAnnotations.map(a => a.id));

  const invalidConflicts = conflictData.conflicts.filter(c =>
    c.document_id === parseInt(documentId) &&
    c.status === CONFLICT_STATUS.PENDING &&
    !c.annotation_ids.every(id => docAnnotationIds.has(id))
  );
  if (invalidConflicts.length > 0) {
    conflictData.conflicts = conflictData.conflicts.filter(c => !invalidConflicts.includes(c));
    saveConflictData();
  }

  const existingConflictPairs = new Set();
  conflictData.conflicts.forEach(c => {
    if (c.document_id === parseInt(documentId) && c.status === CONFLICT_STATUS.PENDING) {
      const pair = [c.annotation_ids[0], c.annotation_ids[1]].sort().join('-');
      existingConflictPairs.add(pair);
    }
  });

  const newConflicts = [];
  for (let i = 0; i < docAnnotations.length; i++) {
    for (let j = i + 1; j < docAnnotations.length; j++) {
      const a = docAnnotations[i];
      const b = docAnnotations[j];

      if (b.start_offset >= a.end_offset) break;

      if (isOverlapping(a, b)) {
        const pair = [a.id, b.id].sort().join('-');
        if (!existingConflictPairs.has(pair)) {
          const overlap = getOverlapRange(a, b);
          const conflict = {
            id: conflictData.nextConflictId++,
            document_id: parseInt(documentId),
            annotation_ids: [a.id, b.id],
            overlap_start: overlap.start,
            overlap_end: overlap.end,
            status: CONFLICT_STATUS.PENDING,
            resolution: null,
            resolved_by: null,
            resolved_at: null,
            created_at: now()
          };
          conflictData.conflicts.push(conflict);
          newConflicts.push(enrichConflict(conflict));
        }
      }
    }
  }

  if (newConflicts.length > 0) {
    saveConflictData();
  }

  return newConflicts;
}

function enrichConflict(conflict) {
  const annotations = conflict.annotation_ids
    .map(id => data.annotations.find(a => a.id === id))
    .filter(Boolean)
    .map(a => enrichAnnotation(a));

  let overlapText = '';
  if (annotations.length >= 2) {
    const doc = require('./documentService').getDocumentById(conflict.document_id, { reload: false });
    if (doc) {
      const content = doc.versions[doc.versions.length - 1].content;
      overlapText = content.substring(conflict.overlap_start, conflict.overlap_end);
    }
  }

  return {
    ...conflict,
    annotations,
    overlap_text: overlapText,
    status_label: conflict.status === CONFLICT_STATUS.PENDING ? '待裁决' : '已解决'
  };
}

function listAnnotationsByDocument(documentId) {
  loadData();
  return data.annotations
    .filter(a => a.document_id === parseInt(documentId))
    .map(a => enrichAnnotation(a));
}

function getAnnotationById(id) {
  loadData();
  const annotation = data.annotations.find(a => a.id === parseInt(id));
  return annotation ? enrichAnnotation(annotation) : null;
}

function enrichAnnotation(annotation) {
  return {
    ...annotation,
    type_label: ANNOTATION_TYPE_LABELS[annotation.type] || annotation.type,
    color: ANNOTATION_COLORS[annotation.type] || '#e5e7eb',
    border_color: ANNOTATION_BORDER_COLORS[annotation.type] || '#9ca3af',
    created_by_username: annotation.created_by_username || annotation.created_by || '匿名用户'
  };
}

function createAnnotation({ document_id, start_offset, end_offset, text, type, description, created_by, created_by_username }) {
  loadData();

  if (!document_id || start_offset === undefined || end_offset === undefined || !text || !type) {
    return { error: '缺少必要参数', status: 400 };
  }

  if (!Object.values(ANNOTATION_TYPES).includes(type)) {
    return { error: '无效的标注类型', status: 400 };
  }

  const annotation = {
    id: data.nextAnnotationId++,
    document_id: parseInt(document_id),
    start_offset: parseInt(start_offset),
    end_offset: parseInt(end_offset),
    text,
    type,
    description: description || '',
    created_by: created_by || '匿名用户',
    created_by_username: created_by_username || created_by || '匿名用户',
    created_at: now(),
    position_x: null,
    position_y: null
  };

  data.annotations.push(annotation);
  saveData();

  return enrichAnnotation(annotation);
}

function updateAnnotation(id, { description, position_x, position_y }) {
  loadData();

  const annotation = data.annotations.find(a => a.id === parseInt(id));
  if (!annotation) {
    return { error: '标注不存在', status: 404 };
  }

  if (description !== undefined) {
    annotation.description = description;
  }
  if (position_x !== undefined) {
    annotation.position_x = position_x;
  }
  if (position_y !== undefined) {
    annotation.position_y = position_y;
  }

  saveData();
  return enrichAnnotation(annotation);
}

function deleteAnnotation(id) {
  loadData();

  const idx = data.annotations.findIndex(a => a.id === parseInt(id));
  if (idx === -1) {
    return { error: '标注不存在', status: 404 };
  }

  const deleted = data.annotations.splice(idx, 1)[0];

  const relatedRelations = data.relations.filter(
    r => r.from_annotation_id === deleted.id || r.to_annotation_id === deleted.id
  );
  relatedRelations.forEach(r => {
    const rIdx = data.relations.findIndex(rel => rel.id === r.id);
    if (rIdx !== -1) {
      data.relations.splice(rIdx, 1);
    }
  });

  saveData();
  return { success: true, deleted_relations: relatedRelations.length };
}

function listRelationsByDocument(documentId) {
  loadData();
  const docAnnotations = data.annotations
    .filter(a => a.document_id === parseInt(documentId))
    .map(a => a.id);

  return data.relations
    .filter(r => docAnnotations.includes(r.from_annotation_id) || docAnnotations.includes(r.to_annotation_id))
    .map(r => enrichRelation(r));
}

function listRelationsByAnnotation(annotationId) {
  loadData();
  return data.relations
    .filter(r => r.from_annotation_id === parseInt(annotationId) || r.to_annotation_id === parseInt(annotationId))
    .map(r => enrichRelation(r));
}

function getRelationById(id) {
  loadData();
  const relation = data.relations.find(r => r.id === parseInt(id));
  return relation ? enrichRelation(relation) : null;
}

function enrichRelation(relation) {
  const fromAnnotation = data.annotations.find(a => a.id === relation.from_annotation_id);
  const toAnnotation = data.annotations.find(a => a.id === relation.to_annotation_id);

  return {
    ...relation,
    type_label: RELATION_TYPE_LABELS[relation.type] || relation.type,
    from_annotation: fromAnnotation ? {
      id: fromAnnotation.id,
      text: fromAnnotation.text,
      type: fromAnnotation.type
    } : null,
    to_annotation: toAnnotation ? {
      id: toAnnotation.id,
      text: toAnnotation.text,
      type: toAnnotation.type
    } : null
  };
}

function createRelation({ from_annotation_id, to_annotation_id, type, description }) {
  loadData();

  if (!from_annotation_id || !to_annotation_id || !type) {
    return { error: '缺少必要参数', status: 400 };
  }

  const fromAnn = data.annotations.find(a => a.id === parseInt(from_annotation_id));
  const toAnn = data.annotations.find(a => a.id === parseInt(to_annotation_id));

  if (!fromAnn || !toAnn) {
    return { error: '标注不存在', status: 404 };
  }

  if (fromAnn.document_id !== toAnn.document_id) {
    return { error: '不能在不同文档的标注之间建立关系', status: 400 };
  }

  if (parseInt(from_annotation_id) === parseInt(to_annotation_id)) {
    return { error: '不能自己和自己建立关系', status: 400 };
  }

  const exists = data.relations.some(
    r => r.from_annotation_id === parseInt(from_annotation_id) &&
         r.to_annotation_id === parseInt(to_annotation_id) &&
         r.type === type
  );

  if (exists) {
    return { error: '该关系已存在', status: 400 };
  }

  const relation = {
    id: data.nextRelationId++,
    from_annotation_id: parseInt(from_annotation_id),
    to_annotation_id: parseInt(to_annotation_id),
    type,
    description: description || '',
    created_at: now()
  };

  data.relations.push(relation);
  saveData();

  return enrichRelation(relation);
}

function updateRelation(id, { description }) {
  loadData();

  const relation = data.relations.find(r => r.id === parseInt(id));
  if (!relation) {
    return { error: '关系不存在', status: 404 };
  }

  if (description !== undefined) {
    relation.description = description;
  }

  saveData();
  return enrichRelation(relation);
}

function deleteRelation(id) {
  loadData();

  const idx = data.relations.findIndex(r => r.id === parseInt(id));
  if (idx === -1) {
    return { error: '关系不存在', status: 404 };
  }

  data.relations.splice(idx, 1);
  saveData();
  return { success: true };
}

function listConflictsByDocument(documentId, { status = null } = {}) {
  loadConflictData();
  loadData();

  const docAnnotations = data.annotations.filter(a => a.document_id === parseInt(documentId));
  const docAnnotationIds = new Set(docAnnotations.map(a => a.id));

  const invalidConflicts = conflictData.conflicts.filter(c =>
    c.document_id === parseInt(documentId) &&
    c.status === CONFLICT_STATUS.PENDING &&
    !c.annotation_ids.every(id => docAnnotationIds.has(id))
  );
  let needSave = false;
  if (invalidConflicts.length > 0) {
    conflictData.conflicts = conflictData.conflicts.filter(c => !invalidConflicts.includes(c));
    needSave = true;
  }

  let conflicts = conflictData.conflicts.filter(c => c.document_id === parseInt(documentId));

  if (status) {
    conflicts = conflicts.filter(c => c.status === status);
  }

  const enrichedConflicts = conflicts
    .map(c => enrichConflict(c))
    .filter(c => c.annotations && c.annotations.length >= 2);

  if (needSave) {
    saveConflictData();
  }

  return enrichedConflicts;
}

function getConflictById(id) {
  loadConflictData();
  loadData();
  const conflict = conflictData.conflicts.find(c => c.id === parseInt(id));
  if (!conflict) return null;
  const enriched = enrichConflict(conflict);
  return enriched.annotations && enriched.annotations.length >= 2 ? enriched : null;
}

function getConflictingAnnotationIds(documentId) {
  loadConflictData();
  const pendingConflicts = conflictData.conflicts.filter(
    c => c.document_id === parseInt(documentId) && c.status === CONFLICT_STATUS.PENDING
  );
  const conflictingIds = new Set();
  pendingConflicts.forEach(c => {
    c.annotation_ids.forEach(id => conflictingIds.add(id));
  });
  return Array.from(conflictingIds);
}

function resolveConflict(conflictId, { resolution, resolved_by, merge_type, merge_text, merge_description, keep_annotation_id }) {
  loadConflictData();
  loadData();

  const conflict = conflictData.conflicts.find(c => c.id === parseInt(conflictId));
  if (!conflict) {
    return { error: '冲突不存在', status: 404 };
  }

  if (conflict.status !== CONFLICT_STATUS.PENDING) {
    return { error: '冲突已裁决，不可重复操作', status: 400 };
  }

  if (!Object.values(RESOLUTION_TYPE).includes(resolution)) {
    return { error: '无效的裁决类型', status: 400 };
  }

  const [ann1Id, ann2Id] = conflict.annotation_ids;
  const ann1 = data.annotations.find(a => a.id === ann1Id);
  const ann2 = data.annotations.find(a => a.id === ann2Id);

  if (!ann1 || !ann2) {
    return { error: '关联标注不存在', status: 404 };
  }

  let deletedAnnotationIds = [];
  let newAnnotation = null;

  switch (resolution) {
    case RESOLUTION_TYPE.KEEP_FIRST:
      deletedAnnotationIds = [ann2Id];
      break;
    case RESOLUTION_TYPE.KEEP_SECOND:
      deletedAnnotationIds = [ann1Id];
      break;
    case RESOLUTION_TYPE.KEEP_BOTH:
      if (keep_annotation_id !== ann1Id && keep_annotation_id !== ann2Id) {
        return { error: '请指定保留的标注ID', status: 400 };
      }
      const keptAnn = keep_annotation_id === ann1Id ? ann1 : ann2;
      const otherAnn = keep_annotation_id === ann1Id ? ann2 : ann1;

      if (keptAnn.start_offset < otherAnn.start_offset) {
        otherAnn.start_offset = keptAnn.end_offset;
      } else {
        otherAnn.end_offset = keptAnn.start_offset;
      }
      if (otherAnn.start_offset >= otherAnn.end_offset) {
        deletedAnnotationIds = [otherAnn.id];
      } else {
        const doc = require('./documentService').getDocumentById(conflict.document_id, { reload: false });
        const content = doc.versions[doc.versions.length - 1].content;
        otherAnn.text = content.substring(otherAnn.start_offset, otherAnn.end_offset);
      }
      break;
    case RESOLUTION_TYPE.SHORTEN:
      if (keep_annotation_id !== ann1Id && keep_annotation_id !== ann2Id) {
        return { error: '请指定保留的标注ID', status: 400 };
      }
      const kept = keep_annotation_id === ann1Id ? ann1 : ann2;
      const other = keep_annotation_id === ann1Id ? ann2 : ann1;

      if (kept.start_offset < other.start_offset) {
        other.start_offset = kept.end_offset;
      } else {
        other.end_offset = kept.start_offset;
      }
      if (other.start_offset >= other.end_offset) {
        deletedAnnotationIds = [other.id];
      } else {
        const doc = require('./documentService').getDocumentById(conflict.document_id, { reload: false });
        const content = doc.versions[doc.versions.length - 1].content;
        other.text = content.substring(other.start_offset, other.end_offset);
      }
      break;
    case RESOLUTION_TYPE.MERGE:
      if (!merge_type || !Object.values(ANNOTATION_TYPES).includes(merge_type)) {
        return { error: '请指定有效的合并标注类型', status: 400 };
      }
      const mergedStart = Math.min(ann1.start_offset, ann2.start_offset);
      const mergedEnd = Math.max(ann1.end_offset, ann2.end_offset);
      const doc = require('./documentService').getDocumentById(conflict.document_id, { reload: false });
      const content = doc.versions[doc.versions.length - 1].content;

      newAnnotation = {
        id: data.nextAnnotationId++,
        document_id: conflict.document_id,
        start_offset: mergedStart,
        end_offset: mergedEnd,
        text: merge_text || content.substring(mergedStart, mergedEnd),
        type: merge_type,
        description: merge_description || `${ann1.text} + ${ann2.text}`,
        created_by: resolved_by || 'system',
        created_at: now(),
        position_x: null,
        position_y: null
      };
      data.annotations.push(newAnnotation);
      deletedAnnotationIds = [ann1Id, ann2Id];
      break;
  }

  deletedAnnotationIds.forEach(id => {
    const idx = data.annotations.findIndex(a => a.id === id);
    if (idx !== -1) {
      data.annotations.splice(idx, 1);
    }
    const relatedRelations = data.relations.filter(
      r => r.from_annotation_id === id || r.to_annotation_id === id
    );
    relatedRelations.forEach(r => {
      const rIdx = data.relations.findIndex(rel => rel.id === r.id);
      if (rIdx !== -1) {
        data.relations.splice(rIdx, 1);
      }
    });
  });

  conflict.status = CONFLICT_STATUS.RESOLVED;
  conflict.resolution = resolution;
  conflict.resolved_by = resolved_by || 'system';
  conflict.resolved_at = now();
  conflict.keep_annotation_id = keep_annotation_id || null;
  conflict.merge_annotation_id = newAnnotation ? newAnnotation.id : null;
  conflict.deleted_annotation_ids = deletedAnnotationIds;

  saveData();
  saveConflictData();

  detectConflicts(conflict.document_id);

  return {
    conflict: enrichConflict(conflict),
    new_annotation: newAnnotation ? enrichAnnotation(newAnnotation) : null,
    deleted_annotation_ids: deletedAnnotationIds
  };
}

function getKnowledgeGraph(documentId, { includeConflicts = false } = {}) {
  loadData();
  let annotations = listAnnotationsByDocument(documentId);

  if (!includeConflicts) {
    const conflictingIds = getConflictingAnnotationIds(documentId);
    annotations = annotations.filter(a => !conflictingIds.includes(a.id));
  }

  const annotationIds = new Set(annotations.map(a => a.id));
  let relations = listRelationsByDocument(documentId);
  relations = relations.filter(r =>
    annotationIds.has(r.from_annotation_id) && annotationIds.has(r.to_annotation_id)
  );

  const conflicts = listConflictsByDocument(documentId, { status: CONFLICT_STATUS.PENDING });
  const conflictingIds = getConflictingAnnotationIds(documentId);

  return {
    annotations,
    relations,
    conflicts,
    conflicting_annotation_ids: conflictingIds,
    stats: {
      annotation_count: annotations.length,
      relation_count: relations.length,
      conflict_count: conflicts.length,
      type_counts: annotations.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {})
    }
  };
}

module.exports = {
  ANNOTATION_TYPES,
  ANNOTATION_TYPE_LABELS,
  ANNOTATION_COLORS,
  ANNOTATION_BORDER_COLORS,
  RELATION_TYPES,
  RELATION_TYPE_LABELS,
  CONFLICT_STATUS,
  RESOLUTION_TYPE,
  listAnnotationsByDocument,
  getAnnotationById,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
  listRelationsByDocument,
  listRelationsByAnnotation,
  getRelationById,
  createRelation,
  updateRelation,
  deleteRelation,
  getKnowledgeGraph,
  detectConflicts,
  listConflictsByDocument,
  getConflictById,
  resolveConflict,
  getConflictingAnnotationIds,
  enrichAnnotation,
  enrichConflict
};
