const fs = require('fs');
const path = require('path');
const { splitParagraphs, tokenize } = require('./summaryEngine');

const dataDir = path.join(__dirname, '..', 'data');
const readingFile = path.join(dataDir, 'readingData.json');

let readingData = {
  readingSessions: [],
  paragraphHeatmap: {},
  readingGoals: {},
  activeReaders: {},
  nextSessionId: 1
};

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadReadingData() {
  ensureDataDir();
  if (fs.existsSync(readingFile)) {
    try {
      const raw = fs.readFileSync(readingFile, 'utf8');
      const loaded = JSON.parse(raw);
      
      const paragraphHeatmap = {};
      if (loaded.paragraphHeatmap) {
        for (const docKey of Object.keys(loaded.paragraphHeatmap)) {
          paragraphHeatmap[docKey] = {};
          for (const paraKey of Object.keys(loaded.paragraphHeatmap[docKey])) {
            const item = loaded.paragraphHeatmap[docKey][paraKey];
            paragraphHeatmap[docKey][paraKey] = {
              ...item,
              unique_readers: new Set(item.unique_readers || [])
            };
          }
        }
      }
      
      readingData = {
        readingSessions: loaded.readingSessions || [],
        paragraphHeatmap,
        readingGoals: loaded.readingGoals || {},
        activeReaders: loaded.activeReaders || {},
        nextSessionId: loaded.nextSessionId || 1
      };
    } catch (e) {
      console.warn('阅读数据文件损坏，使用空数据:', e.message);
    }
  }
}

function saveReadingData() {
  ensureDataDir();
  
  const paragraphHeatmapToSave = {};
  for (const docKey of Object.keys(readingData.paragraphHeatmap)) {
    paragraphHeatmapToSave[docKey] = {};
    for (const paraKey of Object.keys(readingData.paragraphHeatmap[docKey])) {
      const item = readingData.paragraphHeatmap[docKey][paraKey];
      paragraphHeatmapToSave[docKey][paraKey] = {
        ...item,
        unique_readers: Array.from(item.unique_readers || [])
      };
    }
  }
  
  const dataToSave = {
    ...readingData,
    paragraphHeatmap: paragraphHeatmapToSave
  };
  
  fs.writeFileSync(readingFile, JSON.stringify(dataToSave, null, 2), 'utf8');
}

function now() {
  return Date.now();
}

function startReadingSession({ documentId, userId, userName }) {
  loadReadingData();
  
  const session = {
    id: readingData.nextSessionId++,
    document_id: documentId,
    user_id: userId,
    user_name: userName || '匿名用户',
    start_time: now(),
    end_time: null,
    last_active_time: now(),
    total_reading_time: 0,
    current_paragraph: 0,
    paragraphs_read: [],
    total_words_read: 0,
    completed: false
  };
  
  readingData.readingSessions.push(session);
  
  const docKey = String(documentId);
  if (!readingData.activeReaders[docKey]) {
    readingData.activeReaders[docKey] = {};
  }
  readingData.activeReaders[docKey][userId] = {
    session_id: session.id,
    user_name: userName || '匿名用户',
    current_paragraph: 0,
    last_active: now()
  };
  
  saveReadingData();
  return session;
}

function updateReadingProgress({ documentId, userId, paragraphIndex, scrollPosition = 0 }) {
  loadReadingData();
  
  const docKey = String(documentId);
  if (readingData.activeReaders[docKey] && readingData.activeReaders[docKey][userId]) {
    readingData.activeReaders[docKey][userId].current_paragraph = paragraphIndex;
    readingData.activeReaders[docKey][userId].last_active = now();
  }
  
  const sessions = readingData.readingSessions.filter(
    s => s.document_id === documentId && s.user_id === userId && !s.end_time
  ).sort((a, b) => b.start_time - a.start_time);
  
  if (sessions.length > 0) {
    const session = sessions[0];
    session.last_active_time = now();
    session.current_paragraph = paragraphIndex;
    
    if (!session.paragraphs_read.includes(paragraphIndex)) {
      session.paragraphs_read.push(paragraphIndex);
    }
    
    const prevTime = session.last_active_time;
    
    saveReadingData();
    return session;
  }
  
  return null;
}

