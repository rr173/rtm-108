const WebSocket = require('ws');
const { getContractById, checkAndUpdateExpiredContracts } = require('./contractService');
const { getReviewById, getCommentsByReview } = require('./reviewService');

class WsService {
  constructor(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.subscriptions = new Map();
    this.clientContracts = new Map();
    this.reviewSubscriptions = new Map();
    this.clientReviews = new Map();

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
      default:
        ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
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
  }
}

module.exports = WsService;
