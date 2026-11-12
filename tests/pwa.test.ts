// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Construit l'app dans un dossier temporaire (n'écrase pas dist/) puis inspecte le résultat.
const out = mkdtempSync(join(tmpdir(), 'lecteur-pwa-'));
const read = (f: string) => readFileSync(join(out, f), 'utf8');

beforeAll(() => {
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir'], { stdio: 'pipe' });
}, 170_000);

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('PWA (build)', () => {
  it('produit un manifeste conforme', () => {
    const m = JSON.parse(read('manifest.webmanifest'));
    expect(m.name).toBe('Lecteur de notes');
    expect(m.short_name).toBe('Notes audio');
    expect(m.lang).toBe('fr');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('/Lecteur-note-audio/');
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect(existsSync(join(out, i.src.replace('/Lecteur-note-audio/', '')))).toBe(true);
  });

  it('produit un service worker qui précache l’app sans les gros fichiers WASM', () => {
    expect(existsSync(join(out, 'sw.js'))).toBe(true);
    const sw = read('sw.js');
    expect(sw).toContain('index.html');
    expect(sw).not.toContain('huggingface');
    expect(sw).not.toMatch(/ort-wasm[^"']*\.wasm/);
    expect(sw).not.toMatch(/piper_phonemize[^"']*\.(wasm|data)/);
    expect(sw).toMatch(/tts\.worker-[^"']*\.js/);
  });

  it('n’embarque plus la variante ORT non-SIMD', () => {
    const wasm = readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.wasm'));
    expect(wasm.some((f) => f.startsWith('ort-wasm-simd'))).toBe(true);
    expect(wasm.some((f) => /^ort-wasm-[A-Za-z0-9_-]+\.wasm$/.test(f) && !f.startsWith('ort-wasm-simd'))).toBe(false);
  });

  it('index.html déclare icône Apple et couleur de thème', () => {
    const html = read('index.html');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('theme-color');
    expect(html).toContain('manifest.webmanifest');
  });
});
