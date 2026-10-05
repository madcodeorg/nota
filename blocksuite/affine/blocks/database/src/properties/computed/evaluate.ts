export type FormulaValue = string | number | boolean | null;
export type ComputedError = { error: string };
export type ComputedValue = FormulaValue | ComputedError;

export const isComputedError = (value: unknown): value is ComputedError =>
  !!value && typeof value === 'object' && 'error' in value;

export const computedText = (value: unknown): string =>
  isComputedError(value) ? `#ERROR: ${value.error}` : String(value ?? '');

type Node =
  | { kind: 'value'; value: FormulaValue }
  | { kind: 'unary'; op: string; value: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] };

const precedence: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

// This language intentionally has no member access, assignment, or JS execution.
function parse(expression: string): Node {
  if (expression.length > 4096) throw new Error('Formula is too long');
  const tokens: string[] = [];
  const token =
    /\s*("(?:[^"\\]|\\.)*"|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z_\d]*|==|!=|<=|>=|&&|\|\||[()+\-*/%,!<>])/y;
  let offset = 0;
  while (offset < expression.length) {
    if (!expression.slice(offset).trim()) break;
    token.lastIndex = offset;
    const match = token.exec(expression);
    if (!match?.[1]) throw new Error('Invalid formula syntax');
    tokens.push(match[1]);
    offset = token.lastIndex;
    if (tokens.length > 256) throw new Error('Formula is too complex');
  }
  let position = 0;
  const read = (minimum = 0, depth = 0): Node => {
    if (depth > 32) throw new Error('Formula nesting limit exceeded');
    const current = tokens[position++];
    let node: Node;
    if (current === '(') {
      node = read(0, depth + 1);
      if (tokens[position++] !== ')')
        throw new Error('Expected closing parenthesis');
    } else if (current === '-' || current === '+' || current === '!') {
      node = { kind: 'unary', op: current, value: read(7, depth + 1) };
    } else if (current?.startsWith('"')) {
      node = { kind: 'value', value: JSON.parse(current) as string };
    } else if (current && /^\d/.test(current)) {
      node = { kind: 'value', value: Number(current) };
    } else if (
      current === 'true' ||
      current === 'false' ||
      current === 'null'
    ) {
      node = {
        kind: 'value',
        value: current === 'null' ? null : current === 'true',
      };
    } else if (
      current &&
      /^[A-Za-z_]/.test(current) &&
      tokens[position++] === '('
    ) {
      const args: Node[] = [];
      if (tokens[position] !== ')') {
        do {
          args.push(read(0, depth + 1));
        } while (tokens[position] === ',' && ++position);
      }
      if (tokens[position++] !== ')')
        throw new Error('Expected closing parenthesis');
      node = { kind: 'call', name: current, args };
    } else {
      throw new Error('Expected a value or function');
    }
    while (position < tokens.length) {
      const op = tokens[position]!;
      const rank = precedence[op];
      if (rank == null || rank < minimum) break;
      position++;
      node = {
        kind: 'binary',
        op,
        left: node,
        right: read(rank + 1, depth + 1),
      };
    }
    return node;
  };
  const node = read();
  if (position !== tokens.length) throw new Error('Unexpected formula token');
  return node;
}

const number = (value: FormulaValue): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Expected a finite number');
  }
  return value;
};
const text = (value: FormulaValue): string => {
  if (typeof value !== 'string') throw new Error('Expected text');
  return value;
};
const boolean = (value: FormulaValue): boolean => {
  if (typeof value !== 'boolean') throw new Error('Expected a boolean');
  return value;
};

