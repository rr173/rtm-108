const TOKEN_TYPES = {
  TEXT: 'TEXT',
  VARIABLE: 'VARIABLE',
  IF_OPEN: 'IF_OPEN',
  IF_CLOSE: 'IF_CLOSE',
  EACH_OPEN: 'EACH_OPEN',
  EACH_CLOSE: 'EACH_CLOSE'
};

function tokenize(template) {
  const tokens = [];
  let pos = 0;

  while (pos < template.length) {
    const openBrace = template.indexOf('{{', pos);

    if (openBrace === -1) {
      tokens.push({ type: TOKEN_TYPES.TEXT, value: template.slice(pos) });
      break;
    }

    if (openBrace > pos) {
      tokens.push({ type: TOKEN_TYPES.TEXT, value: template.slice(pos, openBrace) });
    }

    const closeBrace = template.indexOf('}}', openBrace + 2);
    if (closeBrace === -1) {
      tokens.push({ type: TOKEN_TYPES.TEXT, value: template.slice(openBrace) });
      break;
    }

    const expression = template.slice(openBrace + 2, closeBrace).trim();

    if (expression.startsWith('#if ')) {
      const varName = expression.slice(4).trim();
      tokens.push({ type: TOKEN_TYPES.IF_OPEN, variable: varName });
    } else if (expression === '/if') {
      tokens.push({ type: TOKEN_TYPES.IF_CLOSE });
    } else if (expression.startsWith('#each ')) {
      const varName = expression.slice(6).trim();
      tokens.push({ type: TOKEN_TYPES.EACH_OPEN, variable: varName });
    } else if (expression === '/each') {
      tokens.push({ type: TOKEN_TYPES.EACH_CLOSE });
    } else {
      tokens.push({ type: TOKEN_TYPES.VARIABLE, variable: expression });
    }

    pos = closeBrace + 2;
  }

  return tokens;
}

function getVariableValue(data, path) {
  const parts = path.split('.');
  let current = data;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function isTruthy(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'number') return value !== 0;
  return true;
}

function parseBlock(tokens, startIndex) {
  const children = [];
  let i = startIndex;
  let depth = 1;

  while (i < tokens.length && depth > 0) {
    const token = tokens[i];

    if (token.type === TOKEN_TYPES.IF_OPEN || token.type === TOKEN_TYPES.EACH_OPEN) {
      if (depth === 1) {
        const block = parseBlock(tokens, i + 1);
        children.push({
          type: token.type,
          variable: token.variable,
          children: block.children
        });
        i = block.endIndex + 1;
      } else {
        depth++;
        i++;
      }
    } else if (token.type === TOKEN_TYPES.IF_CLOSE || token.type === TOKEN_TYPES.EACH_CLOSE) {
      depth--;
      if (depth === 0) {
        return { children, endIndex: i };
      }
      i++;
    } else {
      if (depth === 1) {
        children.push(token);
      }
      i++;
    }
  }

  return { children, endIndex: i - 1 };
}

function parseTemplate(tokens) {
  const ast = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === TOKEN_TYPES.IF_OPEN || token.type === TOKEN_TYPES.EACH_OPEN) {
      const block = parseBlock(tokens, i + 1);
      ast.push({
        type: token.type,
        variable: token.variable,
        children: block.children
      });
      i = block.endIndex + 1;
    } else {
      ast.push(token);
      i++;
    }
  }

  return ast;
}

function renderAst(ast, data, originalTemplate, keepMissing = true) {
  let result = '';

  for (const node of ast) {
    if (node.type === TOKEN_TYPES.TEXT) {
      result += node.value;
    } else if (node.type === TOKEN_TYPES.VARIABLE) {
      const value = getVariableValue(data, node.variable);
      if (value === undefined || value === null) {
        if (keepMissing) {
          result += `{{${node.variable}}}`;
        }
      } else {
        result += String(value);
      }
    } else if (node.type === TOKEN_TYPES.IF_OPEN) {
      const value = getVariableValue(data, node.variable);
      if (isTruthy(value)) {
        result += renderAst(node.children, data, originalTemplate, keepMissing);
      }
    } else if (node.type === TOKEN_TYPES.EACH_OPEN) {
      const list = getVariableValue(data, node.variable);
      if (Array.isArray(list)) {
        list.forEach((item, index) => {
          const itemData = {
            ...data,
            this: item,
            index: index,
            [node.variable]: list
          };
          if (typeof item === 'object' && item !== null) {
            Object.assign(itemData, item);
          }
          result += renderAst(node.children, itemData, originalTemplate, keepMissing);
        });
      }
    }
  }

  return result;
}

function renderTemplate(template, data = {}, { keepMissing = true } = {}) {
  const tokens = tokenize(template);
  const ast = parseTemplate(tokens);
  return renderAst(ast, data, template, keepMissing);
}

function extractVariables(template) {
  const tokens = tokenize(template);
  const variables = new Set();

  function collectFromAst(ast) {
    for (const node of ast) {
      if (node.type === TOKEN_TYPES.VARIABLE) {
        variables.add(node.variable);
      } else if (node.type === TOKEN_TYPES.IF_OPEN || node.type === TOKEN_TYPES.EACH_OPEN) {
        variables.add(node.variable);
        if (node.children) {
          collectFromAst(node.children);
        }
      }
    }
  }

  const ast = parseTemplate(tokens);
  collectFromAst(ast);

  return Array.from(variables).sort();
}

function highlightTemplate(template) {
  const tokens = tokenize(template);
  let result = '';

  function renderHighlighted(ast) {
    let html = '';
    for (const node of ast) {
      if (node.type === TOKEN_TYPES.TEXT) {
        html += escapeHtml(node.value);
      } else if (node.type === TOKEN_TYPES.VARIABLE) {
        html += `<span class="tpl-var">{{${escapeHtml(node.variable)}}}</span>`;
      } else if (node.type === TOKEN_TYPES.IF_OPEN) {
        html += `<span class="tpl-if">{{#if ${escapeHtml(node.variable)}}}</span>`;
        html += renderHighlighted(node.children);
        html += `<span class="tpl-if">{{/if}}</span>`;
      } else if (node.type === TOKEN_TYPES.EACH_OPEN) {
        html += `<span class="tpl-each">{{#each ${escapeHtml(node.variable)}}}</span>`;
        html += renderHighlighted(node.children);
        html += `<span class="tpl-each">{{/each}}</span>`;
      }
    }
    return html;
  }

  const ast = parseTemplate(tokens);
  return renderHighlighted(ast);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  renderTemplate,
  extractVariables,
  highlightTemplate,
  tokenize,
  parseTemplate,
  TOKEN_TYPES
};
