#!/usr/bin/env node

/**
 * HTTP Request Extractor & Replay Tool v3.3
 * Full AST analysis + regex fallback for minified Angular code
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

let BURP_PROXY = 'http://127.0.0.1:8080';
let SILENT = false;
let DEBUG = false;
const CONCURRENCY = 5;
let limit;
let httpsAgent, httpAgent;

function initializeProxyAgents() {
  httpsAgent = new HttpsProxyAgent(BURP_PROXY, { rejectUnauthorized: false, secureProtocol: 'TLSv1_2_method', timeout: 30000 });
  httpAgent = new HttpProxyAgent(BURP_PROXY, { timeout: 30000 });
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function log(...args) { if (!SILENT) console.log(...args); }
function error(...args) { if (!SILENT) console.error(...args); }
function debug(...args) { if (DEBUG) console.log('[DEBUG]', ...args); }

function parseArguments() {
  const args = process.argv.slice(2);
  const result = { help: false, silent: false, proxy: null, target: null, debug: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--silent' || arg === '-s') result.silent = true;
    else if (arg === '--debug' || arg === '-d') result.debug = true;
    else if (arg === '--proxy' || arg === '-p') {
      if (i + 1 < args.length) result.proxy = args[++i];
      else { error('Missing proxy value'); return null; }
    } else if (!arg.startsWith('-')) result.target = arg;
  }
  return result;
}

async function sendRequest({ method = 'GET', url, headers = {}, data, source = 'unknown' }) {
  try {
    let normalizedUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) normalizedUrl = 'https://' + url;
    try { new URL(normalizedUrl); } catch { log(`❌ Invalid URL: ${url}`); return null; }
    log(`🔍 Sending ${method} to: ${normalizedUrl} (${source})`);
    const config = {
      method: method.toLowerCase(), url: normalizedUrl, proxy: false,
      timeout: 15000, validateStatus: () => true, maxRedirects: 5,
      headers: { 'x-neo-js': 'true', 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9', 'Connection': 'close', ...headers }
    };
    if (normalizedUrl.startsWith('https://')) config.httpsAgent = httpsAgent;
    else config.httpAgent = httpAgent;
    if (data) config.data = data;
    const response = await axios(config);
    log(`✅ ${response.status} from ${normalizedUrl}`);
    return { status: response.status };
  } catch (err) { log(`❌ Failed: ${err.message}`); return null; }
}

// ============================================================================
// Expression Resolver
// ============================================================================

function resolveExpr(node, variables, functions, depth = 0) {
  if (!node || depth > 50) return null;
  switch (node.type) {
    case 'StringLiteral': return node.value;
    case 'NumericLiteral': return node.value;
    case 'BooleanLiteral': return node.value;
    case 'NullLiteral': return null;
    case 'Identifier': {
      if (variables.has(node.name)) {
        const v = variables.get(node.name);
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object' && v.value !== undefined) return v.value;
        return v;
      }
      return null;
    }
    case 'MemberExpression': {
      if (node.computed) {
        const obj = resolveExpr(node.object, variables, functions, depth + 1);
        const prop = resolveExpr(node.property, variables, functions, depth + 1);
        if (obj && typeof obj === 'object' && prop !== null) return obj[String(prop)];
        if (prop !== null && obj === null && node.object.type === 'Identifier' && ['window', 'global', 'globalThis', 'self'].includes(node.object.name)) return String(prop);
        return null;
      }
      if (node.property.type === 'Identifier') {
        const propName = node.property.name;
        if (node.object.type === 'ThisExpression') {
          const key = `this.${propName}`;
          if (variables.has(key)) {
            const v = variables.get(key);
            return v && v.value !== undefined ? v.value : v;
          }
          return null;
        }
        const obj = resolveExpr(node.object, variables, functions, depth + 1);
        if (obj && typeof obj === 'object' && propName in obj) return obj[propName];
        if (node.object.type === 'Identifier' && ['window', 'global', 'globalThis', 'self'].includes(node.object.name)) return propName;
      }
      return null;
    }
    case 'TemplateLiteral': {
      if (node.expressions.length === 0) return node.quasis[0].value.raw || node.quasis[0].value.cooked || '';
      let result = '';
      for (let i = 0; i < node.quasis.length; i++) {
        result += node.quasis[i].value.raw || node.quasis[i].value.cooked || '';
        if (i < node.expressions.length) {
          const r = resolveExpr(node.expressions[i], variables, functions, depth + 1);
          if (r !== null && r !== undefined) result += String(r);
          else return null;
        }
      }
      return result;
    }
    case 'BinaryExpression': {
      if (node.operator === '+') {
        const left = resolveExpr(node.left, variables, functions, depth + 1);
        const right = resolveExpr(node.right, variables, functions, depth + 1);
        if (left !== null && right !== null) return String(left) + String(right);
      }
      return null;
    }
    case 'ConditionalExpression': {
      const test = resolveExpr(node.test, variables, functions, depth + 1);
      if (test) return resolveExpr(node.consequent, variables, functions, depth + 1);
      return resolveExpr(node.alternate, variables, functions, depth + 1);
    }
    case 'LogicalExpression': {
      if (node.operator === '||') return resolveExpr(node.left, variables, functions, depth + 1) || resolveExpr(node.right, variables, functions, depth + 1);
      if (node.operator === '&&') { const l = resolveExpr(node.left, variables, functions, depth + 1); return l ? resolveExpr(node.right, variables, functions, depth + 1) : l; }
      if (node.operator === '??') { const l = resolveExpr(node.left, variables, functions, depth + 1); return l !== null && l !== undefined ? l : resolveExpr(node.right, variables, functions, depth + 1); }
      return null;
    }
    case 'CallExpression': {
      if (node.callee.type === 'MemberExpression' && node.callee.object?.type === 'Identifier' && node.callee.object.name === 'String' && node.callee.property?.name === 'fromCharCode') {
        return node.arguments.filter(a => a.type === 'NumericLiteral').map(a => String.fromCharCode(a.value)).join('') || null;
      }
      if (node.callee.type === 'Identifier') {
        if ((node.callee.name === 'btoa' || node.callee.name === 'atob') && node.arguments[0]) {
          const arg = resolveExpr(node.arguments[0], variables, functions, depth + 1);
          if (arg && typeof arg === 'string') {
            try { return node.callee.name === 'btoa' ? Buffer.from(arg, 'utf8').toString('base64') : Buffer.from(arg, 'base64').toString('utf8'); } catch {}
          }
        }
      }
      return null;
    }
    case 'ObjectExpression': {
      const obj = {};
      for (const prop of node.properties) {
        if ((prop.type === 'ObjectProperty' || prop.type === 'Property') && prop.key.type === 'Identifier') {
          obj[prop.key.name] = resolveExpr(prop.value, variables, functions, depth + 1);
        }
      }
      return obj;
    }
    case 'ArrayExpression': return node.elements.map(e => resolveExpr(e, variables, functions, depth + 1));
    default: return null;
  }
}

function extractHeaders(node, variables, functions) {
  if (!node || node.type !== 'ObjectExpression') return {};
  const headers = {};
  for (const prop of node.properties) {
    if ((prop.type === 'ObjectProperty' || prop.type === 'Property')) {
      let key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.type === 'StringLiteral' ? prop.key.value : null;
      if (prop.computed) key = resolveExpr(prop.key, variables, functions);
      if (key) {
        const value = resolveExpr(prop.value, variables, functions);
        if (value !== null && value !== undefined) headers[String(key)] = String(value);
      }
    }
  }
  return headers;
}

function getObjName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression') return getObjName(node.object) + '.' + (node.computed ? '[computed]' : (node.property.name || ''));
  return '';
}

// ============================================================================
// Regex fallback for minified Angular code
// ============================================================================

function regexScanForMinifiedRequests(code) {
  const requests = [];
  const seen = new Set();
  
  // Find base URLs from config/env patterns
  const baseUrlPatterns = [
    /baseUrl\s*:\s*["']([^"']+)["']/g,
    /backendBaseUrl\s*:\s*["']([^"']+)["']/g,
    /domain\s*:\s*["']([^"']+)["']/g,
  ];
  let baseUrl = '';
  for (const pattern of baseUrlPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(code);
    if (match) { baseUrl = match[1].replace(/\/+$/, ''); break; }
  }
  
  // Find full HTTP/HTTPS URLs
  const urlRegex = /https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}[^\s"'`<>\[\]{}|\\^~;,)}+]+/gi;
  let match;
  while ((match = urlRegex.exec(code)) !== null) {
    let url = match[0].replace(/[),;:}\]]+$/, '');
    if (url.length > 10 && !url.includes('w3.org') && !url.includes('schema.org')) {
      const key = `GET:${url}`;
      if (!seen.has(key)) { seen.add(key); requests.push({ method: 'GET', url, headers: {}, data: null, source: 'regex-URL' }); }
    }
  }
  
  // Find API paths with baseUrl concatenation patterns
  // this.baseUrl + "api/..." or baseUrl + "/api/..."
  if (baseUrl) {
    const apiPathPatterns = [
      /(?:baseUrl|this\.baseUrl)\s*\+\s*["']([^"']+)["']/g,
      /["'](\/api\/[^"']+)["']/g,
      /["'](\/Account\/[^"']+)["']/g,
      /["'](\/UserPanel[^"']*)["']/g,
      /["'](\/AdminPanel[^"']*)["']/g,
      /["'](\/Headerless[^"']*)["']/g,
    ];
    for (const pattern of apiPathPatterns) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(code)) !== null) {
        let url = m[1];
        if (!url.startsWith('http')) url = baseUrl + (url.startsWith('/') ? url : '/' + url);
        const key = `GET:${url}`;
        if (!seen.has(key)) { seen.add(key); requests.push({ method: 'GET', url, headers: {}, data: null, source: 'regex-API' }); }
      }
    }
  }
  
  // Find navigateByUrl calls
  const navRegex = /navigateByUrl\s*\(\s*["']([^"']+)["']/g;
  while ((match = navRegex.exec(code)) !== null) {
    let url = match[1];
    if (baseUrl && !url.startsWith('http')) url = baseUrl + (url.startsWith('/') ? url : '/' + url);
    const key = `GET:${url}`;
    if (!seen.has(key)) { seen.add(key); requests.push({ method: 'GET', url, headers: {}, data: null, source: 'regex-Router' }); }
  }
  
  // Find router.navigate([]) calls
  const navArrRegex = /navigate\s*\(\s*\[\s*["']([^"']+)["']/g;
  while ((match = navArrRegex.exec(code)) !== null) {
    let url = match[1];
    if (baseUrl && !url.startsWith('http')) url = baseUrl + (url.startsWith('/') ? url : '/' + url);
    const key = `GET:${url}`;
    if (!seen.has(key)) { seen.add(key); requests.push({ method: 'GET', url, headers: {}, data: null, source: 'regex-Router' }); }
  }
  
  return requests;
}

// ============================================================================
// Full AST Request Analyzer (for non-minified code)
// ============================================================================

class RequestAnalyzer {
  constructor(code, filePath) {
    this.code = code;
    this.filePath = filePath;
    this.variables = new Map();
    this.functions = new Map();
    this.axiosInstances = new Map();
    this.httpClients = new Map();
    this.xhrMap = new Map();
    this.formDataMap = new Map();
    this.urlSearchParamsMap = new Map();
    this.requests = [];
    this._seen = new Set();
  }

  analyze() {
    let ast = null;
    try {
      ast = parser.parse(this.code, {
        sourceType: 'unambiguous', errorRecovery: true,
        allowImportExportEverywhere: true, allowAwaitOutsideFunction: true,
        plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'classPrivateProperties', 'classPrivateMethods', 'optionalChaining', 'nullishCoalescingOperator', 'dynamicImport', 'topLevelAwait', 'importAssertions', 'objectRestSpread', 'logicalAssignment', 'asyncGenerators', 'numericSeparator', 'exportDefaultFrom', 'exportNamespaceFrom', 'optionalCatchBinding', 'throwExpressions'],
      });
    } catch (err) { return this.requests; }
    if (!ast) return this.requests;

    this.collectSymbols(ast);
    this.detectRequests(ast);
    return this.requests;
  }

  collectSymbols(ast) {
    traverse(ast, {
      VariableDeclarator: (path) => {
        const { id, init } = path.node;
        if (id.type !== 'Identifier' || !init) return;
        this.processAssignment(id.name, init);
      },
      FunctionDeclaration: (path) => { if (path.node.id) this.functions.set(path.node.id.name, path.node); },
      AssignmentExpression: (path) => {
        const { left, right } = path.node;
        // this.http = ... / this.router = ... / this.baseUrl = ...
        if (left.type === 'MemberExpression' && left.object.type === 'ThisExpression' && left.property.type === 'Identifier') {
          const propName = left.property.name;
          if (['http', 'httpClient', 'router', 'api', 'apiService', 'authService'].includes(propName) || propName.toLowerCase().includes('http') || propName.toLowerCase().includes('api') || propName.toLowerCase().includes('router')) {
            this.axiosInstances.set(`this.${propName}`, {});
            debug(`Injected client: this.${propName}`);
          }
          if ((propName === 'baseUrl' || propName === 'baseURL') && right.type === 'StringLiteral') {
            this.variables.set(`this.${propName}`, { value: right.value, type: 'string' });
          }
          return;
        }
        // x = "value"
        if (left.type === 'Identifier') this.processAssignment(left.name, right);
        // window['ax'+'ios'] = ...
        if (left.type === 'MemberExpression' && left.computed) {
          const resolved = resolveExpr(right, this.variables, this.functions);
          if (resolved === 'axios' && left.object.type === 'Identifier') {
            this.axiosInstances.set(left.object.name, {});
            debug(`Axios alias: ${left.object.name}`);
          }
        }
        // window.axios = ...
        if (left.type === 'MemberExpression' && !left.computed && left.object.type === 'Identifier' && ['window', 'global', 'globalThis', 'self'].includes(left.object.name) && left.property.name === 'axios') {
          this.axiosInstances.set(left.object.name, {});
        }
      },
    });
  }

  processAssignment(name, init) {
    if (init.type === 'StringLiteral') { this.variables.set(name, { value: init.value, type: 'string' }); return; }
    if (init.type === 'TemplateLiteral' && init.expressions.length === 0) { this.variables.set(name, { value: init.quasis[0].value.raw, type: 'string' }); return; }
    if (init.type === 'BinaryExpression' && init.operator === '+') {
      const r = resolveExpr(init, this.variables, this.functions);
      if (typeof r === 'string') { this.variables.set(name, { value: r, type: 'string' }); }
      return;
    }
    if (init.type === 'NewExpression' && init.callee.type === 'Identifier') {
      if (init.callee.name === 'XMLHttpRequest') this.xhrMap.set(name, { headers: {}, method: null, url: null, body: null });
      else if (init.callee.name === 'FormData') this.formDataMap.set(name, { data: {} });
      else if (init.callee.name === 'URLSearchParams') this.urlSearchParamsMap.set(name, { data: {} });
      return;
    }
    if (init.type === 'CallExpression' && init.callee.type === 'MemberExpression' && init.callee.object?.name === 'axios' && init.callee.property?.name === 'create') {
      const config = init.arguments[0]?.type === 'ObjectExpression' ? resolveExpr(init.arguments[0], this.variables, this.functions) || {} : {};
      this.axiosInstances.set(name, config);
      this.variables.set(name, { value: config, type: 'axios' });
      return;
    }
    if (init.type === 'ObjectExpression') { this.variables.set(name, { value: init, type: 'object' }); }
  }

  detectRequests(ast) {
    traverse(ast, {
      CallExpression: (path) => {
        const node = path.node, callee = node.callee;
        
        // fetch()
        if (callee.type === 'Identifier' && callee.name === 'fetch') { this.handleFetch(node); return; }
        
        // Dynamic import
        if (callee.type === 'Import' && node.arguments[0]) {
          const url = resolveExpr(node.arguments[0], this.variables, this.functions);
          if (url && typeof url === 'string' && url.startsWith('http')) this.addReq('GET', url, {}, null, 'dynamic import');
          return;
        }
        
        if (callee.type === 'MemberExpression') {
          const objName = getObjName(callee.object), method = callee.property.name;
          const instanceName = callee.object.type === 'Identifier' ? callee.object.name : objName;
          
          // Angular: this.http.get()
          if ((objName === 'this.http' || objName === 'this.httpClient' || objName === 'this.api' || objName.includes('this.http')) && ['get', 'post', 'put', 'delete', 'patch', 'request'].includes(method)) {
            this.handleAngularHttp(node, objName); return;
          }
          // Angular Router
          if ((objName === 'this.router' || instanceName === 'this.router') && method === 'navigateByUrl') {
            const url = resolveExpr(node.arguments[0], this.variables, this.functions);
            if (url && typeof url === 'string') this.addReq('GET', url, {}, null, 'router.navigateByUrl()');
            return;
          }
          if ((objName === 'this.router' || instanceName === 'this.router') && method === 'navigate' && node.arguments[0]?.elements?.[0]) {
            const url = resolveExpr(node.arguments[0].elements[0], this.variables, this.functions);
            if (url && typeof url === 'string') this.addReq('GET', url, {}, null, 'router.navigate()');
            return;
          }
          // XMLHttpRequest
          if (this.xhrMap.has(instanceName) || this.xhrMap.has(objName)) { this.handleXHR(node, this.xhrMap.has(instanceName) ? instanceName : objName); return; }
          // Axios
          if (objName === 'axios' || instanceName === 'axios' || this.axiosInstances.has(instanceName) || this.axiosInstances.has(objName)) {
            if (['get', 'post', 'put', 'delete', 'patch', 'request', 'head'].includes(method)) {
              const ax = this.axiosInstances.has(instanceName) ? instanceName : this.axiosInstances.has(objName) ? objName : 'axios';
              this.handleAxiosMethod(node, ax); return;
            }
          }
          // jQuery
          if ((objName === '$' || objName === 'jQuery') && ['ajax', 'get', 'post', 'getJSON', 'load'].includes(method)) { this.handleJQuery(node); return; }
          // Superagent
          if ((objName === 'request' || instanceName === 'request') && ['get', 'post', 'put', 'delete', 'head'].includes(method)) { this.handleSuperagent(node); return; }
          // Generic HTTP
          if (['get', 'post', 'put', 'delete', 'patch', 'request'].includes(method)) {
            const ol = objName.toLowerCase();
            if (ol.includes('http') || ol.includes('api') || ol.includes('client') || ol.includes('service')) { this.handleGenericHTTP(node, objName); return; }
          }
          // sendBeacon
          if (objName === 'navigator' && method === 'sendBeacon') {
            const url = resolveExpr(node.arguments[0], this.variables, this.functions);
            if (url && typeof url === 'string') this.addReq('POST', url, {}, resolveExpr(node.arguments[1], this.variables, this.functions), 'sendBeacon');
            return;
          }
          // FormData/URLSearchParams append/set
          if (['append', 'set'].includes(method)) {
            const key = resolveExpr(node.arguments[0], this.variables, this.functions);
            const val = resolveExpr(node.arguments[1], this.variables, this.functions);
            if (key && val !== null) {
              if (this.formDataMap.has(objName)) this.formDataMap.get(objName).data[String(key)] = val;
              else if (this.urlSearchParamsMap.has(objName)) this.urlSearchParamsMap.get(objName).data[String(key)] = val;
            }
            return;
          }
        }
        
        // axios() config
        if (callee.type === 'Identifier' && callee.name === 'axios' && node.arguments[0]?.type === 'ObjectExpression') { this.handleAxiosConfig(node); return; }
        // Obfuscated axios alias
        if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && this.axiosInstances.has(callee.object.name) && ['get', 'post', 'put', 'delete', 'patch', 'request'].includes(callee.property.name)) {
          this.handleAxiosMethod(node, callee.object.name); return;
        }
      },
      NewExpression: (path) => {
        const node = path.node;
        if (node.callee.type === 'Identifier' && ['WebSocket', 'EventSource'].includes(node.callee.name) && node.arguments[0]) {
          const url = resolveExpr(node.arguments[0], this.variables, this.functions);
          if (url && typeof url === 'string') this.addReq(node.callee.name === 'EventSource' ? 'GET' : 'WS', url, {}, null, node.callee.name);
        }
      },
    });
  }

  handleFetch(node) {
    const url = resolveExpr(node.arguments[0], this.variables, this.functions);
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return;
    let method = 'GET', headers = {}, data = null;
    if (node.arguments[1]?.type === 'ObjectExpression') {
      const opts = resolveExpr(node.arguments[1], this.variables, this.functions) || {};
      if (opts.method) method = String(opts.method).toUpperCase();
      if (opts.body) data = opts.body;
      const hp = node.arguments[1].properties.find(p => p.key?.name === 'headers' || p.key?.value === 'headers');
      if (hp) Object.assign(headers, extractHeaders(hp.value, this.variables, this.functions));
      if (opts.headers && typeof opts.headers === 'object') Object.assign(headers, opts.headers);
    }
    this.addReq(method, url, headers, data, 'fetch()');
  }

  handleAngularHttp(node, objName) {
    const method = node.callee.property.name.toUpperCase();
    let url = resolveExpr(node.arguments[0], this.variables, this.functions);
    if (!url) return;
    if (node.arguments[0].type === 'BinaryExpression' && node.arguments[0].operator === '+') {
      const r = resolveExpr(node.arguments[0], this.variables, this.functions);
      if (r && typeof r === 'string') url = r;
    }
    if (typeof url === 'string' && !url.startsWith('http')) {
      const bv = this.variables.get('this.baseUrl');
      if (bv?.value) url = bv.value.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);
    }
    if (!url || typeof url !== 'string') return;
    let headers = {}, data = null;
    if (node.arguments[1]) {
      const config = resolveExpr(node.arguments[1], this.variables, this.functions);
      if (config && typeof config === 'object') {
        if (config.params) { try { url += (url.includes('?') ? '&' : '?') + new URLSearchParams(config.params).toString(); } catch {} }
        if (config.headers) headers = config.headers;
      }
    }
    if (['POST', 'PUT', 'PATCH'].includes(method) && node.arguments[1]) data = resolveExpr(node.arguments[1], this.variables, this.functions);
    this.addReq(method, url, headers, data, `Angular HttpClient`);
  }

  handleXHR(node, xhrName) {
    const x = this.xhrMap.get(xhrName); if (!x) return;
    const mn = node.callee.property.name;
    if (mn === 'open') { x.method = resolveExpr(node.arguments[0], this.variables, this.functions); x.url = resolveExpr(node.arguments[1], this.variables, this.functions); }
    else if (mn === 'setRequestHeader') { const n = resolveExpr(node.arguments[0], this.variables, this.functions), v = resolveExpr(node.arguments[1], this.variables, this.functions); if (n && v) x.headers[String(n)] = String(v); }
    else if (mn === 'send') {
      let d = null;
      if (node.arguments[0]) { const ra = resolveExpr(node.arguments[0], this.variables, this.functions); if (typeof ra === 'string') { try { d = JSON.parse(ra); } catch { d = ra; } } else d = ra; }
      if (x.url) this.addReq(x.method || 'GET', x.url, x.headers || {}, d, 'XMLHttpRequest');
    }
  }

  handleAxiosMethod(node, instanceName) {
    const method = node.callee.property.name.toUpperCase();
    let url = resolveExpr(node.arguments[0], this.variables, this.functions);
    if (!url || typeof url !== 'string') return;
    let headers = {}, data = null;
    const inst = this.axiosInstances.get(instanceName) || {};
    if (inst.baseURL && !url.startsWith('http')) url = inst.baseURL.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);
    if (inst.headers) Object.assign(headers, inst.headers);
    if (['POST', 'PUT', 'PATCH'].includes(method) && node.arguments[1]) data = resolveExpr(node.arguments[1], this.variables, this.functions);
    const ci = ['POST', 'PUT', 'PATCH'].includes(method) ? 2 : 1;
    if (node.arguments[ci]?.type === 'ObjectExpression') {
      const cfg = resolveExpr(node.arguments[ci], this.variables, this.functions) || {};
      if (cfg.headers) Object.assign(headers, cfg.headers);
      if (cfg.params) { try { url += (url.includes('?') ? '&' : '?') + new URLSearchParams(cfg.params).toString(); } catch {} }
      const hp = node.arguments[ci].properties.find(p => p.key?.name === 'headers' || p.key?.value === 'headers');
      if (hp) Object.assign(headers, extractHeaders(hp.value, this.variables, this.functions));
    }
    this.addReq(method, url, headers, data, instanceName === 'axios' ? 'axios' : `${instanceName}.${method}`);
  }

  handleAxiosConfig(node) {
    if (node.arguments[0]?.type !== 'ObjectExpression') return;
    const cfg = resolveExpr(node.arguments[0], this.variables, this.functions) || {};
    const url = cfg.url; if (!url || typeof url !== 'string') return;
    let headers = cfg.headers || {};
    const hp = node.arguments[0].properties.find(p => p.key?.name === 'headers' || p.key?.value === 'headers');
    if (hp) Object.assign(headers, extractHeaders(hp.value, this.variables, this.functions));
    this.addReq((cfg.method || 'GET').toUpperCase(), url, headers, cfg.data, 'axios()');
  }

  handleJQuery(node) {
    const method = node.callee.property.name;
    if (method === 'ajax' && node.arguments[0]?.type === 'ObjectExpression') {
      const cfg = resolveExpr(node.arguments[0], this.variables, this.functions) || {};
      const url = cfg.url; if (!url) return;
      let headers = cfg.headers || {};
      const hp = node.arguments[0].properties.find(p => p.key?.name === 'headers' || p.key?.value === 'headers');
      if (hp) Object.assign(headers, extractHeaders(hp.value, this.variables, this.functions));
      this.addReq((cfg.method || cfg.type || 'GET').toUpperCase(), url, headers, cfg.data, 'jQuery.ajax');
      return;
    }
    const url = resolveExpr(node.arguments[0], this.variables, this.functions);
    if (url && typeof url === 'string' && url.startsWith('http')) {
      this.addReq(method === 'getJSON' ? 'GET' : method.toUpperCase(), url, {}, node.arguments[1] ? resolveExpr(node.arguments[1], this.variables, this.functions) : null, 'jQuery');
    }
  }

  handleSuperagent(node) {
    const url = resolveExpr(node.arguments[0], this.variables, this.functions);
    if (url && typeof url === 'string' && url.startsWith('http')) this.addReq(node.callee.property.name.toUpperCase(), url, {}, null, 'superagent');
  }

  handleGenericHTTP(node, objName) {
    const url = resolveExpr(node.arguments[0], this.variables, this.functions);
    if (url && typeof url === 'string' && url.startsWith('http')) this.addReq(node.callee.property.name.toUpperCase(), url, {}, null, `${objName}.${node.callee.property.name}`);
  }

  addReq(method, url, headers, data, source) {
    if (!url || typeof url !== 'string' || url.length < 10) return;
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('wss://') && !url.startsWith('ws://')) return;
    if (url.includes('undefined') || url.includes('[object Object]') || url.includes('null')) return;
    let n = url; if (n.startsWith('//')) n = 'https:' + n;
    try { new URL(n); } catch { return; }
    const key = `${method}:${n}`;
    if (this._seen.has(key)) return;
    this._seen.add(key);
    this.requests.push({ method: method.toUpperCase(), url: n, headers: headers || {}, data: data || null, source });
  }
}

// ============================================================================
// File Processing
// ============================================================================

function getAllFiles(dirPath) {
  const files = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output', 'coverage', '__pycache__', 'bower_components', 'vendor', '.cache']);
  function scan(dir) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!SKIP.has(entry.name) && !entry.name.startsWith('.')) scan(fullPath); }
        else if (entry.isFile() && ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(path.extname(entry.name).toLowerCase())) files.push(fullPath);
      }
    } catch (e) {}
  }
  scan(dirPath);
  return files;
}

function analyzeFile(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf8');
    if (!code.trim()) return [];
    
    // Try full AST analysis first
    const analyzer = new RequestAnalyzer(code, filePath);
    const astRequests = analyzer.analyze();
    
    // If AST found requests, return them
    if (astRequests.length > 0) {
      log(`📄 ${path.basename(filePath)}: ${astRequests.length} requests (AST)`);
      astRequests.forEach(r => log(`  🔍 ${r.method} ${r.url} (${r.source})`));
      return astRequests;
    }
    
    // If AST found nothing, try regex fallback for minified code
    const regexRequests = regexScanForMinifiedRequests(code);
    if (regexRequests.length > 0) {
      log(`📄 ${path.basename(filePath)}: ${regexRequests.length} requests (regex fallback)`);
      regexRequests.forEach(r => log(`  🔍 ${r.method} ${r.url} (${r.source})`));
      return regexRequests;
    }
    
    return [];
  } catch (err) { return []; }
}

// ============================================================================
// Main
// ============================================================================

async function sendAllRequests(requests) {
  if (!limit) { error('pLimit not initialized'); return; }
  log(`\n🚀 Sending ${requests.length} requests...\n`);
  const results = await Promise.allSettled(requests.map(req => limit(() => sendRequest(req))));
  let success = 0, fail = 0;
  results.forEach(r => { if (r.status === 'fulfilled' && r.value) success++; else fail++; });
  log(`\n📊 ${success} succeeded, ${fail} failed`);
}

function showUsage() { console.log(`HTTP Request Extractor v3.3\nUsage: node JSRequests.js [--silent] [--proxy host:port] <path>`); }

async function main() {
  try {
    const pLimitModule = await import('p-limit'); limit = pLimitModule.default(CONCURRENCY);
    const args = parseArguments(); if (!args) return;
    if (args.help) { showUsage(); return; }
    if (args.silent) SILENT = true;
    if (args.debug) DEBUG = true;
    if (args.proxy) { const [h, p] = args.proxy.split(':'); if (!h || !p) { error('Invalid proxy'); return; } BURP_PROXY = `http://${h}:${p}`; }
    initializeProxyAgents();
    if (!args.target) { error('No target'); return; }
    if (!fs.existsSync(args.target)) { error(`Path not found: ${args.target}`); return; }
    
    const targetPath = args.target;
    let allRequests = [];
    const stat = fs.statSync(targetPath);
    
    if (stat.isDirectory()) {
      log(`📁 Scanning: ${targetPath}`);
      const files = getAllFiles(targetPath);
      log(`📁 Found ${files.length} files\n`);
      for (const file of files) { const r = analyzeFile(file); if (r.length > 0) allRequests.push(...r); }
    } else { allRequests = analyzeFile(targetPath); }
    
    // Deduplicate
    const seen = new Set();
    allRequests = allRequests.filter(r => { const k = `${r.method}:${r.url}`; if (seen.has(k)) return false; seen.add(k); return true; });
    
    log(`\n📊 Total unique requests: ${allRequests.length}`);
    if (allRequests.length > 0) await sendAllRequests(allRequests);
    else log('⚠️ No HTTP requests found.');
    log('\n✅ Done!');
  } catch (err) { error('💥 Error:', err.message); process.exit(1); }
}

process.on('SIGINT', () => { log('\n👋 Exiting...'); process.exit(0); });
main().catch(err => { error('💥 Error:', err); process.exit(1); });