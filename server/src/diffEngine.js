function lcsLength(arr1, arr2) {
  const m = arr1.length;
  const n = arr2.length;
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}

function backtrack(dp, arr1, arr2, i, j) {
  if (i === 0 || j === 0) {
    return [];
  }
  if (arr1[i - 1] === arr2[j - 1]) {
    const result = backtrack(dp, arr1, arr2, i - 1, j - 1);
    result.push({ type: 'unchanged', oldIndex: i - 1, newIndex: j - 1, value: arr1[i - 1] });
    return result;
  }
  if (dp[i - 1][j] > dp[i][j - 1]) {
    const result = backtrack(dp, arr1, arr2, i - 1, j);
    result.push({ type: 'deleted', oldIndex: i - 1, newIndex: null, value: arr1[i - 1] });
    return result;
  } else {
    const result = backtrack(dp, arr1, arr2, i, j - 1);
    result.push({ type: 'added', oldIndex: null, newIndex: j - 1, value: arr2[j - 1] });
    return result;
  }
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
      }
      for (let k = minLen; k < deleted.length; k++) {
        result.push(deleted[k]);
      }
      for (let k = minLen; k < added.length; k++) {
        result.push(added[k]);
      }
    } else {
      result.push(...deleted, ...added);
    }
  }

  return result;
}

function computeCharDiff(oldStr, newStr) {
  const oldChars = oldStr.split('');
  const newChars = newStr.split('');
  const dp = lcsLength(oldChars, newChars);
  const charDiff = backtrack(dp, oldChars, newChars, oldChars.length, newChars.length);
  return charDiff;
}

function lineDiff(oldText, newText) {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const dp = lcsLength(oldLines, newLines);
  const rawDiff = backtrack(dp, oldLines, newLines, oldLines.length, newLines.length);
  const diffWithModifications = detectModifications(rawDiff);

  return {
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
    diff: diffWithModifications,
    stats: computeStats(diffWithModifications)
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
  lcsLength,
  backtrack
};
