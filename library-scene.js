/**
 * 沉浸式 3D 图书馆 — 参考 three.js 官方示例的渲染与循环习惯再实现业务逻辑。
 *
 * 调研来源（用户指定）:
 * https://github.com/mrdoob/three.js/blob/master/examples/webgl_animation_walk.html
 * 从中迁移、且适合静态站 + 无打包机的部分：
 * - RGBE  equirectangular → scene.environment（IBL，r170 用 RGBELoader；示例里旧名 HDRLoader）
 * - 线性雾 THREE.Fog(color, near, far)（室内深度，避免「贴图灰片」）
 * - renderer.setAnimationLoop（与示例一致的动画循环入口）
 * - OrbitControls：enablePan = false、damping、竖直角度限制
 * - 定向光阴影：较紧的正交范围（示例 ShadowMap 为 PCF；此处 PCF 略省带宽）
 * - 官方常以 PBR + env 做场景/角色；**细长 Instanced 方块书**在阴影 + 低 exposure 下易全黑。
 *   本书架沿用：**房间/层板仍吃 IBL**，**书脊固定 MeshBasic + instanceColor**（不闭门造「黑砖」）。
 *
 * window.libraryAtmosphere.setPapers(PaperView[])
 * 点击书本 → CustomEvent 'library-paper-select'
 *
 * 降级：prefers-reduced-motion / 窄屏 ≤720 / saveData / CPU≤2
 * 调试：?library3d=1 | debug | force
 */
/** 与 index.html ?v= 同步 bump */
const LIBRARY_SCENE_REVISION = 'bookstore-bright-20260514';

const CONFIG = {
  debug: false,
  maxBooks: 400,
  wallZ: -7.85,
  shelfWidth: 12.0,
  shelfRows: 4,
  shelfBaseY: 0.30,
  shelfStepY: 1.18,
  roomSize: 50,
  parallaxStrength: 0,
  driftSpeed: 0,
  lightIntensity: 1.0,
};

const THREE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
const ORBIT_CONTROLS_URL =
  'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js';
const RGBE_LOADER_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/RGBELoader.js';
/** three.js 官方仓库 `examples/textures/equirectangular`（与 webgl_animation_walk 同源思路） */
const HDR_EQUILATERAL_URL =
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/textures/equirectangular/royal_esplanade_1k.hdr';

/** 现代书店配色：饱和明快，像新书架上的精装书 */
const TAG_BOOK_HEX = {
  Agents: 0x4f6df0,        // 钴蓝
  Benchmarks: 0x2bb673,    // 翡翠绿
  Diffusion: 0xff8c3a,     // 鲜橙
  RL: 0x8b5cf6,            // 紫
  Multimodal: 0xff5d8f,    // 玫红
  'Long-context': 0x14b8b0,// 青绿
  MoE: 0xc4d033,           // 柠檬黄
  Safety: 0xef4d4d,        // 朱红
  Systems: 0x3aa8ff,       // 天蓝
  Math: 0xb066ff,          // 兰花紫
  Tables: 0xe8b54a,        // 蜂蜜黄
  Robotics: 0xff5a6a,      // 草莓红
  Geo: 0x66c93f,           // 春绿
  Music: 0xe056ff,         // 品红
  Bio: 0x2dd4bf,           // 薄荷
  NLP: 0x4a90ff,           // 浅钴蓝
  CV: 0xf4cc2c,            // 鲜黄
  ML: 0xb09cff,            // 淡紫
  Other: 0xc8b89a,         // 米黄
};

/** 书脊微调：保持鲜艳，仅细微抖动让同行不撞色 */
function brightenBookColorHex(THREE, hex, seed = 0) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const jitterH = ((seed * 23) % 17 - 8) / 360; // ±8°
  const jitterL = (((seed * 13) % 11) - 5) / 100; // ±5%
  const jitterS = (((seed * 7) % 9) - 4) / 100;
  hsl.h = (hsl.h + jitterH + 1) % 1;
  hsl.s = Math.min(1, Math.max(0.55, hsl.s + jitterS));
  // 强制亮度足够高 → 在任何光照下都能看清颜色
  hsl.l = Math.min(0.78, Math.max(0.55, hsl.l + jitterL));
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c.getHex();
}

