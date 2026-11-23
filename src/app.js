// app.js · modelo 3D interativo do controle de erosão (Montes Claros-MG)
// Usa o mesmo motor do vídeo (terreno.js / TER). A história é um número contínuo u (0 a 10):
// cada etapa i vai de u = i-1 até u = i. O botão "próxima" anima u; "anterior" e os pontos saltam.
import * as THREE from "three";
import { OrbitControls } from "../lib/OrbitControls.js";
window.THREE = THREE;

// ------------------------------------------------------------------ textos (edite à vontade)
const CONFIG = {
  titulo: "Controle de erosão e águas pluviais",
  subtitulo: "Montes Claros – MG · modelo 3D da solução proposta",
};
const ETAPAS = [
  { nome: "Terreno natural", dur: 0, desc: "Área quase plana do cerrado, com solo exposto e pouca vegetação. Em dias secos, nada indica o problema que a chuva vai causar." },
  { nome: "Começa a chover", dur: 5, desc: "A chuva forte encharca o solo. Quando ele não consegue mais absorver a água, formam-se poças e uma lâmina d'água começa a escorrer morro abaixo." },
  { nome: "Enxurrada e erosão em sulcos", dur: 7, desc: "Sem nada que a segure, a água se concentra nos pontos mais baixos, ganha velocidade e arrasta a terra, abrindo sulcos que viram valas." },
  { nome: "A voçoroca se abre", dur: 9, desc: "Chuva após chuva, as valas se aprofundam e as paredes perdem estabilidade e desabam. O resultado é a voçoroca: uma erosão profunda que só cresce." },
  { nome: "Terraços em nível", dur: 8, desc: "Primeira parte da solução: terraços (curvas de nível) acompanham a mesma altura do terreno. Eles funcionam como barreiras que seguram e infiltram a água antes que ela ganhe força." },
  { nome: "Canal central e ramais", dur: 8, desc: "No fundo da erosão entra um canal central. Dele saem ramais inclinados, formando uma espinha de peixe que recolhe a água das laterais e a conduz de forma organizada." },
  { nome: "Revestimento dos canais", dur: 6, desc: "Os canais são forrados com geomembrana sobre manta geotêxtil. O solo por onde a água passa fica protegido e a água escoa melhor, sem cavar novos sulcos." },
  { nome: "Paliçadas em X", dur: 8, desc: "No fim de cada ramal, logo antes do canal central, entra uma paliçada em X de madeira de eucalipto com manta de juta. Ela diminui a força da água e retém a terra que ela carrega." },
  { nome: "Caminho de pedras e reservatórios", dur: 7, desc: "No fim do canal, a água passa por um caminho de pedras, que desacelera e filtra. Depois chega a um reservatório no mesmo nível ou abaixo do canal, sem precisar subir." },
  { nome: "Chuva com o sistema funcionando", dur: 12, desc: "Na próxima chuva, a água é desacelerada, direcionada, retida e armazenada. Quando o reservatório enche, a boia abre a saída e o excesso vai para outro reservatório e para a irrigação." },
  { nome: "Resultado", dur: 7, desc: "Com a água sob controle, a erosão para de crescer e a vegetação volta a cobrir os taludes. A água que destruía o terreno agora é armazenada e reaproveitada." },
];
const N = ETAPAS.length, UMAX = N - 1, U_ANTES = 3, U_DEPOIS = UMAX;
document.getElementById("tituloTxt").textContent = CONFIG.titulo;
document.getElementById("subTxt").textContent = CONFIG.subtitulo;

// ------------------------------------------------------------------ qualidade conforme o aparelho
const fraco = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 700 || (navigator.hardwareConcurrency || 8) <= 4;
const QS = new URLSearchParams(location.search).get("q");
const QUAL = QS === "alta" ? "alta" : QS === "baixa" || (fraco && QS !== "media") ? "baixa" : "media";
window.TER_Q = { alta: { main: 1, patch: 1, rain: 6000, shadow: 2048 }, media: { main: 0.6, patch: 0.55, rain: 4000, shadow: 2048 }, baixa: { main: 0.42, patch: 0.38, rain: 2200, shadow: 1024 } }[QUAL];
const PIXEL = { alta: 2, media: 1.5, baixa: 1.25 }[QUAL];

