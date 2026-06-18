const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'highlights.json');

const VISIBILITY = {
  PRIVATE: 'private',
  PUBLIC: 'public'
};

let highlightData = {
  highlights: [],
  nextHighlightId: 1
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
      highlightData = {
        highlights: loaded.highlights || [],
        nextHighlightId: loaded.nextHighlightId || 1
      };
    } catch (e) {
      console.warn('划线批注数据文件损坏，使用空数据:', e.message);
    }
  }
}

function saveData() {
  ensureDataDir();
  fs.writeFileSync(dataFile, JSON.stringify(highlightData, null, 2), 'utf8');
}

function now() {
  return Date.now();
}

function enrichHighlight(highlight, currentUserId = null) {
  const isOwner = currentUserId && highlight.created_by === currentUserId;
  return {
    ...highlight,
    is_owner: isOwner,
    visibility_label: highlight.visibility === VISIBILITY.PUBLIC ? '公开' : '私有',
    created_at_formatted: formatTime(highlight.created_at),
    updated_at_formatted: highlight.updated_at ? formatTime(highlight.updated_at) : null
  };
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function createHighlight({
  document_id,
  paragraph_index,
  start_offset,
  end_offset,
  selected_text,
  comment_text = '',
  visibility = VISIBILITY.PRIVATE,
  created_by,
  created_by_username
}) {
  loadData();

  if (!document_id || paragraph_index === undefined || start_offset === undefined || end_offset === undefined) {
    return { error: '缺少必要参数(document_id, paragraph_index, start_offset, end_offset)', status: 400 };
  }

  if (start_offset >= end_offset) {
    return { error: 'start_offset 必须小于 end_offset', status: 400 };
  }

  if (!Object.values(VISIBILITY).includes(visibility)) {
    return { error: '无效的可见性，必须是 private 或 public', status: 400 };
  }

  const highlight = {
    id: highlightData.nextHighlightId++,
    document_id: parseInt(document_id),
    paragraph_index: parseInt(paragraph_index),
    start_offset: parseInt(start_offset),
    end_offset: parseInt(end_offset),
    selected_text: selected_text || '',
    comment_text: comment_text || '',
    visibility: visibility,
    created_by: created_by || 'anonymous',
    created_by_username: created_by_username || created_by || '匿名用户',
    created_at: now(),
    updated_at: null
  };

  highlightData.highlights.push(highlight);
  saveData();

  return enrichHighlight(highlight, created_by);
}

function updateHighlight(id, { comment_text, visibility }, currentUserId) {
  loadData();

  const highlight = highlightData.highlights.find(h => h.id === parseInt(id));
  if (!highlight) {
    return { error: '划线不存在', status: 404 };
  }

  if (currentUserId && highlight.created_by !== currentUserId) {
    return { error: '无权编辑他人的划线', status: 403 };
  }

  if (comment_text !== undefined) {
    highlight.comment_text = comment_text;
  }
  if (visibility !== undefined) {
    if (!Object.values(VISIBILITY).includes(visibility)) {
      return { error: '无效的可见性', status: 400 };
    }
    highlight.visibility = visibility;
  }

  highlight.updated_at = now();
  saveData();

  return enrichHighlight(highlight, currentUserId);
}

function deleteHighlight(id, currentUserId) {
  loadData();

  const idx = highlightData.highlights.findIndex(h => h.id === parseInt(id));
  if (idx === -1) {
    return { error: '划线不存在', status: 404 };
  }

  const highlight = highlightData.highlights[idx];
  if (currentUserId && highlight.created_by !== currentUserId) {
    return { error: '无权删除他人的划线', status: 403 };
  }

  const deleted = highlightData.highlights.splice(idx, 1)[0];
  saveData();

  return { success: true, deleted: enrichHighlight(deleted, currentUserId) };
}

function getHighlightById(id, currentUserId = null) {
  loadData();
  const highlight = highlightData.highlights.find(h => h.id === parseInt(id));
  if (!highlight) return null;

  if (highlight.visibility === VISIBILITY.PRIVATE && currentUserId !== highlight.created_by) {
    return null;
  }

  return enrichHighlight(highlight, currentUserId);
}

function listMyHighlightsByDocument(documentId, userId) {
  loadData();
  const docId = parseInt(documentId);

  const highlights = highlightData.highlights
    .filter(h => h.document_id === docId && h.created_by === userId)
    .sort((a, b) => {
      if (a.paragraph_index !== b.paragraph_index) {
        return a.paragraph_index - b.paragraph_index;
      }
      return a.start_offset - b.start_offset;
    });

  return highlights.map(h => enrichHighlight(h, userId));
}

function listPublicHighlightsByDocument(documentId, excludeUserId = null) {
  loadData();
  const docId = parseInt(documentId);

  const highlights = highlightData.highlights
    .filter(h => h.document_id === docId && h.visibility === VISIBILITY.PUBLIC)
    .filter(h => !excludeUserId || h.created_by !== excludeUserId)
    .sort((a, b) => {
      if (a.paragraph_index !== b.paragraph_index) {
        return a.paragraph_index - b.paragraph_index;
      }
      return a.start_offset - b.start_offset;
    });

  return highlights.map(h => enrichHighlight(h, excludeUserId));
}

function listAllHighlightsForDocument(documentId, currentUserId) {
  loadData();
  const docId = parseInt(documentId);

  const highlights = highlightData.highlights
    .filter(h => h.document_id === docId)
    .filter(h => h.visibility === VISIBILITY.PUBLIC || h.created_by === currentUserId)
    .sort((a, b) => {
      if (a.paragraph_index !== b.paragraph_index) {
        return a.paragraph_index - b.paragraph_index;
      }
      return a.start_offset - b.start_offset;
    });

  return highlights.map(h => enrichHighlight(h, currentUserId));
}

function listPublicHighlightsByUser(userId) {
  loadData();

  const highlights = highlightData.highlights
    .filter(h => h.created_by === userId && h.visibility === VISIBILITY.PUBLIC)
    .sort((a, b) => b.created_at - a.created_at);

  const docGroups = {};
  highlights.forEach(h => {
    const docId = String(h.document_id);
    if (!docGroups[docId]) {
      docGroups[docId] = [];
    }
    docGroups[docId].push(enrichHighlight(h, null));
  });

  return {
    user_id: userId,
    total_count: highlights.length,
    by_document: docGroups,
    all_highlights: highlights.map(h => enrichHighlight(h, null))
  };
}

function getDocumentHighlightStats(documentId, currentUserId = null) {
  loadData();
  const docId = parseInt(documentId);

  const allHighlights = highlightData.highlights.filter(h => h.document_id === docId);
  const publicHighlights = allHighlights.filter(h => h.visibility === VISIBILITY.PUBLIC);
  const userHighlights = currentUserId
    ? allHighlights.filter(h => h.created_by === currentUserId)
    : [];

  const paragraphCounts = {};
  allHighlights.forEach(h => {
    if (h.visibility === VISIBILITY.PUBLIC || h.created_by === currentUserId) {
      const key = String(h.paragraph_index);
      if (!paragraphCounts[key]) paragraphCounts[key] = 0;
      paragraphCounts[key]++;
    }
  });

  const uniqueAuthors = new Set(
    publicHighlights.map(h => h.created_by)
  );

  return {
    document_id: docId,
    total_highlights: allHighlights.filter(h => h.visibility === VISIBILITY.PUBLIC || h.created_by === currentUserId).length,
    public_highlights: publicHighlights.length,
    my_highlights: userHighlights.length,
    unique_authors: uniqueAuthors.size,
    paragraph_counts: paragraphCounts,
    top_paragraphs: Object.entries(paragraphCounts)
      .map(([idx, count]) => ({ paragraph_index: parseInt(idx), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  };
}

function bulkCreateHighlights(highlightsData) {
  loadData();
  const results = [];
  highlightsData.forEach(data => {
    const result = createHighlight(data);
    if (!result.error) {
      results.push(result);
    }
  });
  return results;
}

module.exports = {
  VISIBILITY,
  createHighlight,
  updateHighlight,
  deleteHighlight,
  getHighlightById,
  listMyHighlightsByDocument,
  listPublicHighlightsByDocument,
  listAllHighlightsForDocument,
  listPublicHighlightsByUser,
  getDocumentHighlightStats,
  bulkCreateHighlights,
  loadData
};
