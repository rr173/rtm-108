const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const summaryFile = path.join(dataDir, 'summaries.json');

let summaryCache = {
  summaries: {},
  nextId: 1
};

const STOP_WORDS = new Set([
  '的', '了', '和', '是', '在', '我', '有', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '这个', '那个', '他', '她', '它', '们', '而', '与', '或',
  '及', '等', '中', '为', '以', '于', '对', '从', '由', '其', '之', '所', '然',
  '但', '并', '且', '还', '又', '再', '已', '已经', '将', '要', '能', '能够',
  '可以', '可能', '应该', '应当', '必须', '需', '需要', '把', '被', '让', '给',
  '向', '往', '朝', '沿', '顺', '按', '照', '依', '据', '因', '因为', '所以',
  '因此', '故', '如', '如果', '若', '则', '虽', '虽然', '但是', '然而', '不过',
  '可', '可是', '却', '倒', '偏', '竟', '越', '更', '最', '真', '实', '的确',
  '吧', '吗', '呢', '啊', '呀', '哦', '哈', '嘿', '嗯', '哎', '喂', '喔', '呃',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
  'and', 'or', 'but', 'so', 'if', 'when', 'while', 'although', 'though',
  'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'than', 'too',
  'very', 'just', 'because', 'also', 'until', 'up', 'down', 'about'
]);

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadSummaryCache() {
  ensureDataDir();
  if (fs.existsSync(summaryFile)) {
    try {
      const raw = fs.readFileSync(summaryFile, 'utf8');
      const loaded = JSON.parse(raw);
      summaryCache = {
        summaries: loaded.summaries || {},
        nextId: loaded.nextId || 1
      };
    } catch (e) {
      console.warn('摘要缓存文件损坏，使用空数据:', e.message);
    }
  }
}

function saveSummaryCache() {
  ensureDataDir();
  fs.writeFileSync(summaryFile, JSON.stringify(summaryCache, null, 2), 'utf8');
}

function splitSentences(text) {
  if (!text) return [];
  const sentences = [];
  let current = '';
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    current += char;
    if (char === '。' || char === '！' || char === '？' || char === '?' || char === '!' || char === '.') {
      if (current.trim()) {
        sentences.push(current.trim());
      }
      current = '';
    }
  }
  
  if (current.trim()) {
    sentences.push(current.trim());
  }
  
  return sentences;
}

function splitParagraphs(text) {
  if (!text) return [];
  return text.split(/\n\s*\n/).filter(p => p.trim());
}

function splitSections(text) {
  const paragraphs = splitParagraphs(text);
  const sections = [];
  let currentSection = {
    title: '',
    paragraphs: []
  };
  
  for (const para of paragraphs) {
    const trimmed = para.trim();
    const headingMatch = trimmed.match(/^第[一二三四五六七八九十百千\d]+[条款章节篇]\s*(.*)/) ||
                         trimmed.match(/^(\d+(\.\d+)*)\s+(.+)/) ||
                         trimmed.match(/^[一二三四五六七八九十]+、\s*(.+)/);
    
    if (headingMatch && trimmed.length < 100) {
      if (currentSection.paragraphs.length > 0 || currentSection.title) {
        sections.push({ ...currentSection });
      }
      currentSection = {
        title: trimmed,
        paragraphs: []
      };
    } else {
      currentSection.paragraphs.push(trimmed);
    }
  }
  
  if (currentSection.paragraphs.length > 0 || currentSection.title) {
    sections.push(currentSection);
  }
  
  return sections;
}

function tokenize(text) {
  if (!text) return [];
  const tokens = [];
  
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    
    if (/[\u4e00-\u9fa5]/.test(char)) {
      let word = '';
      while (i < text.length && /[\u4e00-\u9fa5]/.test(text[i])) {
        word += text[i];
        i++;
      }
      for (let j = 0; j < word.length - 1; j++) {
        tokens.push(word.substring(j, j + 2));
      }
      if (word.length === 1) {
        tokens.push(word);
      }
    } else if (/[a-zA-Z0-9]/.test(char)) {
      let word = '';
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) {
        word += text[i];
        i++;
      }
      if (word.length > 1) {
        tokens.push(word.toLowerCase());
      }
    } else {
      i++;
    }
  }
  
  return tokens.filter(t => t && t.length > 1 && !STOP_WORDS.has(t.toLowerCase()));
}

function computeWordFrequency(sentences) {
  const freq = {};
  let total = 0;
  
  for (const sentence of sentences) {
    const tokens = tokenize(sentence);
    for (const token of tokens) {
      freq[token] = (freq[token] || 0) + 1;
      total++;
    }
  }
  
  return { freq, total };
}

