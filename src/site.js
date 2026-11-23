// site.js · página da Ecoprad: o texto rola à esquerda e o recorte de terreno 3D fica fixo à direita.
// A rolagem controla o mesmo número u (0 a 10) do modelo interativo (demo/): cada bloco de texto tem data-u e data-v.
import * as THREE from "three";
window.THREE = THREE;

// ------------------------------------------------------------------ qualidade conforme o aparelho
const fraco = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 700 || (navigator.hardwareConcurrency || 8) <= 4;
const QS = new URLSearchParams(location.search).get("q");
const QUAL = QS === "alta" ? "alta" : QS === "baixa" || (fraco && QS !== "media") ? "baixa" : "media";
window.TER_Q = { alta: { main: 1, patch: 1, rain: 5000, shadow: 2048 }, media: { main: 0.6, patch: 0.55, rain: 3000, shadow: 2048 }, baixa: { main: 0.42, patch: 0.38, rain: 1600, shadow: 1024 } }[QUAL];
const PIXEL = { alta: 2, media: 1.5, baixa: 1.25 }[QUAL];

const $ = id => document.getElementById(id);
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, k) => a + (b - a) * k;
const ease = x => { x = cl(x); return x * x * (3 - 2 * x); };
const eOut = x => 1 - Math.pow(1 - cl(x), 3);
const seg = (k, a, b) => cl((k - a) / Math.max(1e-4, b - a));
const K = (u, i) => cl(u - (i - 1));

// ------------------------------------------------------------------ renderizador (fundo transparente: o recorte "flutua" na página)
const palco = document.querySelector(".palco"), canvas = $("cena");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
let PW = 1, PH = 1;
function resize() {
  const r = canvas.getBoundingClientRect(); PW = Math.max(1, r.width); PH = Math.max(1, r.height);
  renderer.setSize(PW, PH, false); cam.aspect = PW / PH; cam.fov = 30; cam.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas); resize();

// ------------------------------------------------------------------ o recorte: caixa de corte + paredes de solo
const BOX = { x0: -29.5, x1: 29.5, z0: -45.5, z1: 49.5, y0: -12 };
let planos = null;
function caixa() {
  // o reservatório pode ficar perto da borda: a caixa cresce para incluí-lo, sem passar do terreno (60 x 96 m)
  const R = TER.RES; if (R) { BOX.z1 = Math.min(49.8, Math.max(BOX.z1, R.cz + R.r + 3)); BOX.x1 = Math.min(29.8, Math.max(BOX.x1, R.cx + R.r + 3)); BOX.x0 = Math.max(-29.8, Math.min(BOX.x0, R.cx - R.r - 3)); }
  planos = [new THREE.Plane(new THREE.Vector3(1, 0, 0), -BOX.x0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), BOX.x1),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -BOX.z0), new THREE.Plane(new THREE.Vector3(0, 0, -1), BOX.z1), new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOX.y0)];
  // paredes laterais (corte do solo) com camadas: grama fina, terra escura, subsolo e base mais clara
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const CAM = [[0, "#5f7d34"], [0.28, "#5f7d34"], [0.36, "#4a3020"], [1.5, "#5a3a25"], [1.62, "#9a5e3a"], [5.2, "#a8693f"], [5.35, "#c08657"], [99, "#b98252"]];
  const cor = new THREE.Color();
  const borda = (ax, az, bx, bz) => {
    const n = 120, pos = [], col = [], idx = [], R = CAM.length;
    for (let i = 0; i <= n; i++) {
      const k = i / n, x = mix(ax, bx, k), z = mix(az, bz, k), top = TER.surface(x, z, 0, 0) - 0.02;
      const ond = 0.25 * Math.sin(x * 0.31 + z * 0.23) + 0.15 * Math.sin(x * 0.9 - z * 0.7);   // camadas levemente onduladas
      for (let r = 0; r < R; r++) {
        const d = r === 0 ? 0 : CAM[r][0] + (r > 1 && r < R - 1 ? ond : 0);
        pos.push(x, Math.max(BOX.y0, top - d), z); cor.set(CAM[r][1]); col.push(cor.r, cor.g, cor.b);
      }
      if (i < n) for (let r = 0; r < R - 1; r++) { const a0 = i * R + r, b0 = a0 + R; idx.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.userData.parede = true; m.receiveShadow = true; scene.add(m);
  };
  const e = 0.01;
  borda(BOX.x0 + e, BOX.z0 + e, BOX.x1 - e, BOX.z0 + e); borda(BOX.x1 - e, BOX.z0 + e, BOX.x1 - e, BOX.z1 - e);
  borda(BOX.x1 - e, BOX.z1 - e, BOX.x0 + e, BOX.z1 - e); borda(BOX.x0 + e, BOX.z1 - e, BOX.x0 + e, BOX.z0 + e);
  const W = BOX.x1 - BOX.x0, D = BOX.z1 - BOX.z0, cx = (BOX.x0 + BOX.x1) / 2, cz = (BOX.z0 + BOX.z1) / 2;
  const fundo = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: "#b98252", roughness: 1, side: THREE.DoubleSide }));
  fundo.rotation.x = Math.PI / 2; fundo.position.set(cx, BOX.y0, cz); scene.add(fundo);
  // base clara do diorama (como uma peça de maquete)
  const BH = 2.4, base = new THREE.Mesh(new THREE.BoxGeometry(W + 2.4, BH, D + 2.4), new THREE.MeshStandardMaterial({ color: "#f1ede4", roughness: 0.85 }));
  base.position.set(cx, BOX.y0 - BH / 2 - 0.01, cz); base.receiveShadow = true; scene.add(base);
  // sombra suave no "chão" da página: degradê radial, sem borda
  const cv = document.createElement("canvas"); cv.width = cv.height = 256; const c2 = cv.getContext("2d");
  const gr = c2.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, "rgba(20,35,25,.38)"); gr.addColorStop(0.45, "rgba(20,35,25,.16)"); gr.addColorStop(1, "rgba(20,35,25,0)");
  c2.fillStyle = gr; c2.fillRect(0, 0, 256, 256);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const sombra = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.9, D * 1.55), new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, toneMapped: false }));
  sombra.rotation.x = -Math.PI / 2; sombra.position.set(cx + 3, BOX.y0 - BH - 3.5, cz + 4); sombra.renderOrder = -1; scene.add(sombra);
}
const vistos = new WeakSet();
function aplicaCorte() {
  const WD = TER.WD; if (!WD) return;
  if (WD.outer) WD.outer.visible = false;
  WD.root.traverse(o => {
    if (o.userData.horizonte) o.visible = false;
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) if (!vistos.has(m)) { vistos.add(m); m.clippingPlanes = planos; m.needsUpdate = true; }
  });
}