// ------------------------------------------------------------------ renderizador, câmera, controles
const canvas = document.getElementById("cena");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
const ctl = new OrbitControls(cam, canvas);
ctl.enableDamping = true; ctl.dampingFactor = 0.08; ctl.screenSpacePanning = false;
ctl.minDistance = 3; ctl.maxDistance = 160; ctl.maxPolarAngle = Math.PI * 0.485; ctl.rotateSpeed = 0.7; ctl.zoomSpeed = 0.9;
ctl.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.fov = w < h ? 58 : 45; cam.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

// ------------------------------------------------------------------ utilitários
const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (a, b, k) => a + (b - a) * k;
const ease = x => { x = cl(x); return x * x * (3 - 2 * x); };
const eOut = x => 1 - Math.pow(1 - cl(x), 3);
const seg = (k, a, b) => cl((k - a) / Math.max(1e-4, b - a));
const K = (u, i) => cl(u - (i - 1));          // progresso local da etapa i (1..10)

let A = null;            // pontos de referência do mundo (preenchidos depois do build)
function refs() {
  const S1 = { R: 1, G: 1 }, BR = [1, 1, 1, 1, 1, 1, 1, 1];
  const along = (s, lat = 0) => { const p = TER.at(TER.MAIN, s), x = p[0] + Math.cos(p[2]) * lat, z = p[1] - Math.sin(p[2]) * lat; return [x, z]; };
  const g = (xz, R = 1, G = 1, up = 0) => [xz[0], TER.surface(xz[0], xz[1], R, G) + up, xz[1]];
  const pp = (n, u, up = 0) => { const p = TER.pathPt(n, u, S1); return [p[0], p[1] + up, p[2]]; };
  const RES = TER.RES, pal = k => { const f = TER.palFloor(TER.SYS.pal[k], { R: 1, G: 1, br: BR }); return [f[0], f[1] + 0.6, f[2]]; };
  A = {
    along, g, pp, pal, RES,
    meio: g(along(0.5), 0, 0), cabeca: g(along(0.3), 0, 0), voc: g(along(0.55, 0), 1, 1),
    sulco: g(along(0.42, 0), 1, 0.07, 0.1), rim: g(along(0.6, 7.5), 0, 0),
    cv: pp("cvb1", 0.22, 0.4), cc: pp("central", 0.45, 0.3), br: pp("br2", 0.55, 0.3), gt: pp("central", 0.3, 0.2),
    p3: pal(3), ped: pp("res", 0.45, 0.3), r1: [RES.cx, RES.top + 0.3, RES.cz], r2: [RES.t2[0], RES.t2[1] + 0.3, RES.t2[2]],
    boia: [RES.fxz[0], RES.top + 0.2, RES.fxz[1]], irr: RES.irr ? [RES.irr[0], RES.irr[1] + 0.2, RES.irr[2]] : null,
    tal: g(along(0.5, 6.5), 1, 1, 0.2),
  };
}

// ------------------------------------------------------------------ estado da história em função de u
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
  // desabamento da parede no meio da etapa 3
  if (u >= 2.6) { if (COLL.t === null) COLL.t = t - 30; o.collapse = COLL; } else COLL.t = null;
  // sedimento (terra correndo na enxurrada)
  o.sedOn = (u > 1.25 && u < 3.6) || (k9 > 0.05 && k10 < 0.6);
  if (k9 > 0.05) { o.sedBr = FOC; o.sedA = 0.08; o.sedB = TER.SYS.pal[FOC].u; o.sedStop = TER.SYS.pal[FOC].u; o.sedSp = 0.8; }
  // sistema
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
    if (rotOn && k9 > 0.15) o.arrows = flechas(0.9 * seg(k9, 0.15, 0.35) * (1 - seg(k10, 0, 0.5)));
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

