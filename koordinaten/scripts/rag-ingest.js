/* global process */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(process.cwd());
const ENV_PATH = path.join(ROOT, '.env.local');
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.log']);
const DEFAULT_SOURCE_TABLE = 'rag_docs';
const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_CHUNK_OVERLAP = 180;
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) return;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^"|"$/g, '');
    if (!process.env[key]) process.env[key] = value;
  });
};

const parseArgs = (argv = []) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const ensureHttpUrl = (value, fallback) => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (raw.startsWith('/')) return fallback;
  return raw.replace(/\/+$/, '');
};

const resolveSupabaseUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace('host.docker.internal', '127.0.0.1');
};

const normalizeText = (input) => String(input || '')
  .replace(/\u0000/g, ' ')
  .replace(/\r/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const toSourceIdBase = (filePath) => String(filePath || '')
  .replace(/\\/g, '/')
  .replace(/[^a-zA-Z0-9/_\-\.]/g, '_');

const collectFilesRecursively = (dirPath, out = []) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  entries.forEach((entry) => {
    if (entry.name.startsWith('.')) return;
    const absolute = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursively(absolute, out);
      return;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return;
    out.push(absolute);
  });
  return out;
};

const splitIntoChunks = (text, chunkSize, overlap) => {
  const safeText = normalizeText(text);
  if (!safeText) return [];
  if (safeText.length <= chunkSize) return [safeText];

  const chunks = [];
  let start = 0;
  while (start < safeText.length) {
    let end = Math.min(start + chunkSize, safeText.length);
    if (end < safeText.length) {
      const nearBreak = safeText.lastIndexOf('\n', end);
      if (nearBreak > start + Math.floor(chunkSize * 0.45)) {
        end = nearBreak;
      }
    }
    const chunk = safeText.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= safeText.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
};

const createEmbedding = async ({ ollamaUrl, model, text }) => {
  const response = await fetch(`${ollamaUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Ollama embedding request failed (${response.status})`);
  }
  const embedding = data?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Ollama returned no embedding values.');
  }
  return embedding;
};

const toPgVectorLiteral = (embedding) => `[${embedding.map((value) => Number(value) || 0).join(',')}]`;

const main = async () => {
  loadEnvFile(ENV_PATH);

  const cli = parseArgs(process.argv.slice(2));
  const docsDir = path.resolve(ROOT, cli.dir || 'rag-docs');
  const sourceTable = String(cli.source || DEFAULT_SOURCE_TABLE).trim() || DEFAULT_SOURCE_TABLE;
  const chunkSize = toPositiveInt(cli.chunk, DEFAULT_CHUNK_SIZE);
  const chunkOverlap = toPositiveInt(cli.overlap, DEFAULT_CHUNK_OVERLAP);
  const ollamaUrl = ensureHttpUrl(
    cli.ollama || process.env.OLLAMA_URL || process.env.VITE_OLLAMA_URL,
    DEFAULT_OLLAMA_URL,
  );
  const embedModel = String(
    cli.model
    || process.env.OLLAMA_EMBED_MODEL
    || process.env.VITE_OLLAMA_EMBED_MODEL
    || DEFAULT_EMBED_MODEL,
  ).trim();

  const supabaseUrl = resolveSupabaseUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  }

  if (!fs.existsSync(docsDir)) {
    throw new Error(`RAG docs directory not found: ${docsDir}`);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const files = collectFilesRecursively(docsDir);
  if (files.length === 0) {
    console.log(`No supported files found in ${docsDir}.`);
    return;
  }

  console.log(`RAG ingest started. files=${files.length} source_table=${sourceTable} model=${embedModel}`);
  let fileCount = 0;
  let chunkCount = 0;
  let failedFiles = 0;

  for (const absoluteFilePath of files) {
    const relativePath = path.relative(ROOT, absoluteFilePath);
    const sourceIdBase = toSourceIdBase(relativePath);
    try {
      const raw = fs.readFileSync(absoluteFilePath, 'utf8');
      const chunks = splitIntoChunks(raw, chunkSize, chunkOverlap);
      if (chunks.length === 0) {
        console.log(`skip empty file ${relativePath}`);
        continue;
      }

      const { error: deleteError } = await supabase
        .from('ai_documents')
        .delete()
        .eq('source_table', sourceTable)
        .like('source_id', `${sourceIdBase}#%`);
      if (deleteError) throw deleteError;

      const rows = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const content = chunks[index];
        const embedding = await createEmbedding({ ollamaUrl, model: embedModel, text: content });
        rows.push({
          source_table: sourceTable,
          source_id: `${sourceIdBase}#${index + 1}`,
          content,
          embedding: toPgVectorLiteral(embedding),
          meta: {
            path: relativePath.replace(/\\/g, '/'),
            chunk_index: index + 1,
            chunk_count: chunks.length,
            embedded_with: embedModel,
          },
        });
      }

      const { error: upsertError } = await supabase
        .from('ai_documents')
        .upsert(rows, { onConflict: 'source_table,source_id' });
      if (upsertError) throw upsertError;

      fileCount += 1;
      chunkCount += rows.length;
      console.log(`ok ${relativePath} chunks=${rows.length}`);
    } catch (error) {
      failedFiles += 1;
      console.error(`failed ${relativePath}: ${error?.message || 'unknown error'}`);
    }
  }

  console.log(`RAG ingest finished. files_ok=${fileCount} files_failed=${failedFiles} chunks=${chunkCount}`);
  if (failedFiles > 0) process.exitCode = 1;
};

main().catch((error) => {
  console.error(`RAG ingest aborted: ${error?.message || 'unknown error'}`);
  process.exit(1);
});
