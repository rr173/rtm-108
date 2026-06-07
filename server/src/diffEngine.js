function computeLCS(arr1, arr2) {
  const m = arr1.length;
  const n = arr2.length;

  if (m === 0 || n === 0) {
    return { dp: [], lcsLength: 0 };
  }

  const dp = Array(m + 1);
  for (let i = 0; i <= m; i++) {
    dp[i] = Array(n + 1).fill(0);
  }

  for (let i = 1; i <= m; i++) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    const val1 = arr1[i - 1];
    for (let j = 1; j <= n; j++) {
      if (val1 === arr2[j - 1]) {
        row[j] = prevRow[j - 1] + 1;
      } else {
        row[j] = prevRow[j] > row[j - 1] ? prevRow[j] : row[j - 1];
      }
    }
  }

  return { dp, lcsLength: dp[m][n] };
}

function backtrackIterative(dp, arr1, arr2) {
  const result = [];
  let i = arr1.length;
  let j = arr2.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && arr1[i - 1] === arr2[j - 1]) {
      result.unshift({
        type: 'unchanged',
        oldIndex: i - 1,
        newIndex: j - 1,
        value: arr1[i - 1]
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({
        type: 'added',
        oldIndex: null,
        newIndex: j - 1,
        value: arr2[j - 1]
      });
      j--;
    } else if (i > 0) {
      result.unshift({
        type: 'deleted',
        oldIndex: i - 1,
        newIndex: null,
        value: arr1[i - 1]
      });
      i--;
    }
  }

  return result;
}

function detectModifications(diffResult) {
  const result = [];
  let i = 0;

  while (i < diffResult.length) {
    const current = diffResult[i];

    if (current.type === 'unchanged') {
      result.push(current);
      i++;
      continue;
    }

    const deleted = [];
    const added = [];

    while (i < diffResult.length && diffResult[i].type === 'deleted') {
      deleted.push(diffResult[i]);
      i++;
    }

    while (i < diffResult.length && diffResult[i].type === 'added') {
      added.push(diffResult[i]);
      i++;
    }

    if (deleted.length > 0 && added.length > 0) {
      const minLen = Math.min(deleted.length, added.length);
      const maxLen = Math.max(deleted.length, added.length);

      const isSmallBlock = maxLen <= 3;
      const isBalanced = minLen / maxLen >= 0.6;
      const shouldPair = isSmallBlock && isBalanced;

      if (shouldPair) {
        let pairedCount = 0;
        for (let k = 0; k < minLen; k++) {
          const oldLine = deleted[k].value;
          const newLine = added[k].value;
          const charDiff = computeCharDiff(oldLine, newLine);
          result.push({
            type: 'modified',
            oldIndex: deleted[k].oldIndex,
            newIndex: added[k].newIndex,
            oldValue: oldLine,
            newValue: newLine,
            charDiff: charDiff
          });
          pairedCount++;
        }
        for (let k = pairedCount; k < deleted.length; k++) {
          result.push(deleted[k]);
        }
        for (let k = pairedCount; k < added.length; k++) {
          result.push(added[k]);
        }
      } else {
        result.push(...deleted, ...added);
      }
    } else {
      result.push(...deleted, ...added);
    }
  }

  return result;
}

function isLineSimilar(line1, line2) {
  if (line1 === line2) return true;
  if (line1.length === 0 || line2.length === 0) return false;

  const maxLen = Math.max(line1.length, line2.length);
  const minLen = Math.min(line1.length, line2.length);

  const set1 = new Set(line1.split(''));
  const set2 = new Set(line2.split(''));
  let common = 0;
  for (const ch of set1) {
    if (set2.has(ch)) common++;
  }
  const charSimilarity = common / Math.max(set1.size, set2.size);

  let prefixMatch = 0;
  while (prefixMatch < minLen && line1[prefixMatch] === line2[prefixMatch]) {
    prefixMatch++;
  }
  const prefixSimilarity = prefixMatch / maxLen;

  let suffixMatch = 0;
  while (suffixMatch < minLen && line1[line1.length - 1 - suffixMatch] === line2[line2.length - 1 - suffixMatch]) {
    suffixMatch++;
  }
  const suffixSimilarity = suffixMatch / maxLen;

  const totalSimilar = prefixMatch + suffixMatch;
  const overlapRatio = totalSimilar / maxLen;

  return charSimilarity >= 0.4 || overlapRatio >= 0.4;
}