// ------------------------------------------------------------------ vistas de câmera por etapa
// alvo = ponto olhado; off = deslocamento da câmera em relação ao alvo
function vista(i) {
  const R0 = A.RES, mx = (R0.cx + R0.t2[0]) / 2, mz = (R0.cz + R0.t2[2]) / 2;
  const P = TER.SYS.pal[FOC], q = TER.at(TER.SYS.br[P.br], P.u), dx = Math.sin(q[2]), dz = Math.cos(q[2]), pp = A.p3;
  const V = [
    { alvo: [1, -4, 0], pos: [-12, 48, 68] },
    { alvo: [1, -2, 6], pos: [-12, 20, 36] },
    { alvo: A.sulco, off: [14, 16, 22] },
    { alvo: A.voc, off: [-17, 15, 17] },
    { alvo: [0, -2, -27], pos: [-11, 25, 3] },
    { alvo: A.cc, off: [-7, 23, 12] },
    { alvo: A.gt, off: [-8, 12, -10.5] },
    { alvo: [pp[0], pp[1] - 0.3, pp[2]], pos: [pp[0] - dx * 4.2 - dz * 1.6, pp[1] + 3.0, pp[2] - dz * 4.2 + dx * 1.6] },
    { alvo: [mx, R0.top - 0.8, mz], off: [-7.5, 8, -5.5] },
    { alvo: [1, -3, 6], pos: [-14, 30, 42] },
    { alvo: [1, -3, 2], pos: [-20, 46, 64] },
  ][i];
  const pos = V.pos || [V.alvo[0] + V.off[0], V.alvo[1] + V.off[1], V.alvo[2] + V.off[2]];
  return { alvo: new THREE.Vector3(...V.alvo), pos: new THREE.Vector3(...pos) };
}
let voo = null;
function voar(i, dur = 2.2) {
  const v = vista(i); voo = { a0: ctl.target.clone(), p0: cam.position.clone(), a1: v.alvo, p1: v.pos, t: 0, d: dur };
}
function posVoo(dt) {
  if (!voo) return;
  voo.t += dt; const e = ease(voo.t / voo.d);
  ctl.target.lerpVectors(voo.a0, voo.a1, e);
  // arco: vai pelo caminho esférico em volta do alvo para não atravessar o terreno
  const r0 = voo.p0.clone().sub(voo.a0), r1 = voo.p1.clone().sub(voo.a1);
  const s0 = new THREE.Spherical().setFromVector3(r0), s1 = new THREE.Spherical().setFromVector3(r1);
  let dth = s1.theta - s0.theta; if (dth > Math.PI) dth -= 2 * Math.PI; if (dth < -Math.PI) dth += 2 * Math.PI;
  const s = new THREE.Spherical(mix(s0.radius, s1.radius, e), mix(s0.phi, s1.phi, e), s0.theta + dth * e);
  cam.position.copy(ctl.target).add(new THREE.Vector3().setFromSpherical(s));
  if (voo.t >= voo.d) voo = null;
}
ctl.addEventListener("start", () => { voo = null; });

