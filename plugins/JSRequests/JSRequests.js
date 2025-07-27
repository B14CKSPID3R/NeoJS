const fs = require('fs');
const path = require('path');
const axios = require('axios');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const vm = require('vm');

// Configuration
let BURP_PROXY = 'http://127.0.0.1:8080';
let SILENT = false;
const CONCURRENCY = 5; // or make this a CLI option
let limit; // Will be initialized in main()

function parseArguments() {
  const args = process.argv.slice(2);
  const result = {
    help: false,
    silent: false,
    proxy: null,
    target: null
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--silent' || arg === '-s') {
      result.silent = true;
    } else if (arg === '--proxy' || arg === '-p') {
      if (i + 1 < args.length) {
        result.proxy = args[++i];
      } else {
        error('❌ Missing proxy value');
        return null;
      }
    } else if (!arg.startsWith('-')) {
      // The first non-flag argument is the target
      result.target = arg;
    }
  }

  return result;
}

function log(...args) {
  if (!SILENT) console.log(...args);
}

function error(...args) {
  if (!SILENT) console.error(...args);
}

let httpsAgent, httpAgent;

function initializeProxyAgents() {
  httpsAgent = new HttpsProxyAgent(BURP_PROXY, {
    rejectUnauthorized: false,
    secureProtocol: 'TLSv1_2_method',
    timeout: 30000
  });

  httpAgent = new HttpProxyAgent(BURP_PROXY, {
    timeout: 30000
  });
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const processedRequests = new Set();
const urlVariables = new Map();
const functionReturnValues = new Map();
const urlPatterns = new Set();
const headersVariables = new Map(); // New: Track Headers objects

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
const HTTP_LIBRARIES = new Set(['axios', 'request', 'superagent', 'got', 'node-fetch', 'ky', 'sendBeacon']);
const JQUERY_METHODS = new Set(['ajax', 'get', 'post', 'getJSON', 'load']);
const URL_KEYWORDS = new Set(['url', 'endpoint', 'api', 'host', 'domain', 'server']);

async function sendRequest({ method = 'GET', url, headers = {}, data, source = 'unknown' }) {
  try {
    let normalizedUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      normalizedUrl = 'https://' + url;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      log(`❌ Invalid URL: ${url}`);
      return null;
    }

    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(normalizedUrl)) {
      log(`❌ Skipping invalid URL: ${normalizedUrl}`);
      return null;
    }

    log(`🔍 Sending ${method} request to: ${normalizedUrl} (from ${source})`);
    
    // Log headers if they exist
    if (Object.keys(headers).length > 0) {
      log(`📋 Headers:`, JSON.stringify(headers, null, 2));
    }

    const config = {
      method: method.toLowerCase(),
      url: normalizedUrl,
      proxy: false,
      timeout: 15000,
      validateStatus: () => true,
      maxRedirects: 5,
      headers: {
        'x-neo-js': 'true',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'close',
        ...headers // Merge extracted headers
      }
    };

    if (normalizedUrl.startsWith('https://')) {
      config.httpsAgent = httpsAgent;
    } else {
      config.httpAgent = httpAgent;
    }

    if (data) config.data = data;

    const response = await axios(config);
    log(`✅ Response: ${response.status} from ${normalizedUrl}`);
    return {
      status: response.status,
      headers: response.headers,
      data: response.data
    };
  } catch (err) {
    log(`❌ Request failed for ${url}: ${err.message}`);
    return null;
  }
}