// ------------------------------------------------------------------ pontos de referência e estado da história (iguais ao demo/)
let A = null;
function refs() {
  const S1 = { R: 1, G: 1 }, BR = [1, 1, 1, 1, 1, 1, 1, 1];
  const along = (s, lat = 0) => { const p = TER.at(TER.MAIN, s), x = p[0] + Math.cos(p[2]) * lat, z = p[1] - Math.sin(p[2]) * lat; return [x, z]; };
  const g = (xz, R = 1, G = 1, up = 0) => [xz[0], TER.surface(xz[0], xz[1], R, G) + up, xz[1]];
  const pp = (n, u, up = 0) => { const p = TER.pathPt(n, u, S1); return [p[0], p[1] + up, p[2]]; };
  const RES = TER.RES, pal = k => { const f = TER.palFloor(TER.SYS.pal[k], { R: 1, G: 1, br: BR }); return [f[0], f[1] + 0.6, f[2]]; };
  A = {
    RES, voc: g(along(0.55, 0), 1, 1), sulco: g(along(0.42, 0), 1, 0.07, 0.1),
    cv: pp("cvb1", 0.22, 0.4), cc: pp("central", 0.45, 0.3), br: pp("br2", 0.55, 0.3), gt: pp("central", 0.3, 0.2),
    p3: pal(3), ped: pp("res", 0.45, 0.3), r1: [RES.cx, RES.top + 0.3, RES.cz], r2: [RES.t2[0], RES.t2[1] + 0.3, RES.t2[2]],
    boia: [RES.fxz[0], RES.top + 0.2, RES.fxz[1]], tal: g(along(0.5, 6.5), 1, 1, 0.2),
  };
}
const NB = 8, FOC = 3;
const mainXat = z => 1.0 + 2.6 * Math.sin(z * 0.07 + 0.5) + 1.1 * Math.sin(z * 0.19 + 1.3);
const COLL = { s: 0.56, side: 1, t: null };
function estado(u, t) {
  const k1 = K(u, 1), k2 = K(u, 2), k3 = K(u, 3), k4 = K(u, 4), k5 = K(u, 5), k6 = K(u, 6), k7 = K(u, 7), k8 = K(u, 8), k9 = K(u, 9), k10 = K(u, 10);
  let rain = ease(seg(k1, 0, 0.5)); rain = mix(rain, 0.12, ease(seg(k4, 0, 0.3))); rain = mix(rain, 1, ease(seg(k9, 0, 0.2))); rain = mix(rain, 0, ease(seg(k10, 0, 0.5)));
  let wet = mix(0.12, 1, ease(seg(k1, 0.1, 0.8))); wet = mix(wet, 0.8, k4); wet = mix(wet, 1, k9); wet = mix(wet, 0.32, ease(k10));
  let puddle = ease(seg(k1, 0.3, 0.9)); puddle = mix(puddle, 0.45, k4); puddle = mix(puddle, 0.6, k9); puddle = mix(puddle, 0, ease(seg(k10, 0.2, 0.9)));
  let sheet = ease(seg(k1, 0.55, 1)) * 0.9; sheet = mix(sheet, 0.15, ease(seg(k4, 0, 0.4))); sheet = mix(sheet, 0.45, k9); sheet = mix(sheet, 0, ease(seg(k10, 0, 0.6)));
  const R = ease(seg(k2, 0.05, 0.95)), G = 0.07 * ease(seg(k2, 0.5, 1)) + 0.93 * ease(seg(k3, 0, 0.92));
  const flow = ease(seg(k1, 0.6, 1) * 0.4 + seg(k2, 0, 0.3) * 0.6);
  const o = { t, R, G, rain, wet, puddle, sheet, flow, light: mix(1, 0.85, rain) };
  if (u >= 2.6) { if (COLL.t === null) COLL.t = t - 30; o.collapse = COLL; } else COLL.t = null;
  o.sedOn = (u > 1.25 && u < 3.6) || (k9 > 0.05 && k10 < 0.6);
  if (k9 > 0.05) { o.sedBr = FOC; o.sedA = 0.08; o.sedB = TER.SYS.pal[FOC].u; o.sedStop = TER.SYS.pal[FOC].u; o.sedSp = 0.8; }
  o.sysOn = u > 3;
  if (o.sysOn) {
    o.cv = [0, 1, 2].map(j => ease(seg(k4, j * 0.16, j * 0.16 + 0.62)));
    o.oc = ease(seg(k4, 0.55, 0.95)); o.cvW = seg(k4, 0.65, 1);
    o.cc = ease(seg(k5, 0, 0.5));
    o.br = Array.from({ length: NB }, (_, i) => ease(seg(k5, 0.32 + i * 0.07, 0.52 + i * 0.07)));
    o.gt = ease(k6);
    o.pal = Array.from({ length: NB }, (_, i) => seg(k7, i * 0.06, 0.5 + i * 0.06));
    o.manta = Array.from({ length: NB }, (_, i) => eOut(seg(k7, 0.5 + i * 0.05, 0.62 + i * 0.05)));
    o.mound = Array.from({ length: NB }, () => Math.pow(seg(k9, 0.1, 0.9), 0.8));
    o.resv = eOut(seg(k8, 0, 0.55));
    const sf = seg(k9, 0, 0.3) * (1 - 0.75 * ease(seg(k10, 0, 0.7)));
    o.sf = sf; o.natW = mix(mix(1, 0.4, ease(k4)), 0.12, seg(k9, 0, 0.3));
    o.mud = k9 > 0 ? 0.8 * seg(k9, 0, 0.15) * (1 - k10) : 0; o.mudU = TER.SYS.pal[FOC].u;
    o.level = 0.74 * Math.pow(seg(k9, 0.18, 0.62), 0.85) + 0.18 * seg(k9, 0.6, 0.76);
    o.valve = seg(k9, 0.76, 0.8);
    o.level2 = 0.78 * Math.pow(seg(k9, 0.82, 1), 0.8);
    if (k9 > 0.15) o.arrows = flechas(0.9 * seg(k9, 0.15, 0.35) * (1 - seg(k10, 0, 0.5)));
  }
  o.reveg = ease(seg(k10, 0.1, 1));
  return o;
}
function flechas(kk) {
  if (kk <= 0.01) return [];
  const uc = TER.SYS.uc, r = [{ p: "cv0", u0: 0.03, u1: uc - 0.01, k: kk }, { p: "cv0", u0: 0.97, u1: uc + 0.01, k: kk }];
  for (const [c, z] of [[1, -17], [2, 3]]) { const uL = (mainXat(z) - 13 + 28) / 56, uR = (mainXat(z) + 13 + 28) / 56; r.push({ p: "cv" + c, u0: 0.02, u1: uL, k: kk }, { p: "cv" + c, u0: 0.98, u1: uR, k: kk }); }
  r.push({ p: "out", k: kk }); for (let j = 0; j < NB; j++) r.push({ p: "br" + j, k: kk, sp: 1.3 });
  r.push({ p: "central", k: kk, sp: 1.8, gap: 2.2 }, { p: "res", k: kk, gap: 1.2 });
  return r;
}