// ------------------------------------------------------------------ etiquetas
const ROT = [
  [],
  [],
  [["SULCOS DE EROSÃO", "sulco", 0.5]],
  [["VOÇOROCA", "voc", 0.55]],
  [["TERRAÇOS EM NÍVEL", "cv", 0.55]],
  [["CANAL CENTRAL", "cc", 0.35], ["RAMAIS (ESPINHA DE PEIXE)", "br", 0.7]],
  [["GEOMEMBRANA + MANTA GEOTÊXTIL", "gt", 0.3]],
  [["PALIÇADA EM X", "p3", 0.25], ["MADEIRA DE EUCALIPTO + MANTA DE JUTA", "p3b", 0.7]],
  [["CAMINHO DE PEDRAS", "ped", 0.35], ["RESERVATÓRIO", "r1", 0.6], ["2º RESERVATÓRIO", "r2", 0.75]],
  [["ÁGUA CONDUZIDA", "cc", 0.2], ["TERRA RETIDA", "p3", 0.45], ["BOIA", "boia", 0.6], ["SAÍDA ABERTA → OUTRO RESERVATÓRIO E IRRIGAÇÃO", "r2", 0.82]],
  [["TALUDES REVEGETADOS", "tal", 0.4], ["ÁGUA ARMAZENADA", "r1", 0.6]],
];
const rotBox = document.getElementById("rotulos"), rotEls = new Map();
let rotOn = true;
function rotEl(txt) {
  let e = rotEls.get(txt);
  if (!e) { e = document.createElement("div"); e.className = "rot"; e.innerHTML = `<div class="ln"></div><div class="pt"></div><div class="tx"></div>`; e.querySelector(".tx").textContent = txt; rotBox.appendChild(e); rotEls.set(txt, e); }
  return e;
}
const _v = new THREE.Vector3();
function rotulos(u) {
  const vivos = new Set();
  if (rotOn && A) {
    const i = Math.min(N - 1, Math.ceil(u - 1e-6)), k = i === 0 ? 1 : K(u, i);
    const W = innerWidth, H = innerHeight, mob = W < 640;
    ROT[i].forEach(([txt, key, at], j) => {
      if (k < at) return;
      let p = key === "p3b" ? [A.p3[0], A.p3[1] - 0.3, A.p3[2]] : A[key]; if (!p) return;
      _v.set(...p).project(cam); if (_v.z > 1 || Math.abs(_v.x) > 1.05 || Math.abs(_v.y) > 1.05) return;
      const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      const e = rotEl(txt); vivos.add(txt);
      const tx = e.querySelector(".tx"), tw = tx.offsetWidth || txt.length * 9, dir = (x > W * 0.55 ? -1 : 1) * (j % 2 ? -1 : 1);
      const dx = (mob ? 34 : 60) * dir, dy = -(mob ? 46 : 70) - Math.floor(j / 2) * (mob ? 34 : 46);
      let lx = x + dx, ly = cl(y + dy, 70, H - (mob ? 190 : 200));
      if (dir > 0) lx = Math.min(lx, W - tw - 12); else lx = Math.max(lx, tw + 12);
      e.style.transform = `translate(${x}px, ${y}px)`; e.style.opacity = 1;
      const ln = e.querySelector(".ln"), ddx = lx - x, ddy = ly - y;
      ln.style.width = Math.hypot(ddx, ddy) + "px"; ln.style.transform = `rotate(${Math.atan2(ddy, ddx)}rad)`;
      tx.style.left = (dir > 0 ? ddx : ddx - tw) + "px"; tx.style.top = (ddy - 13) + "px";
    });
  }
  for (const [txt, e] of rotEls) if (!vivos.has(txt)) e.style.opacity = 0;
}

