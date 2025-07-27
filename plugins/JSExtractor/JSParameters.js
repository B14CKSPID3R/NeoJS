const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const PARAM_KEYS = new Set();
const JS_TS_EXT = ['.js', '.jsx', '.ts', '.tsx'];
const KNOWN_URL_FUNCS = new Set([
  'fetch', 'axios', 'get', 'post', 'put', 'delete',
  'XMLHttpRequest.open',
  'window.open', 'location.assign', 'location.replace',
  'open', 'Image', 'Script', 'import', 'load',
]);

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

function extractParamsFromURL(str) {
  const matches = [...str.matchAll(/[?&]([a-zA-Z0-9_-]+)=/g)];
  for (const m of matches) PARAM_KEYS.add(m[1]);
}

function extractParamsFromArgument(arg) {
  if (!arg) return;
  if (arg.type === 'StringLiteral') extractParamsFromURL(arg.value);
  else if (arg.type === 'TemplateLiteral') {
    const raw = arg.quasis.map(q => q.value.raw).join('');
    extractParamsFromURL(raw);
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

function extractGraphQLVariables(arg) {
  if (!arg) return;
  if (arg.type === 'ObjectExpression') {
    arg.properties.forEach(p => {
      if (p.type === 'ObjectProperty' && p.key.type === 'Identifier') {
        PARAM_KEYS.add(p.key.name);
      }
    });
  }
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

        if (callee.type === 'Identifier' && KNOWN_URL_FUNCS.has(callee.name)) {
          extractParamsFromArgument(args[0]);
          if (callee.name === 'fetch' && args[1]) extractGraphQLVariables(args[1]);
        }

        if (callee.type === 'MemberExpression') {
          const method = `${getObjectName(callee)}.${callee.property.name}`;
          if (KNOWN_URL_FUNCS.has(method)) {
            extractParamsFromArgument(args[0]);
          }
        }
      },

      NewExpression(path) {
        const { callee, arguments: args } = path.node;
        if (callee.type === 'Identifier' && KNOWN_URL_FUNCS.has(callee.name)) {
          extractParamsFromArgument(args[0]);
        }
      },

      AssignmentExpression(path) {
        const { left, right } = path.node;
        if (left.type === 'MemberExpression') {
          const prop = left.property.name;
          if (['href', 'src'].includes(prop)) {
            extractParamsFromArgument(right);
          }
        }
      }
    });

    const matches = [...content.matchAll(/(?:https?:\/\/[^\s"'`<>]+|\b[a-zA-Z]+=[^&\s"'`<>]+)/g)];
    for (const m of matches) extractParamsFromURL(m[0]);

  } catch (e) {
    // Silent fail
  }
}

function printUsageAndExit() {
  console.error('Usage:\n  node analyze.js --file <filepath>\n  node analyze.js --directory <dirpath>');
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

  console.log(JSON.stringify([...PARAM_KEYS], null, 2));
}

main();
