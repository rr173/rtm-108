const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'annotations.json');

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

let data = {
  annotations: [],
  relations: [],
  nextAnnotationId: 1,
  nextRelationId: 1
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

function now() {
  return Date.now();
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
    border_color: ANNOTATION_BORDER_COLORS[annotation.type] || '#9ca3af'
  };
}

function createAnnotation({ document_id, start_offset, end_offset, text, type, description, created_by }) {
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

function getKnowledgeGraph(documentId) {
  loadData();
  const annotations = listAnnotationsByDocument(documentId);
  const relations = listRelationsByDocument(documentId);

  return {
    annotations,
    relations,
    stats: {
      annotation_count: annotations.length,
      relation_count: relations.length,
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
  getKnowledgeGraph
};
