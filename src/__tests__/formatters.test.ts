import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, fmtShort, fmtGap, pctDelta, cagr, htmlEscape } from '../digest/formatters.js';
import { resolveVars, resolveParams } from '../engine/template-loader.js';
import type { FlowTemplate } from '../engine/template-loader.js';

// ── fmt ──────────────────────────────────────────────────────────────

describe('fmt', () => {
  it('formats zero as em dash', () => assert.equal(fmt(0), '—'));
  it('formats small positive values', () => assert.equal(fmt(500), '$500'));
  it('rounds thousands', () => assert.equal(fmt(1_500), '$2K'));
  it('formats exact thousands', () => assert.equal(fmt(1_000), '$1K'));
  it('formats millions to 2dp', () => assert.equal(fmt(1_500_000), '$1.50M'));
  it('handles negative thousands', () => assert.equal(fmt(-2_000), '$-2K'));
  it('handles negative millions', () => assert.equal(fmt(-1_500_000), '$-1.50M'));
});

// ── fmtShort ─────────────────────────────────────────────────────────

describe('fmtShort', () => {
  it('formats zero as em dash', () => assert.equal(fmtShort(0), '—'));
  it('formats millions to 1dp', () => assert.equal(fmtShort(1_500_000), '$1.5M'));
  it('rounds thousands', () => assert.equal(fmtShort(1_500), '$2K'));
  it('formats small values verbatim', () => assert.equal(fmtShort(999), '$999'));
});

// ── fmtGap ───────────────────────────────────────────────────────────

describe('fmtGap', () => {
  it('prefixes positive with +$', () => assert.equal(fmtGap(5_000), '+$5K'));
  it('prefixes negative with -$', () => assert.equal(fmtGap(-5_000), '-$5K'));
  it('formats zero gap as +$0', () => assert.equal(fmtGap(0), '+$0'));
  it('handles millions positive', () => assert.equal(fmtGap(2_000_000), '+$2.00M'));
  it('handles millions negative', () => assert.equal(fmtGap(-2_000_000), '-$2.00M'));
});

// ── pctDelta ─────────────────────────────────────────────────────────

describe('pctDelta', () => {
  it('returns empty string when prev is 0', () => assert.equal(pctDelta(100, 0), ''));
  it('calculates positive delta', () => assert.equal(pctDelta(110, 100), '+10%'));
  it('calculates negative delta', () => assert.equal(pctDelta(90, 100), '-10%'));
  it('rounds fractional percentages', () => assert.equal(pctDelta(101, 100), '+1%'));
  it('returns +0% for identical values', () => assert.equal(pctDelta(100, 100), '+0%'));
});

// ── cagr ─────────────────────────────────────────────────────────────

describe('cagr', () => {
  it('returns em dash for zero earliest', () => assert.equal(cagr(100, 0, 3), '—'));
  it('returns em dash for zero latest', () => assert.equal(cagr(0, 100, 3), '—'));
  it('returns em dash for zero years', () => assert.equal(cagr(100, 100, 0), '—'));
  it('calculates ~26% CAGR (2x over 3 years)', () => assert.equal(cagr(200, 100, 3), '+26%'));
  it('calculates negative CAGR', () => assert.equal(cagr(50, 100, 3), '-21%'));
});

// ── htmlEscape ───────────────────────────────────────────────────────

describe('htmlEscape', () => {
  it('escapes ampersand', () => assert.equal(htmlEscape('A & B'), 'A &amp; B'));
  it('escapes less-than', () => assert.equal(htmlEscape('<script>'), '&lt;script&gt;'));
  it('escapes double quotes', () => assert.equal(htmlEscape('"quoted"'), '&quot;quoted&quot;'));
  it('escapes single quotes', () => assert.equal(htmlEscape("it's"), 'it&#39;s'));
  it('leaves safe strings unchanged', () => assert.equal(htmlEscape('Acme Corp'), 'Acme Corp'));
  it('handles all special chars together', () =>
    assert.equal(htmlEscape('<a href="x">it\'s & fun</a>'), '&lt;a href=&quot;x&quot;&gt;it&#39;s &amp; fun&lt;/a&gt;'));
});

// ── resolveVars ──────────────────────────────────────────────────────

describe('resolveVars', () => {
  it('replaces a simple placeholder', () =>
    assert.equal(resolveVars('Hello {{name}}', { name: 'World' }), 'Hello World'));

  it('replaces a nested placeholder', () =>
    assert.equal(resolveVars('{{a.b}}', { a: { b: 'deep' } }), 'deep'));

  it('leaves unknown placeholders unchanged', () =>
    assert.equal(resolveVars('{{missing}}', {}), '{{missing}}'));

  it('leaves null-valued placeholders unchanged', () =>
    assert.equal(resolveVars('{{x}}', { x: null }), '{{x}}'));

  it('replaces multiple placeholders', () =>
    assert.equal(resolveVars('{{a}}-{{b}}', { a: '1', b: '2' }), '1-2'));

  it('coerces numbers to strings', () =>
    assert.equal(resolveVars('{{n}}', { n: 42 }), '42'));
});

// ── resolveParams ────────────────────────────────────────────────────

describe('resolveParams', () => {
  const template: FlowTemplate = {
    id: 'test',
    version: '1.0',
    name: 'Test',
    description: '',
    parameters: [
      { name: 'schedule', type: 'string', label: 'Schedule', default: '0 9 * * 1-5' },
      { name: 'channels', type: 'array',  label: 'Channels', default: ['slack'] },
      { name: 'limit',    type: 'number', label: 'Limit' },   // no default
    ],
    data_source: { type: 'supabase' },
    channels: {},
    runtime: { engine: 'digest', entrypoint: '' },
  };

  it('uses defaults when no overrides provided', () => {
    const params = resolveParams(template, {});
    assert.equal(params['schedule'], '0 9 * * 1-5');
    assert.deepEqual(params['channels'], ['slack']);
  });

  it('overrides take precedence over defaults', () => {
    const params = resolveParams(template, { schedule: '0 8 * * *' });
    assert.equal(params['schedule'], '0 8 * * *');
  });

  it('parameters with no default and no override are undefined', () => {
    const params = resolveParams(template, {});
    assert.equal(params['limit'], undefined);
  });

  it('only resolves declared parameters (ignores unknown overrides)', () => {
    const params = resolveParams(template, { unknown_key: 'ignored' });
    assert.equal(params['unknown_key'], undefined);
  });
});
