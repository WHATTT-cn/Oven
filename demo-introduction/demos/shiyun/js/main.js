/* ============================================================
 * 诗云 · POETRY GALAXY
 * Three.js 三维诗歌星系
 * - 50 位诗人 = 50 颗恒星（螺旋星系分布，朝代着色）
 * - 500 首诗  = 500 颗行星数据点（公转轨道 + 自定义着色器）
 * - 交互：轨道漫游 / 点击拾取 / 搜索高亮 / Bento 详情面板
 * ============================================================ */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const DATA = window.POETRY_DATA;

/* ---------- 朝代配色（霓虹星系色谱） ---------- */
const DYNASTY_COLORS = {
  '先秦':     0xffd166,
  '汉魏六朝': 0x06d6a0,
  '唐':       0x4cc9f0,
  '宋':       0xb388ff,
  '明清':     0xf72585,
  '近现代':   0xff8c42
};
const cssColor = h => '#' + h.toString(16).padStart(6, '0');

/* ---------- 确定性伪随机（保证每次打开星系形态一致） ---------- */
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/* ============================================================
 * 1. 渲染器 / 场景 / 相机 / 控制器
 * ============================================================ */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));   // 性能：限制像素比
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020108);
scene.fog = new THREE.FogExp2(0x020108, 0.0015);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);
camera.position.set(0, 320, 560);                                // 入场远景，随后飞入

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;                                   // 阻尼 = 平滑漫游
controls.dampingFactor = 0.06;
controls.rotateSpeed = 0.55;
controls.minDistance = 4;
controls.maxDistance = 700;
controls.target.set(0, 0, 0);

canvas.addEventListener('contextmenu', e => e.preventDefault());

/* 后期泛光（霓虹辉光的关键） */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.4, 0.22);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ============================================================
 * 2. 通用星光着色器（核心辉光 + 闪烁，一次 draw call 渲染全部粒子）
 * ============================================================ */
const STAR_VERTEX = /* glsl */`
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aPhase;
  uniform float uTime;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    float twinkle = 0.82 + 0.18 * sin(uTime * 1.7 + aPhase);   // 呼吸闪烁
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float s = aSize * twinkle * (300.0 / -mv.z);               // 距离衰减
    gl_PointSize = clamp(s, 1.5, 68.0);
    gl_Position = projectionMatrix * mv;
  }
`;
const STAR_FRAGMENT = /* glsl */`
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float core = smoothstep(0.18, 0.02, d);                    // 亮核
    float glow = pow(smoothstep(0.5, 0.0, d), 2.6);            // 辉光
    vec3 col = vColor * glow * 1.7 + vec3(1.0) * core * 1.9;
    float a = clamp(glow + core, 0.0, 1.0);
    if (a < 0.02) discard;
    gl_FragColor = vec4(col, a);
  }
`;
function makeStarMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
}
function buildPoints(positions, colors, sizes, phases, material) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('aColor',   new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));
  g.setAttribute('aPhase',   new THREE.BufferAttribute(phases, 1));
  return new THREE.Points(g, material);
}

/* ============================================================
 * 3. 背景深空：远景星幕 + 星云团雾
 * ============================================================ */
{
  const N = 2600;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const siz = new Float32Array(N), pha = new Float32Array(N);
  const tint = [new THREE.Color(0xffffff), new THREE.Color(0x9fd8ff), new THREE.Color(0xd9b8ff), new THREE.Color(0xffe6b8)];
  for (let i = 0; i < N; i++) {
    const r = 550 + hash(i) * 900;
    const th = hash(i * 3 + 1) * Math.PI * 2, ph = Math.acos(2 * hash(i * 7 + 2) - 1);
    pos[i*3]   = r * Math.sin(ph) * Math.cos(th);
    pos[i*3+1] = r * Math.cos(ph) * 0.6;
    pos[i*3+2] = r * Math.sin(ph) * Math.sin(th);
    const c = tint[Math.floor(hash(i * 11) * tint.length)].multiplyScalar(0.6);
    col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    siz[i] = 1.2 + hash(i * 13) * 2.6;
    pha[i] = hash(i * 17) * Math.PI * 2;
  }
  window.__bgMat = makeStarMaterial();
  scene.add(buildPoints(pos, col, siz, pha, window.__bgMat));
}

