import JavaScriptObfuscator from 'javascript-obfuscator';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env.NODE_ENV !== 'production') {
  console.log('[build] Skipping obfuscation (not production)');
  process.exit(0);
}

const src = path.join(__dirname, 'public', 'app-tool.js');
const code = fs.readFileSync(src, 'utf8');

const result = JavaScriptObfuscator.obfuscate(code, {
  compact: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.8,
  rotateStringArray: true,
  shuffleStringArray: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  disableConsoleOutput: false,
});

fs.writeFileSync(src, result.getObfuscatedCode());
console.log('[build] app-tool.js obfuscated successfully');
