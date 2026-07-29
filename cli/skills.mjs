// Serves versioned docs from skill-data/ so instructions always match the
// installed CLI. Same contract as `agent-browser skills get core --full`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'skill-data');

export function listSkills() {
  if (!fs.existsSync(DATA)) return [];
  return fs.readdirSync(DATA).filter(d => fs.statSync(path.join(DATA, d)).isDirectory());
}

export function getSkill(topic, full) {
  const dir = path.join(DATA, topic);
  const main = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(main)) {
    const err = new Error(`unknown skill "${topic}". available: ${listSkills().join(', ') || '(none)'}`);
    err.code = 'EUSAGE';
    throw err;
  }
  let out = fs.readFileSync(main, 'utf8');

  const refs = path.join(dir, 'references');
  if (full && fs.existsSync(refs)) {
    for (const f of fs.readdirSync(refs).sort()) {
      out += `\n\n<!-- references/${f} -->\n\n` + fs.readFileSync(path.join(refs, f), 'utf8');
    }
  } else if (fs.existsSync(refs)) {
    out += `\n\nMore: \`agent-hands skills get ${topic} --full\` adds ` +
      fs.readdirSync(refs).sort().map(f => f.replace(/\.md$/, '')).join(', ') + '.\n';
  }
  return out;
}