/* 星云团雾（Canvas 径向渐变贴图 + 加色混合大精灵） */
function nebulaTexture(hex) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  const col = new THREE.Color(hex);
  const rgb = `${Math.round(col.r*255)},${Math.round(col.g*255)},${Math.round(col.b*255)}`;
  g.addColorStop(0, `rgba(${rgb},0.55)`);
  g.addColorStop(0.45, `rgba(${rgb},0.16)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
[0x123a6e, 0x3b1d5e, 0x5e1d4a, 0x0e4a4a, 0x20315e].forEach((hex, i) => {
  const m = new THREE.SpriteMaterial({
    map: nebulaTexture(hex), transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const sp = new THREE.Sprite(m);
  const a = i * 1.35 + 0.6, r = 90 + i * 32;
  sp.position.set(Math.cos(a) * r, (hash(i * 3) - 0.5) * 60, Math.sin(a) * r);
  const s = 260 + hash(i * 9) * 220;
  sp.scale.set(s, s, 1);
  scene.add(sp);
});

/* ============================================================
 * 4. 星系主体：诗人恒星 + 诗歌行星
 * ============================================================ */
const galaxy = new THREE.Group();
scene.add(galaxy);

/* 4.1 螺旋星系布局：五条旋臂，诗人按年代由内向外展开 */
const ARMS = 5;
const poetPositions = DATA.map((p, i) => {
  const n = DATA.length;
  const t = (i + 0.5) / n;                                     // 0→1 时间轴
  const r = 17 + Math.pow(t, 0.85) * 118;                      // 半径
  const arm = i % ARMS;
  const a = arm * (Math.PI * 2 / ARMS) + t * Math.PI * 3.1 + (hash(i * 23) - 0.5) * 0.45;
  const y = (hash(i * 29 + 5) - 0.5) * 7.5 * (1 - t * 0.45);   // 银盘厚度
  return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
});

/* 4.2 恒星（诗人）：大粒子 + 朝代色 */
const poetMat = makeStarMaterial();
{
  const n = DATA.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const siz = new Float32Array(n), pha = new Float32Array(n);
  DATA.forEach((p, i) => {
    const v = poetPositions[i];
    pos[i*3] = v.x; pos[i*3+1] = v.y; pos[i*3+2] = v.z;
    const c = new THREE.Color(DYNASTY_COLORS[p.dynasty]);
    col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    siz[i] = 26 + hash(i * 41) * 14;
    pha[i] = hash(i * 43) * Math.PI * 2;
  });
  var poetPoints = buildPoints(pos, col, siz, pha, poetMat);
  galaxy.add(poetPoints);
}

/* 4.3 行星（诗歌）：公转轨道数据 + 小粒子 */
const poems = [];          // { pi, pj, r, speed, angle, tilt }
const poemIndexMap = [];   // 点序号 → { pi, pj }
DATA.forEach((poet, pi) => {
  const tilt = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((hash(pi * 3) - 0.5) * 1.05, hash(pi * 5) * Math.PI * 2, 0)
  );
  poet.poems.forEach((poem, pj) => {
    poems.push({
      pi, pj, tilt,
      r: 2.8 + pj * 0.30 + hash(pi * 31 + pj * 7) * 0.6,
      speed: (0.35 + hash(pj * 13 + pi * 3) * 0.65) * (pj % 2 ? 1 : -1) * 0.4,
      angle: hash(pi * 97 + pj * 7) * Math.PI * 2
    });
    poemIndexMap.push({ pi, pj });
  });
});
const poemMat = makeStarMaterial();
const poemGeo = new THREE.BufferGeometry();
{
  const n = poems.length;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const siz = new Float32Array(n), pha = new Float32Array(n);
  poems.forEach((p, i) => {
    const poet = DATA[p.pi];
    const c = new THREE.Color(DYNASTY_COLORS[poet.dynasty]).lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(0.85);
    col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b;
    siz[i] = 7 + hash(i * 53) * 6;
    pha[i] = hash(i * 59) * Math.PI * 2;
  });
  poemGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  poemGeo.setAttribute('aColor',   new THREE.BufferAttribute(col, 3));
  poemGeo.setAttribute('aSize',    new THREE.BufferAttribute(siz, 1));
  poemGeo.setAttribute('aPhase',   new THREE.BufferAttribute(pha, 1));
}
const poemPoints = new THREE.Points(poemGeo, poemMat);
poemPoints.frustumCulled = false;          // 轨道动态更新，避免包围球过期
galaxy.add(poemPoints);

/* ============================================================
 * 5. 选中标记：脉冲光环 + 定位光球
 * ============================================================ */
const marker = new THREE.Group();
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
const ring = new THREE.Mesh(new THREE.RingGeometry(7.2, 7.55, 80), ringMat);
ring.rotation.x = -Math.PI / 2;
const glowMat = new THREE.SpriteMaterial({ map: nebulaTexture(0xffffff), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
const glow = new THREE.Sprite(glowMat);
glow.scale.set(12, 12, 1);
marker.add(ring, glow);
marker.visible = false;
galaxy.add(marker);

function setMarker(pi) {
  const poet = DATA[pi];
  const hex = DYNASTY_COLORS[poet.dynasty];
  ringMat.color.setHex(hex);
  glowMat.map = nebulaTexture(hex);
  marker.position.copy(poetPositions[pi]);
  marker.visible = true;
}

/* ============================================================
 * 6. 相机飞行（缓动补间）+ 目标跟随
 * ============================================================ */
let tween = null, follow = null, selectedPoet = null;
const _tmp = new THREE.Vector3();

function poetWorldPos(pi, out) {
  out.copy(poetPositions[pi]);
  return galaxy.localToWorld(out);
}
function flyTo(worldTarget, dist, dur = 1.6) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  const toTg = worldTarget.clone();
  const toPos = worldTarget.clone().addScaledVector(dir, dist).add(new THREE.Vector3(0, dist * 0.35, 0));
  tween = { t: 0, dur, fp: camera.position.clone(), tp: toPos, ft: controls.target.clone(), tt: toTg };
}
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ============================================================
 * 7. 拾取：射线检测（悬浮提示 + 点击下钻）
 * ============================================================ */
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById('tooltip');
let hoverInfo = null;   // { type:'poet'|'poem', pi, pj }

function pick(cx, cy) {
  mouse.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  raycaster.params.Points.threshold = 1.25;
  let hits = raycaster.intersectObject(poemPoints);
  if (hits.length) {
    const m = poemIndexMap[hits[0].index];
    return { type: 'poem', pi: m.pi, pj: m.pj };
  }
  raycaster.params.Points.threshold = 2.6;
  hits = raycaster.intersectObject(poetPoints);
  if (hits.length) return { type: 'poet', pi: hits[0].index };
  return null;
}

canvas.addEventListener('pointermove', e => {
  hoverInfo = pick(e.clientX, e.clientY);
  if (hoverInfo) {
    const poet = DATA[hoverInfo.pi];
    tooltip.innerHTML = hoverInfo.type === 'poem'
      ? `《${poet.poems[hoverInfo.pj].t}》<span class="tt-dynasty"> · ${poet.name}</span>`
      : `${poet.name}<span class="tt-dynasty"> · ${poet.dynasty}</span>`;
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top  = (e.clientY + 10) + 'px';
    tooltip.classList.remove('hidden');
    canvas.style.cursor = 'pointer';
  } else {
    tooltip.classList.add('hidden');
    canvas.style.cursor = 'grab';
  }
});
canvas.addEventListener('pointerleave', () => tooltip.classList.add('hidden'));

/* 区分「点击」与「拖拽」 */
let downX = 0, downY = 0, downT = 0;
canvas.addEventListener('pointerdown', e => { downX = e.clientX; downY = e.clientY; downT = performance.now(); if (e.button === 2) follow = null; });
canvas.addEventListener('pointerup', e => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || performance.now() - downT > 500) return;
  const hit = pick(e.clientX, e.clientY);
  if (!hit) return;
  if (hit.type === 'poem') selectPoem(hit.pi, hit.pj, true);
  else selectPoetStar(hit.pi);
});

/* ============================================================
 * 8. 详情面板（Bento Grid）
 * ============================================================ */
const panel = document.getElementById('panel');
const panelContent = document.getElementById('panelContent');
const panelCrumb = document.getElementById('panelCrumb');

function openPanel() { panel.classList.add('open'); }
function closePanel() { panel.classList.remove('open'); selectedPoet = null; follow = null; marker.visible = false; }
document.getElementById('panelClose').addEventListener('click', closePanel);

function poemListHTML(poet, activeIdx) {
  return poet.poems.map((p, j) =>
    `<button class="poem-link ${j === activeIdx ? 'active' : ''}" data-pj="${j}">《${p.t}》</button>`
  ).join('');
}
function bindPoemLinks(pi) {
  panelContent.querySelectorAll('.poem-link').forEach(btn => {
    btn.addEventListener('click', () => selectPoem(pi, parseInt(btn.dataset.pj), false));
  });
}

function showPoem(pi, pj) {
  const poet = DATA[pi], poem = poet.poems[pj];
  const hex = cssColor(DYNASTY_COLORS[poet.dynasty]);
  panelCrumb.textContent = `POEM · 星辰 NO.${pi + 1}-${pj + 1}`;
  panelContent.innerHTML = `
  <div class="fade-in grid grid-cols-2 gap-2.5">
    <div class="card col-span-2 text-center">
      <div class="card-label">诗 &nbsp;名</div>
      <div class="poem-title">《${poem.t}》</div>
    </div>
    <div class="card text-center">
      <div class="card-label">恒 &nbsp;星</div>
      <div class="serif text-lg font-semibold">${poet.name}</div>
      <div class="text-[10px] text-slate-500 mt-1">${poet.years}</div>
    </div>
    <div class="card text-center">
      <div class="card-label">星 &nbsp;系</div>
      <span class="dynasty-chip mt-1" style="color:${hex}">
        <span class="dynasty-dot" style="background:${hex}"></span>${poet.dynasty}
      </span>
      <div class="text-[10px] text-slate-500 mt-2">第 ${pj + 1} / ${poet.poems.length} 首</div>
    </div>
    <div class="card col-span-2">
      <div class="card-label text-center">诗 &nbsp;文</div>
      <div class="poem-text">${poem.c}</div>
    </div>
    <div class="card col-span-2">
      <div class="card-label">同恒星系的诗 · ${poet.poems.length} 首</div>
      <div class="max-h-36 overflow-y-auto grid grid-cols-2 gap-x-1 pr-1">${poemListHTML(poet, pj)}</div>
    </div>
    <div class="col-span-2 flex gap-2.5 mt-1">
      <button class="nav-btn" id="navPrev">← 上一首</button>
      <button class="nav-btn" id="navRand">✦ 随机一首</button>
      <button class="nav-btn" id="navNext">下一首 →</button>
    </div>
  </div>`;
  bindPoemLinks(pi);
  const n = poet.poems.length;
  document.getElementById('navPrev').addEventListener('click', () => selectPoem(pi, (pj - 1 + n) % n, false));
  document.getElementById('navNext').addEventListener('click', () => selectPoem(pi, (pj + 1) % n, false));
  document.getElementById('navRand').addEventListener('click', randomRoam);
  openPanel();
}

function showPoet(pi) {
  const poet = DATA[pi];
  const hex = cssColor(DYNASTY_COLORS[poet.dynasty]);
  panelCrumb.textContent = `STAR · 恒星 NO.${pi + 1}`;
  panelContent.innerHTML = `
  <div class="fade-in grid grid-cols-2 gap-2.5">
    <div class="card col-span-2 text-center">
      <div class="card-label">诗 &nbsp;人</div>
      <div class="serif text-2xl font-black tracking-[0.2em]">${poet.name}</div>
      <div class="text-[11px] text-slate-500 mt-1.5">${poet.years}</div>
    </div>
    <div class="card text-center">
      <div class="card-label">星 &nbsp;系</div>
      <span class="dynasty-chip mt-1" style="color:${hex}">
        <span class="dynasty-dot" style="background:${hex}"></span>${poet.dynasty}
      </span>
    </div>
    <div class="card text-center">
      <div class="card-label">行 &nbsp;星</div>
      <div class="serif text-lg font-semibold mt-1">${poet.poems.length} 首诗</div>
    </div>
    <div class="card col-span-2">
      <div class="card-label">铭 &nbsp;记</div>
      <p class="serif text-sm leading-7 text-slate-300 tracking-wider">${poet.intro}</p>
    </div>
    <div class="card col-span-2">
      <div class="card-label">环绕运行的诗 · 点击阅读</div>
      <div class="max-h-72 overflow-y-auto grid grid-cols-2 gap-x-1 pr-1">${poemListHTML(poet, -1)}</div>
    </div>
  </div>`;
  bindPoemLinks(pi);
  openPanel();
}

function selectPoetStar(pi) {
  selectedPoet = pi; follow = pi;
  setMarker(pi);
  flyTo(poetWorldPos(pi, _tmp), 20);
  showPoet(pi);
}
function selectPoem(pi, pj, withFly) {
  selectedPoet = pi; follow = pi;
  setMarker(pi);
  if (withFly) flyTo(poetWorldPos(pi, _tmp), 15);
  showPoem(pi, pj);
}
function randomRoam() {
  const pi = Math.floor(Math.random() * DATA.length);
  const pj = Math.floor(Math.random() * DATA[pi].poems.length);
  selectPoem(pi, pj, true);
}

/* ============================================================
 * 9. 搜索：诗人 / 诗名 → 高亮定位
 * ============================================================ */
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

function doSearch(q) {
  q = q.trim();
  if (!q) { searchResults.classList.add('hidden'); return; }
  const poetHits = [], poemHits = [];
  DATA.forEach((poet, pi) => {
    if (poet.name.includes(q) || poet.intro.includes(q))
      poetHits.push({ type: 'poet', pi, label: poet.name, sub: `${poet.dynasty} · ${poet.poems.length} 首诗` });
    poet.poems.forEach((p, pj) => {
      if (p.t.includes(q) && poemHits.length < 30)
        poemHits.push({ type: 'poem', pi, pj, label: `《${p.t}》`, sub: poet.name });
    });
  });
  const hits = [...poetHits, ...poemHits].slice(0, 10);
  if (!hits.length) {
    searchResults.innerHTML = `<div class="search-item" style="cursor:default"><span class="text-slate-500">星云中未找到「${q}」</span></div>`;
  } else {
    searchResults.innerHTML = hits.map((h, i) => `
      <div class="search-item" data-i="${i}">
        <span class="dynasty-dot" style="background:${cssColor(DYNASTY_COLORS[DATA[h.pi].dynasty])}"></span>
        <span>${h.label}</span>
        <span class="tag">${h.sub}</span>
      </div>`).join('');
    searchResults.querySelectorAll('.search-item').forEach(el => {
      el.addEventListener('click', () => {
        const h = hits[parseInt(el.dataset.i)];
        searchResults.classList.add('hidden');
        searchInput.value = h.type === 'poet' ? DATA[h.pi].name : DATA[h.pi].poems[h.pj].t;
        h.type === 'poet' ? selectPoetStar(h.pi) : selectPoem(h.pi, h.pj, true);
      });
    });
  }
  searchResults.classList.remove('hidden');
  searchResults._hits = hits;
}
searchInput.addEventListener('input', e => doSearch(e.target.value));
searchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && searchResults._hits && searchResults._hits.length) {
    const h = searchResults._hits[0];
    searchResults.classList.add('hidden');
    h.type === 'poet' ? selectPoetStar(h.pi) : selectPoem(h.pi, h.pj, true);
  }
  if (e.key === 'Escape') searchResults.classList.add('hidden');
});
document.addEventListener('click', e => {
  if (!e.target.closest('#searchInput') && !e.target.closest('#searchResults'))
    searchResults.classList.add('hidden');
});

/* ============================================================
 * 10. 顶栏按钮 / 统计 / 图例
 * ============================================================ */
document.getElementById('btnRandom').addEventListener('click', randomRoam);
document.getElementById('btnReset').addEventListener('click', () => {
  closePanel();
  flyTo(new THREE.Vector3(0, 0, 0), 230, 1.8);
});

const totalPoems = DATA.reduce((s, p) => s + p.poems.length, 0);
document.getElementById('stats').textContent =
  `${DATA.length} 位诗人 · ${totalPoems} 首诗歌 · 灵感源自《诗云》`;

document.getElementById('legend').innerHTML = Object.entries(DYNASTY_COLORS).map(([d, h]) =>
  `<span class="legend-chip" style="color:${cssColor(h)}">
     <span class="legend-dot" style="background:${cssColor(h)}"></span>${d}
   </span>`).join('');

/* ============================================================
 * 11. 主渲染循环（60 FPS：单 draw call 粒子 + 轨道 CPU 轻量更新）
 * ============================================================ */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  /* 星系缓转 + 着色器时间 */
  galaxy.rotation.y += dt * 0.02;
  poetMat.uniforms.uTime.value = t;
  poemMat.uniforms.uTime.value = t;
  window.__bgMat.uniforms.uTime.value = t;

  /* 500 首诗歌沿轨道公转 */
  const arr = poemGeo.attributes.position.array;
  for (let i = 0; i < poems.length; i++) {
    const p = poems[i];
    p.angle += p.speed * dt;
    _tmp.set(Math.cos(p.angle) * p.r, 0, Math.sin(p.angle) * p.r).applyQuaternion(p.tilt);
    const b = poetPositions[p.pi];
    arr[i * 3]     = b.x + _tmp.x;
    arr[i * 3 + 1] = b.y + _tmp.y;
    arr[i * 3 + 2] = b.z + _tmp.z;
  }
  poemGeo.attributes.position.needsUpdate = true;

  /* 选中标记脉冲 */
  if (marker.visible) {
    const s = 1 + 0.07 * Math.sin(t * 3);
    ring.scale.set(s, s, s);
    ringMat.opacity = 0.4 + 0.2 * Math.sin(t * 3);
  }

  /* 相机补间 & 恒星跟随 */
  if (tween) {
    tween.t += dt / tween.dur;
    const e = easeInOut(Math.min(tween.t, 1));
    camera.position.lerpVectors(tween.fp, tween.tp, e);
    controls.target.lerpVectors(tween.ft, tween.tt, e);
    if (tween.t >= 1) tween = null;
  } else if (follow !== null) {
    controls.target.lerp(poetWorldPos(follow, _tmp), 0.06);
  }

  controls.update();
  composer.render();
}
animate();

/* ============================================================
 * 12. 入场动画 / 加载淡出 / 自适应
 * ============================================================ */
flyTo(new THREE.Vector3(0, 0, 0), 230, 3.4);          // 开场：由深空飞入银河
setTimeout(() => {
  const el = document.getElementById('loading');
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 1100);
}, 900);
setTimeout(() => { document.getElementById('quote').style.opacity = '0'; }, 7000);

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});
