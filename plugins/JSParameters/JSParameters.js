#!/usr/bin/env node

/**
 * analyze.js - Request Parameter Extractor
 * Extracts parameter names from JavaScript/TypeScript source code
 * CLI: node analyze.js --file <filepath>
 *      node analyze.js --directory <dirpath>
 * Output: JSON array of unique parameter names
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SUPPORTED_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte'
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '.output', 'coverage', 'bower_components', 'vendor', '.cache'
]);

const PARAM_KEYS = new Set();

// ============================================================================
// Words that are NEVER parameter names
// ============================================================================

const BLOCKED = new Set([
  // CSS/React Native
  'alignItems', 'backgroundColor', 'borderRadius', 'flexDirection', 'flexGrow',
  'flexShrink', 'fontFamily', 'fontSize', 'fontWeight', 'justifyContent',
  'lineHeight', 'marginBottom', 'marginLeft', 'marginRight', 'marginTop',
  'maxHeight', 'maxWidth', 'minHeight', 'minWidth', 'paddingBottom',
  'paddingLeft', 'paddingRight', 'paddingTop', 'textAlign', 'textDecoration',
  'textTransform', 'whiteSpace', 'boxShadow', 'objectFit', 'pointerEvents',
  'userSelect', 'overflow', 'position', 'display', 'transform', 'transition',
  'visibility', 'opacity', 'zIndex', 'cursor', 'animation',
  
  // HTML attributes
  'href', 'src', 'alt', 'placeholder', 'disabled', 'readonly',
  'checked', 'selected', 'multiple', 'required', 'pattern', 'min', 'max',
  'step', 'autocomplete', 'autofocus', 'tabIndex', 'role', 'ariaLabel',
  'matInput', 'matSuffix', 'matTooltipPosition',
  
  // React/Vue props
  'children', 'component', 'render', 'key', 'ref', 'props', 'state',
  'onClick', 'onChange', 'onSubmit', 'onFocus', 'onBlur',
  
  // JavaScript built-ins
  'constructor', 'prototype', '__proto__', 'toString', 'valueOf', 'hasOwnProperty',
  'length', 'call', 'apply', 'bind', 'arguments',
  
  // HTTP internals
  'method', 'headers', 'status', 'statusText', 'ok',
  'redirected', 'mode', 'credentials', 'cache', 'integrity',
  'keepalive', 'signal', 'referrer', 'referrerPolicy',
  
  // Generic config
  'config', 'options', 'settings', 'baseURL', 'timeout', 'responseType',
  
  // Tutorial
  'fixture', 'fixtureAfter', 'unskippable', 'resolved', 'hints',
  'ignoreCase', 'replacement',
  
  // Angular template
  'ngIf', 'ngFor', 'ngForOf', 'ngModelChange', 'ngModel',
  'formControl', 'formControlName', 'formGroup', 'formArray',
  'translate', 'translateParams', 'fxLayout', 'fxLayoutAlign',
  'routerLink', 'routerLinkActive',
  
  // Angular component
  'passwordComponent', 'fontIcon',
  'lowerCaseCriteriaMsg', 'upperCaseCriteriaMsg', 'digitsCriteriaMsg',
  'specialCharsCriteriaMsg', 'minCharsCriteriaMsg',
  
  // Angular form control names
  'emailControl', 'passwordControl', 'repeatPasswordControl',
  'securityQuestionControl', 'securityAnswerControl',
  'editReviewControl', 'initialTokenControl',
  
  // Angular DI services
  'securityQuestionService', 'userService', 'securityAnswerService',
  'formSubmitService', 'translateService', 'snackBarHelperService',
  'productReviewService', 'dialogRef', 'http', 'router', 'snackBar', 'ngZone',
  
  // Minified vars
  't', 'e', 'r', 'n', 'o', 'a', 'c', 'p', 'g', 'b', 'h', 'f', 'm', 'y',
  'i', 'j', 'k', 'x', 'z', 'v', 'u', 's', 'w', 'd', 'l',
  
  // Null/undefined
  'null', 'undefined', 'NaN', 'Infinity', 'true', 'false',
]);

// Words that are OK as query params or HTTP body keys
const ALLOWED = new Set([
  // OAuth / auth
  'client_id', 'redirect_uri', 'response_type', 'scope', 'access_token',
  'token', 'secret', 'issuer', 'implicit',
  // Common API params
  'email', 'password', 'passwordRepeat', 'new', 'repeat', 'current',
  'securityQuestion', 'securityAnswer', 'answer', 'question',
  'id', 'UserId', 'SecurityQuestionId', 'addressId', 'continueCode',
  'continueCodeFindIt', 'continueCodeFixIt',
  // Generic
  'url', 'color', 'type', 'name', 'title', 'caption', 'image',
  'language', 'entity', 'to', 'from', 'message', 'body', 'data',
  'params', 'query', 'search', 'page', 'limit', 'offset', 'sort', 'order',
  // SoundCloud
  'auto_play', 'hide_related', 'show_comments', 'show_user', 'show_reposts', 'show_teaser',
  // Cookie/banner
  'cookieconsent_status', 'welcomebanner_status',
  // Social
  'hashtags', 'usp',
]);

// ============================================================================

function isValidParamName(name, fromURL = false) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 2) return false;
  if (name.length > 100) return false;
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) return false;
  
  // Explicitly allowed
  if (ALLOWED.has(name)) return true;
  
  // From URL query string - be more permissive
  if (fromURL && name.length >= 2) return !BLOCKED.has(name);
  
  // Block list
  if (BLOCKED.has(name)) return false;
  
  // Block ALL_CAPS_UNDERSCORE (translation keys) unless in allowed list
  if (/^[A-Z][A-Z0-9]*(_[A-Z][A-Z0-9]*)*$/.test(name) && name.length > 3) return false;
  
  // Block names ending with Control/Service/Component
  if (/(Control|Service|Component|Module|Directive|Pipe)$/.test(name)) return false;
  
  return true;
}

// ============================================================================

function extractFromURL(url) {
  if (!url || typeof url !== 'string') return;
  const regex = /[?&]([a-zA-Z_$][a-zA-Z0-9_$]*)=/g;
  let match;
  while ((match = regex.exec(url)) !== null) {
    if (isValidParamName(match[1], true)) {
      PARAM_KEYS.add(match[1]);
    }
  }
}

// ============================================================================

class ParameterExtractor {
  constructor() {
    this.variables = new Map();
  }

  extractFromCode(code, filePath) {
    this.variables = new Map();
    
    let codeToAnalyze = code;
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.vue') {
      const scripts = [];
      const regex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = regex.exec(code)) !== null) scripts.push(m[1]);
      codeToAnalyze = scripts.join('\n') || code;
    }
    if (ext === '.svelte') {
      const m = code.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
      if (m) codeToAnalyze = m[1];
    }

    let ast = null;
    try {
      ast = parser.parse(codeToAnalyze, {
        sourceType: 'unambiguous',
        errorRecovery: true,
        plugins: [
          'jsx', 'typescript', 'decorators-legacy', 'classProperties',
          'optionalChaining', 'dynamicImport', 'objectRestSpread', 'topLevelAwait',
        ],
      });
    } catch (e) {}

    if (ast) {
      this.extractParams(ast);
    }

    this.regexScan(code);
  }

  extractParams(ast) {
    traverse(ast, {
      // String literals with query params
      StringLiteral: (path) => {
        const val = path.node.value;
        if (val.includes('?') && val.includes('=')) {
          extractFromURL(val);
        }
        // Also check route params: /:id
        if (val.startsWith('/') && val.includes(':')) {
          this.extractRouteParams(val);
        }
      },

      CallExpression: (path) => {
        const { callee, arguments: args } = path.node;
        if (args.length === 0) return;

        if (callee.type === 'MemberExpression') {
          const method = callee.property.name;

          // .append('param'), .set('param')
          if (['append', 'set', 'get', 'delete', 'getAll', 'has'].includes(method)) {
            if (args[0] && args[0].type === 'StringLiteral') {
              const name = args[0].value;
              if (isValidParamName(name)) PARAM_KEYS.add(name);
            }
          }

          // req.query.XXX, req.body.XXX
          const objName = this.getFullName(callee.object);
          if (/^(req|request)\.(query|body|params|cookies|headers)$/.test(objName)) {
            if (callee.property.type === 'Identifier') {
              const name = callee.property.name;
              if (isValidParamName(name)) PARAM_KEYS.add(name);
            }
          }
        }
        
        // First argument to HTTP methods: .save({...}), .create({...})
        const calleeName = callee.type === 'Identifier' ? callee.name :
          callee.type === 'MemberExpression' ? callee.property.name : '';
        
        if (/^(save|create|post|put|patch|update|resetPassword|login|register|signup|signin|findBy|find)$/i.test(calleeName)) {
          if (args[0] && args[0].type === 'ObjectExpression') {
            this.extractObjectKeys(args[0]);
          }
        }
      },

      // NestJS decorators
      Decorator: (path) => {
        const expr = path.node.expression;
        if (expr.type !== 'CallExpression') return;
        const name = expr.callee.type === 'Identifier' ? expr.callee.name : '';
        if (['Param', 'Query', 'Body', 'Header', 'Headers', 'Cookie', 'Cookies', 'Session'].includes(name)) {
          if (expr.arguments[0] && expr.arguments[0].type === 'StringLiteral') {
            const p = expr.arguments[0].value;
            if (isValidParamName(p)) PARAM_KEYS.add(p);
          }
        }
      },

      // GraphQL: gql`...`
      TaggedTemplateExpression: (path) => {
        const tag = path.node.tag;
        if (tag.type === 'Identifier' && ['gql', 'graphql'].includes(tag.name)) {
          const query = path.node.quasi.quasis.map(q => q.value.raw).join('');
          this.extractGraphQLVars(query);
        }
      },
    });
  }

  extractObjectKeys(node) {
    if (node.type !== 'ObjectExpression') return;
    for (const prop of node.properties) {
      if (prop.type === 'ObjectProperty' || prop.type === 'Property') {
        if (prop.key.type === 'Identifier') {
          const name = prop.key.name;
          if (isValidParamName(name)) PARAM_KEYS.add(name);
        } else if (prop.key.type === 'StringLiteral') {
          const name = prop.key.value;
          if (isValidParamName(name)) PARAM_KEYS.add(name);
        }
        // Recurse nested objects
        if (prop.value && prop.value.type === 'ObjectExpression') {
          this.extractObjectKeys(prop.value);
        }
      }
    }
  }

  extractRouteParams(path) {
    const regex = /:([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let m;
    while ((m = regex.exec(path)) !== null) {
      if (isValidParamName(m[1])) PARAM_KEYS.add(m[1]);
    }
    const bracketRegex = /\[\.\.\.?([a-zA-Z_$][a-zA-Z0-9_$]*)\]/g;
    while ((m = bracketRegex.exec(path)) !== null) {
      if (isValidParamName(m[1])) PARAM_KEYS.add(m[1]);
    }
  }

  extractGraphQLVars(query) {
    const regex = /\$([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let m;
    while ((m = regex.exec(query)) !== null) {
      if (isValidParamName(m[1])) PARAM_KEYS.add(m[1]);
    }
  }

  getFullName(node) {
    if (!node) return '';
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'ThisExpression') return 'this';
    if (node.type === 'MemberExpression') {
      return this.getFullName(node.object) + '.' + 
             (node.computed ? '[computed]' : (node.property.name || ''));
    }
    return '';
  }

  regexScan(code) {
    // Query params in URLs
    const urlRegex = /[?&]([a-zA-Z_$][a-zA-Z0-9_$]*)=/g;
    let m;
    while ((m = urlRegex.exec(code)) !== null) {
      if (isValidParamName(m[1], true)) PARAM_KEYS.add(m[1]);
    }

    // .append('param'), .set('param')
    const appendRegex = /\.(?:append|set|get|delete|getAll|has)\s*\(\s*['"]([a-zA-Z_$][a-zA-Z0-9_$]*)['"]/g;
    while ((m = appendRegex.exec(code)) !== null) {
      if (isValidParamName(m[1])) PARAM_KEYS.add(m[1]);
    }

    // Express routes: /:param
    const routeRegex = /\/:([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    while ((m = routeRegex.exec(code)) !== null) {
      if (isValidParamName(m[1])) PARAM_KEYS.add(m[1]);
    }

    // Next.js: /[param]
    const bracketRegex = /\[\.\.\.?([a-zA-Z_$][a-zA-Z0-9_$]*)\]/g;
    while ((m = bracketRegex.exec(code)) !== null) {
      if (isValidParamName(m[1])) PARAM_KEYS.add(m[1]);
    }

    // NestJS: @Param('xxx')
    const decoratorRegex = /@(?:Param|Query|Body|Header|Headers|Cookie|Cookies|Session)\s*\(\s*['"]([a-zA-Z_$][a-zA-Z0-9_$]*)['"]/g;
    while ((m = decoratorRegex.exec(code)) !== null) {
      if (isValidParamName(m[1])) PARAM_KEYS.add(m[1]);
    }

    // req.query.xxx, req.body.xxx
    const reqRegex = /req\.(?:query|body|params|cookies)\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    while ((m = reqRegex.exec(code)) !== null) {
      if (isValidParamName(m[1])) PARAM_KEYS.add(m[1]);
    }

    // GraphQL $variables (min 3 chars)
    const gqlRegex = /\$([a-zA-Z_$][a-zA-Z0-9_$]{2,})/g;
    while ((m = gqlRegex.exec(code)) !== null) {
      if (isValidParamName(m[1])) PARAM_KEYS.add(m[1]);
    }
    
    // Object literals passed to HTTP methods: .save({email:..., password:...})
    const httpCallRegex = /\.(?:save|create|post|put|patch|update|resetPassword|login|register|signup|signin|findBy|find)\s*\(\s*\{/g;
    let lastIndex = 0;
    while ((m = httpCallRegex.exec(code)) !== null) {
      const startIdx = m.index + m[0].length - 1; // position of {
      const objContent = this.extractBraces(code, startIdx);
      if (objContent) {
        const keyRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g;
        let km;
        while ((km = keyRegex.exec(objContent)) !== null) {
          if (isValidParamName(km[1])) PARAM_KEYS.add(km[1]);
        }
      }
    }
  }
  
  extractBraces(code, startIdx) {
    if (code[startIdx] !== '{') return null;
    let depth = 0;
    let i = startIdx;
    while (i < code.length) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') {
        depth--;
        if (depth === 0) return code.substring(startIdx + 1, i);
      }
      i++;
    }
    return null;
  }
}

// ============================================================================

function getAllFiles(dirPath) {
  const files = [];
  function scan(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) scan(fullPath);
        } else if (entry.isFile()) {
          if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            files.push(fullPath);
          }
        }
      }
    } catch (e) {}
  }
  scan(dirPath);
  return files;
}

function analyzeFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const extractor = new ParameterExtractor();
    extractor.extractFromCode(content, filePath);
  } catch (e) {}
}

// ============================================================================

function printUsage() {
  console.error('Usage:\n  node analyze.js --file <filepath>\n  node analyze.js --directory <dirpath>');
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) printUsage();

  const mode = args[0];
  const targetPath = args[1];

  if (!fs.existsSync(targetPath)) {
    console.error(`Error: Path "${targetPath}" does not exist.`);
    process.exit(1);
  }

  if (mode === '--file') {
    if (!SUPPORTED_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) {
      console.error('Error: Unsupported file type.');
      process.exit(1);
    }
    analyzeFile(targetPath);
  } else if (mode === '--directory') {
    const files = getAllFiles(targetPath);
    for (const file of files) analyzeFile(file);
  } else {
    printUsage();
  }

  console.log(JSON.stringify([...PARAM_KEYS].sort(), null, 2));
}

if (require.main === module) main();