// ------------------------------------------------------------------ vistas: o diorama inteiro sempre na tela
// Cada etapa gira o bloco para mostrar o ponto de interesse e chega o foco um pouco nele; a distância é a menor que ainda
// deixa os 8 cantos do bloco dentro da tela (com folga), então ele nunca aparece cortado.
const _cam = new THREE.PerspectiveCamera(), _q = new THREE.Vector3(), cacheV = new Map();
function vista(i) {
  const chave = i + "|" + PW + "x" + PH; if (cacheV.has(chave)) return cacheV.get(chave);
  const C = [(BOX.x0 + BOX.x1) / 2, -5, (BOX.z0 + BOX.z1) / 2];
  const F = (p, k) => [mix(C[0], p[0], k), mix(C[1], p[1], k), mix(C[2], p[2], k)];
  const V = [
    { alvo: C, dir: [-0.42, 0.52, 0.76] },
    { alvo: C, dir: [-0.55, 0.45, 0.72] },
    { alvo: F(A.sulco, 0.35), dir: [0.4, 0.5, 0.75] },
    { alvo: F(A.voc, 0.35), dir: [-0.7, 0.5, 0.5] },
    { alvo: F([0, -2, -27], 0.3), dir: [-0.45, 0.62, 0.62] },
    { alvo: F(A.cc, 0.25), dir: [-0.25, 0.85, 0.45] },
    { alvo: F(A.gt, 0.35), dir: [0.5, 0.55, 0.68] },
    { alvo: F(A.p3, 0.35), dir: [0.72, 0.45, 0.52] },
    { alvo: F(A.r1, 0.35), dir: [-0.5, 0.5, 0.7] },
    { alvo: F(A.ped, 0.2), dir: [-0.38, 0.55, 0.74] },
    { alvo: C, dir: [-0.42, 0.52, 0.76] },
    { alvo: C, dir: [0.5, 0.5, 0.7] },
    { alvo: C, dir: [-0.3, 0.75, 0.6] },
  ][i];
  const alvo = new THREE.Vector3(...V.alvo), d = new THREE.Vector3(...V.dir).normalize();
  _cam.fov = cam.fov; _cam.aspect = cam.aspect; _cam.near = 0.1; _cam.far = 2000; _cam.updateProjectionMatrix();
  const cantos = []; for (const x of [BOX.x0 - 1.2, BOX.x1 + 1.2]) for (const z of [BOX.z0 - 1.2, BOX.z1 + 1.2]) for (const y of [BOX.y0 - 2.4, 6]) cantos.push([x, y, z]);
  const M = PW < 520 ? 0.9 : 0.72;           // folga: no computador o diorama fica pequeno, com ar em volta
  const cabe = dist => {
    _cam.position.copy(alvo).addScaledVector(d, dist); _cam.lookAt(alvo); _cam.updateMatrixWorld();
    return cantos.every(c => { _q.set(...c).project(_cam); return _q.z < 1 && Math.abs(_q.x) <= M && Math.abs(_q.y) <= M; });
  };
  let lo = 20, hi = 600; while (!cabe(hi) && hi < 5000) hi *= 1.5;
  for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (cabe(m)) hi = m; else lo = m; }
  const r = { alvo, pos: alvo.clone().addScaledVector(d, hi) };
  cacheV.set(chave, r); return r;
}
// mistura de duas vistas pelo arco esférico em volta do alvo (não atravessa o terreno)
const _s0 = new THREE.Spherical(), _s1 = new THREE.Spherical(), _r = new THREE.Vector3();
function misturaVista(a, b, k, giro) {
  const alvo = a.alvo.clone().lerp(b.alvo, k);
  _s0.setFromVector3(_r.copy(a.pos).sub(a.alvo)); _s1.setFromVector3(_r.copy(b.pos).sub(b.alvo));
  let dth = _s1.theta - _s0.theta; if (dth > Math.PI) dth -= 2 * Math.PI; if (dth < -Math.PI) dth += 2 * Math.PI;
  const s = new THREE.Spherical(mix(_s0.radius, _s1.radius, k), mix(_s0.phi, _s1.phi, k), _s0.theta + dth * k + giro);
  return { alvo, pos: alvo.clone().add(_r.setFromSpherical(s)) };
}

