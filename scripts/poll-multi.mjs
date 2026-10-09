#!/usr/bin/env node
// Nebius multi-region GPU spot/on-demand price poller (public calculator; read-only; creates nothing).
// Usage: node poll-multi.mjs [--ingest URL] (INGEST_KEY env) [--source name]
const URL_EST = 'https://api.nebius.cloud/billing/v1alpha1/calculators/estimate';
// region -> project (any project in that region works as calculator parent)
export const TARGETS = [
  // [region, projectId, platform-family, platform, preset1, preset8]
  ['us-central1','project-u00r8jdvpr00yn57fxczc5','rtx6000','gpu-rtx6000','1gpu-24vcpu-218gb','8gpu-192vcpu-1744gb'],
  ['eu-south1','project-e07nt62cma000n4gnwx34d','rtx6000','gpu-rtx6000-a','1gpu-24vcpu-218gb','8gpu-192vcpu-1744gb'],
  ['uk-south2','project-e05sbm8kln00apw9tcamyr','rtx6000','gpu-rtx6000-a','1gpu-24vcpu-218gb','8gpu-192vcpu-1744gb'],
  ['us-central1','project-u00r8jdvpr00yn57fxczc5','b200','gpu-b200-sxm','1gpu-20vcpu-224gb','8gpu-160vcpu-1792gb'],
  ['me-west1','project-i00p5qebpr00yvsm3f6x4z','b200','gpu-b200-sxm-a','1gpu-20vcpu-224gb','8gpu-160vcpu-1792gb'],
  ['us-north1','project-u02qfb1pig00nj0z2pm8hc','b300','gpu-b300-sxm','1gpu-24vcpu-346gb','8gpu-192vcpu-2768gb'],
  ['eu-west2','project-e04gyhe6bc00vhn7jkskzm','b300','gpu-b300-sxm','1gpu-24vcpu-346gb','8gpu-192vcpu-2768gb'],
  ['uk-south1','project-e03nbb2fpr00gf0bc0800g','b300','gpu-b300-sxm','1gpu-24vcpu-346gb','8gpu-192vcpu-2768gb'],
  ['us-central1','project-u00r8jdvpr00yn57fxczc5','h200','gpu-h200-sxm','1gpu-16vcpu-200gb','8gpu-128vcpu-1600gb'],
  ['eu-north1','project-e00gb31qpr0064sktby5gg','h200','gpu-h200-sxm','1gpu-16vcpu-200gb','8gpu-128vcpu-1600gb'],
  ['eu-west1','project-e01wzp8tpr00amba73mjgj','h200','gpu-h200-sxm','1gpu-16vcpu-200gb','8gpu-128vcpu-1600gb'],
  ['eu-north1','project-e00gb31qpr0064sktby5gg','h100','gpu-h100-sxm','1gpu-16vcpu-200gb','8gpu-128vcpu-1600gb'],
];
async function est(parent, platform, preset, spot) {
  const spec = { resources: { platform, preset } };
  if (spot) { spec.preemptible = { onPreemption: 'STOP' }; spec.followsSpotPrice = {}; }
  const body = JSON.stringify({ resourceSpec: { computeInstanceSpec: { metadata: { parentId: parent }, spec } } });
  let last = '';
  for (let a = 0; a < 2; a++) {
    try {
      const r = await fetch(URL_EST, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      if (r.ok) { const v = JSON.parse(t)?.hourlyCost?.general?.total?.cost; if (v != null) return { v: Number(v) }; }
      last = `HTTP ${r.status} ${t.slice(0, 160)}`;
    } catch (e) { last = String(e).slice(0, 160); }
    await new Promise(r => setTimeout(r, 3000));
  }
  return { e: last };
}
export async function pollAll(source) {
  const ts = Math.floor(Date.now() / 1000);
  const rows = await Promise.all(TARGETS.map(async ([region, parent, family, platform, p1, p8]) => {
    const [s1, s8, od] = await Promise.all([est(parent, platform, p1, true), est(parent, platform, p8, true), est(parent, platform, p1, false)]);
    const errs = [s1.e && `spot1: ${s1.e}`, s8.e && `spot8: ${s8.e}`, od.e && `od1: ${od.e}`].filter(Boolean);
    return { ts, region, family, platform, preset: p1, spot_1gpu: s1.v ?? null, spot_8gpu: s8.v ?? null, ondemand_1gpu: od.v ?? null, source, error: errs.length ? errs.join(' | ') : null };
  }));
  return rows;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const source = arg('--source') || 'local';
  const rows = await pollAll(source);
  for (const r of rows) console.log([r.region, r.platform, r.spot_1gpu, r.spot_8gpu, r.ondemand_1gpu, r.error || ''].join('\t'));
  const ingest = arg('--ingest');
  if (ingest) {
    const r = await fetch(ingest, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.INGEST_KEY}` }, body: JSON.stringify({ rows }) });
    console.log('ingest', r.status, (await r.text()).slice(0, 200));
    if (!r.ok) process.exit(1);
  }
  const ok = rows.filter(r => r.spot_1gpu != null).length;
  if (!ok) process.exit(2);
}
