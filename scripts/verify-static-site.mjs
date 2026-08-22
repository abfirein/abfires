import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const htmlFiles = (await readdir(root))
  .filter((file) => file.endsWith('.html') && !file.startsWith('google'));

function report(file, message) {
  errors.push(`${path.relative(root, file)}: ${message}`);
}

function isLocalReference(value) {
  return value && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value);
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function verifyReference(sourceFile, reference) {
  const target = reference.split(/[?#]/, 1)[0];
  if (!isLocalReference(target) || target === '') return;

  const resolved = path.resolve(path.dirname(sourceFile), target);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    report(sourceFile, `reference escapes the project: ${reference}`);
  } else if (!(await fileExists(resolved))) {
    report(sourceFile, `missing local file: ${reference}`);
  }
}

for (const name of htmlFiles) {
  const file = path.join(root, name);
  const source = (await readFile(file, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');

  if (!/^<!doctype html>/i.test(source.trim())) {
    report(file, 'missing HTML doctype');
  }

  for (const match of source.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    await verifyReference(file, match[1]);
  }

  for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    await verifyReference(file, match[1]);
  }

  const ids = new Set([...source.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]));
  for (const match of source.matchAll(/data-bs-target\s*=\s*["']#([^"']+)["']/gi)) {
    if (!ids.has(match[1])) report(file, `missing Bootstrap target: #${match[1]}`);
  }
}

for (const name of ['css/style.css']) {
  const file = path.join(root, name);
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    await verifyReference(file, match[1]);
  }
}

if (errors.length > 0) {
  console.error(`Static site verification failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(`Static site verification passed for ${htmlFiles.length} pages.`);
}