// ------------------------------------------------------------------ interface
const $ = id => document.getElementById(id);
let u = 0, alvoU = 0, velU = 0, camAuto = true, textoOn = true, painelOn = true;
const pontos = $("pontos");
ETAPAS.forEach((e, i) => { const b = document.createElement("button"); b.title = `${i + 1}. ${e.nome}`; b.setAttribute("aria-label", b.title); b.onclick = () => saltar(i); b.innerHTML = '<span class="bar" style="width:0"></span>'; pontos.appendChild(b); });
function ui() {
  const i = Math.round(alvoU);
  $("num").textContent = `Etapa ${i + 1} de ${N}`; $("nome").textContent = ETAPAS[i].nome; $("desc").textContent = ETAPAS[i].desc;
  $("ant").disabled = alvoU <= 0; $("prox").disabled = alvoU >= UMAX;
  $("bAntes").classList.toggle("on", Math.abs(alvoU - U_ANTES) < 0.01); $("bDepois").classList.toggle("on", Math.abs(alvoU - U_DEPOIS) < 0.01);
}
function barras() {
  [...pontos.children].forEach((b, i) => {
    const k = i === 0 ? (u >= 0 ? 1 : 0) : K(u, i);
    b.className = i === Math.round(alvoU) ? "atual" : k >= 1 ? "feito" : "";
    b.firstChild.style.width = (i === Math.round(alvoU) && k < 1 ? k * 100 : 0) + "%";
  });
}
function proxima() {
  if (alvoU >= UMAX) return;
  if (u < alvoU) u = alvoU;                  // termina a animação em curso
  alvoU = Math.min(UMAX, Math.round(alvoU) + 1);
  velU = 1 / Math.max(0.5, ETAPAS[alvoU].dur);
  if (camAuto) voar(alvoU); ui();
}
function veu(fn) { const v = $("veu"); v.style.opacity = 0.85; setTimeout(() => { fn(); setTimeout(() => v.style.opacity = 0, 60); }, 230); }
function saltar(i, comVeu = true) {
  const go = () => { u = alvoU = i; COLL.t = null; ui(); if (camAuto) voar(i, 0.01); };
  comVeu ? veu(go) : go();
}
function anterior() { if (alvoU > 0) saltar(Math.round(alvoU) - 1); }
$("prox").onclick = proxima; $("ant").onclick = anterior;
$("bAntes").onclick = () => saltar(U_ANTES); $("bDepois").onclick = () => saltar(U_DEPOIS);
function liga(btn, v) { $(btn).classList.toggle("on", v); }
$("bRot").onclick = () => { rotOn = !rotOn; liga("bRot", rotOn); };
$("bCam").onclick = () => { camAuto = !camAuto; liga("bCam", camAuto); if (camAuto) voar(Math.round(alvoU)); };
$("bCentro").onclick = () => voar(Math.round(alvoU), 1.4);
$("btnTexto").onclick = () => { textoOn = !textoOn; $("desc").classList.toggle("fechado", !textoOn); };
$("bPainel").onclick = () => { painelOn = !painelOn; $("painel").classList.toggle("oculto", !painelOn); liga("bPainel", !painelOn); };
$("bTela").onclick = () => { const d = document; if (!d.fullscreenElement) (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen || (() => {})).call(d.documentElement); else d.exitFullscreen && d.exitFullscreen(); };
addEventListener("keydown", e => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const k = e.key;
  if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); proxima(); }
  else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") { e.preventDefault(); anterior(); }
  else if (k === "Home") saltar(0); else if (k === "End") saltar(UMAX);
  else if (/^[aA]$/.test(k)) saltar(U_ANTES); else if (/^[dD]$/.test(k)) saltar(U_DEPOIS);
  else if (/^[lL]$/.test(k)) $("bRot").click(); else if (/^[cC]$/.test(k)) $("bCam").click();
  else if (/^[rR]$/.test(k)) $("bCentro").click(); else if (/^[hH]$/.test(k)) $("bPainel").click();
  else if (/^[tT]$/.test(k)) $("btnTexto").click(); else if (/^[fF]$/.test(k)) $("bTela").click();
});
// esconde a dica depois da primeira interação
const dica = $("dica"); let dicaT = setTimeout(() => dica.style.opacity = 0, 9000);
canvas.addEventListener("pointerdown", () => { clearTimeout(dicaT); dica.style.opacity = 0; }, { once: true });
if (matchMedia("(pointer: coarse)").matches) dica.textContent = "Arraste para girar · pinça para aproximar · dois dedos para mover";

// ------------------------------------------------------------------ partida e laço
let relogio = 0, ultimo = performance.now(), quadros = 0, tMed = 0;
window.APP = { get u() { return u; }, get alvo() { return alvoU; }, proxima, anterior, saltar: i => saltar(i, false), qual: QUAL, ms: () => tMed, cam, ctl, estado: () => estado(u, relogio) };
function iniciar() {
  try {
    TER.ensure(); refs();
    const v = vista(0); ctl.target.copy(v.alvo); cam.position.copy(v.pos); ctl.update();
    TER.update(scene, Object.assign(estado(0, 0), { cam }));
    ui(); requestAnimationFrame(laco);
    const c = $("carregando"); c.style.opacity = 0; setTimeout(() => c.remove(), 600);
  } catch (err) { console.error(err); $("erro").style.display = "block"; $("erro").textContent = "Não foi possível montar a cena 3D neste aparelho: " + err.message; }
}
function laco(now) {
  const dt = Math.min(0.1, (now - ultimo) / 1000); ultimo = now; relogio += dt;
  const pu = u; if (u < alvoU) { u = Math.min(alvoU, u + velU * dt); }
  if (pu < 2.6 && u >= 2.6) COLL.t = relogio;   // a parede desaba agora
  posVoo(dt); ctl.update();
  const t0 = performance.now();
  TER.update(scene, Object.assign(estado(u, relogio), { cam, rainAhead: Math.min(22, cam.position.distanceTo(ctl.target) * 0.55), rainBox: 34 }));
  renderer.render(scene, cam);
  tMed = mix(tMed, performance.now() - t0, 0.1);
  rotulos(u); barras();
  requestAnimationFrame(laco);
}
setTimeout(iniciar, 50);