function extractStringValue(node, code, depth = 0) {
  if (!node || depth > 10) return null;
  
  // Add debug logging to see what's being extracted
  if (!SILENT && depth === 0) {
    log(`🔎 Extracting string from node type: ${node.type}`);
  }
  
  switch (node.type) {
    case 'StringLiteral':
      const value = node.value;
      if (!SILENT && depth === 0) {
        log(`📝 Extracted StringLiteral: "${value}"`);
      }
      return value;
      
    case 'TemplateLiteral':
      try {
        // First try simple static template literal
        if (node.expressions.length === 0) {
          const staticValue = node.quasis[0]?.value?.cooked || '';
          if (!SILENT && depth === 0) {
            log(`📝 Extracted static TemplateLiteral: "${staticValue}"`);
          }
          return staticValue;
        }
        
        // For complex template literals, try to extract the raw code and evaluate it safely
        const templateCode = code.slice(node.start, node.end);
        if (!SILENT && depth === 0) {
          log(`📝 Template literal code: ${templateCode}`);
        }
        
        // Try simple variable substitution for common patterns
        let result = node.quasis.reduce((acc, quasi, i) => {
          acc += quasi.value.cooked || quasi.value.raw || '';
          if (i < node.expressions.length) {
            const expr = node.expressions[i];
            const exprValue = extractStringValue(expr, code, depth + 1);
            if (exprValue !== null) {
              acc += exprValue;
            } else {
              acc += '[DYNAMIC]';
            }
          }
          return acc;
        }, '');
        
        if (!SILENT && depth === 0) {
          log(`📝 Extracted complex TemplateLiteral: "${result}"`);
        }
        return result;
      } catch (e) {
        if (!SILENT && depth === 0) {
          log(`❌ Template literal extraction failed: ${e.message}`);
        }
        return null;
      }
      
    case 'BinaryExpression':
      if (node.operator === '+') {
        const left = extractStringValue(node.left, code, depth + 1);
        const right = extractStringValue(node.right, code, depth + 1);
        
        if (left !== null && right !== null) {
          const result = left + right;
          if (!SILENT && depth === 0) {
            log(`📝 Extracted BinaryExpression: "${result}"`);
          }
          return result;
        }
      }
      return null;
      
    case 'CallExpression':
      // Handle function calls that might return URLs
      if (node.callee.type === 'Identifier') {
        const funcName = node.callee.name;
        
        // Check if this function is known to return URLs
        if (functionReturnValues.has(funcName)) {
          const returnValue = functionReturnValues.get(funcName);
          if (!SILENT && depth === 0) {
            log(`📝 Extracted from known function ${funcName}: "${returnValue}"`);
          }
          return returnValue;
        }
        
        // Handle URLSearchParams toString()
        if (funcName === 'URLSearchParams' || 
            (node.callee.object?.type === 'NewExpression' && 
             node.callee.object.callee?.name === 'URLSearchParams')) {
          if (!SILENT && depth === 0) {
            log(`📝 Found URLSearchParams - returning placeholder`);
          }
          return '[URLSearchParams]';
        }
        
        // Handle btoa() and atob() functions
        if (funcName === 'btoa' && node.arguments[0]) {
          const arg = extractStringValue(node.arguments[0], code, depth + 1);
          if (arg !== null) {
            try {
              const encoded = Buffer.from(arg, 'utf8').toString('base64');
              if (!SILENT && depth === 0) {
                log(`📝 Extracted btoa("${arg}"): "${encoded}"`);
              }
              return encoded;
            } catch (e) {
              if (!SILENT && depth === 0) {
                log(`❌ btoa() encoding failed: ${e.message}`);
              }
              return null;
            }
          }
        }
        
        if (funcName === 'atob' && node.arguments[0]) {
          const arg = extractStringValue(node.arguments[0], code, depth + 1);
          if (arg !== null) {
            try {
              const decoded = Buffer.from(arg, 'base64').toString('utf8');
              if (!SILENT && depth === 0) {
                log(`📝 Extracted atob("${arg}"): "${decoded}"`);
              }
              return decoded;
            } catch (e) {
              if (!SILENT && depth === 0) {
                log(`❌ atob() decoding failed: ${e.message}`);
              }
              return null;
            }
          }
        }
      }
      
      // Handle method calls on URLSearchParams
      if (node.callee.type === 'MemberExpression' &&
          node.callee.property?.name === 'toString' &&
          node.callee.object?.type === 'Identifier') {
        const objName = node.callee.object.name;
        // Check if this object was created as URLSearchParams
        if (urlPatterns.has(objName)) {
          if (!SILENT && depth === 0) {
            log(`📝 URLSearchParams.toString() - returning placeholder`);
          }
          return '[URLSearchParams]';
        }
      }
      
      if (node.callee.type === 'MemberExpression' &&
          node.callee.object?.name === 'String' &&
          node.callee.property?.name === 'fromCharCode') {
        const result = node.arguments
          .filter(arg => arg.type === 'NumericLiteral')
          .map(arg => String.fromCharCode(arg.value))
          .join('');
        if (!SILENT && depth === 0) {
          log(`📝 Extracted String.fromCharCode: "${result}"`);
        }
        return result;
      }
      
      return null;
      
    case 'Identifier':
      if (urlVariables.has(node.name)) {
        const value = urlVariables.get(node.name);
        if (!SILENT && depth === 0) {
          log(`📝 Extracted Identifier from cache: "${value}"`);
        }
        return value;
      }
      
      // Try to find the variable declaration in the code
      const varRegex = new RegExp(`(?:const|let|var)\\s+${node.name}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
      const match = varRegex.exec(code);
      if (match) {
        const value = match[1];
        if (!SILENT && depth === 0) {
          log(`📝 Extracted Identifier from code: "${value}"`);
        }
        return value;
      }
      
      if (!SILENT && depth === 0) {
        log(`❌ Could not resolve Identifier: ${node.name}`);
      }
      return null;
      
    default:
      if (!SILENT && depth === 0) {
        log(`❌ Unsupported node type: ${node.type}`);
      }
      return null;
  }
}

// Enhanced function to extract headers from various formats
function extractHeaders(node, code) {
  if (!node) return {};
  
  log(`🔎 Extracting headers from node type: ${node.type}`);
  
  switch (node.type) {
    case 'ObjectExpression':
      // Regular object literal headers
      return extractObjectProperties(node, code);
      
    case 'NewExpression':
      // new Headers() constructor
      if (node.callee?.name === 'Headers' && node.arguments[0]) {
        log(`📋 Found Headers constructor`);
        return extractHeaders(node.arguments[0], code);
      }
      break;
      
    case 'Identifier':
      // Reference to a Headers variable
      if (headersVariables.has(node.name)) {
        const headers = headersVariables.get(node.name);
        log(`📋 Retrieved cached Headers variable: ${node.name}`);
        return headers;
      }
      break;
      
    case 'CallExpression':
      // Method calls that might return headers
      if (node.callee?.type === 'MemberExpression' && 
          node.callee.property?.name === 'entries' &&
          node.callee.object?.type === 'Identifier') {
        const objName = node.callee.object.name;
        if (headersVariables.has(objName)) {
          return headersVariables.get(objName);
        }
      }
      break;
  }
  
  return {};
}

function extractObjectProperties(node, code) {
  if (!node || node.type !== 'ObjectExpression') return {};
  
  return node.properties.reduce((props, prop) => {
    let key = null;
    
    if (prop.key?.type === 'Identifier') {
      key = prop.key.name;
    } else if (prop.key?.type === 'StringLiteral') {
      key = prop.key.value;
    }
    
    if (key && prop.value) {
      if (prop.value.type === 'ObjectExpression') {
        props[key] = extractObjectProperties(prop.value, code);
      } else if (prop.value.type === 'CallExpression' && 
                 prop.value.callee?.object?.name === 'JSON' &&
                 prop.value.callee?.property?.name === 'stringify') {
        // Handle JSON.stringify() calls
        const arg = prop.value.arguments[0];
        if (arg.type === 'ObjectExpression') {
          props[key] = extractObjectProperties(arg, code);
        } else {
          const value = extractStringValue(arg, code);
          if (value !== null) props[key] = value;
        }
      } else {
        const value = extractStringValue(prop.value, code);
        if (value !== null) props[key] = value;
      }
    }
    return props;
  }, {});
}

function extractRequestBody(node, code, ast) {
  if (!node) return null;
  
  // Handle direct string literals
  if (node.type === 'StringLiteral') {
    return node.value;
  }
  
  // Handle JSON.stringify() calls
  if (node.type === 'CallExpression' && 
      node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'JSON' &&
      node.callee.property.name === 'stringify') {
    const arg = node.arguments[0];
    if (arg.type === 'ObjectExpression') {
      // Extract the object properties directly
      const obj = {};
      arg.properties.forEach(prop => {
        if (prop.key && prop.value) {
          const key = prop.key.name || prop.key.value;
          if (prop.value.type === 'StringLiteral' || prop.value.type === 'NumericLiteral' || prop.value.type === 'BooleanLiteral') {
            obj[key] = prop.value.value;
          } else if (prop.value.type === 'ObjectExpression') {
            obj[key] = extractRequestBody(prop.value, code, ast);
          }
        }
      });
      return obj;
    }
  }
  
  // Handle object literals
  if (node.type === 'ObjectExpression') {
    const obj = {};
    node.properties.forEach(prop => {
      if (prop.key && prop.value) {
        const key = prop.key.name || prop.key.value;
        if (prop.value.type === 'StringLiteral' || prop.value.type === 'NumericLiteral' || prop.value.type === 'BooleanLiteral') {
          obj[key] = prop.value.value;
        } else if (prop.value.type === 'ObjectExpression') {
          obj[key] = extractRequestBody(prop.value, code, ast);
        }
      }
    });
    return obj;
  }
  
  // Handle template literals
  if (node.type === 'TemplateLiteral') {
    return extractStringValue(node, code);
  }
  
  // Handle binary expressions (string concatenation)
  if (node.type === 'BinaryExpression') {
    return extractStringValue(node, code);
  }
  
  // Handle identifiers (variables)
  if (node.type === 'Identifier') {
    const varDecl = findVariableDeclaration(node.name, ast);
    if (varDecl && varDecl.init) {
      return extractRequestBody(varDecl.init, code, ast);
    }
  }
  
  return null;
}

function processHttpRequest(node, method, url, config = {}, source, code) {
  if (!url) {
    log(`❌ No URL found for ${source}`);
    return null;
  }
  
  // Handle URLSearchParams placeholder
  if (url.includes('[URLSearchParams]')) {
    // Extract base URL and add placeholder query
    const baseUrl = url.replace('?[URLSearchParams]', '');
    if (baseUrl && (baseUrl.includes('http') || baseUrl.includes('.'))) {
      log(`🔍 Processing URLSearchParams request: ${baseUrl}?[query]`);
      return {
        method: method.toUpperCase(),
        url: baseUrl + '?query=placeholder',
        headers: config.headers || {},
        data: null,
        source: source + ' (URLSearchParams)'
      };
    }
  }
  
  // Skip requests with empty dynamic parts
  if (url.includes('[DYNAMIC]') || url.includes('undefined')) {
    log(`⚠️ Skipping request with dynamic parts: ${url}`);
    return null;
  }
  
  // Validate URL format
  if (!url.includes('http') && !url.includes('.')) {
    log(`⚠️ Skipping invalid URL: ${url}`);
    return null;
  }
  
  const request = {
    method: method.toUpperCase(),
    url,
    headers: config.headers || {},
    data: null,
    source
  };
  
  log(`✅ Found HTTP request: ${method.toUpperCase()} ${url} (${source})`);
  
  // Handle body for POST/PUT/PATCH requests
  if (['post', 'put', 'patch'].includes(method.toLowerCase())) {
    if (config.body) {
      // If body is already an object (from JSON.stringify), use it directly
      if (typeof config.body === 'object' && !Array.isArray(config.body)) {
        request.data = config.body;
      } else {
        request.data = config.body;
      }
    } else if (node.arguments[1]?.properties) {
      // Fallback to extracting from AST directly
      const bodyProp = node.arguments[1].properties.find(p => 
        (p.key?.name === 'body' || p.key?.value === 'body')
      );
      if (bodyProp) {
        request.data = extractRequestBody(bodyProp.value, code, ast);
      }
    }
  }
  
  return request;
}

// Add this helper function after the existing helper functions
function extractFormData(node, code, ast) {
  if (!node) return null;
  
  // Handle FormData instances
  if (node.type === 'NewExpression' && 
      node.callee.name === 'FormData') {
    return {
      type: 'form-data',
      data: {} // We'll populate this with append() calls
    };
  }
  
  // Handle FormData.append() calls
  if (node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.property.name === 'append') {
    const formDataVar = node.callee.object.name;
    const key = extractStringValue(node.arguments[0], code);
    const value = extractStringValue(node.arguments[1], code);
    
    if (key && value) {
      return {
        type: 'form-data-append',
        formDataVar,
        key,
        value
      };
    }
  }
  
  return null;
}

// Add this helper function after the existing helper functions
function extractURLSearchParams(node, code, ast) {
  if (!node) return null;
  
  // Handle URLSearchParams instances
  if (node.type === 'NewExpression' && 
      node.callee.name === 'URLSearchParams') {
    return {
      type: 'url-search-params',
      data: {}
    };
  }
  
  // Handle URLSearchParams.append() calls
  if (node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.property.name === 'append') {
    const paramsVar = node.callee.object.name;
    const key = extractStringValue(node.arguments[0], code);
    const value = extractStringValue(node.arguments[1], code);
    
    if (key && value) {
      return {
        type: 'url-search-params-append',
        paramsVar,
        key,
        value
      };
    }
  }
  
  return null;
}

// Add this helper function after the existing helper functions
function extractAxiosConfig(node, code, ast) {
  if (!node) return null;
  
  const config = {
    method: 'GET',
    url: '',
    headers: {},
    data: null,
    params: null
  };
  
  // Handle direct method calls (axios.get, axios.post, etc.)
  if (node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'axios') {
    const method = node.callee.property.name.toUpperCase();
    config.method = method;
    
    // Extract URL from first argument
    if (node.arguments[0]) {
      config.url = extractStringValue(node.arguments[0], code);
    }
    
    // Extract data/body from second argument (for POST, PUT, PATCH)
    if (['POST', 'PUT', 'PATCH'].includes(method) && node.arguments[1]) {
      if (node.arguments[1].type === 'ObjectExpression') {
        config.data = extractObjectProperties(node.arguments[1], code);
      } else if (node.arguments[1].type === 'Identifier') {
        // Handle FormData
        const formDataVar = node.arguments[1].name;
        const formData = formDataMap.get(formDataVar);
        if (formData) {
          config.data = formData.data;
          config.headers['Content-Type'] = 'multipart/form-data';
        }
      }
    }
    
    // Extract config object from last argument
    const configArg = node.arguments[node.arguments.length - 1];
    if (configArg && configArg.type === 'ObjectExpression') {
      // Extract headers
      const headersProp = configArg.properties.find(p => 
        (p.key?.name === 'headers' || p.key?.value === 'headers')
      );
      if (headersProp) {
        const extractedHeaders = extractHeaders(headersProp.value, code);
        config.headers = { ...config.headers, ...extractedHeaders };
      }
      
      // Extract params
      const paramsProp = configArg.properties.find(p => 
        (p.key?.name === 'params' || p.key?.value === 'params')
      );
      if (paramsProp) {
        config.params = extractObjectProperties(paramsProp.value, code);
      }
    }
  }
  
  return config;
}

function handleAxiosCall(node, code, formDataMap) {
  // axios.<method>()
  if (node.callee && node.callee.type === 'MemberExpression' && node.callee.object?.name === 'axios') {
    let url = '';
    if (node.arguments[0]) {
      url = extractStringValue(node.arguments[0], code);
    }
    if (!url) return null;
    const method = (node.callee.property?.name || 'get').toUpperCase();
    const headers = {};
    let data = null;
    let params = null;
    if (node.arguments.length > 1) {
      const configArg = node.arguments[node.arguments.length - 1];
      if (configArg && configArg.type === 'ObjectExpression') {
        const headersProp = configArg.properties.find(p => (p.key?.name === 'headers' || p.key?.value === 'headers'));
        if (headersProp) Object.assign(headers, extractHeaders(headersProp.value, code));
        const paramsProp = configArg.properties.find(p => (p.key?.name === 'params' || p.key?.value === 'params'));
        if (paramsProp) params = extractObjectProperties(paramsProp.value, code);
      }
    }
    if (["POST", "PUT", "PATCH"].includes(method) && node.arguments[1]) {
      if (node.arguments[1].type === 'ObjectExpression') {
        data = extractObjectProperties(node.arguments[1], code);
      } else if (node.arguments[1].type === 'Identifier') {
        const formDataVar = node.arguments[1].name;
        const formData = formDataMap.get(formDataVar);
        if (formData) {
          data = formData.data;
          headers['Content-Type'] = 'multipart/form-data';
        }
      }
    }
    if (params) {
      const queryString = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
    return { method, url, headers, data, source: 'axios' };
  }
  // axios({ ... })
  if (node.callee && node.callee.type === 'Identifier' && node.callee.name === 'axios' && node.arguments[0] && node.arguments[0].type === 'ObjectExpression') {
    const configObj = node.arguments[0];
    let url = '';
    let method = 'GET';
    let headers = {};
    let data = null;
    let params = null;
    for (const prop of configObj.properties) {
      if (prop.key?.name === 'url' || prop.key?.value === 'url') url = extractStringValue(prop.value, code);
      else if (prop.key?.name === 'method' || prop.key?.value === 'method') method = extractStringValue(prop.value, code)?.toUpperCase() || 'GET';
      else if (prop.key?.name === 'headers' || prop.key?.value === 'headers') headers = extractHeaders(prop.value, code);
      else if (prop.key?.name === 'data' || prop.key?.value === 'data') {
        if (prop.value.type === 'ObjectExpression') data = extractObjectProperties(prop.value, code);
        else if (prop.value.type === 'Identifier') {
          const formDataVar = prop.value.name;
          const formData = formDataMap.get(formDataVar);
          if (formData) {
            data = formData.data;
            headers['Content-Type'] = 'multipart/form-data';
          }
        }
      }
      else if (prop.key?.name === 'params' || prop.key?.value === 'params') params = extractObjectProperties(prop.value, code);
    }
    if (params) {
      const queryString = Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      url += (url.includes('?') ? '&' : '?') + queryString;
    }
    return { method, url, headers, data, source: 'axios' };
  }
  return null;
}

function handleJQueryAjaxCall(node, code, ast, formDataMap) {
  // Check if this is a $.ajax() call
  if (node.callee.type === 'MemberExpression' &&
      node.callee.object.name === '$' &&
      node.callee.property.name === 'ajax' &&
      node.arguments[0] &&
      node.arguments[0].type === 'ObjectExpression') {
    
    const configObj = node.arguments[0];
    let url = '';
    let method = 'GET';
    let headers = {};
    let data = null;
    let contentType = null;
    
    try {
      // Extract configuration from the object
      for (const prop of configObj.properties) {
        if (prop.key?.name === 'url' || prop.key?.value === 'url') {
          url = extractStringValue(prop.value, code);
        } else if (prop.key?.name === 'method' || prop.key?.value === 'method') {
          method = extractStringValue(prop.value, code)?.toUpperCase() || 'GET';
        } else if (prop.key?.name === 'headers' || prop.key?.value === 'headers') {
          if (prop.value.type === 'ObjectExpression') {
            for (const headerProp of prop.value.properties) {
              const headerName = headerProp.key.name || headerProp.key.value;
              let headerValue = extractStringValue(headerProp.value, code);
              
              // Handle btoa in headers (for Basic Auth)
              if (headerProp.value.type === 'BinaryExpression' && 
                  headerProp.value.operator === '+' &&
                  headerProp.value.right.type === 'CallExpression' &&
                  headerProp.value.right.callee.name === 'btoa') {
                const authString = extractStringValue(headerProp.value.right.arguments[0], code);
                if (authString) {
                  try {
                    headerValue = 'Basic ' + Buffer.from(authString).toString('base64');
                  } catch (e) {
                    log(`⚠️ Failed to process btoa: ${e.message}`);
                  }
                }
              }
              
              if (headerName && headerValue) {
                headers[headerName] = headerValue;
              }
            }
          }
        } else if (prop.key?.name === 'contentType' || prop.key?.value === 'contentType') {
          if (prop.value.type === 'StringLiteral') {
            contentType = prop.value.value;
            headers['Content-Type'] = contentType;
          } else if (prop.value.type === 'BooleanLiteral' && !prop.value.value) {
            // Handle contentType: false
            headers['Content-Type'] = 'multipart/form-data';
          }
        } else if (prop.key?.name === 'data' || prop.key?.value === 'data') {
          if (prop.value.type === 'ObjectExpression') {
            data = extractObjectProperties(prop.value, code);
          } else if (prop.value.type === 'Identifier') {
            // Handle FormData
            const formDataVar = prop.value.name;
            const formData = formDataMap.get(formDataVar);
            if (formData) {
              data = formData.data;
              headers['Content-Type'] = 'multipart/form-data';
            }
          } else if (prop.value.type === 'CallExpression') {
            // Handle JSON.stringify
            if (prop.value.callee.type === 'MemberExpression' &&
                prop.value.callee.object.name === 'JSON' &&
                prop.value.callee.property.name === 'stringify') {
              const jsonBody = extractRequestBody(prop.value.arguments[0], code, ast);
              if (jsonBody !== null) {
                data = jsonBody;
                headers['Content-Type'] = 'application/json';
              }
            }
          }
        }
      }

      // Handle processData flag
      for (const prop of configObj.properties) {
        if (prop.key?.name === 'processData' || prop.key?.value === 'processData') {
          if (prop.value.type === 'BooleanLiteral' && !prop.value.value) {
            // If processData is false, keep the data as is (for FormData)
            headers['Content-Type'] = 'multipart/form-data';
          }
        }
      }
      
      // Handle query parameters for GET requests
      if (method === 'GET' && data && typeof data === 'object') {
        const queryString = Object.entries(data)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&');
        url += (url.includes('?') ? '&' : '?') + queryString;
        data = null; // Clear data since it's now in URL
      }

      // Ensure we have a valid URL
      if (!url) {
        log(`⚠️ Skipping jQuery AJAX request with no URL`);
        return null;
      }

      // Log the detected request details
      log(`🔍 Detected jQuery AJAX request: ${method} ${url}`);
      if (Object.keys(headers).length > 0) {
        log(`📋 Headers:`, JSON.stringify(headers, null, 2));
      }
      if (data) {
        log(`📦 Data:`, JSON.stringify(data, null, 2));
      }
      
      return { method, url, headers, data, source: 'jQuery.ajax' };
    } catch (err) {
      log(`⚠️ Error processing jQuery AJAX request: ${err.message}`);
      return null;
    }
  }
  return null;
}

// Update the processFile function to handle all request types
async function processFile(filePath) {
  log(`📁 Reading file: ${filePath}`);
  
  let code;
  try {
    code = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    error(`❌ Failed to read file: ${err.message}`);
    return;
  }

  // Skip if file is empty
  if (!code.trim()) {
    log(`⚠️ Skipping empty file: ${filePath}`);
    return;
  }

  let ast;
  try {
    ast = parser.parse(code, {
      sourceType: 'unambiguous',
      allowImportExportEverywhere: true,
      plugins: [
        'jsx',
        'typescript',
        'classProperties',
        'dynamicImport',
        'decorators-legacy',
        'objectRestSpread'
      ]
    });
  } catch (err) {
    // Skip files that can't be parsed as JavaScript
    log(`⚠️ Skipping non-JavaScript file: ${filePath}`);
    return;
  }

  let requestCount = 0;
  const foundRequests = [];
  urlVariables.clear();
  functionReturnValues.clear();
  urlPatterns.clear();
  headersVariables.clear();

  // Initialize tracking maps
  const xhrMap = new Map();
  const formDataMap = new Map();
  const urlSearchParamsMap = new Map();

  // First pass: collect instances and their method calls
  traverse(ast, {
    VariableDeclarator({ node }) {
      // Track XMLHttpRequest instances
      if (node.init && 
          node.init.type === 'NewExpression' && 
          node.init.callee.name === 'XMLHttpRequest') {
        xhrMap.set(node.id.name, { headers: {} });
        log(`📝 Found XMLHttpRequest instance: ${node.id.name}`);
      }
      // Track FormData instances
      if (node.init && 
          node.init.type === 'NewExpression' && 
          node.init.callee.name === 'FormData') {
        formDataMap.set(node.id.name, { data: {} });
        log(`📝 Found FormData instance: ${node.id.name}`);
      }
      // Track URLSearchParams instances
      if (node.init && 
          node.init.type === 'NewExpression' && 
          node.init.callee.name === 'URLSearchParams') {
        urlSearchParamsMap.set(node.id.name, { data: {} });
        log(`📝 Found URLSearchParams instance: ${node.id.name}`);
      }
      // Track URL instances
      if (node.init && 
          node.init.type === 'NewExpression' && 
          node.init.callee.name === 'URL') {
        const url = extractStringValue(node.init.arguments[0], code);
        if (url) {
          urlSearchParamsMap.set(node.id.name, { url, data: {} });
          log(`📝 Found URL instance: ${node.id.name} -> ${url}`);
        }
      }
    },
    CallExpression({ node }) {
      try {
        // Handle FormData.append()
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'append') {
          const formDataVar = node.callee.object.name;
          const formData = formDataMap.get(formDataVar);
          if (formData) {
            const key = extractStringValue(node.arguments[0], code);
            const value = extractStringValue(node.arguments[1], code);
            if (key && value) {
              formData.data[key] = value;
              log(`📝 Added FormData field: ${key}=${value} to ${formDataVar}`);
            }
          }
        }
        // Handle URLSearchParams.append()
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.name === 'append') {
          const paramsVar = node.callee.object.name;
          const params = urlSearchParamsMap.get(paramsVar);
          if (params) {
            const key = extractStringValue(node.arguments[0], code);
            const value = extractStringValue(node.arguments[1], code);
            if (key && value) {
              params.data[key] = value;
              log(`📝 Added URLSearchParams field: ${key}=${value} to ${paramsVar}`);
            }
          }
        }

        // Check for other request types
        const axiosRequest = handleAxiosCall(node, code, formDataMap);
        if (axiosRequest) {
          sendRequest(axiosRequest).then(response => {
            if (response) {
              log(`✅ [Axios] Axios request succeeded: ${axiosRequest.method} ${axiosRequest.url}`);
            } else {
              log(`❌ [Axios] Axios request failed: ${axiosRequest.method} ${axiosRequest.url}`);
            }
          });
          foundRequests.push(axiosRequest);
          requestCount++;
          return;
        }

        const jQueryRequest = handleJQueryAjaxCall(node, code, ast, formDataMap);
        if (jQueryRequest) {
          sendRequest(jQueryRequest).then(response => {
            if (response) {
              log(`✅ [jQuery] AJAX request succeeded: ${jQueryRequest.method} ${jQueryRequest.url}`);
            } else {
              log(`❌ [jQuery] AJAX request failed: ${jQueryRequest.method} ${jQueryRequest.url}`);
            }
          });
          foundRequests.push(jQueryRequest);
          requestCount++;
          return;
        }

        const callee = node.callee;
        let request = null;

        // Debug logging for all call expressions
        if (!SILENT) {
          log(`🔍 Processing call expression:`, {
            type: callee.type,
            name: callee.name,
            object: callee.object?.name,
            property: callee.property?.name,
            arguments: node.arguments.map(arg => ({
              type: arg.type,
              value: arg.value,
              name: arg.name
            }))
          });
        }

        // Handle XMLHttpRequest
        if (callee.type === 'MemberExpression' &&
            callee.object.type === 'Identifier') {
          const xhrName = callee.object.name;
          const xhrObj = xhrMap.get(xhrName);
          if (xhrObj) {
            const methodName = callee.property.name;
            if (methodName === 'open') {
              xhrObj.method = extractStringValue(node.arguments[0], code) || 'GET';
              xhrObj.url = extractStringValue(node.arguments[1], code);
              log(`📝 XMLHttpRequest ${xhrName} opened: ${xhrObj.method} ${xhrObj.url}`);
            } else if (methodName === 'setRequestHeader') {
              const headerName = extractStringValue(node.arguments[0], code);
              const headerValue = extractStringValue(node.arguments[1], code);
              if (headerName && headerValue) {
                xhrObj.headers[headerName] = headerValue;
                log(`📝 Added header to ${xhrName}: ${headerName}=${headerValue}`);
              }
            } else if (methodName === 'send') {
              // Extract body if present
              if (node.arguments.length > 0) {
                const body = extractRequestBody(node.arguments[0], code, ast);
                if (body !== null) {
                  xhrObj.body = body;
                  // If Content-Type is application/json and body is a string, try to parse it
                  if (xhrObj.headers['Content-Type'] === 'application/json' && typeof body === 'string') {
                    try {
                      xhrObj.body = JSON.parse(body);
                    } catch (e) {
                      // Keep as string if parsing fails
                    }
                  }
                }
              }
              // Now, push the reconstructed request
              request = {
                method: xhrObj.method || 'GET',
                url: xhrObj.url,
                headers: xhrObj.headers,
                data: xhrObj.body,
                source: 'XMLHttpRequest'
              };
              log(`✅ Found XMLHttpRequest: ${request.method} ${request.url}`);
              if (Object.keys(request.headers).length > 0) {
                log(`📋 Headers:`, JSON.stringify(request.headers, null, 2));
              }
              if (request.data) {
                log(`📦 Data:`, JSON.stringify(request.data, null, 2));
              }
              foundRequests.push(request);
              requestCount++;
            }
          }
        }
        // Handle fetch requests
        else if (callee.type === 'Identifier' && callee.name === 'fetch') {
          log(`🔎 Processing fetch() call`);
          let url = extractStringValue(node.arguments[0], code);
          
          if (!url) return;

          const options = node.arguments[1] ? extractObjectProperties(node.arguments[1], code) : {};
          
          // Handle FormData in fetch body
          if (node.arguments[1] && node.arguments[1].type === 'ObjectExpression') {
            const bodyProp = node.arguments[1].properties.find(p => 
              (p.key?.name === 'body' || p.key?.value === 'body')
            );
            
            if (bodyProp) {
              // Handle FormData
              if (bodyProp.value.type === 'Identifier') {
                const formDataVar = bodyProp.value.name;
                const formData = formDataMap.get(formDataVar);
                if (formData) {
                  options.body = formData.data;
                  options.headers = {
                    ...options.headers,
                    'Content-Type': 'multipart/form-data'
                  };
                }
              }
              
              // Handle URLSearchParams
              if (bodyProp.value.type === 'Identifier') {
                const paramsVar = bodyProp.value.name;
                const params = urlSearchParamsMap.get(paramsVar);
                if (params) {
                  options.body = params.data;
                  options.headers = {
                    ...options.headers,
                    'Content-Type': 'application/x-www-form-urlencoded'
                  };
                }
              }
              
              // Handle JSON.stringify
              if (bodyProp.value.type === 'CallExpression' &&
                  bodyProp.value.callee.type === 'MemberExpression' &&
                  bodyProp.value.callee.object.name === 'JSON' &&
                  bodyProp.value.callee.property.name === 'stringify') {
                const jsonBody = extractRequestBody(bodyProp.value.arguments[0], code, ast);
                if (jsonBody !== null) {
                  options.body = jsonBody;
                  options.headers = {
                    ...options.headers,
                    'Content-Type': 'application/json'
                  };
                }
              }
            }
          }
          
          // Enhanced header extraction for fetch
          if (node.arguments[1]) {
            const optionsNode = node.arguments[1];
            if (optionsNode.type === 'ObjectExpression') {
              const headersProp = optionsNode.properties.find(p => 
                (p.key?.name === 'headers' || p.key?.value === 'headers')
              );
              if (headersProp) {
                const extractedHeaders = extractHeaders(headersProp.value, code);
                options.headers = { ...options.headers, ...extractedHeaders };
                log(`📋 Extracted headers from fetch options:`, JSON.stringify(extractedHeaders, null, 2));
              }
            }
          }
          
          request = processHttpRequest(node, options.method || 'GET', url, options, 'fetch()', code);
          if (request) {
            log(`✅ Found fetch request: ${request.method} ${request.url}`);
            if (Object.keys(request.headers).length > 0) {
              log(`📋 Headers:`, JSON.stringify(request.headers, null, 2));
            }
            if (request.data) {
              log(`📦 Data:`, JSON.stringify(request.data, null, 2));
            }
            foundRequests.push(request);
            requestCount++;
          }
        }
      } catch (err) {
        log(`⚠️ Error processing call expression: ${err.message}`);
      }
    }
  });

  log(`\n📊 Found ${requestCount} HTTP requests in ${path.basename(filePath)}`);
  
  // Send requests with staggered timing
  if (foundRequests.length > 0) {
    await sendAllRequests(foundRequests);
  }
}

async function sendAllRequests(requests) {
  if (!limit) {
    error('❌ Error: pLimit not initialized');
    return;
  }

  const results = await Promise.allSettled(
    requests.map(req => limit(() => sendRequest(req)))
  );
  
  // Print summary of results
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      log(`Request #${i + 1} succeeded`);
    } else {
      error(`Request #${i + 1} failed: ${result.reason}`);
    }
  });
}