function recordParagraphDwellTime({ documentId, paragraphIndex, durationMs, userId }) {
  loadReadingData();
  
  const docKey = String(documentId);
  if (!readingData.paragraphHeatmap[docKey]) {
    readingData.paragraphHeatmap[docKey] = {};
  }
  
  const paraKey = String(paragraphIndex);
  if (!readingData.paragraphHeatmap[docKey][paraKey]) {
    readingData.paragraphHeatmap[docKey][paraKey] = {
      paragraph_index: paragraphIndex,
      total_dwell_time: 0,
      read_count: 0,
      unique_readers: new Set()
    };
  }
  
  const heatData = readingData.paragraphHeatmap[docKey][paraKey];
  heatData.total_dwell_time += durationMs;
  heatData.read_count += 1;
  if (userId) {
    heatData.unique_readers.add(userId);
  }
  
  saveReadingData();
  return heatData;
}

function endReadingSession({ documentId, userId }) {
  loadReadingData();
  
  const docKey = String(documentId);
  if (readingData.activeReaders[docKey]) {
    delete readingData.activeReaders[docKey][userId];
    if (Object.keys(readingData.activeReaders[docKey]).length === 0) {
      delete readingData.activeReaders[docKey];
    }
  }
  
  const sessions = readingData.readingSessions.filter(
    s => s.document_id === documentId && s.user_id === userId && !s.end_time
  ).sort((a, b) => b.start_time - a.start_time);
  
  if (sessions.length > 0) {
    const session = sessions[0];
    session.end_time = now();
    session.total_reading_time = session.end_time - session.start_time;
    session.completed = true;
    
    saveReadingData();
    return session;
  }
  
  return null;
}

function getDocumentHeatmap(documentId) {
  loadReadingData();
  
  const docKey = String(documentId);
  const heatmapData = readingData.paragraphHeatmap[docKey] || {};
  
  const result = Object.values(heatmapData).map(h => ({
    paragraph_index: h.paragraph_index,
    total_dwell_time: h.total_dwell_time,
    read_count: h.read_count,
    unique_reader_count: h.unique_readers ? h.unique_readers.size : 0
  })).sort((a, b) => a.paragraph_index - b.paragraph_index);
  
  return result;
}

function getActiveReaders(documentId) {
  loadReadingData();
  
  const docKey = String(documentId);
  const active = readingData.activeReaders[docKey] || {};
  
  return Object.entries(active).map(([userId, data]) => ({
    user_id: userId,
    user_name: data.user_name,
    current_paragraph: data.current_paragraph,
    last_active: data.last_active
  }));
}

function getDocumentReadingStats(documentId) {
  loadReadingData();
  
  const sessions = readingData.readingSessions.filter(
    s => s.document_id === documentId && s.completed
  );
  
  const uniqueReaders = new Set(sessions.map(s => s.user_id));
  const totalReadingTime = sessions.reduce((sum, s) => sum + s.total_reading_time, 0);
  const avgReadingTime = uniqueReaders.size > 0 ? totalReadingTime / uniqueReaders.size : 0;
  
  const completedSessions = sessions.filter(s => {
    return s.paragraphs_read && s.paragraphs_read.length > 0;
  });
  const completionRate = sessions.length > 0 ? completedSessions.length / sessions.length : 0;
  
  const heatmap = getDocumentHeatmap(documentId);
  
  return {
    total_readers: uniqueReaders.size,
    total_sessions: sessions.length,
    avg_reading_time_ms: avgReadingTime,
    avg_reading_time_minutes: avgReadingTime / 60000,
    completion_rate: completionRate,
    total_reading_time_ms: totalReadingTime,
    heatmap,
    active_readers: getActiveReaders(documentId)
  };
}