function computeSentenceScore(sentence, wordFreq, position, totalSentences, annotationCount = 0) {
  const tokens = tokenize(sentence);
  if (tokens.length === 0) return 0;
  
  let tfScore = 0;
  for (const token of tokens) {
    tfScore += wordFreq[token] || 0;
  }
  tfScore = tfScore / tokens.length;
  
  const normalizedPos = position / totalSentences;
  let positionScore = 0;
  if (normalizedPos < 0.2) {
    positionScore = 1.0 - normalizedPos * 2;
  } else if (normalizedPos > 0.8) {
    positionScore = (normalizedPos - 0.8) * 2;
  } else {
    positionScore = 0.3;
  }
  
  const lengthScore = Math.min(sentence.length / 100, 1.0);
  
  const annotationScore = annotationCount > 0 ? Math.min(annotationCount * 0.5, 1.0) : 0;
  
  const totalScore = tfScore * 0.4 + positionScore * 0.25 + lengthScore * 0.15 + annotationScore * 0.2;
  
  return totalScore;
}

function extractKeySentences(sentences, wordFreq, count, annotationDensity = {}) {
  if (sentences.length === 0) return [];
  
  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: computeSentenceScore(
      sentence, 
      wordFreq, 
      index, 
      sentences.length,
      annotationDensity[index] || 0
    )
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  const topCount = Math.min(count, sentences.length);
  const topSentences = scored.slice(0, topCount);
  
  topSentences.sort((a, b) => a.index - b.index);
  
  return topSentences.map(s => s.sentence);
}

function generateDocumentSummary(content, options = {}) {
  const paragraphs = splitParagraphs(content);
  const allSentences = [];
  const paragraphSentences = [];
  
  for (const para of paragraphs) {
    const sentences = splitSentences(para);
    paragraphSentences.push(sentences);
    allSentences.push(...sentences);
  }
  
  const { freq } = computeWordFrequency(allSentences);
  
  const summarySentenceCount = options.summaryRatio 
    ? Math.max(3, Math.floor(allSentences.length * options.summaryRatio))
    : Math.max(3, Math.min(8, Math.floor(allSentences.length * 0.15)));
  
  const overallSummary = extractKeySentences(
    allSentences, 
    freq, 
    summarySentenceCount,
    options.annotationDensity || {}
  ).join('');
  
  const sections = splitSections(content);
  const sectionSummaries = [];
  
  for (const section of sections) {
    const sectionText = section.paragraphs.join('\n');
    const sectionSentences = splitSentences(sectionText);
    
    if (sectionSentences.length > 0) {
      const sectionCount = Math.max(1, Math.ceil(sectionSentences.length * 0.2));
      const sectionSummary = extractKeySentences(sectionSentences, freq, sectionCount).join('');
      sectionSummaries.push({
        title: section.title,
        summary: sectionSummary,
        sentenceCount: sectionSentences.length
      });
    }
  }
  
  const paragraphSummaries = [];
  let globalSentenceIndex = 0;
  
  for (let i = 0; i < paragraphSentences.length; i++) {
    const sentences = paragraphSentences[i];
    if (sentences.length > 0) {
      const keySentence = extractKeySentences(sentences, freq, Math.min(1, sentences.length))[0] || sentences[0];
      paragraphSummaries.push({
        paragraphIndex: i,
        keySentence,
        sentenceCount: sentences.length,
        wordCount: tokenize(sentences.join('')).length
      });
    }
    globalSentenceIndex += sentences.length;
  }
  
  return {
    overallSummary,
    sectionSummaries,
    paragraphSummaries,
    stats: {
      totalParagraphs: paragraphs.length,
      totalSentences: allSentences.length,
      totalWords: tokenize(content).length,
      summarySentenceCount: overallSummary ? splitSentences(overallSummary).length : 0
    }
  };
}

function getDocumentSummary(documentId, versionNumber, options = {}) {
  loadSummaryCache();
  
  const cacheKey = `${documentId}_${versionNumber}`;
  
  if (summaryCache.summaries[cacheKey] && !options.forceRegenerate) {
    return summaryCache.summaries[cacheKey];
  }
  
  return null;
}

function saveDocumentSummary(documentId, versionNumber, summary) {
  loadSummaryCache();
  
  const cacheKey = `${documentId}_${versionNumber}`;
  summaryCache.summaries[cacheKey] = {
    ...summary,
    documentId,
    versionNumber,
    generatedAt: Date.now()
  };
  
  saveSummaryCache();
  return summaryCache.summaries[cacheKey];
}

module.exports = {
  generateDocumentSummary,
  getDocumentSummary,
  saveDocumentSummary,
  splitSentences,
  splitParagraphs,
  splitSections,
  tokenize,
  computeWordFrequency,
  extractKeySentences,
  STOP_WORDS
};