function computeCharDiff(oldStr, newStr) {
  const oldChars = oldStr.split('');
  const newChars = newStr.split('');

  if (oldChars.length > 500 || newChars.length > 500) {
    return oldStr === newStr
      ? [{ type: 'unchanged', oldIndex: 0, newIndex: 0, value: oldStr }]
      : [
          { type: 'deleted', oldIndex: 0, newIndex: null, value: oldStr },
          { type: 'added', oldIndex: null, newIndex: 0, value: newStr }
        ];
  }

  const { dp } = computeLCS(oldChars, newChars);
  const charDiff = backtrackIterative(dp, oldChars, newChars);
  return charDiff;
}

function simpleDiff(oldLines, newLines) {
  const oldSet = new Map();
  oldLines.forEach((line, idx) => {
    if (!oldSet.has(line)) {
      oldSet.set(line, idx);
    }
  });

  const diff = [];
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length && newIdx < newLines.length) {
    if (oldLines[oldIdx] === newLines[newIdx]) {
      diff.push({
        type: 'unchanged',
        oldIndex: oldIdx,
        newIndex: newIdx,
        value: oldLines[oldIdx]
      });
      oldIdx++;
      newIdx++;
    } else {
      const nextOldMatch = oldSet.get(newLines[newIdx]);
      const nextNewInOld = oldLines.slice(oldIdx).findIndex(l => l === newLines[newIdx]);

      if (nextNewInOld !== -1 && nextNewInOld < 5) {
        for (let k = 0; k < nextNewInOld; k++) {
          diff.push({
            type: 'deleted',
            oldIndex: oldIdx + k,
            newIndex: null,
            value: oldLines[oldIdx + k]
          });
        }
        oldIdx += nextNewInOld;
      } else {
        diff.push({
          type: 'added',
          oldIndex: null,
          newIndex: newIdx,
          value: newLines[newIdx]
        });
        newIdx++;
      }
    }
  }

  while (oldIdx < oldLines.length) {
    diff.push({
      type: 'deleted',
      oldIndex: oldIdx,
      newIndex: null,
      value: oldLines[oldIdx]
    });
    oldIdx++;
  }

  while (newIdx < newLines.length) {
    diff.push({
      type: 'added',
      oldIndex: null,
      newIndex: newIdx,
      value: newLines[newIdx]
    });
    newIdx++;
  }

  return diff;
}

function lineDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  if (oldLines.length === 0 && newLines.length === 0) {
    return {
      oldLineCount: 0,
      newLineCount: 0,
      diff: [],
      stats: { added: 0, deleted: 0, modified: 0, unchanged: 0 }
    };
  }

  if (oldLines.length === 0) {
    const diff = newLines.map((line, idx) => ({
      type: 'added',
      oldIndex: null,
      newIndex: idx,
      value: line
    }));
    return {
      oldLineCount: 0,
      newLineCount: newLines.length,
      diff,
      stats: { added: newLines.length, deleted: 0, modified: 0, unchanged: 0 }
    };
  }

  if (newLines.length === 0) {
    const diff = oldLines.map((line, idx) => ({
      type: 'deleted',
      oldIndex: idx,
      newIndex: null,
      value: line
    }));
    return {
      oldLineCount: oldLines.length,
      newLineCount: 0,
      diff,
      stats: { added: 0, deleted: oldLines.length, modified: 0, unchanged: 0 }
    };
  }

  const maxLines = 3000;
  const useSimpleDiff = oldLines.length > maxLines || newLines.length > maxLines;

  let rawDiff;
  if (useSimpleDiff) {
    rawDiff = simpleDiff(oldLines, newLines);
  } else {
    const { dp } = computeLCS(oldLines, newLines);
    rawDiff = backtrackIterative(dp, oldLines, newLines);
  }

  const diffWithModifications = detectModifications(rawDiff);

  return {
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
    diff: diffWithModifications,
    stats: computeStats(diffWithModifications),
    usedSimpleDiff: useSimpleDiff
  };
}

function computeStats(diffResult) {
  let added = 0;
  let deleted = 0;
  let modified = 0;
  let unchanged = 0;

  diffResult.forEach(item => {
    switch (item.type) {
      case 'added':
        added++;
        break;
      case 'deleted':
        deleted++;
        break;
      case 'modified':
        modified++;
        break;
      case 'unchanged':
        unchanged++;
        break;
    }
  });

  return { added, deleted, modified, unchanged };
}

module.exports = {
  lineDiff,
  computeCharDiff,
  computeLCS,
  backtrackIterative
};