function bookColorForTag(tag) {
  return TAG_BOOK_HEX[tag] ?? TAG_BOOK_HEX.Other;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function library3dQueryFlag() {
  return (new URLSearchParams(window.location.search).get('library3d') || '').trim().toLowerCase();
}

function library3dDebugFromStorage() {
  try {
    return localStorage.getItem('library3d-debug') === '1';
  } catch {
    return false;
  }
}

function gradientFallbackDecision() {
  const flag = library3dQueryFlag();
  const overrideAll = flag === 'force';
  const overrideHeuristics = overrideAll || flag === '1' || flag === 'true';

  if (flag === 'debug') CONFIG.debug = true;
  if (library3dDebugFromStorage()) CONFIG.debug = true;

  if (overrideAll) return { useFallback: false, reason: 'url-library3d-force' };
  if (prefersReducedMotion()) return { useFallback: true, reason: 'prefers-reduced-motion' };
  if (overrideHeuristics) return { useFallback: false, reason: 'url-library3d-override' };

  if (window.matchMedia('(max-width: 720px)').matches) return { useFallback: true, reason: 'max-width-720px' };
  if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return { useFallback: true, reason: 'save-data' };
  if ((navigator.hardwareConcurrency || 99) <= 2) return { useFallback: true, reason: 'hardware-concurrency-low' };
  return { useFallback: false, reason: null };
}

let loggedPath = false;
function logPath(msg) {
  if (!CONFIG.debug || loggedPath) return;
  loggedPath = true;
  console.log('[library-scene]', msg);
}

let resizePending = false;
let disposed = false;

function isDarkTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function palette() {
  if (isDarkTheme()) {
    return {
      bg: 0x2c2418,
      floor: 0x6a4a2e,
      wall: 0xa48562,
      wallTrim: 0xc69a6a,
      shelf: 0x8b5a32,
      shelfHi: 0xb88858,
      accentFog: 0x352a1d,
      warmLight: 0xfff0d4,
      coolLight: 0xd0e0ff,
    };
  }
  return {
    bg: 0xe8d8b8,
    floor: 0x9c6f44,
    wall: 0xf2e2c4,
    wallTrim: 0xc69a6a,
    shelf: 0xa67244,
    shelfHi: 0xd4a574,
    accentFog: 0xddc8a4,
    warmLight: 0xfff2d8,
    coolLight: 0xdbeaff,
  };
}

/* ---------- Procedural canvas textures (no external assets) ---------- */

const _texCache = new Map();

function makeWoodTexture(THREE, baseHex, hiHex, key) {
  const cached = _texCache.get(key);
  if (cached) return cached;
  const w = 512, h = 512;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const base = '#' + baseHex.toString(16).padStart(6, '0');
  const hi = '#' + hiHex.toString(16).padStart(6, '0');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // 横向木纹条带
  for (let y = 0; y < h; y += 2) {
    const t = (Math.sin(y * 0.045) + Math.sin(y * 0.013 + 1.7)) * 0.5;
    const a = 0.05 + 0.18 * Math.abs(t);
    ctx.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`;
    ctx.fillRect(0, y, w, 1);
  }
  // 节疤 / 高光纹路
  ctx.strokeStyle = hi;
  ctx.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * h;
    const x0 = Math.random() * w;
    const len = 60 + Math.random() * 200;
    ctx.globalAlpha = 0.06 + Math.random() * 0.10;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.bezierCurveTo(x0 + len * 0.3, y + 4, x0 + len * 0.6, y - 4, x0 + len, y + (Math.random() - 0.5) * 6);
    ctx.stroke();
  }
  // 暗节疤
  ctx.globalAlpha = 0.4;
  for (let i = 0; i < 8; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = 4 + Math.random() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  _texCache.set(key, tex);
  return tex;
}

function makeWallpaperTexture(THREE, baseHex, trimHex, key) {
  const cached = _texCache.get(key);
  if (cached) return cached;
  const w = 256, h = 256;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const base = '#' + baseHex.toString(16).padStart(6, '0');
  const trim = '#' + trimHex.toString(16).padStart(6, '0');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  // 颗粒噪点（布面壁纸）
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 22;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  // 细竖纹（壁纸竖条）
  ctx.strokeStyle = trim;
  ctx.globalAlpha = 0.10;
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 16) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  _texCache.set(key, tex);
  return tex;
}

/** 书脊纹理：纯白底（最大程度让 instanceColor 显色）+ 极细装饰 */
function makeBookSpineTexture(THREE) {
  const cached = _texCache.get('book-spine');
  if (cached) return cached;
  const w = 64, h = 256;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  // 纯白底 → instanceColor 完全决定颜色
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  // 顶/底各 1 条浅米色细线（模拟封面与书页交界处）
  ctx.fillStyle = '#fff8e8';
  ctx.fillRect(0, 26, w, 2);
  ctx.fillRect(0, h - 28, w, 2);
  // 上下端面非常轻的阴影（不要超过 12% alpha，否则把颜色压暗）
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0.10)');
  grad.addColorStop(0.05, 'rgba(0,0,0,0)');
  grad.addColorStop(0.95, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _texCache.set('book-spine', tex);
  return tex;
}

function attachResize(renderer, camera) {
  const onResize = () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => {
      resizePending = false;
      if (disposed || !renderer || !camera) return;
      const wrap = document.getElementById('library-atmosphere');
      const w = wrap?.clientWidth || window.innerWidth;
      const h = wrap?.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    });
  };
  window.addEventListener('resize', onResize, { passive: true });
  onResize();
  return onResize;
}

function disposeSubtree(obj, THREE) {
  obj.traverse((node) => {
    const mesh = /** @type {import('three').Mesh} */ (node);
    mesh.geometry?.dispose?.();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => disposeMat(m, THREE));
    else disposeMat(mat, THREE);
  });
}

function disposeMat(material, THREE) {
  if (!material) return;
  for (const k of Object.keys(material)) {
    const val = /** @type {Record<string, unknown>} */ (material)[k];
    if (val && /** @type {object} */ (val).isTexture) /** @type {import('three').Texture} */ (val).dispose?.();
  }
  /** @type {import('three').Material} */ (material).dispose?.();
}

function clearManaged(THREE, scene, managed) {
  for (const o of [...managed.list]) {
    scene.remove(o);
    disposeSubtree(o, THREE);
  }
  managed.list.length = 0;
}

/**
 * @param {import('three')} THREE
 * @param {unknown[]} papers
 */
function buildRoomAndBooks(THREE, scene, managedRoom, papers) {
  const pal = palette();

  // 地板：木地板纹理
  const floorTex = makeWoodTexture(THREE, pal.floor, pal.shelfHi, 'wood-floor');
  floorTex.repeat.set(8, 8);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.roomSize, CONFIG.roomSize),
    new THREE.MeshStandardMaterial({ map: floorTex, color: 0xffffff, roughness: 0.78, metalness: 0.05 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  managedRoom.list.push(floor);

  // 墙：壁纸纹理 + 暖色基底
  const wallTex = makeWallpaperTexture(THREE, pal.wall, pal.wallTrim, 'wallpaper');
  wallTex.repeat.set(8, 4);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0.0,
  });

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(32, 14), wallMat);
  backWall.position.set(0, 5.8, CONFIG.wallZ - 0.5);
  backWall.receiveShadow = true;
  scene.add(backWall);
  managedRoom.list.push(backWall);

  // 墙角踢脚线
  const trimMat = new THREE.MeshStandardMaterial({ color: pal.shelfHi, roughness: 0.6, metalness: 0.1 });
  const baseboard = new THREE.Mesh(new THREE.BoxGeometry(32, 0.18, 0.06), trimMat);
  baseboard.position.set(0, 0.09, CONFIG.wallZ - 0.49);
  scene.add(baseboard);
  managedRoom.list.push(baseboard);

  const sideGeom = new THREE.PlaneGeometry(24, 14);
  const leftW = new THREE.Mesh(sideGeom, wallMat);
  leftW.rotation.y = Math.PI / 2;
  leftW.position.set(-14.5, 5.8, 0);
  leftW.receiveShadow = true;
  scene.add(leftW);
  managedRoom.list.push(leftW);

  const rightW = new THREE.Mesh(sideGeom, wallMat);
  rightW.rotation.y = -Math.PI / 2;
  rightW.position.set(14.5, 5.8, 0);
  rightW.receiveShadow = true;
  scene.add(rightW);
  managedRoom.list.push(rightW);

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.roomSize, CONFIG.roomSize),
    new THREE.MeshStandardMaterial({ color: pal.wall, roughness: 1, metalness: 0 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 11.2;
  scene.add(ceil);
  managedRoom.list.push(ceil);

  // 书架：木纹
  const shelfWoodTex = makeWoodTexture(THREE, pal.shelf, pal.shelfHi, 'wood-shelf');
  shelfWoodTex.repeat.set(4, 1);
  const shelfMat = new THREE.MeshStandardMaterial({
    map: shelfWoodTex,
    color: 0xffffff,
    roughness: 0.7,
    metalness: 0.08,
  });
  // 书架边缘高光条（金属薄边）
  const shelfEdgeMat = new THREE.MeshStandardMaterial({
    color: pal.shelfHi,
    roughness: 0.45,
    metalness: 0.35,
  });

  const list = Array.isArray(papers) ? papers : [];
  const n = Math.min(list.length, CONFIG.maxBooks);
  const rows = CONFIG.shelfRows;
  const perRow = Math.max(1, Math.ceil(n / rows));

  // 书：MeshLambertMaterial + InstancedMesh.instanceColor（受光照影响有立体感）
  // 关键：**不能**设 `vertexColors: true`！那会让 shader 去乘一个 BoxGeometry 上不存在的
  // `color` 顶点属性 → 默认 (0,0,0) → 整本书全黑。
  // InstancedMesh 会自动检测 `instanceColor !== null` 并启用 USE_INSTANCING_COLOR define。
  const bookGeo = new THREE.BoxGeometry(1, 1, 1);
  const bookMat = new THREE.MeshLambertMaterial({
    color: 0xffffff,
  });
  const cap = Math.max(n, 1);
  const booksMesh = new THREE.InstancedMesh(bookGeo, bookMat, cap);
  booksMesh.castShadow = true;
  booksMesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  /** @type {unknown[]} */
  const papersByInstance = [];
  /** @type {number[]} */
  const baseBookHex = [];
  let idx = 0;

  // 用一个 PRNG 替代 Math.random，保证刷新一致
  let rngState = 1337;
  const rng = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 0xffffffff;
  };

  // 端面立板（侧板）+ 顶板
  const sideBoard = new THREE.BoxGeometry(0.12, rows * CONFIG.shelfStepY + 0.6, 0.6);
  const leftBoard = new THREE.Mesh(sideBoard, shelfMat);
  leftBoard.position.set(-CONFIG.shelfWidth / 2 - 0.18, CONFIG.shelfBaseY + (rows * CONFIG.shelfStepY) / 2 - 0.2, CONFIG.wallZ + 0.30);
  leftBoard.castShadow = true; leftBoard.receiveShadow = true;
  scene.add(leftBoard); managedRoom.list.push(leftBoard);
  const rightBoard = leftBoard.clone();
  rightBoard.position.x = CONFIG.shelfWidth / 2 + 0.18;
  scene.add(rightBoard); managedRoom.list.push(rightBoard);

  for (let row = 0; row < rows && idx < n; row++) {
    const y = CONFIG.shelfBaseY + row * CONFIG.shelfStepY;
    // 主板（厚一点的木板）
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(CONFIG.shelfWidth + 0.5, 0.10, 0.62),
      shelfMat,
    );
    plank.position.set(0, y - 0.06, CONFIG.wallZ + 0.32);
    plank.castShadow = true;
    plank.receiveShadow = true;
    scene.add(plank);
    managedRoom.list.push(plank);

    // 板前沿金属条（小高光）
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(CONFIG.shelfWidth + 0.5, 0.012, 0.014),
      shelfEdgeMat,
    );
    edge.position.set(0, y - 0.005, CONFIG.wallZ + 0.62);
    scene.add(edge); managedRoom.list.push(edge);

    // 估算每行可塞多少本（紧凑铺满）
    // 平均书脊厚 ≈ 0.30；让书互相紧靠，仅在头尾留 0.15
    const usableW = CONFIG.shelfWidth - 0.3;
    const remaining = n - idx;
    const desired = Math.min(perRow, remaining);
    // 自适应：若书少不够铺满，则保持 ≥0.26 厚度并居中
    const avgThick = Math.max(0.26, Math.min(0.42, usableW / desired));
    let cursorX = -CONFIG.shelfWidth / 2 + 0.15;
    const rowOffsetX = (usableW - avgThick * desired) / 2;
    cursorX += rowOffsetX;

    for (let b = 0; b < desired && idx < n; b++) {
      const paper = list[idx];
      const thick = avgThick * (0.85 + rng() * 0.30); // 厚度抖动
      const h = 0.78 + rng() * 0.30;                  // 书高 0.78–1.08（接近层间距 1.18）
      const d = 0.40 + rng() * 0.10;                  // 厚度方向（前后）
      // 随机让少量书向后顶到墙
      const backShift = rng() < 0.25 ? 0.05 : 0;
      const x = cursorX + thick / 2;
      // 倾斜：1/40 的书略微倾斜（更真实，但避免穿模）
      const tilt = rng() < 0.04 ? (rng() < 0.5 ? -1 : 1) * (0.10 + rng() * 0.12) : 0;
      // y：底部贴板
      const y0 = y + h / 2 + 0.001;
      dummy.position.set(x, y0, CONFIG.wallZ + d / 2 + 0.06 - backShift);
      dummy.scale.set(thick * 0.96, h, d);
      dummy.rotation.set(0, 0, tilt);
      dummy.updateMatrix();
      booksMesh.setMatrixAt(idx, dummy.matrix);

      const rawHex = bookColorForTag(paper._tags?.[0] || 'Other');
      const hex = brightenBookColorHex(THREE, rawHex, idx);
      baseBookHex[idx] = hex;
      color.setHex(hex);
      booksMesh.setColorAt(idx, color);
      papersByInstance[idx] = paper;

      cursorX += thick;
      idx++;
    }

    // 行末/行首加一个"靠边斜书"：把最后一本顶住，挡书板状
    if (row % 2 === 0) {
      const endProp = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.78, 0.42),
        shelfEdgeMat,
      );
      endProp.position.set(CONFIG.shelfWidth / 2 - 0.05, y + 0.40, CONFIG.wallZ + 0.30);
      endProp.castShadow = true; endProp.receiveShadow = true;
      scene.add(endProp); managedRoom.list.push(endProp);
    }
  }

  booksMesh.count = idx;
  booksMesh.instanceMatrix.needsUpdate = true;
  if (booksMesh.instanceColor) {
    booksMesh.instanceColor.needsUpdate = true;
  }
  scene.add(booksMesh);
  managedRoom.list.push(booksMesh);

  // 顶部装饰：小球 / 摆件（仅 1–2 个）
  const ornGeo = new THREE.SphereGeometry(0.10, 16, 12);
  const ornMat = new THREE.MeshStandardMaterial({ color: 0xd8b070, roughness: 0.35, metalness: 0.55 });
  const orn1 = new THREE.Mesh(ornGeo, ornMat);
  orn1.position.set(-CONFIG.shelfWidth / 2 + 0.5, CONFIG.shelfBaseY + (rows - 1) * CONFIG.shelfStepY + 0.92, CONFIG.wallZ + 0.45);
  orn1.castShadow = true;
  scene.add(orn1); managedRoom.list.push(orn1);

  return { booksMesh, papersByInstance, baseBookHex };
}

async function initWebGL() {
  const root = document.getElementById('library-atmosphere');
  if (!root) return;

  document.documentElement.classList.add('library-scene-on');
  root.classList.add('library-atmosphere--immersive');

  let THREE;
  try {
    THREE = await import(THREE_MODULE_URL);
    THREE.ColorManagement.enabled = true;
    window.__LIBRARY_SCENE_REVISION = LIBRARY_SCENE_REVISION;
  } catch (err) {
    console.error('[library-scene] Three.js', err);
    initFallback();
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.06, 110);
  /* 拉远一些，视角能看到整面书墙 + 一点天花/地面氛围 */
  camera.position.set(0.4, 2.4, 4.6);

  const pal0 = palette();
  const renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('library-canvas'),
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(pal0.bg, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = isDarkTheme() ? 1.25 : 1.45;
  renderer.shadowMap.enabled = true;
  /* PCFSoft：边缘更柔，配合暖色调有「室内灯光」的感觉 */
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const resizeHandler = attachResize(renderer, camera);
  root.classList.add('library-atmosphere--webgl');

  /** @type {{ list: import('three').Object3D[] }} */
  const managedRoom = { list: [] };
  /** @type {{ list: import('three').Object3D[] }} */
  const managedLights = { list: [] };

  const palL = palette();
  // 强环境光：保证每本书的颜色都看得清（书店应该是亮的）
  const ambient = new THREE.AmbientLight(0xffffff, 0.9 * CONFIG.lightIntensity);
  scene.add(ambient);
  managedLights.list.push(ambient);

  // 半球光：暖天/木地反弹
  const hemi = new THREE.HemisphereLight(palL.warmLight, 0x6a4a2e, 0.85 * CONFIG.lightIntensity);
  scene.add(hemi);
  managedLights.list.push(hemi);

  // 主光：从前上方打向书墙（书脊朝向相机的面也要被照亮）
  const sun = new THREE.DirectionalLight(palL.warmLight, 1.10 * CONFIG.lightIntensity);
  sun.position.set(2, 8, 6);
  sun.target.position.set(0, 1.8, CONFIG.wallZ + 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00022;
  sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2.5;
  const sc = sun.shadow.camera;
  sc.near = 1;
  sc.far = 24;
  sc.left = -10;
  sc.right = 10;
  sc.top = 10;
  sc.bottom = -2;
  sc.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);
  managedLights.list.push(sun, sun.target);

  // 冷色补光（背光、勾边）
  const rim = new THREE.DirectionalLight(palL.coolLight, 0.45 * CONFIG.lightIntensity);
  rim.position.set(-6, 5, 5);
  scene.add(rim);
  managedLights.list.push(rim);

  // 每排书架一盏暖色"层板射灯"，从书架前上方斜照书脊正面（关键：书脊朝相机，光要从相机这一侧来）
  for (let i = 0; i < CONFIG.shelfRows; i++) {
    const y = CONFIG.shelfBaseY + i * CONFIG.shelfStepY + 1.05;
    // 左、右、左、右…
    const xs = [-3.0, 3.0, -1.5, 1.5];
    const pl = new THREE.PointLight(0xfff2d8, 1.5 * CONFIG.lightIntensity, 8.0, 1.6);
    pl.position.set(xs[i % xs.length], y, CONFIG.wallZ + 2.4); // z 比墙更靠近相机
    scene.add(pl);
    managedLights.list.push(pl);
  }

  // 中央顶射聚光：制造焦点
  const spot = new THREE.SpotLight(0xfff0d8, 2.0 * CONFIG.lightIntensity, 16, Math.PI / 5, 0.6, 1.3);
  spot.position.set(0.0, 6.5, 3.0);
  spot.target.position.set(0, 1.55, CONFIG.wallZ + 0.5);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0002;
  scene.add(spot);
  scene.add(spot.target);
  managedLights.list.push(spot, spot.target);

  // 前景填光：避免镜头一侧的书发暗
  const fill = new THREE.PointLight(0xfff5eb, 1.0 * CONFIG.lightIntensity, 12, 1.4);
  fill.position.set(0, 3.0, 4.5);
  scene.add(fill);
  managedLights.list.push(fill);

  /** @type {import('three').InstancedMesh | null} */
  let booksMesh = null;
  /** @type {unknown[]} */
  let papersByInstance = [];
  /** @type {number[]} */
  let baseBookHex = [];
  let hoverInstanceId = -1;

  let useIbl = false;
  /** @type {import('three').Texture | null} */
  let envMapTexture = null;
  let lastAppliedPapers = [];

  function syncFogAndBackground() {
    const pal = palette();
    renderer.setClearColor(pal.bg, 1);
    // 不加雾——书店里看书是要看清的，雾会把颜色拉灰
    scene.fog = null;
  }

  function applyPapers(papers) {
    lastAppliedPapers = Array.isArray(papers) ? [...papers] : [];
    clearManaged(THREE, scene, managedRoom);
    const { booksMesh: bm, papersByInstance: pbi, baseBookHex: hexes } = buildRoomAndBooks(
      THREE,
      scene,
      managedRoom,
      lastAppliedPapers,
    );
    booksMesh = bm;
    papersByInstance = pbi;
    baseBookHex = hexes;
    hoverInstanceId = -1;
    syncFogAndBackground();
    syncLookHudIdle();
  }

  let OrbitControls;
  try {
    const mod = await import(ORBIT_CONTROLS_URL);
    OrbitControls = mod.OrbitControls;
  } catch (e) {
    console.error('[library-scene] OrbitControls', e);
  }

  const controls = OrbitControls ? new OrbitControls(camera, renderer.domElement) : null;
  if (controls) {
    controls.target.set(0, 1.85, CONFIG.wallZ + 0.45);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minPolarAngle = 0.45;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 2.0;
    controls.maxDistance = 13;
    controls.minAzimuthAngle = -Math.PI * 0.55;
    controls.maxAzimuthAngle = Math.PI * 0.55;
    controls.update();
  }

  void (async () => {
    try {
      const { RGBELoader } = await import(RGBE_LOADER_URL);
      const loader = new RGBELoader();
      const tex = await loader.loadAsync(HDR_EQUILATERAL_URL);
      if (disposed) {
        tex.dispose();
        return;
      }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = tex;
      envMapTexture = tex;
      // 极轻 IBL：仅给金属/木板边一点反射高光；不要稀释主光体系
      scene.environmentIntensity = isDarkTheme() ? 0.20 : 0.28;
      useIbl = true;
      applyPapers(lastAppliedPapers);
      console.info('[library-scene] IBL OK (RGBE):', HDR_EQUILATERAL_URL);
    } catch (err) {
      console.warn('[library-scene] IBL 未加载 → 直射光 + MeshBasic 书脊（可检查网络/CORS）', err);
      syncFogAndBackground();
    }
  })();

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = { x: 0, y: 0, t: 0 };

  function onDown(e) {
    down.x = e.clientX;
    down.y = e.clientY;
    down.t = performance.now();
  }

  function onUp(e) {
    const elapsed = performance.now() - down.t;
    if (elapsed > 700) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 16) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    if (!booksMesh || !booksMesh.count) return;
    const hits = raycaster.intersectObject(booksMesh, false);
    if (!hits.length || hits[0].instanceId === undefined) return;
    const paper = papersByInstance[hits[0].instanceId];
    if (paper) window.dispatchEvent(new CustomEvent('library-paper-select', { detail: { paper } }));
  }

  renderer.domElement.addEventListener('pointerdown', onDown, { passive: true });
  renderer.domElement.addEventListener('pointerup', onUp, { passive: true });

  const cHover = new THREE.Color();

  function syncLookHudIdle() {
    const hud = document.getElementById('library-look-hud');
    if (!hud) return;
    const ey = hud.querySelector('.library-look-eyebrow');
    const ti = hud.querySelector('.library-look-title');
    const gi = hud.querySelector('.library-look-gist');
    const hint = hud.querySelector('.library-look-hint');
    if (!ey || !ti || !gi) return;
    const n = papersByInstance.length;
    if (!n) {
      ey.textContent = '';
      ti.textContent = '图书馆正在上架…';
      gi.textContent = '请稍候，或与系统筛选条件切换日期、主题。';
      if (hint) hint.textContent = `若长期如此请硬刷新 Ctrl+F5 · 场景 ${LIBRARY_SCENE_REVISION}`;
      return;
    }
    ey.textContent = '探索模式';
    ti.textContent = '拖动旋转 · 准星对准书脊';
    gi.textContent = `本架共 ${n} 册，悬停可读标题，点击打开论文抽屉。`;
    if (hint) {
      hint.textContent = `单击打开详情 · Esc 关闭抽屉 · 场景 ${LIBRARY_SCENE_REVISION}`;
    }
  }

  function setInstanceHoverVisual(id, highlighted) {
    if (!booksMesh?.instanceColor || id < 0 || baseBookHex[id] === undefined) return;
    const hex = baseBookHex[id];
    cHover.setHex(hex);
    if (highlighted) cHover.multiplyScalar(1.2);
    booksMesh.setColorAt(id, cHover);
    booksMesh.instanceColor.needsUpdate = true;
  }

  function updateBookHover(clientX, clientY) {
    if (!booksMesh?.count) {
      syncLookHudIdle();
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(booksMesh, false);
    const id =
      hits.length && hits[0].instanceId !== undefined ? /** @type {number} */ (hits[0].instanceId) : -1;

    const hud = document.getElementById('library-look-hud');
    const ey = hud?.querySelector('.library-look-eyebrow');
    const ti = hud?.querySelector('.library-look-title');
    const gi = hud?.querySelector('.library-look-gist');

    if (id === hoverInstanceId) {
      if (id < 0) syncLookHudIdle();
      return;
    }

    if (hoverInstanceId >= 0) setInstanceHoverVisual(hoverInstanceId, false);
    hoverInstanceId = id;
    if (hoverInstanceId >= 0) setInstanceHoverVisual(hoverInstanceId, true);

    if (hoverInstanceId < 0 || !papersByInstance[hoverInstanceId]) {
      syncLookHudIdle();
      return;
    }
    const paper = papersByInstance[hoverInstanceId];
    if (ey) ey.textContent = String(paper._tags?.[0] || 'Paper');
    if (ti) ti.textContent = String(paper.title || '(untitled)');
    if (gi) gi.textContent = String(paper._gist || paper._abstract || '').slice(0, 220);
  }

  function onCanvasPointerMove(e) {
    if (e.pointerType === 'touch') return;
    updateBookHover(e.clientX, e.clientY);
  }

  function onCanvasPointerLeave() {
    if (hoverInstanceId >= 0) setInstanceHoverVisual(hoverInstanceId, false);
    hoverInstanceId = -1;
    syncLookHudIdle();
  }

  renderer.domElement.addEventListener('pointermove', onCanvasPointerMove, { passive: true });
  renderer.domElement.addEventListener('pointerleave', onCanvasPointerLeave, { passive: true });

  applyPapers([]);

  function renderFrame() {
    if (disposed) return;
    if (controls) controls.update();
    renderer.render(scene, camera);
  }

  disposed = false;
  renderer.setAnimationLoop(renderFrame);

  window.libraryAtmosphere = {
    setPapers(papers) {
      applyPapers(papers || []);
    },
    resize() {
      const wrap = document.getElementById('library-atmosphere');
      const w = wrap?.clientWidth || window.innerWidth;
      const h = wrap?.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      if (envMapTexture) {
        envMapTexture.dispose();
        envMapTexture = null;
      }
      scene.environment = null;
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onCanvasPointerMove);
      renderer.domElement.removeEventListener('pointerleave', onCanvasPointerLeave);
      window.removeEventListener('resize', resizeHandler);
      clearManaged(THREE, scene, managedRoom);
      clearManaged(THREE, scene, managedLights);
      renderer.dispose();
      root.classList.remove('library-atmosphere--webgl', 'library-atmosphere--immersive');
      delete window.libraryAtmosphere;
    },
  };

  console.info('[library-scene] WebGL build:', LIBRARY_SCENE_REVISION);

  window.dispatchEvent(new Event('library-atmosphere-ready'));
  logPath('immersive-room');
}

function initFallback() {
  const root = document.getElementById('library-atmosphere');
  if (root) {
    root.classList.add('library-atmosphere--fallback');
    root.classList.remove('library-atmosphere--webgl', 'library-atmosphere--immersive');
  }
  document.documentElement.classList.add('library-scene-on');
}

function boot() {
  try {
    const { useFallback, reason } = gradientFallbackDecision();
    if (useFallback) {
      logPath(`fallback: ${reason}`);
      initFallback();
      return;
    }
    logPath(`webgl ${reason || ''}`);
    void initWebGL();
  } catch (e) {
    console.error('[library-scene]', e);
    initFallback();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
