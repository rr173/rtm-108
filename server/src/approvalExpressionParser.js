const TOKEN_TYPES = {
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  BOOLEAN: 'BOOLEAN',
  IDENTIFIER: 'IDENTIFIER',
  OP: 'OP',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
  EOF: 'EOF'
};

class Tokenizer {
  constructor(input) {
    this.input = input;
    this.pos = 0;
    this.tokens = [];
  }

  tokenize() {
    while (this.pos < this.input.length) {
      this.skipWhitespace();
      if (this.pos >= this.input.length) break;

      const ch = this.input[this.pos];

      if (ch === '(') {
        this.tokens.push({ type: TOKEN_TYPES.LPAREN, value: '(' });
        this.pos++;
      } else if (ch === ')') {
        this.tokens.push({ type: TOKEN_TYPES.RPAREN, value: ')' });
        this.pos++;
      } else if (ch === '!' && this.input[this.pos + 1] === '=') {
        this.tokens.push({ type: TOKEN_TYPES.OP, value: '!=' });
        this.pos += 2;
      } else if (ch === '=' && this.input[this.pos + 1] === '=') {
        this.tokens.push({ type: TOKEN_TYPES.OP, value: '==' });
        this.pos += 2;
      } else if (ch === '>' && this.input[this.pos + 1] === '=') {
        this.tokens.push({ type: TOKEN_TYPES.OP, value: '>=' });
        this.pos += 2;
      } else if (ch === '<' && this.input[this.pos + 1] === '=') {
        this.tokens.push({ type: TOKEN_TYPES.OP, value: '<=' });
        this.pos += 2;
      } else if (ch === '>') {
        this.tokens.push({ type: TOKEN_TYPES.OP, value: '>' });
        this.pos++;
      } else if (ch === '<') {
        this.tokens.push({ type: TOKEN_TYPES.OP, value: '<' });
        this.pos++;
      } else if (ch === '!') {
        this.tokens.push({ type: TOKEN_TYPES.NOT, value: '!' });
        this.pos++;
      } else if (ch === '&' && this.input[this.pos + 1] === '&') {
        this.tokens.push({ type: TOKEN_TYPES.AND, value: '&&' });
        this.pos += 2;
      } else if (ch === '|' && this.input[this.pos + 1] === '|') {
        this.tokens.push({ type: TOKEN_TYPES.OR, value: '||' });
        this.pos += 2;
      } else if (ch === '"' || ch === "'") {
        this.readString(ch);
      } else if (this.isDigit(ch) || (ch === '-' && this.isDigit(this.input[this.pos + 1]))) {
        this.readNumber();
      } else if (this.isLetter(ch) || ch === '_') {
        this.readIdentifier();
      } else {
        throw new Error(`Unexpected character: ${ch} at position ${this.pos}`);
      }
    }
    this.tokens.push({ type: TOKEN_TYPES.EOF, value: null });
    return this.tokens;
  }

  skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }

  isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  isLetter(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
  }

  readString(quote) {
    this.pos++;
    let value = '';
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      if (this.input[this.pos] === '\\' && this.pos + 1 < this.input.length) {
        this.pos++;
        const escaped = this.input[this.pos];
        switch (escaped) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '"': value += '"'; break;
          case "'": value += "'"; break;
          case '\\': value += '\\'; break;
          default: value += escaped;
        }
      } else {
        value += this.input[this.pos];
      }
      this.pos++;
    }
    if (this.pos >= this.input.length) {
      throw new Error('Unterminated string');
    }
    this.pos++;
    this.tokens.push({ type: TOKEN_TYPES.STRING, value });
  }

  readNumber() {
    let start = this.pos;
    if (this.input[this.pos] === '-') this.pos++;
    while (this.pos < this.input.length && this.isDigit(this.input[this.pos])) {
      this.pos++;
    }
    if (this.input[this.pos] === '.' && this.isDigit(this.input[this.pos + 1])) {
      this.pos++;
      while (this.pos < this.input.length && this.isDigit(this.input[this.pos])) {
        this.pos++;
      }
    }
    const numStr = this.input.slice(start, this.pos);
    this.tokens.push({ type: TOKEN_TYPES.NUMBER, value: parseFloat(numStr) });
  }

  readIdentifier() {
    let start = this.pos;
    while (this.pos < this.input.length &&
      (this.isLetter(this.input[this.pos]) || this.isDigit(this.input[this.pos]) || this.input[this.pos] === '_' || this.input[this.pos] === '.')) {
      this.pos++;
    }
    const ident = this.input.slice(start, this.pos);
    if (ident === 'true' || ident === 'false') {
      this.tokens.push({ type: TOKEN_TYPES.BOOLEAN, value: ident === 'true' });
    } else if (ident === 'and' || ident === 'AND') {
      this.tokens.push({ type: TOKEN_TYPES.AND, value: '&&' });
    } else if (ident === 'or' || ident === 'OR') {
      this.tokens.push({ type: TOKEN_TYPES.OR, value: '||' });
    } else if (ident === 'not' || ident === 'NOT') {
      this.tokens.push({ type: TOKEN_TYPES.NOT, value: '!' });
    } else {
      this.tokens.push({ type: TOKEN_TYPES.IDENTIFIER, value: ident });
    }
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  current() {
    return this.tokens[this.pos];
  }

  consume(type, value = null) {
    const token = this.current();
    if (token.type !== type || (value !== null && token.value !== value)) {
      throw new Error(`Expected ${type}${value ? `(${value})` : ''} but got ${token.type}(${token.value})`);
    }
    this.pos++;
    return token;
  }

  parse() {
    const result = this.parseOr();
    this.consume(TOKEN_TYPES.EOF);
    return result;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.current().type === TOKEN_TYPES.OR) {
      this.consume(TOKEN_TYPES.OR);
      const right = this.parseAnd();
      left = { type: 'BinaryExpr', op: '||', left, right };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.current().type === TOKEN_TYPES.AND) {
      this.consume(TOKEN_TYPES.AND);
      const right = this.parseNot();
      left = { type: 'BinaryExpr', op: '&&', left, right };
    }
    return left;
  }

  parseNot() {
    if (this.current().type === TOKEN_TYPES.NOT) {
      this.consume(TOKEN_TYPES.NOT);
      const operand = this.parseNot();
      return { type: 'UnaryExpr', op: '!', operand };
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parsePrimary();
    if (this.current().type === TOKEN_TYPES.OP) {
      const opToken = this.consume(TOKEN_TYPES.OP);
      const right = this.parsePrimary();
      return { type: 'ComparisonExpr', op: opToken.value, left, right };
    }
    return left;
  }

  parsePrimary() {
    const token = this.current();
    if (token.type === TOKEN_TYPES.NUMBER) {
      this.pos++;
      return { type: 'Literal', value: token.value };
    } else if (token.type === TOKEN_TYPES.STRING) {
      this.pos++;
      return { type: 'Literal', value: token.value };
    } else if (token.type === TOKEN_TYPES.BOOLEAN) {
      this.pos++;
      return { type: 'Literal', value: token.value };
    } else if (token.type === TOKEN_TYPES.IDENTIFIER) {
      this.pos++;
      return { type: 'Identifier', name: token.value };
    } else if (token.type === TOKEN_TYPES.LPAREN) {
      this.consume(TOKEN_TYPES.LPAREN);
      const expr = this.parseOr();
      this.consume(TOKEN_TYPES.RPAREN);
      return expr;
    }
    throw new Error(`Unexpected token: ${token.type}(${token.value})`);
  }
}

class Evaluator {
  constructor(context) {
    this.context = context || {};
  }

  evaluate(ast) {
    return this.visit(ast);
  }

  visit(node) {
    switch (node.type) {
      case 'Literal':
        return node.value;
      case 'Identifier':
        return this.resolveIdentifier(node.name);
      case 'UnaryExpr':
        return this.visitUnary(node);
      case 'BinaryExpr':
        return this.visitBinary(node);
      case 'ComparisonExpr':
        return this.visitComparison(node);
      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  resolveIdentifier(name) {
    const parts = name.split('.');
    let value = this.context;
    for (const part of parts) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[part];
    }
    return value;
  }

  visitUnary(node) {
    const operand = this.visit(node.operand);
    switch (node.op) {
      case '!':
        return !operand;
      default:
        throw new Error(`Unknown unary operator: ${node.op}`);
    }
  }

  visitBinary(node) {
    const left = this.visit(node.left);
    const right = this.visit(node.right);
    switch (node.op) {
      case '&&':
        return left && right;
      case '||':
        return left || right;
      default:
        throw new Error(`Unknown binary operator: ${node.op}`);
    }
  }

  visitComparison(node) {
    const left = this.visit(node.left);
    const right = this.visit(node.right);
    switch (node.op) {
      case '==':
        return left == right;
      case '!=':
        return left != right;
      case '>':
        return left > right;
      case '<':
        return left < right;
      case '>=':
        return left >= right;
      case '<=':
        return left <= right;
      default:
        throw new Error(`Unknown comparison operator: ${node.op}`);
    }
  }
}

function parseExpression(expression) {
  const tokenizer = new Tokenizer(expression);
  const tokens = tokenizer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}

function evaluateExpression(expression, context) {
  if (typeof expression === 'string') {
    const trimmed = expression.trim();
    if (trimmed === '') return true;
  }
  const ast = parseExpression(expression);
  const evaluator = new Evaluator(context);
  return evaluator.evaluate(ast);
}

function validateExpression(expression) {
  try {
    parseExpression(expression);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

module.exports = {
  Tokenizer,
  Parser,
  Evaluator,
  parseExpression,
  evaluateExpression,
  validateExpression
};