// ------------------------------------------------------------------ etiquetas (as mesmas do demo, presas a pontos 3D)
const ROT = [[], [], [["SULCOS DE EROSÃO", "sulco"]], [["VOÇOROCA", "voc"]], [["TERRAÇOS EM NÍVEL", "cv"]],
  [["CANAL CENTRAL", "cc"], ["RAMAIS (ESPINHA DE PEIXE)", "br"]], [["MANTA GEOTÊXTIL", "gt"]], [["PALIÇADA DE EUCALIPTO", "p3"]],
  [["CAMINHO DE PEDRAS", "ped"], ["RESERVATÓRIO", "r1"]], [["TERRA RETIDA", "p3"], ["BOIA", "boia"], ["2º RESERVATÓRIO", "r2"]],
  [["TALUDES REVEGETADOS", "tal"], ["ÁGUA ARMAZENADA", "r1"]]];
const rotBox = $("rotulos"), rotEls = new Map(), _v = new THREE.Vector3();
function rotEl(txt) {
  let e = rotEls.get(txt);
  if (!e) { e = document.createElement("div"); e.className = "rot"; e.innerHTML = '<div class="ln"></div><div class="pt"></div><div class="tx"></div>'; e.querySelector(".tx").textContent = txt; rotBox.appendChild(e); rotEls.set(txt, e); }
  return e;
}
function rotulos(lista) {
  const vivos = new Set(), mob = PW < 520;
  lista.forEach(([txt, key], j) => {
    const p = A[key]; if (!p) return;
    _v.set(...p).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 0.95 || Math.abs(_v.y) > 0.95) return;
    const x = (_v.x * 0.5 + 0.5) * PW, y = (-_v.y * 0.5 + 0.5) * PH, e = rotEl(txt); vivos.add(txt);
    const tx = e.querySelector(".tx"), tw = tx.offsetWidth || txt.length * 8, dir = (x > PW * 0.55 ? -1 : 1) * (j % 2 ? -1 : 1);
    let lx = x + (mob ? 26 : 50) * dir, ly = cl(y - (mob ? 36 : 56) - Math.floor(j / 2) * 34, 40, PH - 30);
    if (dir > 0) lx = Math.min(lx, PW - tw - 34); else lx = Math.max(lx, tw + 12);
    e.style.transform = `translate(${x}px, ${y}px)`; e.style.opacity = 1;
    const ln = e.querySelector(".ln"), ddx = lx - x, ddy = ly - y;
    ln.style.width = Math.hypot(ddx, ddy) + "px"; ln.style.transform = `rotate(${Math.atan2(ddy, ddx)}rad)`;
    tx.style.left = (dir > 0 ? ddx : ddx - tw) + "px"; tx.style.top = (ddy - 12) + "px";
  });
  for (const [txt, e] of rotEls) if (!vivos.has(txt)) e.style.opacity = 0;
}

