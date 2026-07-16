#!/usr/bin/env node

/**
 * JSEndpoints.js - Clean Endpoint Extractor
 * Extracts URLs and API paths from JavaScript/TypeScript files
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SUPPORTED_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage']);

// ============================================================================
// URL Cleaning
// ============================================================================

function cleanUrl(url) {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();
  
  while ((url.startsWith("'") && url.endsWith("'")) ||
         (url.startsWith('"') && url.endsWith('"')) ||
         (url.startsWith('`') && url.endsWith('`'))) {
    url = url.slice(1, -1).trim();
  }
  
  url = url.replace(/[),;:}\]]+$/, '');
  
  if (url.endsWith('.') && !url.match(/\/\.\.?$/)) {
    url = url.slice(0, -1);
  }
  
  url = url.replace(/\\(.)/g, '$1');
  
  if (/^\/\/[a-zA-Z0-9]/.test(url)) {
    url = 'https:' + url;
  }
  
  return url.trim();
}

// ============================================================================
// Validation
// ============================================================================

function isValidEndpoint(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.length < 4) return false;
  if (url.length > 2000) return false;
  
  // ============================================================
  // BLOCK: Bare protocols
  // ============================================================
  if (/^https?:\/\/$/i.test(url)) return false;
  if (/^wss?:\/\/$/i.test(url)) return false;
  
  // ============================================================
  // BLOCK: W3C URLs
  // ============================================================
  if (/w3\.org/i.test(url)) return false;
  if (/\/1998\/Math\/MathML/i.test(url)) return false;
  if (/\/1999\/(html|xhtml|xlink)/i.test(url)) return false;
  if (/\/2000\/svg/i.test(url)) return false;
  if (/\/XML\/1998\/namespace/i.test(url)) return false;
  
  // ============================================================
  // BLOCK: Placeholder/template-only URLs
  // ============================================================
  if (/^#\/\$\{/.test(url)) return false;         // #/${...
  if (/^\$\{/.test(url)) return false;             // ${...
  if (/^\{[A-Z*]+\}$/.test(url)) return false;     // {ENV}, {*}
  if (/\/\$\{?\/?$/.test(url)) return false;       // /$ , /${
  if (/=\$\{?\/?$/.test(url)) return false;        // =$ , =${
  if (/https?:\/\/[^\/]+\/\$\/?$/.test(url)) return false;
  if (/https?:\/\/[^\/]+\/\{\*\}\/?$/.test(url)) return false;
  
  // ============================================================
  // BLOCK: URLs ending with empty parameter values
  // ============================================================
  if (/[?&][^=]+=\s*$/.test(url)) return false;    // ?param=  or &param=
  if (/[?&][^=]+=&/.test(url)) return false;       // ?param=&
  
  // ============================================================
  // BLOCK: Single char or nonsense paths
  // ============================================================
  if (/^\/[a-zA-Z0-9_]$/.test(url)) return false;
  if (/^\/\d+\/?$/.test(url)) return false;
  if (/^\/\(\/?$/.test(url)) return false;
  
  // ============================================================
  // BLOCK: JavaScript code in URL
  // ============================================================
  if (/\.replace\(/.test(url)) return false;
  if (/encodeURIComponent/.test(url)) return false;
  if (/decodeURIComponent/.test(url)) return false;
  if (/\.replace\(/i.test(url)) return false;
  if (/%3A\/g/i.test(url)) return false;
  
  // ============================================================
  // BLOCK: Pure punctuation
  // ============================================================
  if (/^[\/\s{}()\[\]<>.,;:!?@#$%^&*+=|\\~`'"_-]+$/.test(url)) return false;
  
  // ============================================================
  // BLOCK: HTML/XML fragments
  // ============================================================
  if (/^<\/?[a-zA-Z0-9]/.test(url)) return false;
  if (/\/><\//.test(url)) return false;
  if (/<\/[a-zA-Z]+>$/.test(url)) return false;
  if (/^<[a-zA-Z]+\s/.test(url)) return false;
  if (/^<[a-zA-Z]+\/>$/.test(url)) return false;
  if (/^\/>/.test(url)) return false;
  
  // ============================================================
  // BLOCK: File extensions
  // ============================================================
  if (/\.(css|scss|sass|less|styl|svg|png|jpg|jpeg|gif|ico|webp|avif|bmp|tiff|mp4|webm|ogg|mp3|wav|flac|aac|woff|woff2|ttf|eot|otf|map|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|tar|gz|rar|7z)$/i.test(url)) return false;
  
  // ============================================================
  // BLOCK: Non-web protocols
  // ============================================================
  if (/^(data|blob|file|chrome|chrome-extension|about|edge|opera):/i.test(url)) return false;
  if (/^javascript:/i.test(url)) return false;
  if (/^mailto:/i.test(url)) return false;
  if (/^tel:/i.test(url)) return false;
  
  // ============================================================
  // BLOCK: Build internals
  // ============================================================
  if (/__webpack_/i.test(url)) return false;
  if (/__parcel_/i.test(url)) return false;
  if (/node_modules/i.test(url)) return false;
  
  // ============================================================
  // BLOCK: JavaScript keywords
  // ============================================================
  if (/^(return|yield|await|async|typeof|instanceof|new|delete|void|throw|break|continue|var|let|const|function|class|if|else|for|while|do|switch|case|try|catch|finally)\s/i.test(url)) return false;
  if (/\bMath\.(LN2|LN10|PI|E|SQRT|LOG|SIN|COS|TAN)\b/i.test(url)) return false;
  if (/^(hasOwnProperty|toString|valueOf|constructor|prototype|__proto__)$/i.test(url)) return false;
  if (/^(true|false|null|undefined|NaN|Infinity)$/i.test(url)) return false;
  
  // ============================================================
  // BLOCK: Natural language sentences
  // ============================================================
  const wordCount = url.split(/\s+/).filter(w => w.length > 1).length;
  if (wordCount > 5) return false;
  if (/\s{2,}/.test(url)) return false;
  
  // ============================================================
  // VALIDATE: Full URLs
  // ============================================================
  if (/^https?:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (!u.hostname.includes('.')) return false;
      if (u.hostname.length < 4) return false;
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // ============================================================
  // VALIDATE: WebSocket URLs
  // ============================================================
  if (/^wss?:\/\//i.test(url)) {
    return url.length > 10;
  }
  
  // ============================================================
  // VALIDATE: Protocol-relative URLs
  // ============================================================
  if (/^\/\/[a-zA-Z0-9]/.test(url)) {
    return url.length > 10;
  }
  
  // ============================================================
  // VALIDATE: Relative paths
  // ============================================================
  if (url.startsWith('/')) {
    if (url.length < 3) return false;
    if (!/^\/[a-zA-Z0-9]/.test(url)) return false;
    return true;
  }
  
  // ============================================================
  // VALIDATE: Hash routes
  // ============================================================
  if (/^#\//.test(url)) {
    return url.length > 4;
  }
  
  return false;
}

// ============================================================================
// Endpoint Extractor
// ============================================================================

class EndpointExtractor {
  constructor() {
    this.endpoints = new Set();
    this.variables = new Map();
  }

  extractFromCode(code, filePath) {
    this.variables = new Map();
    
    let codeToAnalyze = code;
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.vue') {
      const scripts = [];
      const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
      let match;
      while ((match = scriptRegex.exec(code)) !== null) {
        scripts.push(match[1]);
      }
      codeToAnalyze = scripts.join('\n') || code;
    }
    
    if (ext === '.svelte') {
      const match = code.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
      if (match) codeToAnalyze = match[1];
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
      traverse(ast, {
        VariableDeclarator: (path) => {
          const { id, init } = path.node;
          if (id.type === 'Identifier') {
            if (init && init.type === 'StringLiteral') {
              this.variables.set(id.name, init.value);
            }
            if (init && init.type === 'TemplateLiteral' && init.expressions.length === 0) {
              this.variables.set(id.name, init.quasis[0].value.raw);
            }
          }
        },
        AssignmentExpression: (path) => {
          const { left, right } = path.node;
          if (left.type === 'Identifier' && right.type === 'StringLiteral') {
            this.variables.set(left.name, right.value);
          }
        },
      });

      traverse(ast, {
        StringLiteral: (path) => {
          const val = path.node.value;
          if (val.startsWith('/') || val.startsWith('http') || val.startsWith('ws') || val.startsWith('#/') || val.startsWith('//')) {
            const cleaned = cleanUrl(val);
            if (isValidEndpoint(cleaned)) {
              this.endpoints.add(cleaned);
            }
          }
        },
        
        TemplateLiteral: (path) => {
          if (path.node.expressions.length > 0) return;
          const val = path.node.quasis[0].value.raw;
          if (val.startsWith('/') || val.startsWith('http') || val.startsWith('ws') || val.startsWith('//')) {
            const cleaned = cleanUrl(val);
            if (isValidEndpoint(cleaned)) {
              this.endpoints.add(cleaned);
            }
          }
        },
        
        JSXAttribute: (path) => {
          const { name, value } = path.node;
          if (!name || !value) return;
          const attrName = typeof name.name === 'string' ? name.name : '';
          if (!['href', 'src', 'to', 'action', 'url', 'api', 'link'].includes(attrName)) return;
          
          if (value.type === 'StringLiteral') {
            const cleaned = cleanUrl(value.value);
            if (isValidEndpoint(cleaned)) {
              this.endpoints.add(cleaned);
            }
          }
        },
        
        ImportDeclaration: (path) => {
          const source = path.node.source.value;
          if (source.startsWith('http') || source.startsWith('//')) {
            const cleaned = cleanUrl(source);
            if (isValidEndpoint(cleaned)) {
              this.endpoints.add(cleaned);
            }
          }
        },
      });
    }

    this.regexScan(code);
  }

  regexScan(code) {
    const urlRegex = /https?:\/\/[^\s"'`<>\[\]{}|\\^~;,)}+]+/gi;
    let match;
    while ((match = urlRegex.exec(code)) !== null) {
      const cleaned = cleanUrl(match[0]);
      if (isValidEndpoint(cleaned)) {
        this.endpoints.add(cleaned);
      }
    }
    
    const protoRelRegex = /\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}[^\s"'`<>\[\]{}|\\^~;,)}+]+/gi;
    while ((match = protoRelRegex.exec(code)) !== null) {
      const cleaned = cleanUrl(match[0]);
      if (isValidEndpoint(cleaned)) {
        this.endpoints.add(cleaned);
      }
    }
    
    const wsRegex = /wss?:\/\/[^\s"'`<>\[\]{}|\\^~;,)}+]+/gi;
    while ((match = wsRegex.exec(code)) !== null) {
      const cleaned = cleanUrl(match[0]);
      if (isValidEndpoint(cleaned)) {
        this.endpoints.add(cleaned);
      }
    }
    
    const pathRegex = /["'`](\/[a-zA-Z][^"'`]{2,200})["'`]/g;
    while ((match = pathRegex.exec(code)) !== null) {
      const cleaned = cleanUrl(match[1]);
      if (isValidEndpoint(cleaned)) {
        this.endpoints.add(cleaned);
      }
    }
    
    const hashRegex = /["'`](#\/[^"'`]{3,200})["'`]/g;
    while ((match = hashRegex.exec(code)) !== null) {
      const cleaned = cleanUrl(match[1]);
      if (isValidEndpoint(cleaned)) {
        this.endpoints.add(cleaned);
      }
    }
  }

  getResults() {
    return Array.from(this.endpoints).sort();
  }
}

// ============================================================================
// File Scanner
// ============================================================================

function getAllFiles(dirPath) {
  const files = [];
  
  function scan(dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
            scan(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
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
    const extractor = new EndpointExtractor();
    extractor.extractFromCode(content, filePath);
    return extractor.getResults();
  } catch (e) {
    return [];
  }
}

// ============================================================================
// CLI
// ============================================================================

function printUsage() {
  console.error('Usage:');
  console.error('  node JSEndpoints.js --file <filepath>');
  console.error('  node JSEndpoints.js --directory <dirpath>');
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
  
  let results = [];
  
  if (mode === '--file') {
    const ext = path.extname(targetPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      console.error(`Error: Unsupported file type: ${ext}`);
      process.exit(1);
    }
    results = analyzeFile(targetPath);
  } else if (mode === '--directory') {
    const files = getAllFiles(targetPath);
    const allEndpoints = new Set();
    
    for (const file of files) {
      const endpoints = analyzeFile(file);
      endpoints.forEach(e => allEndpoints.add(e));
    }
    
    results = Array.from(allEndpoints).sort();
  } else {
    printUsage();
  }
  
  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = { EndpointExtractor, analyzeFile, getAllFiles };