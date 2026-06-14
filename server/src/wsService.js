const WebSocket = require('ws');
const { getContractById, checkAndUpdateExpiredContracts } = require('./contractService');
const { getReviewById, getCommentsByReview } = require('./reviewService');
const { listMirrorsByDocument, getMirrorById, getTranslationWorkbench } = require('./mirrorService');
const { getDocumentById } = require('./documentService');

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
  }
}

module.exports = WsService;
