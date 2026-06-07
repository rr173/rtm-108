const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const dataFile = path.join(dataDir, 'reviews.json');

let data = {
  reviews: [],
  comments: [],
  nextReviewId: 1,
  nextCommentId: 1
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
        reviews: loaded.reviews || [],
        comments: loaded.comments || [],
        nextReviewId: loaded.nextReviewId || 1,
        nextCommentId: loaded.nextCommentId || 1
      };
    } catch (e) {
      console.warn('评审数据文件损坏，使用空数据:', e.message);
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

function createReview({ document_id, old_version, new_version, title = '', created_by = '匿名用户' }) {
  loadData();

  const review = {
    id: data.nextReviewId++,
    document_id,
    old_version,
    new_version,
    title: title || `v${old_version} vs v${new_version} 评审`,
    status: 'pending',
    created_by,
    created_at: now()
  };

  data.reviews.push(review);
  saveData();

  return getReviewById(review.id);
}

function getReviewById(id) {
  loadData();
  const review = data.reviews.find(r => r.id === id);
  if (!review) return null;

  const comments = data.comments.filter(c => c.review_id === id);
  const resolvedCount = comments.filter(c => c.resolved && !c.parent_id).length;
  const totalTopLevel = comments.filter(c => !c.parent_id).length;

  return {
    ...review,
    comment_count: comments.length,
    top_level_comment_count: totalTopLevel,
    resolved_count: resolvedCount
  };
}

function listReviewsByDocument(documentId) {
  loadData();
  return data.reviews
    .filter(r => r.document_id === documentId)
    .sort((a, b) => b.created_at - a.created_at)
    .map(r => getReviewById(r.id));
}

function updateReviewStatus(id, status) {
  loadData();
  const review = data.reviews.find(r => r.id === id);
  if (!review) return null;

  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return null;
  }

  review.status = status;
  review.updated_at = now();
  saveData();

  return getReviewById(id);
}

function deleteReview(id) {
  loadData();
  const reviewIndex = data.reviews.findIndex(r => r.id === id);
  if (reviewIndex === -1) return false;

  data.reviews.splice(reviewIndex, 1);
  data.comments = data.comments.filter(c => c.review_id !== id);
  saveData();
  return true;
}

function addComment({ review_id, old_line = null, new_line = null, content, author = '匿名用户', parent_id = null }) {
  loadData();

  const review = data.reviews.find(r => r.id === review_id);
  if (!review) return null;

  if (parent_id) {
    const parent = data.comments.find(c => c.id === parent_id && c.review_id === review_id);
    if (!parent) return null;
  }

  const comment = {
    id: data.nextCommentId++,
    review_id,
    parent_id,
    old_line,
    new_line,
    content,
    author,
    resolved: false,
    created_at: now()
  };

  data.comments.push(comment);
  saveData();

  return getCommentById(comment.id);
}

function getCommentById(id) {
  loadData();
  return data.comments.find(c => c.id === id) || null;
}

function getCommentsByReview(reviewId) {
  loadData();
  const allComments = data.comments.filter(c => c.review_id === reviewId);

  const topLevel = allComments.filter(c => !c.parent_id);
  const replies = allComments.filter(c => c.parent_id);

  const commentMap = new Map();
  topLevel.forEach(c => {
    commentMap.set(c.id, { ...c, replies: [] });
  });

  replies.forEach(r => {
    const parent = commentMap.get(r.parent_id);
    if (parent) {
      parent.replies.push(r);
    }
  });

  return Array.from(commentMap.values()).sort((a, b) => a.created_at - b.created_at);
}

function getCommentsByLine(reviewId, oldLine = null, newLine = null) {
  loadData();
  return data.comments.filter(c => {
    if (c.review_id !== review_id) return false;
    if (c.parent_id) return false;
    if (oldLine !== null && c.old_line === oldLine) return true;
    if (newLine !== null && c.new_line === newLine) return true;
    return false;
  });
}

function updateComment(id, updates) {
  loadData();
  const comment = data.comments.find(c => c.id === id);
  if (!comment) return null;

  if (updates.content !== undefined) {
    comment.content = updates.content;
  }
  if (updates.resolved !== undefined) {
    comment.resolved = updates.resolved;
  }
  comment.updated_at = now();
  saveData();

  return getCommentById(id);
}

function resolveComment(id) {
  return updateComment(id, { resolved: true });
}

function unresolveComment(id) {
  return updateComment(id, { resolved: false });
}

function deleteComment(id) {
  loadData();
  const index = data.comments.findIndex(c => c.id === id);
  if (index === -1) return false;

  const toDelete = [id];
  let added = true;
  while (added) {
    added = false;
    data.comments.forEach(c => {
      if (c.parent_id && toDelete.includes(c.parent_id) && !toDelete.includes(c.id)) {
        toDelete.push(c.id);
        added = true;
      }
    });
  }

  data.comments = data.comments.filter(c => !toDelete.includes(c.id));
  saveData();
  return true;
}

function checkAllResolved(reviewId) {
  loadData();
  const topLevelComments = data.comments.filter(c => c.review_id === reviewId && !c.parent_id);
  if (topLevelComments.length === 0) return true;
  return topLevelComments.every(c => c.resolved);
}

loadData();

module.exports = {
  createReview,
  getReviewById,
  listReviewsByDocument,
  updateReviewStatus,
  deleteReview,
  addComment,
  getCommentById,
  getCommentsByReview,
  getCommentsByLine,
  updateComment,
  resolveComment,
  unresolveComment,
  deleteComment,
  checkAllResolved
};