function findVariableDeclaration(varName, ast) {
  let declaration = null;
  traverse(ast, {
    VariableDeclarator(path) {
      if (path.node.id.name === varName) {
        declaration = path.node;
        path.stop();
      }
    }
  });
  return declaration;
}

function showUsage() {
  console.log('HTTP Request Analyzer');
  console.log('Usage: node analyze.js [options] <path-to-file>');
  console.log('Options:');
  console.log('  --silent          Suppress output messages');
  console.log('  --proxy <url>     Set proxy address (default: http://127.0.0.1:8080)');
}

// Add directory traversal functionality
async function processDirectory(dirPath) {
  log(`📁 Processing directory: ${dirPath}`);
  
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Recursively process subdirectories
        await processDirectory(fullPath);
      } else if (stat.isFile()) {
        // Process all files, not just .js files
        log(`\n🔍 Processing file: ${fullPath}`);
        try {
          await processFile(fullPath);
        } catch (err) {
          error(`❌ Error processing file ${fullPath}: ${err.message}`);
          // Continue with next file even if one fails
          continue;
        }
      }
    }
  } catch (err) {
    error(`❌ Error processing directory ${dirPath}: ${err.message}`);
  }
}

// Update the main function to handle both files and directories
async function main() {
  try {
    // Initialize p-limit
    const pLimitModule = await import('p-limit');
    limit = pLimitModule.default(CONCURRENCY);

    const args = parseArguments();
    if (!args) return;

    if (args.help) {
      showUsage();
      return;
    }

    if (args.silent) {
      SILENT = true;
    }

    if (args.proxy) {
      const [host, port] = args.proxy.split(':');
      if (!host || !port) {
        error('❌ Invalid proxy format. Use host:port');
        return;
      }
      BURP_PROXY = `http://${host}:${port}`;
      log(`🔧 Using proxy: ${BURP_PROXY}`);
    }

    // Initialize proxy agents
    initializeProxyAgents();

    if (args.target) {
      const targetPath = args.target;
      try {
        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
          // Process directory and its subdirectories
          await processDirectory(targetPath);
        } else if (stat.isFile()) {
          // Process single file
          await processFile(targetPath);
        } else {
          error(`❌ Invalid path: ${targetPath}`);
        }
      } catch (err) {
        error(`❌ Error accessing path ${targetPath}: ${err.message}`);
      }
    } else {
      error('❌ No target file or directory specified');
      showUsage();
    }
  } catch (err) {
    error('💥 Error:', err.message);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  log('\n👋 Exiting...');
  process.exit(0);
});

// Start the program
main().catch(err => {
  error('💥 Error:', err);
  process.exit(1);
});