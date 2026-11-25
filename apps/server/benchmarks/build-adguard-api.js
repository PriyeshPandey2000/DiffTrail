import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { candidates } from './candidates.js';
import { root } from './config.js';

const require = createRequire(import.meta.url);
const source = candidates.adguard.directory;
const runtime = process.argv.includes('--runtime');
const output = resolve(root, runtime ? '.cache/adguard-runtime/extension' : '.cache/adguard-api/extension');
const original = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
if (original.version !== candidates.adguard.version) throw new Error('Run setup:blockers to install the pinned AdGuard reference first');
await mkdir(output, { recursive: true });
// Use the exact reference assets, not a newer download or hand-converted rules.
await cp(resolve(source, 'filters'), resolve(output, 'filters'), { recursive: true });
await cp(resolve(source, 'web-accessible-resources'), resolve(output, 'web-accessible-resources'), { recursive: true });
const filters = [2, 3, 4, 17, 18, 19, 20, 21, 22, 25];
const manifest = {
  manifest_version: 3, name: 'DiffTrail official AdGuard API experiment', version: '0.0.1',
  permissions: ['tabs', 'declarativeNetRequest', 'declarativeNetRequestFeedback', 'scripting', 'webRequest', 'webNavigation', 'storage', 'unlimitedStorage', 'cookies'],
  host_permissions: ['<all_urls>'], background: { service_worker: 'background.js' },
  content_scripts: [{ all_frames: true, js: ['content-script.js'], matches: ['http://*/*', 'https://*/*'], match_about_blank: true, run_at: 'document_start' }],
  declarative_net_request: { rule_resources: original.declarative_net_request.rule_resources.filter(rule => filters.includes(Number(rule.id.replace('ruleset_', '')))).map(rule => ({ ...rule, enabled: false })) },
  web_accessible_resources: original.web_accessible_resources,
};
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(resolve(output, 'status.html'), '<!doctype html><title>DiffTrail AdGuard status</title><p>Programmatic engine readiness page</p>');
await build({
  entryPoints: [resolve(root, 'apps/server/benchmarks/adguard-api/background.js')], outfile: resolve(output, 'background.js'),
  bundle: true, platform: 'browser', format: 'iife', target: 'chrome121', logLevel: 'warning',
  define: { DIFFTRAIL_LAZY_START: runtime ? 'true' : 'false' },
  plugins: [{ name: 'pinned-local-scripts', setup(builder) {
    builder.onResolve({ filter: /^\.\/local-script-rules\.js$/ }, () => ({ path: resolve(source, 'filters/local_script_rules.js') }));
  } }],
});
await build({ stdin: { contents: "import '@adguard/api-mv3/content-script';", resolveDir: root }, outfile: resolve(output, 'content-script.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome121', logLevel: 'warning' });
const dependency = JSON.parse(await readFile(resolve(dirname(require.resolve('@adguard/api-mv3')), '../package.json'), 'utf8'));
await cp(resolve(root, 'apps/server/benchmarks/adguard-api/LICENSE'), resolve(output, 'LICENSE'));
const metadata = { upstreamExampleCommit: '7f665f06297dfaf9609512952970895729afcaa2', sourceArchiveSha256: candidates.adguard.sha256, lazyStart: runtime, source: 'https://github.com/AdguardTeam/tsurlfilter/tree/master/packages/examples/adguard-api-mv3', package: `@adguard/api-mv3@${dependency.version}`, referenceVersion: original.version, filters,
  changes: ['No demo/custom rules or allowlists', 'No 2-minute auto-disable', 'Own readiness/configuration messages', 'Same pinned reference filter and redirect assets'],
  scriptSha256: createHash('sha256').update(await readFile(resolve(output, 'background.js'))).digest('hex'),
};
metadata.files = {};
for (const file of ['manifest.json', 'background.js', 'content-script.js', 'filters/local_script_rules.js', ...manifest.declarative_net_request.rule_resources.map(rule => rule.path)]) {
  metadata.files[file] = createHash('sha256').update(await readFile(resolve(output, file))).digest('hex');
}
await writeFile(resolve(output, 'build.json'), JSON.stringify(metadata, null, 2));
console.log(`Built ${output}`);