// ------------------------------------------------------------------ rolagem -> história
const blocos = [...document.querySelectorAll(".bloco")].map(el => ({ el, u: +el.dataset.u, v: +el.dataset.v }));
const trilha = $("trilha");
blocos.forEach((b, i) => {
  const li = document.createElement("li"); li.title = b.el.querySelector("h2").textContent;
  li.onclick = () => irPara(i); trilha.appendChild(li); b.dot = li;
});
let alvo = { i: 0, j: 0, g: 0, u: 0 }, ativo = -1;
function linhaLeitura() {
  // linha de leitura: meio da área de texto visível (no celular, abaixo do 3D fixo)
  const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav")) || 64;
  const topo = innerWidth <= 860 ? palco.offsetHeight : nav;
  return topo + (innerHeight - topo) / 2;
}
function irPara(i, suave = true) {
  const r = blocos[i].el.getBoundingClientRect();
  scrollTo({ top: scrollY + r.top + r.height / 2 - linhaLeitura(), behavior: suave ? "smooth" : "auto" });
}
function leRolagem() {
  const y0 = linhaLeitura();
  const cs = blocos.map(b => { const r = b.el.getBoundingClientRect(); return r.top + r.height / 2; });
  let i = 0; while (i < blocos.length - 1 && cs[i + 1] <= y0) i++;
  const j = Math.min(blocos.length - 1, i + 1);
  const f = j === i ? 0 : cl((y0 - cs[i]) / (cs[j] - cs[i]));
  const g = ease(seg(f, 0.3, 0.7));                // parado enquanto o bloco está no meio; muda entre um bloco e outro
  alvo = { i, j, g, u: mix(blocos[i].u, blocos[j].u, g) };
  const n = f < 0.5 ? i : j;
  if (n !== ativo) { ativo = n; blocos.forEach((b, k) => { b.el.classList.toggle("ativo", k === n); b.dot.classList.toggle("ativo", k === n); }); }
}
addEventListener("scroll", leRolagem, { passive: true }); addEventListener("resize", leRolagem);