function getReadingGoal(userId) {
  loadReadingData();
  
  const userKey = String(userId);
  return readingData.readingGoals[userKey] || {
    user_id: userId,
    daily_words_goal: 2000,
    words_read_today: 0,
    last_updated: null,
    streak_days: 0
  };
}

function setReadingGoal(userId, dailyWordsGoal) {
  loadReadingData();
  
  const userKey = String(userId);
  const existing = readingData.readingGoals[userKey] || {
    user_id: userId,
    daily_words_goal: 2000,
    words_read_today: 0,
    last_updated: null,
    streak_days: 0
  };
  
  existing.daily_words_goal = dailyWordsGoal;
  readingData.readingGoals[userKey] = existing;
  
  saveReadingData();
  return existing;
}

function updateReadingProgressForGoal(userId, wordsRead) {
  loadReadingData();
  
  const userKey = String(userId);
  let goal = readingData.readingGoals[userKey];
  
  if (!goal) {
    goal = {
      user_id: userId,
      daily_words_goal: 2000,
      words_read_today: 0,
      last_updated: null,
      streak_days: 0
    };
  }
  
  const today = new Date().toDateString();
  const lastUpdateDate = goal.last_updated ? new Date(goal.last_updated).toDateString() : null;
  
  if (lastUpdateDate !== today) {
    goal.words_read_today = 0;
    
    if (lastUpdateDate) {
      const lastDate = new Date(goal.last_updated);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      if (lastDate.toDateString() === yesterday.toDateString()) {
        goal.streak_days = (goal.streak_days || 0) + 1;
      } else {
        goal.streak_days = 1;
      }
    } else {
      goal.streak_days = 1;
    }
  }
  
  goal.words_read_today += wordsRead;
  goal.last_updated = now();
  
  readingData.readingGoals[userKey] = goal;
  saveReadingData();
  
  return goal;
}

function getReadingProgress(userId, documentContent) {
  const goal = getReadingGoal(userId);
  
  const paragraphs = splitParagraphs(documentContent || '');
  const totalWords = paragraphs.reduce((sum, p) => sum + tokenize(p).length, 0);
  
  const progressPercent = goal.daily_words_goal > 0 
    ? Math.min(100, (goal.words_read_today / goal.daily_words_goal) * 100)
    : 0;
  
  const avgReadingSpeed = 200;
  const remainingWords = Math.max(0, goal.daily_words_goal - goal.words_read_today);
  const estimatedMinutesRemaining = remainingWords / avgReadingSpeed;
  
  return {
    goal,
    total_words_in_document: totalWords,
    progress_percent: progressPercent,
    words_read_today: goal.words_read_today,
    daily_goal: goal.daily_words_goal,
    estimated_minutes_remaining: estimatedMinutesRemaining,
    streak_days: goal.streak_days || 0
  };
}

function getUserReadingHistory(userId, limit = 10) {
  loadReadingData();
  
  const sessions = readingData.readingSessions
    .filter(s => s.user_id === userId)
    .sort((a, b) => b.start_time - a.start_time)
    .slice(0, limit);
  
  return sessions;
}

function setHeatmapData(documentId, heatmapArray) {
  loadReadingData();
  
  const docKey = String(documentId);
  if (!readingData.paragraphHeatmap[docKey]) {
    readingData.paragraphHeatmap[docKey] = {};
  }
  
  for (const item of heatmapArray) {
    const paraKey = String(item.paragraph_index);
    readingData.paragraphHeatmap[docKey][paraKey] = {
      paragraph_index: item.paragraph_index,
      total_dwell_time: item.total_dwell_time || 0,
      read_count: item.read_count || 0,
      unique_readers: new Set(item.unique_readers || [])
    };
  }
  
  saveReadingData();
}

module.exports = {
  startReadingSession,
  updateReadingProgress,
  recordParagraphDwellTime,
  endReadingSession,
  getDocumentHeatmap,
  getActiveReaders,
  getDocumentReadingStats,
  getReadingGoal,
  setReadingGoal,
  updateReadingProgressForGoal,
  getReadingProgress,
  getUserReadingHistory,
  setHeatmapData,
  loadReadingData
};
