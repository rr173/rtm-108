const WebSocket = require('ws');
const { getContractById, checkAndUpdateExpiredContracts } = require('./contractService');
const { getReviewById, getCommentsByReview } = require('./reviewService');
const { listMirrorsByDocument, getMirrorById, getTranslationWorkbench } = require('./mirrorService');
const { getDocumentById } = require('./documentService');
const { getInstanceById, listTodos } = require('./approvalWorkflowService');
const { getKnowledgeGraph, listConflictsByDocument, getConflictingAnnotationIds } = require('./annotationService');

class WsService {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.subscriptions = new Map();
    this.clientContracts = new Map();
    this.reviewSubscriptions = new Map();
    this.clientReviews = new Map();
    this.documentMirrorSubscriptions = new Map();
    this.clientDocumentMirrors = new Map();
    this.mirrorSubscriptions = new Map();
    this.clientMirrors = new Map();
    this.approvalSubscriptions = new Map();
    this.clientApprovals = new Map();
    this.todoSubscriptions = new Map();
    this.clientTodos = new Map();
    this.annotationSubscriptions = new Map();
    this.clientAnnotations = new Map();

    this.wss.on('connection', (ws) => {
      ws.id = Math.random().toString(36).substr(2, 9);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleMessage(ws, data);
        } catch (e) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
      });

      ws.on('close', () => {
        this.cleanupClient(ws);
      });
    });

    setInterval(() => {
      const changed = checkAndUpdateExpiredContracts();
      if (changed) {
        this.broadcastAllStatus();
      }
    }, 10000);
  }

  handleMessage(ws, data) {
    switch (data.type) {
      case 'subscribe':
        this.subscribe(ws, data.contractId);
        break;
      case 'unsubscribe':
        this.unsubscribe(ws, data.contractId);
        break;
      case 'subscribe_review':
        this.subscribeReview(ws, data.reviewId);
        break;
      case 'unsubscribe_review':
        this.unsubscribeReview(ws, data.reviewId);
        break;
      case 'subscribe_document_mirrors':
        this.subscribeDocumentMirrors(ws, data.documentId);
        break;
      case 'unsubscribe_document_mirrors':
        this.unsubscribeDocumentMirrors(ws, data.documentId);
        break;
      case 'subscribe_mirror':
        this.subscribeMirror(ws, data.mirrorId);
        break;
      case 'unsubscribe_mirror':
        this.unsubscribeMirror(ws, data.mirrorId);
        break;
      case 'subscribe_approval':
        this.subscribeApproval(ws, data.instanceId);
        break;
      case 'unsubscribe_approval':
        this.unsubscribeApproval(ws, data.instanceId);
        break;
      case 'subscribe_todos':
        this.subscribeTodos(ws, data.userId);
        break;
      case 'unsubscribe_todos':
        this.unsubscribeTodos(ws, data.userId);
        break;
      case 'subscribe_annotations':
        this.subscribeAnnotations(ws, data.documentId);
        break;
      case 'unsubscribe_annotations':
        this.unsubscribeAnnotations(ws, data.documentId);
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
    }
  }

  subscribeDocumentMirrors(ws, documentId) {
    if (!this.documentMirrorSubscriptions.has(documentId)) {
      this.documentMirrorSubscriptions.set(documentId, new Set());
    }
    this.documentMirrorSubscriptions.get(documentId).add(ws);

    if (!this.clientDocumentMirrors.has(ws)) {
      this.clientDocumentMirrors.set(ws, new Set());
    }
    this.clientDocumentMirrors.get(ws).add(documentId);

    const doc = getDocumentById(documentId, { reload: false });
    const mirrors = listMirrorsByDocument(documentId);
    ws.send(JSON.stringify({
      type: 'document_mirrors_status',
      documentId,
      document_title: doc?.title,
      mirrors
    }));
  }

  unsubscribeDocumentMirrors(ws, documentId) {
    if (this.documentMirrorSubscriptions.has(documentId)) {
      this.documentMirrorSubscriptions.get(documentId).delete(ws);
    }
    if (this.clientDocumentMirrors.has(ws)) {
      this.clientDocumentMirrors.get(ws).delete(documentId);
    }
  }

  notifyDocumentMirrorsUpdate(documentId) {
    const doc = getDocumentById(documentId, { reload: false });
    const mirrors = listMirrorsByDocument(documentId);
    const message = JSON.stringify({
      type: 'document_mirrors_updated',
      documentId,
      document_title: doc?.title,
      mirrors
    });

    if (this.documentMirrorSubscriptions.has(documentId)) {
      this.documentMirrorSubscriptions.get(documentId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }

    const relatedMirrorIds = mirrors.map(m => m.id);
    relatedMirrorIds.forEach(mirrorId => {
      this.notifyMirrorUpdate(mirrorId, 'master_updated');
    });
  }

  subscribeMirror(ws, mirrorId) {
    if (!this.mirrorSubscriptions.has(mirrorId)) {
      this.mirrorSubscriptions.set(mirrorId, new Set());
    }
    this.mirrorSubscriptions.get(mirrorId).add(ws);

    if (!this.clientMirrors.has(ws)) {
      this.clientMirrors.set(ws, new Set());
    }
    this.clientMirrors.get(ws).add(mirrorId);

    const workbench = getTranslationWorkbench(mirrorId);
    if (workbench && !workbench.error) {
      ws.send(JSON.stringify({
        type: 'mirror_status',
        mirrorId,
        workbench
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        message: workbench?.error || '镜像不存在'
      }));
    }
  }

  unsubscribeMirror(ws, mirrorId) {
    if (this.mirrorSubscriptions.has(mirrorId)) {
      this.mirrorSubscriptions.get(mirrorId).delete(ws);
    }
    if (this.clientMirrors.has(ws)) {
      this.clientMirrors.get(ws).delete(mirrorId);
    }
  }

  notifyMirrorUpdate(mirrorId, eventType = 'mirror_updated') {
    const workbench = getTranslationWorkbench(mirrorId);
    if (workbench && !workbench.error) {
      const message = JSON.stringify({
        type: eventType,
        mirrorId,
        workbench
      });

      if (this.mirrorSubscriptions.has(mirrorId)) {
        this.mirrorSubscriptions.get(mirrorId).forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        });
      }
    }
  }

  notifyMirrorParagraphUpdate(mirrorId, mappingId, eventType = 'paragraph_updated') {
    const message = JSON.stringify({
      type: eventType,
      mirrorId,
      mappingId
    });

    if (this.mirrorSubscriptions.has(mirrorId)) {
      this.mirrorSubscriptions.get(mirrorId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }

    setTimeout(() => {
      this.notifyMirrorUpdate(mirrorId, 'mirror_workbench_updated');
    }, 50);
  }

  notifyMirrorVersionUpdate(mirrorId, eventType = 'mirror_version_updated') {
    const mirror = getMirrorById(mirrorId);
    const message = JSON.stringify({
      type: eventType,
      mirrorId,
      mirror
    });

    if (this.mirrorSubscriptions.has(mirrorId)) {
      this.mirrorSubscriptions.get(mirrorId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }

    if (mirror) {
      const doc = getDocumentById(mirror.document_id, { reload: false });
      this.notifyDocumentMirrorsUpdate(mirror.document_id);
    }
  }

  subscribe(ws, contractId) {
    if (!this.subscriptions.has(contractId)) {
      this.subscriptions.set(contractId, new Set());
    }
    this.subscriptions.get(contractId).add(ws);

    if (!this.clientContracts.has(ws)) {
      this.clientContracts.set(ws, new Set());
    }
    this.clientContracts.get(ws).add(contractId);

    const contract = getContractById(contractId);
    if (contract) {
      ws.send(JSON.stringify({
        type: 'contract_status',
        contract
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        message: '合同不存在'
      }));
    }
  }

  unsubscribe(ws, contractId) {
    if (this.subscriptions.has(contractId)) {
      this.subscriptions.get(contractId).delete(ws);
    }
    if (this.clientContracts.has(ws)) {
      this.clientContracts.get(ws).delete(contractId);
    }
  }

  notifyContractUpdate(contractId, eventType = 'contract_updated') {
    const contract = getContractById(contractId);
    if (!contract) return;

    const message = JSON.stringify({
      type: eventType,
      contract
    });

    if (this.subscriptions.has(contractId)) {
      this.subscriptions.get(contractId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  sendNotification(contractId, notification) {
    const message = JSON.stringify({
      type: 'notification',
      notification,
      contractId
    });

    if (this.subscriptions.has(contractId)) {
      this.subscriptions.get(contractId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  broadcastAllStatus() {
    this.subscriptions.forEach((clients, contractId) => {
      const contract = getContractById(contractId);
      if (contract) {
        const message = JSON.stringify({
          type: 'contract_status',
          contract
        });
        clients.forEach(ws => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        });
      }
    });
  }

  subscribeReview(ws, reviewId) {
    if (!this.reviewSubscriptions.has(reviewId)) {
      this.reviewSubscriptions.set(reviewId, new Set());
    }
    this.reviewSubscriptions.get(reviewId).add(ws);

    if (!this.clientReviews.has(ws)) {
      this.clientReviews.set(ws, new Set());
    }
    this.clientReviews.get(ws).add(reviewId);

    const review = getReviewById(reviewId);
    if (review) {
      const comments = getCommentsByReview(reviewId);
      ws.send(JSON.stringify({
        type: 'review_status',
        review,
        comments
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        message: '评审不存在'
      }));
    }
  }

  unsubscribeReview(ws, reviewId) {
    if (this.reviewSubscriptions.has(reviewId)) {
      this.reviewSubscriptions.get(reviewId).delete(ws);
    }
    if (this.clientReviews.has(ws)) {
      this.clientReviews.get(ws).delete(reviewId);
    }
  }

  notifyReviewUpdate(reviewId, eventType = 'review_updated') {
    const review = getReviewById(reviewId);
    if (!review) return;

    const message = JSON.stringify({
      type: eventType,
      review
    });

    if (this.reviewSubscriptions.has(reviewId)) {
      this.reviewSubscriptions.get(reviewId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  notifyReviewComment(reviewId, comment, eventType = 'new_comment') {
    const message = JSON.stringify({
      type: eventType,
      reviewId,
      comment
    });

    if (this.reviewSubscriptions.has(reviewId)) {
      this.reviewSubscriptions.get(reviewId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  notifyCommentResolved(reviewId, comment, eventType = 'comment_resolved') {
    const message = JSON.stringify({
      type: eventType,
      reviewId,
      comment
    });

    if (this.reviewSubscriptions.has(reviewId)) {
      this.reviewSubscriptions.get(reviewId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  subscribeApproval(ws, instanceId) {
    if (!this.approvalSubscriptions.has(instanceId)) {
      this.approvalSubscriptions.set(instanceId, new Set());
    }
    this.approvalSubscriptions.get(instanceId).add(ws);

    if (!this.clientApprovals.has(ws)) {
      this.clientApprovals.set(ws, new Set());
    }
    this.clientApprovals.get(ws).add(instanceId);

    const instance = getInstanceById(instanceId, { reload: false });
    if (instance) {
      ws.send(JSON.stringify({
        type: 'approval_status',
        instanceId,
        instance
      }));
    } else {
      ws.send(JSON.stringify({
        type: 'error',
        message: '审批实例不存在'
      }));
    }
  }

  unsubscribeApproval(ws, instanceId) {
    if (this.approvalSubscriptions.has(instanceId)) {
      this.approvalSubscriptions.get(instanceId).delete(ws);
    }
    if (this.clientApprovals.has(ws)) {
      this.clientApprovals.get(ws).delete(instanceId);
    }
  }

  notifyApprovalUpdate(instanceId, eventType = 'approval_updated') {
    const instance = getInstanceById(instanceId, { reload: false });
    if (!instance) return;

    const message = JSON.stringify({
      type: eventType,
      instanceId,
      instance
    });

    if (this.approvalSubscriptions.has(instanceId)) {
      this.approvalSubscriptions.get(instanceId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }

    this.broadcastTodoUpdate();
  }

  subscribeTodos(ws, userId) {
    if (!userId) return;
    const key = String(userId);
    if (!this.todoSubscriptions.has(key)) {
      this.todoSubscriptions.set(key, new Set());
    }
    this.todoSubscriptions.get(key).add(ws);

    if (!this.clientTodos.has(ws)) {
      this.clientTodos.set(ws, new Set());
    }
    this.clientTodos.get(ws).add(key);

    const todos = listTodos(userId);
    ws.send(JSON.stringify({
      type: 'todos_status',
      userId,
      todos
    }));
  }

  unsubscribeTodos(ws, userId) {
    if (!userId) return;
    const key = String(userId);
    if (this.todoSubscriptions.has(key)) {
      this.todoSubscriptions.get(key).delete(ws);
    }
    if (this.clientTodos.has(ws)) {
      this.clientTodos.get(ws).delete(key);
    }
  }

  broadcastTodoUpdate() {
    this.todoSubscriptions.forEach((clients, userIdKey) => {
      const userId = userIdKey;
      const todos = listTodos(userId);
      const message = JSON.stringify({
        type: 'todos_updated',
        userId,
        todos
      });
      clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    });
  }

  subscribeAnnotations(ws, documentId) {
    const docId = parseInt(documentId);
    if (!this.annotationSubscriptions.has(docId)) {
      this.annotationSubscriptions.set(docId, new Set());
    }
    this.annotationSubscriptions.get(docId).add(ws);

    if (!this.clientAnnotations.has(ws)) {
      this.clientAnnotations.set(ws, new Set());
    }
    this.clientAnnotations.get(ws).add(docId);

    const graph = getKnowledgeGraph(docId);
    const conflicts = listConflictsByDocument(docId, { status: 'pending' });
    const conflictingAnnotationIds = getConflictingAnnotationIds(docId);
    ws.send(JSON.stringify({
      type: 'annotations_status',
      documentId: docId,
      graph,
      conflicts,
      conflicting_annotation_ids: conflictingAnnotationIds
    }));
  }

  unsubscribeAnnotations(ws, documentId) {
    const docId = parseInt(documentId);
    if (this.annotationSubscriptions.has(docId)) {
      this.annotationSubscriptions.get(docId).delete(ws);
    }
    if (this.clientAnnotations.has(ws)) {
      this.clientAnnotations.get(ws).delete(docId);
    }
  }

  notifyAnnotationUpdate(documentId, annotation, eventType = 'annotation_updated') {
    const docId = parseInt(documentId);
    const message = JSON.stringify({
      type: eventType,
      documentId: docId,
      annotation
    });

    if (this.annotationSubscriptions.has(docId)) {
      this.annotationSubscriptions.get(docId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  notifyRelationUpdate(documentId, relation, eventType = 'relation_updated') {
    const docId = parseInt(documentId);
    const message = JSON.stringify({
      type: eventType,
      documentId: docId,
      relation
    });

    if (this.annotationSubscriptions.has(docId)) {
      this.annotationSubscriptions.get(docId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  notifyAnnotationConflictsUpdate(documentId, conflicts, eventType = 'conflicts_detected') {
    const docId = parseInt(documentId);
    const graph = getKnowledgeGraph(docId);
    const pendingConflicts = listConflictsByDocument(docId, { status: 'pending' });
    const conflictingAnnotationIds = getConflictingAnnotationIds(docId);
    const message = JSON.stringify({
      type: eventType,
      documentId: docId,
      conflicts,
      pending_conflicts: pendingConflicts,
      conflicting_annotation_ids: conflictingAnnotationIds,
      graph
    });

    if (this.annotationSubscriptions.has(docId)) {
      this.annotationSubscriptions.get(docId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  notifyConflictResolved(documentId, result, eventType = 'conflict_resolved') {
    const docId = parseInt(documentId);
    const graph = getKnowledgeGraph(docId);
    const pendingConflicts = listConflictsByDocument(docId, { status: 'pending' });
    const conflictingAnnotationIds = getConflictingAnnotationIds(docId);
    const message = JSON.stringify({
      type: eventType,
      documentId: docId,
      result,
      pending_conflicts: pendingConflicts,
      conflicting_annotation_ids: conflictingAnnotationIds,
      graph
    });

    if (this.annotationSubscriptions.has(docId)) {
      this.annotationSubscriptions.get(docId).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
        }
      });
    }
  }

  cleanupClient(ws) {
    const contracts = this.clientContracts.get(ws);
    if (contracts) {
      contracts.forEach(contractId => {
        if (this.subscriptions.has(contractId)) {
          this.subscriptions.get(contractId).delete(ws);
        }
      });
      this.clientContracts.delete(ws);
    }

    const reviews = this.clientReviews.get(ws);
    if (reviews) {
      reviews.forEach(reviewId => {
        if (this.reviewSubscriptions.has(reviewId)) {
          this.reviewSubscriptions.get(reviewId).delete(ws);
        }
      });
      this.clientReviews.delete(ws);
    }

    const docMirrors = this.clientDocumentMirrors.get(ws);
    if (docMirrors) {
      docMirrors.forEach(documentId => {
        if (this.documentMirrorSubscriptions.has(documentId)) {
          this.documentMirrorSubscriptions.get(documentId).delete(ws);
        }
      });
      this.clientDocumentMirrors.delete(ws);
    }

    const mirrors = this.clientMirrors.get(ws);
    if (mirrors) {
      mirrors.forEach(mirrorId => {
        if (this.mirrorSubscriptions.has(mirrorId)) {
          this.mirrorSubscriptions.get(mirrorId).delete(ws);
        }
      });
      this.clientMirrors.delete(ws);
    }

    const approvals = this.clientApprovals.get(ws);
    if (approvals) {
      approvals.forEach(instanceId => {
        if (this.approvalSubscriptions.has(instanceId)) {
          this.approvalSubscriptions.get(instanceId).delete(ws);
        }
      });
      this.clientApprovals.delete(ws);
    }

    const todos = this.clientTodos.get(ws);
    if (todos) {
      todos.forEach(userIdKey => {
        if (this.todoSubscriptions.has(userIdKey)) {
          this.todoSubscriptions.get(userIdKey).delete(ws);
        }
      });
      this.clientTodos.delete(ws);
    }

    const annotations = this.clientAnnotations.get(ws);
    if (annotations) {
      annotations.forEach(documentId => {
        if (this.annotationSubscriptions.has(documentId)) {
          this.annotationSubscriptions.get(documentId).delete(ws);
        }
      });
      this.clientAnnotations.delete(ws);
    }
  }
}

module.exports = WsService;
