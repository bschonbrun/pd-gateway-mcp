import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Templates live at repo_root/templates/ — resolve relative to cwd or via env override
const TEMPLATES_DIR = process.env['TEMPLATES_DIR'] || resolve(process.cwd(), 'templates');

// ── Types ────────────────────────────────────────────────────────────

export interface TemplateParameter {
  name: string;
  type: string;
  label: string;
  description?: string;
  default?: unknown;
  options?: string[];
}

export interface FlowTemplate {
  id: string;
  version: string;
  name: string;
  description: string;
  parameters: TemplateParameter[];
  data_source: {
    type: string;
    function?: string;
    query?: string;
    connection?: string;
    args?: Record<string, unknown>;
  };
  channels: Record<string, unknown>;
  runtime: {
    engine: string;
    entrypoint: string;
    notes?: string;
  };
}

export interface TemplateSummary {
  id: string;
  version: string;
  name: string;
  description: string;
  parameters: Array<{ name: string; label: string; type: string; default?: unknown }>;
  available_channels: string[];
}

// ── Loader ───────────────────────────────────────────────────────────

export async function listTemplates(): Promise<TemplateSummary[]> {
  const files = await readdir(TEMPLATES_DIR).catch(() => []);
  const summaries: TemplateSummary[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const tpl = await loadTemplateFromFile(join(TEMPLATES_DIR, file));
      summaries.push({
        id: tpl.id,
        version: tpl.version,
        name: tpl.name,
        description: tpl.description,
        parameters: tpl.parameters.map(p => ({
          name: p.name, label: p.label, type: p.type, default: p.default,
        })),
        available_channels: Object.keys(tpl.channels),
      });
    } catch {
      // Skip invalid templates
    }
  }

  return summaries;
}

export async function loadTemplate(templateId: string): Promise<FlowTemplate> {
  const filePath = join(TEMPLATES_DIR, `${templateId}.json`);
  return loadTemplateFromFile(filePath);
}

async function loadTemplateFromFile(filePath: string): Promise<FlowTemplate> {
  const raw = await readFile(filePath, 'utf-8');
  const data = JSON.parse(raw);
  validate(data);
  return data as FlowTemplate;
}

function validate(data: unknown): asserts data is FlowTemplate {
  const t = data as Record<string, unknown>;
  if (!t.id || typeof t.id !== 'string') throw new Error('Template missing "id"');
  if (!t.name || typeof t.name !== 'string') throw new Error('Template missing "name"');
  if (!t.version || typeof t.version !== 'string') throw new Error('Template missing "version"');
  if (!Array.isArray(t.parameters)) throw new Error('Template missing "parameters" array');
  if (!t.data_source || typeof t.data_source !== 'object') throw new Error('Template missing "data_source"');
  if (!t.channels || typeof t.channels !== 'object') throw new Error('Template missing "channels"');
  if (!t.runtime || typeof t.runtime !== 'object') throw new Error('Template missing "runtime"');
}

// ── Variable Resolution ──────────────────────────────────────────────

export function resolveParams(
  template: FlowTemplate,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const param of template.parameters) {
    resolved[param.name] = overrides[param.name] ?? param.default;
  }

  return resolved;
}

export function resolveVars(input: string, context: Record<string, unknown>): string {
  return input.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const parts = path.split('.');
    let value: unknown = context;
    for (const part of parts) {
      if (value == null || typeof value !== 'object') return _match;
      value = (value as Record<string, unknown>)[part];
    }
    if (value == null) return _match;
    return String(value);
  });
}