// menu: marca a seção visível
const links = [...document.querySelectorAll("#nav a[data-sec]")];
function menu() {
  const et = $("etapas").getBoundingClientRect(), sec = et.top < innerHeight * 0.5 && et.bottom > innerHeight * 0.3 ? "etapas" : et.top >= innerHeight * 0.5 ? "home" : "";
  links.forEach(a => a.classList.toggle("ativo", a.dataset.sec === sec));
}
addEventListener("scroll", menu, { passive: true }); menu();

// folhas: sobem em velocidades diferentes com a rolagem (efeito de profundidade)
const grupos = [...document.querySelectorAll(".folhas")], calmo = matchMedia("(prefers-reduced-motion: reduce)").matches;
let pedido = false;
function folhas() {
  pedido = false; if (calmo) return;
  for (const g of grupos) { const r = g.getBoundingClientRect(); if (r.bottom < -200 || r.top > innerHeight + 200) continue; g.style.setProperty("--sy", (-r.top * 0.35).toFixed(1) + "px"); }
}
addEventListener("scroll", () => { if (!pedido) { pedido = true; requestAnimationFrame(folhas); } }, { passive: true }); folhas();

// ------------------------------------------------------------------ laço (só desenha quando o 3D está na tela)
let visivel = true;
new IntersectionObserver(es => { visivel = es[0].isIntersecting; }, { threshold: 0 }).observe(palco);
let u = 0, relogio = 0, ultimo = performance.now(), camP = null, camA = null, pronto = false, nCorte = 0;
function laco(now) {
  requestAnimationFrame(laco);
  const dt = Math.min(0.1, (now - ultimo) / 1000); ultimo = now;
  if (!pronto || !visivel) return;
  relogio += dt;
  // a história anda até o alvo da rolagem com velocidade limitada (rolar rápido não pula a animação)
  const pu = u, d = alvo.u - u; u += Math.sign(d) * Math.min(Math.abs(d), Math.max(0.35, Math.abs(d) * 2.2) * dt);
  if (pu < 2.6 && u >= 2.6) COLL.t = relogio;
  // câmera: vista do bloco + giro leve de um lado para o outro
  const giro = 0.16 * Math.sin(relogio * 0.22);
  const vv = misturaVista(vista(blocos[alvo.i].v), vista(blocos[alvo.j].v), alvo.g, giro);
  if (!camP) { camP = vv.pos.clone(); camA = vv.alvo.clone(); }
  const kc = 1 - Math.exp(-dt * 3); camP.lerp(vv.pos, kc); camA.lerp(vv.alvo, kc);
  cam.position.copy(camP); cam.lookAt(camA);
  TER.update(scene, Object.assign(estado(u, relogio), { cam, rainAhead: Math.min(22, camP.distanceTo(camA) * 0.55), rainBox: 34 }));
  scene.background = null; scene.fog = null;
  if (nCorte++ % 30 === 0) aplicaCorte();
  renderer.render(scene, cam);
  // etiquetas só com o bloco parado no meio e a animação já terminada
  const parado = (alvo.g < 0.01 || alvo.g > 0.99) && Math.abs(alvo.u - u) < 0.02;
  const b = blocos[alvo.g > 0.5 ? alvo.j : alvo.i];
  rotulos(parado && b.v <= 11 ? ROT[Math.round(b.u)] : []);
}
window.SITE = { irPara, get u() { return u; }, get alvo() { return alvo; }, get ativo() { return ativo; }, qual: QUAL, BOX };
function iniciar() {
  try {
    TER.ensure(); refs(); caixa(); aplicaCorte(); leRolagem();
    u = alvo.u; pronto = true; $("estado3d").textContent = "modelo 3D · qualidade " + QUAL;
    requestAnimationFrame(laco);
  } catch (err) { console.error(err); $("estado3d").textContent = "Não foi possível montar o 3D: " + err.message; }
}
setTimeout(iniciar, 30);