export function evaluateFormula(
  expression: string,
  property: (id: string) => unknown
): ComputedValue {
  if (!expression.trim()) return { error: 'Configure the formula' };
  try {
    const root = parse(expression);
    let steps = 0;
    const evaluate = (node: Node): FormulaValue => {
      if (++steps > 512) throw new Error('Formula evaluation limit exceeded');
      if (node.kind === 'value') return node.value;
      if (node.kind === 'unary') {
        const value = evaluate(node.value);
        return node.op === '!'
          ? !boolean(value)
          : node.op === '-'
            ? -number(value)
            : number(value);
      }
      if (node.kind === 'binary') {
        const a = evaluate(node.left);
        if (node.op === '&&')
          return boolean(a) && boolean(evaluate(node.right));
        if (node.op === '||')
          return boolean(a) || boolean(evaluate(node.right));
        const b = evaluate(node.right);
        switch (node.op) {
          case '==':
            return a === b;
          case '!=':
            return a !== b;
          case '<':
          case '<=':
          case '>':
          case '>=': {
            if (
              !(
                (typeof a === 'number' && typeof b === 'number') ||
                (typeof a === 'string' && typeof b === 'string')
              )
            ) {
              throw new Error('Comparison requires matching numbers or text');
            }
            return node.op === '<'
              ? a < b
              : node.op === '<='
                ? a <= b
                : node.op === '>'
                  ? a > b
                  : a >= b;
          }
          case '+':
            return number(a) + number(b);
          case '-':
            return number(a) - number(b);
          case '*':
            return number(a) * number(b);
          case '/':
          case '%':
            if (number(b) === 0) throw new Error('Division by zero');
            return node.op === '/'
              ? number(a) / number(b)
              : number(a) % number(b);
        }
        throw new Error('Unknown operator');
      }
      if (node.name === 'if') {
        if (node.args.length !== 3) throw new Error('if needs three arguments');
        return evaluate(node.args[boolean(evaluate(node.args[0]!)) ? 1 : 2]!);
      }
      if (node.name === 'prop') {
        if (
          node.args.length !== 1 ||
          node.args[0]?.kind !== 'value' ||
          typeof node.args[0].value !== 'string'
        ) {
          throw new Error('prop needs a quoted column ID');
        }
        const value = property(node.args[0].value);
        if (isComputedError(value)) throw new Error(value.error);
        if (value == null) return null;
        if (['number', 'string', 'boolean'].includes(typeof value))
          return value as FormulaValue;
        // Rich-text is supported without exposing arbitrary objects to formulas.
        if (typeof value === 'object' && 'toDelta' in value)
          return String(value);
        throw new Error('Property has an unsupported value type');
      }
      const args = node.args.map(evaluate);
      const unary = (fn: (value: FormulaValue) => FormulaValue) => {
        if (args.length !== 1)
          throw new Error(`${node.name} needs one argument`);
        return fn(args[0]!);
      };
      switch (node.name) {
        case 'abs':
          return unary(value => Math.abs(number(value)));
        case 'round':
          return unary(value => Math.round(number(value)));
        case 'floor':
          return unary(value => Math.floor(number(value)));
        case 'ceil':
          return unary(value => Math.ceil(number(value)));
        case 'lower':
          return unary(value => text(value).toLowerCase());
        case 'upper':
          return unary(value => text(value).toUpperCase());
        case 'length':
          return unary(value => text(value).length);
        case 'empty':
          return unary(value => value == null || value === '');
        case 'format':
          return unary(value => String(value ?? ''));
        case 'concat':
          return args.map(text).join('');
        case 'min':
        case 'max':
          if (!args.length) throw new Error(`${node.name} needs values`);
          return node.name === 'min'
            ? Math.min(...args.map(number))
            : Math.max(...args.map(number));
        case 'date':
          return unary(value => {
            const str = text(value);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(str))
              throw new Error('date needs YYYY-MM-DD');
            const time = Date.parse(`${str}T00:00:00Z`);
            if (
              !Number.isFinite(time) ||
              new Date(time).toISOString().slice(0, 10) !== str
            )
              throw new Error('Invalid date');
            return time;
          });
        case 'dateAdd':
        case 'dateDiff':
          if (args.length !== 2)
            throw new Error(`${node.name} needs two arguments`);
          return node.name === 'dateAdd'
            ? number(args[0]!) + number(args[1]!) * 86400000
            : (number(args[0]!) - number(args[1]!)) / 86400000;
        default:
          throw new Error(`Unknown function: ${node.name}`);
      }
    };
    const result = evaluate(root);
    if (typeof result === 'number' && !Number.isFinite(result))
      throw new Error('Result is not finite');
    if (typeof result === 'string' && result.length > 4096)
      throw new Error('Result is too long');
    return result;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Invalid formula',
    };
  }
}

export function aggregateRollup(
  operation: string,
  values: unknown[]
): ComputedValue {
  if (values.some(isComputedError)) return values.find(isComputedError)!;
  if (operation === 'count') return values.length;
  const numbers = values.filter(value => value != null);
  if (
    numbers.some(value => typeof value !== 'number' || !Number.isFinite(value))
  )
    return { error: 'Rollup requires numeric values' };
  if (!numbers.length) return operation === 'sum' ? 0 : null;
  const list = numbers as number[];
  const total = () => {
    const value = list.reduce((sum, item) => sum + item, 0);
    if (!Number.isFinite(value))
      return { error: 'Rollup result is not finite' };
    return operation === 'avg' ? value / list.length : value;
  };
  switch (operation) {
    case 'sum':
      return total();
    case 'avg':
      return total();
    case 'min':
      return Math.min(...list);
    case 'max':
      return Math.max(...list);
    default:
      return { error: 'Unknown rollup operation' };
  }
}
