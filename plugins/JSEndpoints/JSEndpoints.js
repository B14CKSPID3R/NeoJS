const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const JS_TS_EXT = ['.js', '.jsx', '.ts', '.tsx'];
const FOUND_ENDPOINTS = new Set();

const ENDPOINT_FUNCS = new Set([
  'fetch', 'axios', 'get', 'post', 'put', 'delete',
  'XMLHttpRequest.open', 'open',
  '$.get', '$.post', '$.ajax',
  'this.$http.get', 'this.$http.post',
  'http.get', 'http.post', 'http.fetch',
  'api.get', 'api.post', 'api.fetch',
  'window.open', 'location.assign', 'location.replace',
  'router.push', 'router.replace',
  'Image', 'import'
]);

const FALSE_POSITIVE_PATTERNS = [
  /^\/[^\/]{0,2}[;:]/,
  /this\.blockSize/i,
  /Math\.(LN2|PI)/i,
  /return$/,
  /=\d+;?$/,
  /var\s/i,
  /for\s*\(/i,
  /function/i,
  /<\d+/,
  />>>?\d*/,
  /\/vnd\.*/,
  /\/prs\.*/,
  /\/*[=<>]+/,
  /writeUInt/, /read/, /props/, /slidesTo/, /_block/
];

function getAllFiles(dirPath, arrayOfFiles = []) {
  fs.readdirSync(dirPath).forEach(file => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else if (JS_TS_EXT.includes(path.extname(file))) {
      arrayOfFiles.push(fullPath);
    }
  });
  return arrayOfFiles;
}

function isProbablyEndpoint(url) {
  if (!url || typeof url !== 'string') return false;
  const lowered = url.toLowerCase();
  if (lowered.match(/^\/?[a-zA-Z0-9_\-]+$/)) return false;
  if (lowered.length < 5) return false;
  if (/\.(js|png|css|svg|map)$/.test(lowered)) return false;
  if (!/[\/]/.test(url)) return false;
  for (const pattern of FALSE_POSITIVE_PATTERNS) {
    if (pattern.test(url)) return false;
  }
  return true;
}

function extractEndpointsFromString(str) {
  const matches = [...str.matchAll(/https?:\/\/[\w\d:#@%/;$()~_?+=\\.&-]+|\/[\w\d_\/-?=&%.:;]+/g)];
  for (const m of matches) {
    if (isProbablyEndpoint(m[0])) FOUND_ENDPOINTS.add(m[0]);
  }
}

function extractEndpointsFromArgument(arg) {
  if (!arg) return;
  if (arg.type === 'StringLiteral') extractEndpointsFromString(arg.value);
  else if (arg.type === 'TemplateLiteral') {
    const raw = arg.quasis.map(q => q.value.raw).join('');
    extractEndpointsFromString(raw);
  }
}

function getObjectName(memberExpr) {
  if (memberExpr.object.type === 'Identifier') {
    return memberExpr.object.name;
  } else if (memberExpr.object.type === 'MemberExpression') {
    return `${getObjectName(memberExpr.object)}.${memberExpr.property.name}`;
  }
  return '';
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    const ast = parser.parse(content, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript', 'classProperties', 'optionalChaining', 'objectRestSpread']
    });

    traverse(ast, {
      CallExpression(path) {
        const { callee, arguments: args } = path.node;

        if (callee.type === 'Identifier' && ENDPOINT_FUNCS.has(callee.name)) {
          extractEndpointsFromArgument(args[0]);
        }

        if (callee.type === 'MemberExpression') {
          const method = `${getObjectName(callee)}.${callee.property.name}`;
          if (ENDPOINT_FUNCS.has(method)) {
            extractEndpointsFromArgument(args[0]);
          }
        }
      },

      NewExpression(path) {
        const { callee, arguments: args } = path.node;
        if (callee.type === 'Identifier' && ENDPOINT_FUNCS.has(callee.name)) {
          extractEndpointsFromArgument(args[0]);
        }
      },

      AssignmentExpression(path) {
        const { left, right } = path.node;
        if (left.type === 'MemberExpression') {
          const prop = left.property.name;
          if (['href', 'src'].includes(prop)) {
            extractEndpointsFromArgument(right);
          }
        }
      }
    });

    // Fallback regex scan for hardcoded or obfuscated URLs
    extractEndpointsFromString(content);
  } catch (e) {
    // Silent fail
  }
}

function printUsageAndExit() {
  console.error('Usage:\n  node JSEndpoints.js --file <filepath>\n  node JSEndpoints.js --directory <dirpath>');
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    printUsageAndExit();
  }

  const mode = args[0];
  const targetPath = args[1];

  if (!fs.existsSync(targetPath)) {
    console.error(`Error: Path "${targetPath}" does not exist.`);
    process.exit(1);
  }

  if (mode === '--file') {
    if (!JS_TS_EXT.includes(path.extname(targetPath))) {
      console.error('Error: Unsupported file type. Only JS/TS files are allowed.');
      process.exit(1);
    }
    analyzeFile(targetPath);
  } else if (mode === '--directory') {
    const files = getAllFiles(targetPath);
    for (const file of files) analyzeFile(file);
  } else {
    printUsageAndExit();
  }

  console.log(JSON.stringify([...FOUND_ENDPOINTS], null, 2));
}

main();