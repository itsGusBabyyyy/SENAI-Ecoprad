"use strict";
// terreno.js · episódio informativo "Erosão e águas pluviais" (Montes Claros-MG)
// Terreno que se deforma com a chuva. Determinístico: o quadro é função de (t, R, G).
//   R = sulcos (0..1): a água abre caminhos rasos.   G = ravinas e voçoroca (0..1): os caminhos se aprofundam.
// Um mundo só é compartilhado por todos os planos 3D: cada plano põe a câmera e chama TER.update(scene, {...}).
// Eixos: x = lado, z = morro abaixo (+z desce), y = cima. O canal principal (MAIN) vira a voçoroca.
// ajudantes do kit de vídeo (stage.js / stage3d.js) usados pelo motor
const lerp = (a, b, k) => a + (b - a) * k;
function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const THREE = window.THREE, c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const tx = new THREE.CanvasTexture(c); if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(repeat[0], repeat[1]); }
  tx.anisotropy = 4; return tx;
}
const _glowCache = {};
function glowTex(color = "#ffe6b0") {
  return _glowCache[color] ||= canvasTex(128, 128, (x, w) => {
    const gr = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, color); gr.addColorStop(0.3, color + "66"); gr.addColorStop(1, color + "00");
    x.fillStyle = gr; x.fillRect(0, 0, w, w);
  });
}
const TER = (() => {
  let T = null, WD = null;
  const Q = Object.assign({ main: 1, patch: 1, rain: 6000, shadow: 2048 }, window.TER_Q || {});   // qualidade (site interativo)
  const cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const sm = (a, b, x) => { const k = cl((x - a) / (b - a)); return k * k * (3 - 2 * k); };
  const mix = (a, b, k) => a + (b - a) * k;
  function h2(ix, iz, s) {
    let n = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16; return (n >>> 0) / 4294967296;
  }
  function vn(x, z, s) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = h2(ix, iz, s), b = h2(ix + 1, iz, s), c = h2(ix, iz + 1, s), d = h2(ix + 1, iz + 1, s);
    return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
  }
  function fbm(x, z, s, o = 4) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++) { v += a * (vn(x * f, z * f, s + i * 17) * 2 - 1); f *= 2.03; a *= 0.5; } return v; }
  function rng(seed) { let a = (seed * 2654435761) >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let x = a; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
  /** relevo original: quase plano, 5,5% de caimento para +z, ondulações suaves */
  const base = (x, z) => -0.055 * z + 0.45 * fbm(x * 0.045, z * 0.045, 1, 3) + 0.05 * fbm(x * 0.7, z * 0.7, 2, 2);

  // ------------------------------------------------------------------ canais (sulcos, afluentes, canal principal)
  const CH = [];
  const mainX = z => 1.0 + 2.6 * Math.sin(z * 0.07 + 0.5) + 1.1 * Math.sin(z * 0.19 + 1.3);
  function addCh(pts, o) {
    const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    const c = Object.assign({ pts, L, len: L[L.length - 1], bb: [x0, x1, z0, z1], kind: "rill", w: 0.6, d: 0.16, delay: 0,
      gdelay: 0, hR: 0.5, w0: 0.6, d0: 0.18, s0: 0.05, te: 0 }, o);
    CH.push(c); return c;
  }
  /** ponto do canal no parâmetro s (0 = cabeceira, 1 = foz): [x, z, ângulo da direção] */
  function at(c, s) {
    const Lq = cl(s) * c.len; let i = 1; while (i < c.L.length - 1 && c.L[i] < Lq) i++;
    const a = c.pts[i - 1], b = c.pts[i], k = (Lq - c.L[i - 1]) / Math.max(1e-6, c.L[i] - c.L[i - 1]);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, Math.atan2(b[0] - a[0], b[1] - a[1])];
  }
  let MAIN = null;
  function gen() {
    const r = rng(7);
    const mp = []; for (let z = -40; z <= 38.01; z += 1.5) mp.push([mainX(z), z]);
    MAIN = addCh(mp, { kind: "gully", w: 15, d: 6.5, s0: 0.14, hR: 0.62, w0: 0.8, d0: 0.34, delay: 0, gdelay: 0, te: 0.14 });
    const tribs = [[-17, -30, 2], [16, -24, 8], [-20, -8, 16], [19, 2, 22], [-14, 14, 28], [12, 18, 31]];
    tribs.forEach(([xs, zs, zj], i) => {
      const xj = mainX(zj), cx = xs * 0.35 + xj * 0.65, cz = (zs + zj) / 2 - 3, p = [];
      for (let k = 0; k <= 24; k++) {
        const u = k / 24;
        p.push([(1 - u) * (1 - u) * xs + 2 * u * (1 - u) * cx + u * u * xj + Math.sin(u * 9 + i) * 0.6 * (1 - u),
                (1 - u) * (1 - u) * zs + 2 * u * (1 - u) * cz + u * u * zj]);
      }
      addCh(p, { kind: "gully", w: 5.5 + r() * 2, d: 2.4 + r() * 1.2, s0: 0.06, hR: 0.5, delay: 0.12 + i * 0.06, gdelay: 0.12 + i * 0.07 });
    });
    const rill = (x, z, n, i, w, d, delay) => {
      const p = [[x, z]];
      for (let k = 0; k < n; k++) { x += (mainX(z) - x) * 0.04 + (r() - 0.5) * 0.45 + Math.sin(z * 0.5 + i) * 0.12; z += 1.0; p.push([x, z]); }
      addCh(p, { kind: "rill", w, d, delay });
    };
    for (let i = 0; i < 46; i++) rill(-26 + r() * 52, -42 + r() * 68, 10 + Math.floor(r() * 14), i, 0.4 + r() * 0.45, 0.14 + r() * 0.12, r() * 0.6);
    // sulcos finos na área dos closes (patch de alta resolução)
    [[-2.5, -7], [0.2, -6], [6.5, -7], [-4.5, -3], [5.8, -2], [-1.2, 1]].forEach(([x, z], i) => rill(x, z, 12, 50 + i, 0.3 + 0.08 * (i % 3), 0.1 + 0.03 * (i % 2), 0.02 + i * 0.05));
  }

  // ------------------------------------------------------------------ sistema (cenas 2 a 6): curvas de nível, canal central, ramais, paliçadas
  const SYS = { cv: [], central: null, br: [], out: null, pal: [], SA: 0.17, SB: 0.84 };
  const mkPath = (pts, o) => { const c = addCh(pts, o); CH.pop(); return c; };
  function contour(z0, x0, x1) {               // curva de nível: acompanha a altura do ponto central
    const h0 = base(mainX(z0), z0), pts = [];
    for (let x = x0; x <= x1 + 1e-6; x += 1) { let z = z0; for (let k = 0; k < 8; k++) z += (base(x, z) - h0) / 0.055; pts.push([x, z]); }
    return pts;
  }
  function genSys() {
    [[-35, 0], [-17, 13], [3, 13]].forEach(([z0, gap]) => SYS.cv.push(mkPath(contour(z0, -28, 28), { kind: "berm", gap, z0 })));
    SYS.central = mkPath(MAIN.pts, { kind: "sys", half: 0.95, depth: 0.75, sA: SYS.SA, sB: SYS.SB });
    // saída planejada da curva de cima até o início do canal central
    const c0 = SYS.cv[0], uc = (mainX(-35) + 28) / 56, q = at(c0, uc), J = at(MAIN, SYS.SA), op = [];
    for (let k = 0; k <= 8; k++) { const u = k / 8; op.push([mix(q[0], J[0], u), mix(q[1] - 1.05, J[1], u)]); }
    SYS.out = mkPath(op, { kind: "sys", half: 0.5, depth: 0.4, sA: 0, sB: 1 });
    SYS.uc = uc;
    [0.25, 0.32, 0.39, 0.46, 0.53, 0.6, 0.67, 0.74].forEach((sj, i) => {
      const side = i % 2 ? -1 : 1, Jp = at(MAIN, sj), a = Jp[2], dx = Math.sin(a), dz = Math.cos(a), nx = Math.cos(a) * side, nz = -Math.sin(a) * side;
      const L = 9, th = 55 * Math.PI / 180, tx = Jp[0] - dx * L * Math.cos(th) + nx * L * Math.sin(th), tz = Jp[1] - dz * L * Math.cos(th) + nz * L * Math.sin(th), p = [];
      for (let k = 0; k <= 10; k++) { const u = k / 10; p.push([mix(tx, Jp[0], u), mix(tz, Jp[1], u)]); }
      SYS.br.push(mkPath(p, { kind: "sys", half: 0.5, depth: 0.4, sA: 0, sB: 1, sj, side }));
      SYS.pal.push({ br: i, u: 0.8 });          // paliçada no fim do ramal, antes de a água cair no canal central
    });
  }
  const dEnd = sj => mix(0.27, 1, sm(SYS.SB, SYS.SB - 0.05, sj));
  function evalSys(F, o) {
    const add = F.add, cs = F.cs, ws = F.ws, lin = F.lin, bm = F.bm, mu = F.mu;
    add.fill(0); cs.fill(0); ws.fill(0); lin.fill(0); bm.fill(0); mu.fill(0);
    if (!o.sysOn) return;
    for (const Lk of F.slinks) {
      const c = Lk.c, { idx, d, s } = Lk;
      if (c.kind === "berm") {
        const fr = ((o.cv && o.cv[SYS.cv.indexOf(c)]) || 0) * 1.04; if (fr <= 0) continue;
        const wk = o.cvW || 0;
        for (let j = 0; j < idx.length; j++) {
          const i = idx[j], b = 1 - sm(fr - 0.03, fr, s[j]); if (b <= 0) continue;
          const x = F.P[2 * i], z = F.P[2 * i + 1], g = c.gap ? sm(c.gap, c.gap + 1.2, Math.abs(x - mainX(z))) : 1; if (g <= 0) continue;
          const sd = d[j], berm = 0.62 * Math.exp(-(((sd - 0.35) / 0.8) ** 2)), ditch = 0.36 * Math.exp(-(((sd + 1.05) / 0.55) ** 2)), k = b * g;
          add[i] += (berm - ditch) * k; bm[i] = Math.max(bm[i], k * sm(0.04, 0.25, berm + ditch));
          const w = wk * k * 0.2 * Math.exp(-(((sd + 1.05) / 0.4) ** 2)); if (w > ws[i]) { ws[i] = w; mu[i] = 1; }
        }
      } else {
        const isC = c === SYS.central, isO = c === SYS.out;
        const fr = isC ? (o.cc || 0) : isO ? (o.oc || 0) : ((o.br && o.br[SYS.br.indexOf(c)]) || 0); if (fr <= 0) continue;
        const sA = c.sA, sB = c.sB, sf = o.sf || 0, front = mix(sA, sB, fr) + (fr >= 1 ? 0.05 : 0);
        const wfront = isC ? mix(sA, sB, cl(sf * 1.25 - 0.25)) + (sf >= 1 ? 0.05 : 0) : cl(sf * 2.2) * 1.05;
        for (let j = 0; j < idx.length; j++) {
          const sj = s[j]; if (sj < sA - 0.004 || sj > sB) continue;
          const b = (1 - sm(front - 0.012, front, sj)) * sm(sA - 0.004, sA + 0.004, sj); if (b <= 0) continue;
          const x = Math.abs(d[j]) / c.half; if (x >= 1.4) continue;
          const i = idx[j], cut = c.depth * (isC ? dEnd(sj) : 1) * (1 - sm(0.55, 1, x)) * b;
          if (cut > cs[i]) cs[i] = cut;
          const lf = isC ? mix(sA, sB, o.gt || 0) + ((o.gt || 0) >= 1 ? 0.05 : 0) : (o.gt || 0) * 1.08;
          lin[i] = Math.max(lin[i], b * (1 - sm(1.05, 1.4, x)) * (1 - sm(lf - 0.01, lf, sj)));
          if (sf > 0 && sj <= wfront && x < 0.8) {
            const w = c.depth * (isC ? dEnd(sj) : 1) * 0.55 * (1 - x / 0.8) * b;
            if (w > ws[i]) { ws[i] = w; mu[i] = isC ? 0 : (sj < (o.mudU ?? 2) ? 1 : 0); }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ campo: distância de cada ponto a cada canal (pré-cálculo)
  function sample(P) {
    const n = P.length / 2, F = { P, n, base: new Float32Array(n), wn: new Float32Array(n), pud: new Float32Array(n), soil: new Float32Array(n),
      fan: new Float32Array(n), cut: new Float32Array(n), wd: new Float32Array(n), links: [] };
    const fx = mainX(38) + 0.5, fz = 41;
    for (let i = 0; i < n; i++) {
      const x = P[2 * i], z = P[2 * i + 1];
      F.base[i] = base(x, z); F.wn[i] = fbm(x * 0.35, z * 0.35, 9, 2); F.pud[i] = vn(x * 0.45, z * 0.45, 33); F.soil[i] = fbm(x * 0.12, z * 0.12, 5, 2);
      F.fan[i] = Math.exp(-((x - fx) ** 2 / 70 + (z - fz) ** 2 / 30)) * 1.1;
    }
    for (const c of CH) {
      const m = c.w * 0.5 * 1.7 + 0.5, idx = [], dd = [], ss = [], pts = c.pts;
      for (let i = 0; i < n; i++) {
        const x = P[2 * i], z = P[2 * i + 1];
        if (x < c.bb[0] - m || x > c.bb[1] + m || z < c.bb[2] - m || z > c.bb[3] + m) continue;
        let best = 1e9, bs = 0;
        for (let j = 1; j < pts.length; j++) {
          const ax = pts[j - 1][0], az = pts[j - 1][1], bx = pts[j][0] - ax, bz = pts[j][1] - az, l2 = bx * bx + bz * bz;
          const u = cl(((x - ax) * bx + (z - az) * bz) / l2), qx = ax + bx * u - x, qz = az + bz * u - z, d2 = qx * qx + qz * qz;
          if (d2 < best) { best = d2; bs = (c.L[j - 1] + u * (c.L[j] - c.L[j - 1])) / c.len; }
        }
        if (best < m * m) { idx.push(i); dd.push(Math.sqrt(best)); ss.push(bs); }
      }
      if (idx.length) F.links.push({ c, idx: Int32Array.from(idx), d: Float32Array.from(dd), s: Float32Array.from(ss) });
    }
    // caminhos do sistema: distância com sinal (+ = morro abaixo da linha)
    F.slinks = []; for (const k of ["add", "cs", "ws", "lin", "bm", "mu"]) F[k] = new Float32Array(n);
    for (const c of [...SYS.cv, SYS.central, SYS.out, ...SYS.br]) {
      const m = c.kind === "berm" ? 2.8 : c.half * 1.45 + 0.2, idx = [], dd = [], ss = [], pts = c.pts;
      for (let i = 0; i < n; i++) {
        const x = P[2 * i], z = P[2 * i + 1];
        if (x < c.bb[0] - m || x > c.bb[1] + m || z < c.bb[2] - m || z > c.bb[3] + m) continue;
        let best = 1e9, bs = 0, sg = 1;
        for (let j = 1; j < pts.length; j++) {
          const ax = pts[j - 1][0], az = pts[j - 1][1], bx = pts[j][0] - ax, bz = pts[j][1] - az, l2 = bx * bx + bz * bz;
          const u = cl(((x - ax) * bx + (z - az) * bz) / l2), qx = ax + bx * u - x, qz = az + bz * u - z, d2 = qx * qx + qz * qz;
          if (d2 < best) { best = d2; bs = (c.L[j - 1] + u * (c.L[j] - c.L[j - 1])) / c.len; sg = (bx * (z - az) - bz * (x - ax)) >= 0 ? 1 : -1; }
        }
        if (best < m * m) { idx.push(i); dd.push(Math.sqrt(best) * sg); ss.push(bs); }
      }
      if (idx.length) F.slinks.push({ c, idx: Int32Array.from(idx), d: Float32Array.from(dd), s: Float32Array.from(ss) });
    }
    return F;
  }
  /** estado de um canal: cabeceira (s), largura, profundidade, paredes (k: 0 = V, 1 = paredes a prumo e fundo chato) */
  function chState(c, R, G) {
    if (c.kind === "rill") {
      const g = cl((R - c.delay) / 0.3); if (g <= 0) return null; const e = 1 - Math.pow(1 - g, 3);
      return { head: 1 - e, W: c.w * (0.45 + 0.55 * e) * (1 + 0.5 * G), D: c.d * e * (1 + 0.6 * G), k: 0.45, wf: 0.6, tl: 0.12, te: 0 };
    }
    const rp = cl((R - c.delay) / 0.45); if (rp <= 0) return null;
    const gp = Math.pow(cl((G - c.gdelay) / Math.max(0.05, 1 - c.gdelay)), 1.15), er = 1 - Math.pow(1 - rp, 3);
    return { head: 1 - c.hR * er - (1 - c.hR - c.s0) * gp, W: c.w0 * er + (c.w - c.w0) * gp, D: c.d0 * er + (c.d - c.d0) * gp,
      k: Math.min(0.92, 0.45 + 0.6 * Math.pow(gp, 0.6)), wf: 0.55 - 0.32 * gp, tl: 0.07 - 0.055 * gp, te: c.te };
  }
  const halfAt = (st, sj, wn) => st.W * 0.5 * (0.7 + 0.3 * sj) * (1 + (0.1 + 0.25 * st.k) * wn);
  function evalField(F, R, G, flow, slump) {
    const cut = F.cut, wd = F.wd, wn = F.wn; cut.fill(0); wd.fill(0);
    for (const Lk of F.links) {
      const st = chState(Lk.c, R, G); if (!st) continue;
      const { idx, d, s } = Lk, sl = slump && slump.c === Lk.c && slump.amt > 0 ? slump : null;
      for (let j = 0; j < idx.length; j++) {
        const sj = s[j]; if (sj <= st.head) continue;
        const i = idx[j];
        let taper = sm(st.head, st.head + st.tl, sj); if (st.te) taper *= sm(1, 1 - st.te, sj);
        let half = halfAt(st, sj, wn[i]);
        if (sl) half *= 1 + sl.amt * Math.exp(-(((sj - sl.s) / 0.022) ** 2));
        const x = d[j] / half; if (x >= 1) continue;
        const v = 1 - x, bx = 1 - sm(0.6, 1, x), prof = v + (bx - v) * st.k;
        const c = st.D * (0.6 + 0.4 * sj) * taper * prof;
        if (c > cut[i]) cut[i] = c;
        if (flow > 0 && x < st.wf) {
          const w = flow * (0.04 + 0.26 * st.k + 0.25 * st.D * (1 - st.k)) * (1 - x / st.wf) * taper;
          const wc = Math.min(w, 0.45 * c + 0.008); if (wc > wd[i]) wd[i] = wc;
        }
      }
    }
  }
  /** fundo do canal no parâmetro s (centro): profundidade do corte e lâmina d'água */
  function centerAt(c, s, R, G, flow = 1) {
    const st = chState(c, R, G); if (!st || s <= st.head) return { cut: 0, wd: 0, half: 0, st };
    let taper = sm(st.head, st.head + st.tl, s); if (st.te) taper *= sm(1, 1 - st.te, s);
    const cc = st.D * (0.6 + 0.4 * s) * taper; return { cut: cc, wd: Math.min(flow * (0.04 + 0.26 * st.k + 0.25 * st.D * (1 - st.k)) * taper, 0.45 * cc + 0.008), half: halfAt(st, s, 0), st };
  }

  // ------------------------------------------------------------------ malhas
  const PAL = {};
  function palette() {
    const C = h => { const c = new T.Color(h); return [c.r, c.g, c.b]; };
    Object.assign(PAL, { a: C("#8f3d22"), b: C("#b2603a"), mud: C("#5a2e1e"), fan: C("#c4916a"),
      layers: ["#b5582f", "#d08a52", "#e6c09a", "#f0dcc0", "#d99a74", "#c4683c", "#e8cfae"].map(C), water: C("#9a5c36"), waterHi: C("#b88458"), sys: C("#3f9fd6"), sysHi: C("#8fd2f2"), stone: C("#6b6f70"), stone2: C("#53585a"), berm: C("#a5512f"), gr: C("#5d7a2e"), gr2: C("#7f8f3a") });
  }
  function grid(w, h, nx, nz, cx, cz) {
    const g = new T.PlaneGeometry(w, h, nx, nz); g.rotateX(-Math.PI / 2); g.translate(cx, 0, cz);
    const pos = g.attributes.position.array, n = pos.length / 3, P = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { P[2 * i] = pos[3 * i]; P[2 * i + 1] = pos[3 * i + 2]; }
    g.setAttribute("color", new T.BufferAttribute(new Float32Array(n * 3), 3));
    return { g, P };
  }
  function detailTex() {
    const r = rng(3);
    return canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = "#d8d8d8"; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) { const v = 150 + Math.floor(r() * 105); x.fillStyle = `rgb(${v},${v},${v})`; const s = 1 + r() * 4; x.fillRect(r() * w, r() * h, s, s); }
      for (let i = 0; i < 40; i++) { x.fillStyle = r() < 0.5 ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.08)"; x.beginPath(); x.ellipse(r() * w, r() * h, 10 + r() * 30, 6 + r() * 18, r() * 3, 0, 7); x.fill(); }
    }, { repeat: [1, 1] });
  }
  function streakTex() {
    const r = rng(11);
    return canvasTex(128, 256, (x, w, h) => {
      x.fillStyle = "rgba(178,178,178,0.92)"; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        const sx = r() * w, sy = r() * h, l = 20 + r() * 70;
        x.strokeStyle = `rgba(255,255,255,${0.5 + r() * 0.5})`; x.lineWidth = 1 + r() * 2.5;
        x.beginPath(); x.moveTo(sx, sy); x.bezierCurveTo(sx + 4, sy + l * 0.3, sx - 4, sy + l * 0.6, sx + (r() - 0.5) * 6, sy + l); x.stroke();
      }
    }, { repeat: [1, 1] });
  }
  function rippleTex() {   // mapa de normais de marolas (água correndo)
    const N = 128, hgt = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) hgt[y * N + x] = fbm(x / N * 8, y / N * 3, 71, 3);
    return canvasTex(N, N, (c) => {
      const im = c.createImageData(N, N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const hx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N], hy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
        const nx = -hx * 4, ny = -hy * 4, nz = 1, l = Math.hypot(nx, ny, nz), o = (y * N + x) * 4;
        im.data[o] = (nx / l * 0.5 + 0.5) * 255; im.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; im.data[o + 2] = (nz / l * 0.5 + 0.5) * 255; im.data[o + 3] = 255;
      }
      c.putImageData(im, 0, 0);
    }, { repeat: [1, 1], srgb: false });
  }
  function terrainMesh(w, h, nx, nz, cx, cz, det) {
    const { g, P } = grid(w, h, nx, nz, cx, cz);
    const tex = det.clone(); tex.needsUpdate = true; tex.repeat.set(w / 1.2, h / 1.2);
    const mat = new T.MeshStandardMaterial({ vertexColors: true, map: tex, bumpMap: tex, bumpScale: 1.2, roughness: 0.92, envMapIntensity: 0.5 });
    const M = new T.Mesh(g, mat); M.receiveShadow = true; M.castShadow = true;
    const wg = g.clone(); wg.setAttribute("color", new T.BufferAttribute(new Float32Array((P.length / 2) * 4), 4));
    const st = WD.streak.clone(); st.needsUpdate = true; st.repeat.set(w / 3, h / 5);
    const rp = WD.ripple.clone(); rp.needsUpdate = true; rp.repeat.set(w / 1.5, h / 2.5);
    const wm = new T.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, map: st, normalMap: rp, normalScale: new T.Vector2(0.7, 0.7), roughness: 0.14, metalness: 0.0, envMapIntensity: 0.75 });
    const Wm = new T.Mesh(wg, wm); Wm.renderOrder = 2;
    return { M, Wm, P, F: sample(P), st, rp, w, h };
  }

  // ------------------------------------------------------------------ mundo
  const PATCH = { x0: -6, x1: 8, z0: -8, z1: 12 };
  const inPatch = (x, z) => x > PATCH.x0 + 1e-3 && x < PATCH.x1 - 1e-3 && z > PATCH.z0 + 1e-3 && z < PATCH.z1 - 1e-3;
  function build() {
    T = window.THREE; Object.assign(Q, window.TER_Q || {}); palette(); gen(); genSys();
    const root = new T.Group();
    WD = { root, streak: streakTex(), det: detailTex(), coll: null }; WD.ripple = rippleTex();
    // céu encoberto (fundo + reflexo do molhado)
    const sky = canvasTex(256, 128, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#8f99a3"); g.addColorStop(0.3, "#b4bcc3"); g.addColorStop(0.5, "#c2c8cc"); g.addColorStop(0.52, "#7c6355"); g.addColorStop(1, "#3b2c24");
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 60; i++) { x.fillStyle = `rgba(${i % 2 ? 90 : 210},${i % 2 ? 98 : 214},${i % 2 ? 108 : 218},.10)`; x.beginPath(); x.ellipse((i * 47) % w, 8 + (i * 13) % 50, 30, 6, 0, 0, 7); x.fill(); }
    });
    sky.mapping = T.EquirectangularReflectionMapping;
    WD.sky = sky; WD.fog = new T.FogExp2("#b3bbc1", 0.0045);
    // luz difusa de dia nublado
    WD.hemi = new T.HemisphereLight("#c5ced6", "#6a3a26", 1.05); root.add(WD.hemi);
    const sun = new T.DirectionalLight("#f6f0e4", 2.3); sun.position.set(-52, 34, -8); sun.target.position.set(0, 0, 0);
    sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow); Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 200 });
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; root.add(sun, sun.target); WD.sun = sun;
    // terreno principal (0,25 m) + patch dos closes (7 cm)
    WD.main = terrainMesh(60, 96, Math.round(240 * Q.main), Math.round(384 * Q.main), 0, 2, WD.det);
    WD.patch = terrainMesh(PATCH.x1 - PATCH.x0, PATCH.z1 - PATCH.z0, Math.round(200 * Q.patch), Math.round(280 * Q.patch), (PATCH.x0 + PATCH.x1) / 2, (PATCH.z0 + PATCH.z1) / 2, WD.det);
    root.add(WD.main.M, WD.main.Wm, WD.patch.M, WD.patch.Wm);
    // chão de fora (baixa resolução, 5 cm abaixo) + morros no horizonte
    const out = grid(900, 900, 150, 150, 0, 0), op = out.g.attributes.position.array, oc = out.g.attributes.color.array;
    for (let i = 0; i < op.length / 3; i++) {
      const x = op[3 * i], z = op[3 * i + 2], d = Math.max(Math.abs(x) - 30, Math.abs(z - 2) - 48, 0);
      const din = Math.min(30 - Math.abs(x), 48 - Math.abs(z - 2)); op[3 * i + 1] = base(x, z) - 0.05 - (din > 7 ? 14 : d > 0 ? 0 : 0.02);   // por dentro do terreno fica bem abaixo (não cobre a voçoroca)
      const k = sm(5, 80, d) * sm(-0.2, 0.5, fbm(x * 0.02, z * 0.02, 41, 3) + 0.2), s = sm(-0.35, 0.45, fbm(x * 0.12, z * 0.12, 5, 2));
      oc[3 * i] = mix(mix(PAL.a[0], PAL.b[0], s), 0.11, k); oc[3 * i + 1] = mix(mix(PAL.a[1], PAL.b[1], s), 0.115, k); oc[3 * i + 2] = mix(mix(PAL.a[2], PAL.b[2], s), 0.05, k);
    }
    out.g.computeVertexNormals();
    const otex = WD.det.clone(); otex.needsUpdate = true; otex.repeat.set(500, 500);
    const outer = new T.Mesh(out.g, new T.MeshStandardMaterial({ vertexColors: true, map: otex, roughness: 0.95, envMapIntensity: 0.4 }));
    outer.receiveShadow = true; root.add(outer); WD.outer = outer;
    const hm = new T.MeshStandardMaterial({ color: "#66704f", roughness: 1 }), r = rng(21);
    for (let i = 0; i < 9; i++) {
      const a = -2.4 + i * 0.6 + r() * 0.3, R = 300 + r() * 120, m = new T.Mesh(new T.SphereGeometry(1, 24, 12), hm);
      m.scale.set(90 + r() * 80, 18 + r() * 26, 60 + r() * 40); m.position.set(Math.sin(a) * R, base(0, -Math.cos(a) * R) - 6, -Math.cos(a) * R); root.add(m);
    }
    vegetation(root); fence(root); WD.rain = rain(root, Q.rain); WD.splash = splashes(root, 700); WD.sed = sediment(root, 420); WD.coll = collapse(root); buildWorks(root);
    WD.F_inst = sample(WD.instP);
    WD.ready = true;
  }

  // ------------------------------------------------------------------ cerrado: capim, arbustos, árvores tortas
  function mergeGeos(list) {
    const parts = list.map(g => g.index ? g.toNonIndexed() : g), n = parts.reduce((k, g) => k + g.attributes.position.count, 0);
    const out = new T.BufferGeometry(), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
    for (const g of parts) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
    out.setAttribute("position", new T.BufferAttribute(pos, 3)); out.setAttribute("normal", new T.BufferAttribute(nor, 3)); out.setAttribute("uv", new T.BufferAttribute(uv, 2));
    return out;
  }
  function grassTex() {
    const r = rng(13);
    return canvasTex(128, 96, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      for (let i = 0; i < 46; i++) {
        const bx = w * (0.15 + 0.7 * r()), lean = (r() - 0.5) * 50, top = h * (0.05 + 0.55 * r()), v = r();
        x.strokeStyle = v < 0.55 ? `rgb(${168 + r() * 30},${140 + r() * 25},${78 + r() * 20})` : `rgb(${110 + r() * 20},${112 + r() * 20},${56 + r() * 12})`;
        x.lineWidth = 1.5 + r() * 2; x.beginPath(); x.moveTo(bx, h); x.quadraticCurveTo(bx + lean * 0.3, h * 0.6, bx + lean, top); x.stroke();
      }
    });
  }
  function vegetation(root) {
    const r = rng(5), P = [];
    const ga = new T.PlaneGeometry(0.46, 0.34); ga.translate(0, 0.17, 0); const gb = ga.clone(); gb.rotateY(Math.PI / 2); const gc = ga.clone(); gc.rotateY(Math.PI / 4);
    const tuftG = mergeGeos([ga, gb, gc]);
    const shrubG = new T.IcosahedronGeometry(0.45, 0); shrubG.scale(1, 0.7, 1); shrubG.translate(0, 0.22, 0);
    const trunkG = new T.CylinderGeometry(0.07, 0.12, 1.8, 6); trunkG.translate(0, 0.9, 0);
    // árvore torta do cerrado: copa rala em tufos separados
    const blob = (x, y, z, s) => { const g = new T.IcosahedronGeometry(s, 0); g.scale(1.3, 0.6, 1.1); g.translate(x, y, z); return g; };
    const crownG = mergeGeos([blob(0.3, 2.0, 0, 0.85), blob(-0.7, 1.8, 0.3, 0.6), blob(0.1, 2.35, -0.6, 0.55), blob(0.9, 1.75, 0.5, 0.45)]);
    trunkG.translate(0, 0, 0); { const a = trunkG.attributes.position; for (let i = 0; i < a.count; i++) { const y = a.getY(i); a.setX(i, a.getX(i) + Math.sin(y * 2.2) * 0.18); } trunkG.computeVertexNormals(); }
    const tufts = [], shrubs = [], trees = [];
    const clear = (x, z, m) => Math.abs(x - mainX(z)) > m;            // longe do canal principal (futura voçoroca)
    for (let i = 0; i < 4200; i++) {
      const x = -29 + r() * 58, z = -45 + r() * 94;
      if (fbm(x * 0.15, z * 0.15, 61, 2) < -0.05) continue;                   // capim em manchas, com chão nu entre elas
      tufts.push({ x, z, s: 0.55 + r() * 0.7, ry: r() * 6.3, c: r() });
    }
    for (let i = 0; i < 120; i++) { const x = -29 + r() * 58, z = -45 + r() * 94; if (clear(x, z, 2.5)) shrubs.push({ x, z, s: 0.5 + r() * 0.7, ry: r() * 6.3 }); }
    for (let i = 0; i < 60 && trees.length < 26; i++) {
      const x = -29 + r() * 58, z = -45 + r() * 94;
      if (!clear(x, z, 11) || (x > PATCH.x0 - 6 && x < PATCH.x1 + 6 && z > PATCH.z0 - 6 && z < PATCH.z1 + 10)) continue;
      trees.push({ x, z, s: 0.75 + r() * 0.5, ry: r() * 6.3, tl: (r() - 0.5) * 0.25 });
    }
    // fora do terreno (horizonte)
    const far = [];
    for (let i = 0; i < 900; i++) {
      const a = r() * 6.283, R = 40 + Math.pow(r(), 0.7) * 260, x = Math.sin(a) * R, z = 2 - Math.cos(a) * R;
      if (Math.abs(x) < 31 && Math.abs(z - 2) < 49) continue;
      far.push({ x, z, s: 0.8 + r() * 0.8, ry: r() * 6.3, tl: (r() - 0.5) * 0.3 });
    }
    const all = tufts.concat(shrubs, trees); for (const p of all) P.push(p.x, p.z);
    WD.instP = Float32Array.from(P);
    const mk = (geo, mat, n) => { const m = new T.InstancedMesh(geo, mat, n); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; root.add(m); return m; };
    const tuftM = mk(tuftG, new T.MeshStandardMaterial({ map: grassTex(), alphaTest: 0.45, side: T.DoubleSide, roughness: 1 }), tufts.length);
    tuftM.castShadow = false;
    const ca = new T.Color("#ffffff"), cb = new T.Color("#c9c0a0"), cc = new T.Color();
    tufts.forEach((p, i) => tuftM.setColorAt(i, cc.copy(ca).lerp(cb, p.c)));
    const shrubM = mk(shrubG, new T.MeshStandardMaterial({ color: "#4f5a2c", roughness: 1, flatShading: true }), shrubs.length);
    const trunkM = mk(trunkG, new T.MeshStandardMaterial({ color: "#3e2e22", roughness: 1 }), trees.length + far.length);
    const crownM = mk(crownG, new T.MeshStandardMaterial({ color: "#56612f", roughness: 1, flatShading: true }), trees.length + far.length);
    WD.veg = { tufts, shrubs, trees, far, tuftM, shrubM, trunkM, crownM, o: new T.Object3D() };
  }
  function fence(root) {
    const mat = new T.MeshStandardMaterial({ color: "#5b4632", roughness: 1 }), g = new T.CylinderGeometry(0.05, 0.06, 1.4, 5);
    const pts = [];
    for (let z = -44; z <= 48; z += 3) { const m = new T.Mesh(g, mat), y = base(-28, z); m.position.set(-28, y + 0.6, z); m.rotation.z = Math.sin(z) * 0.05; m.castShadow = true; root.add(m); pts.push([-28, y, z]); }
    const lm = new T.LineBasicMaterial({ color: "#3d3a36", transparent: true, opacity: 0.8 });
    for (const hgt of [0.55, 0.9, 1.22]) {
      const gg = new T.BufferGeometry().setFromPoints(pts.map(p => new T.Vector3(p[0], p[1] + hgt, p[2])));
      root.add(new T.Line(gg, lm));
    }
  }

  // ------------------------------------------------------------------ chuva, respingos, sedimento, desabamento
  function rain(root, n) {
    const pos = new Float32Array(n * 6), q = new Float32Array(n * 3), r = rng(9);
    for (let i = 0; i < n * 3; i++) q[i] = r();
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3));
    const m = new T.LineBasicMaterial({ color: "#e4e9ee", transparent: true, opacity: 0.42, depthWrite: false });
    const L = new T.LineSegments(g, m); L.frustumCulled = false; L.renderOrder = 3; root.add(L);
    return { L, update(t, c, k = 1, box = 30, len = 0.7) {
      const by = box, wind = 0.16;
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        if (i / n > k) { pos[o + 1] = pos[o + 4] = -9999; continue; }
        const fall = (t * 11 * (0.85 + 0.3 * q[i * 3 + 2]) + q[i * 3 + 1] * by) % by;
        const x = c[0] + (q[i * 3] - 0.5) * box + wind * fall, y = c[1] + by / 2 - fall, z = c[2] + (q[i * 3 + 2] - 0.5) * box;
        pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; pos[o + 3] = x - wind * len; pos[o + 4] = y + len; pos[o + 5] = z;
      }
      g.attributes.position.needsUpdate = true; m.opacity = 0.42;
    } };
  }
  function splashes(root, n) {
    const pos = new Float32Array(n * 3), g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3));
    const m = new T.PointsMaterial({ map: glowTex("#ffffff"), color: "#f2f4f6", size: 0.035, transparent: true, depthWrite: false, opacity: 0.55 });
    const Pt = new T.Points(g, m); Pt.frustumCulled = false; root.add(Pt);
    return { Pt, update(t, c, rad, k, surf) {
      for (let i = 0; i < n; i++) {
        const per = 0.32 + h2(i, 1, 3) * 0.2, ph = h2(i, 2, 3), cyc = Math.floor(t / per + ph), lt = (t / per + ph) - cyc;
        if (!c || i / n > k || lt > 0.22) { pos[i * 3 + 1] = -9999; continue; }
        const a = h2(i, cyc, 5) * 6.283, d = Math.sqrt(h2(i, cyc, 6)) * rad, x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d;
        pos[i * 3] = x; pos[i * 3 + 1] = surf(x, z) + 0.02 + lt * 0.12; pos[i * 3 + 2] = z;
      }
      g.attributes.position.needsUpdate = true;
    } };
  }
  function sediment(root, n) {
    const g = new T.DodecahedronGeometry(1, 0), m = new T.MeshStandardMaterial({ color: "#4e2816", roughness: 1, flatShading: true });
    const M = new T.InstancedMesh(g, m, n); M.frustumCulled = false; M.castShadow = true; root.add(M);
    const o2 = new T.Object3D();
    return { M, update(t, o) {
      const on = !!o.sedOn, sys = (o.cc || 0) > 0, sA = o.sedA ?? 0.47, sB = o.sedB ?? 0.66, stop = o.sedStop, spd = o.sedSp ?? 1;
      if (on && o.sedBr != null) {                       // barro descendo o ramal e parando na manta da paliçada
        const c = SYS.br[o.sedBr];
        for (let i = 0; i < n; i++) {
          const q = h2(i, 7, 1), q2 = h2(i, 8, 1), q3 = h2(i, 9, 1), sp = (0.45 + 0.7 * q3) * spd;
          let u = Math.min(((q + t * sp / c.len / (sB - sA)) % 1) * 1.3, 1), s2 = sA + u * (sB - sA);
          if (stop != null) s2 = Math.min(s2, stop - 0.012 - 0.05 * q2 * q3);
          const p = at(c, s2), lat = (q2 - 0.5) * 0.65, piled = stop != null && u >= 1;
          const y = surface(p[0], p[1], o.R, o.G) - 0.4 + (piled ? 0.04 + 0.18 * q * (1 - q2) : 0.23 + 0.01 * q);
          o2.position.set(p[0] + Math.cos(p[2]) * lat, y, p[1] - Math.sin(p[2]) * lat);
          o2.rotation.set(piled ? q * 6 : t * (2 + q * 5) * spd, piled ? q2 * 6 : t * (3 + q2 * 4) * spd, q3 * 6);
          o2.scale.setScalar((0.007 + 0.02 * q * q2) * 1.5); o2.updateMatrix(); M.setMatrixAt(i, o2.matrix);
        }
        M.instanceMatrix.needsUpdate = true; return;
      }
      for (let i = 0; i < n; i++) {
        const q = h2(i, 7, 1), q2 = h2(i, 8, 1), q3 = h2(i, 9, 1);
        const sp = (0.45 + 0.7 * q3) * spd; let u = (q + t * sp / MAIN.len / (sB - sA)) % 1;
        if (stop != null) u = Math.min(u * 1.3, 1);
        let s2 = sA + u * (sB - sA); if (stop != null) s2 = Math.min(s2, stop - 0.003 - 0.012 * q2 * q3);
        const ce = centerAt(MAIN, s2, o.R, o.G, o.flow);
        if (!on || (!sys && (ce.cut <= 0.02 || ce.wd <= 0.005))) { o2.scale.setScalar(0); o2.updateMatrix(); M.setMatrixAt(i, o2.matrix); continue; }
        const p = at(MAIN, s2), lat = (q2 - 0.5) * (sys ? 1.1 : ce.half * 0.55), de = dEnd(s2);
        const piled = stop != null && s2 < stop - 0.002 && u >= 1;
        const y = sys ? base(p[0], p[1]) - ce.cut - 0.75 * de + (piled ? 0.05 + 0.25 * q * (1 - q2) : 0.42 * de + 0.01 * q) : base(p[0], p[1]) - ce.cut + ce.wd + 0.004 + 0.01 * q;
        o2.position.set(p[0] + Math.cos(p[2]) * lat, y, p[1] - Math.sin(p[2]) * lat);
        o2.rotation.set(piled ? q * 6 : t * (2 + q * 5) * spd, piled ? q2 * 6 : t * (3 + q2 * 4) * spd, q3 * 6);
        o2.scale.setScalar((0.007 + 0.02 * q * q2) * (sys ? 1.6 : 1)); o2.updateMatrix(); M.setMatrixAt(i, o2.matrix);
      }
      M.instanceMatrix.needsUpdate = true;
    } };
  }
  // desabamento da parede da ravina: torrões caem no fundo, poeira de terra molhada
  function collapse(root) {
    const g = new T.DodecahedronGeometry(1, 0), m = new T.MeshStandardMaterial({ color: "#8a4128", roughness: 1, flatShading: true });
    const r = rng(17), parts = [];
    for (let i = 0; i < 9; i++) { const M = new T.Mesh(g, m); M.castShadow = M.receiveShadow = true; M.visible = false; root.add(M);
      parts.push({ M, s: 0.18 + r() * 0.5, ds: (r() - 0.5) * 0.04, h: r(), sp: 0.6 + r() * 0.8, ry: r() * 6, out: 0.3 + r() * 1.4 }); }
    const dn = 160, dpos = new Float32Array(dn * 3), dg = new T.BufferGeometry(); dg.setAttribute("position", new T.BufferAttribute(dpos, 3));
    const dm = new T.PointsMaterial({ map: glowTex("#c49a78"), color: "#b88a66", size: 0.7, transparent: true, depthWrite: false, opacity: 0 });
    const D = new T.Points(dg, dm); D.frustumCulled = false; root.add(D);
    return { parts, D, dm, dpos, dg, cfg: null };
  }

  // ------------------------------------------------------------------ obras: paliçadas, manta, reservatório, trator e setas de fluxo
  let RES = null;
  function juteTex() {
    const r = rng(29);
    return canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = "#b39462"; x.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 4) { x.fillStyle = `rgba(70,48,24,${0.25 + r() * 0.2})`; x.fillRect(i, 0, 1.5, h); x.fillRect(0, i, w, 1.5); }
      for (let i = 0; i < 500; i++) { x.strokeStyle = r() < 0.5 ? "rgba(220,196,150,.35)" : "rgba(80,56,30,.3)"; x.lineWidth = 1; const a = r() * w, b = r() * h; x.beginPath(); x.moveTo(a, b); x.lineTo(a + (r() - 0.5) * 10, b + (r() - 0.5) * 10); x.stroke(); }
    });
  }
  function buildWorks(root) {
    const wood = new T.MeshStandardMaterial({ color: "#8a6440", roughness: 1 });
    const sg = new T.CylinderGeometry(0.04, 0.05, 1.2, 7);
    const jm = new T.MeshStandardMaterial({ map: juteTex(), side: T.DoubleSide, roughness: 1 });
    const mg = new T.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mm = new T.MeshStandardMaterial({ color: "#6b3a22", roughness: 1, map: WD.det });
    SYS.pal.forEach(P => {
      const g = new T.Group(); root.add(g); P.g = g; P.st = [];
      for (let k = 0; k < 2; k++) for (const tl of [-0.45, 0.45]) { const m = new T.Mesh(sg, wood); m.castShadow = true; g.add(m); P.st.push({ m, off: (k - 0.5) * 0.6, tl, dl: (k * 2 + (tl > 0 ? 1 : 0)) / 4 }); }
      const rail = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 1.35, 6), wood); rail.rotation.z = Math.PI / 2; rail.castShadow = true; g.add(rail); P.rail = rail;
      const mgeo = new T.PlaneGeometry(1.25, 0.52); mgeo.translate(0, -0.26, 0);
      const man = new T.Mesh(mgeo, jm); man.castShadow = true; g.add(man); P.man = man;
      const mo = new T.Mesh(mg, mm); mo.receiveShadow = true; mo.castShadow = true; g.add(mo); P.mo = mo;
      g.visible = false;
    });
    // reservatório: dentro da parte baixa da voçoroca, no mesmo nível ou abaixo do fim do canal
    const e = at(MAIN, SYS.SB), a = e[2], dirx = Math.sin(a), dirz = Math.cos(a), nx = Math.cos(a), nz = -Math.sin(a);
    const gf = s2 => { const q = at(MAIN, s2); return base(q[0], q[1]) - centerAt(MAIN, s2, 1, 1).cut; };
    const y1 = gf(SYS.SB) - 0.75 * dEnd(SYS.SB);            // fundo do canal no fim
    const m0 = at(MAIN, SYS.SB + 7.6 / MAIN.len), r = 3.1, cx = m0[0] - nx * 1.2, cz = m0[1] - nz * 1.2, top = y1 - 0.45, bot = top - 2.4;
    const r2 = 1.7, c2x = m0[0] + nx * 3.3 + dirx * 3.6, c2z = m0[1] + nz * 3.3 + dirz * 3.6, top2 = top - 0.6, bot2 = top2 - 1.8;
    RES = { cx, cz, r, top, bot, y1, a, e, pads: [{ cx, cz, r, top, bot }, { cx: c2x, cz: c2z, r: r2, top: top2, bot: bot2 }], paths: {} };
    const conc = new T.MeshStandardMaterial({ color: "#a7a49c", roughness: 0.85, map: WD.det }), innM = new T.MeshStandardMaterial({ color: "#8d8a83", roughness: 0.9, side: T.BackSide, map: WD.det });
    const rg = new T.Group(); root.add(rg); RES.g = rg;
    const wr = WD.ripple.clone(); wr.needsUpdate = true; wr.repeat.set(3, 3); RES.wr = wr;
    const wmat = new T.MeshStandardMaterial({ color: "#3d8fc6", roughness: 0.06, envMapIntensity: 1.1, normalMap: wr, normalScale: new T.Vector2(0.5, 0.5), transparent: true, opacity: 0.93 });
    function tank(tx, tz, tr, tt, tb) {
      const h = tt - tb, out = new T.Mesh(new T.CylinderGeometry(tr, tr, h, 64, 1, true), conc); out.position.set(tx, tb + h / 2, tz);
      const inn = new T.Mesh(new T.CylinderGeometry(tr - 0.2, tr - 0.2, h, 64, 1, true), innM); inn.position.copy(out.position);
      const rimG = new T.RingGeometry(tr - 0.2, tr + 0.6, 64); rimG.rotateX(-Math.PI / 2); const rim = new T.Mesh(rimG, conc); rim.position.set(tx, tt, tz);
      const flG = new T.CircleGeometry(tr - 0.2, 48); flG.rotateX(-Math.PI / 2); const fl = new T.Mesh(flG, new T.MeshStandardMaterial({ color: "#6f6c66", roughness: 1 })); fl.position.set(tx, tb + 0.02, tz);
      for (const m of [out, inn, rim, fl]) { m.castShadow = m.receiveShadow = true; rg.add(m); }
      const wG = new T.CircleGeometry(tr - 0.2, 64); wG.rotateX(-Math.PI / 2); const w = new T.Mesh(wG, wmat); w.position.set(tx, tb + 0.1, tz); rg.add(w); return w;
    }
    RES.water = tank(cx, cz, r, top, bot); RES.water2 = tank(c2x, c2z, r2, top2, bot2);
    // caminho de pedras: do fim do canal até a parede do reservatório, descendo
    const ex = e[0], ez = e[1], vx = ex - cx, vz = ez - cz, vl = Math.hypot(vx, vz), wx = cx + vx / vl * (r + 0.1), wz = cz + vz / vl * (r + 0.1);
    RES.paths.res = [[ex, y1 + 0.18, ez], [wx, top + 0.05, wz]];
    const sr = rng(31), stG = new T.DodecahedronGeometry(1, 0), NS = 230, stM = new T.InstancedMesh(stG, new T.MeshStandardMaterial({ color: "#7a766f", roughness: 1, flatShading: true }), NS), ob = new T.Object3D();
    const plen = Math.hypot(wx - ex, wz - ez), px = -(wz - ez) / plen, pz = (wx - ex) / plen;
    for (let i = 0; i < NS; i++) {
      const u = sr(), lat = (sr() - 0.5) * 1.9, x = mix(ex, wx, u) + px * lat, z = mix(ez, wz, u) + pz * lat, y = mix(y1 - 0.02, top - 0.12, u);
      ob.position.set(x, y + sr() * 0.06, z); ob.rotation.set(sr() * 3, sr() * 3, sr() * 3); ob.scale.set(0.1 + sr() * 0.14, 0.07 + sr() * 0.08, 0.1 + sr() * 0.14); ob.updateMatrix(); stM.setMatrixAt(i, ob.matrix);
    }
    stM.castShadow = stM.receiveShadow = true; rg.add(stM);
    const sw = new T.Mesh(new T.BoxGeometry(1.1, 0.03, plen), wmat.clone()); sw.position.set((ex + wx) / 2, (y1 + top) / 2 + 0.08, (ez + wz) / 2); sw.lookAt(wx, top + 0.05, wz); rg.add(sw); RES.chw = sw;
    // boia + saída: quando o nível sobe demais, a boia levanta a haste e abre a válvula
    const ux = (c2x - cx), uz = (c2z - cz), ul = Math.hypot(ux, uz), ox = ux / ul, oz = uz / ul;
    const pipeM = new T.MeshStandardMaterial({ color: "#5e6a70", roughness: 0.5, metalness: 0.35 });
    const pipe = (p0, p1, rad = 0.13) => { const v0 = new T.Vector3(...p0), v1 = new T.Vector3(...p1), m = new T.Mesh(new T.CylinderGeometry(rad, rad, v0.distanceTo(v1), 12), pipeM);
      m.position.copy(v0).add(v1).multiplyScalar(0.5); m.lookAt(v1); m.rotateX(Math.PI / 2); m.castShadow = true; rg.add(m); return m; };
    const oy = top - 0.3, o0 = [cx + ox * (r - 0.05), oy, cz + oz * (r - 0.05)], tee = [cx + ox * (r + 0.45), oy - 0.03, cz + oz * (r + 0.45)];
    const t2in = [c2x - ox * (r2 - 0.1), top2 + 0.12, c2z - oz * (r2 - 0.1)], irrEnd = [tee[0] + dirx * 6.5, oy - 0.45, tee[2] + dirz * 6.5];
    pipe(o0, tee); pipe(tee, t2in); pipe(tee, irrEnd);
    const teeB = new T.Mesh(new T.BoxGeometry(0.36, 0.36, 0.36), pipeM); teeB.position.set(...tee); rg.add(teeB);
    RES.paths.pipeA = [[tee[0], tee[1] + 0.22, tee[2]], [t2in[0], t2in[1] + 0.22, t2in[2]]];
    RES.paths.pipeB = [[tee[0], tee[1] + 0.22, tee[2]], [irrEnd[0], irrEnd[1] + 0.22, irrEnd[2]]];
    RES.irr = irrEnd; RES.t2 = [c2x, top2, c2z]; RES.r2 = r2; RES.top2 = top2; RES.bot2 = bot2;
    const vb = new T.Mesh(new T.BoxGeometry(0.42, 0.34, 0.42), new T.MeshStandardMaterial({ color: "#3f4a52", roughness: 0.5, metalness: 0.4 })); vb.position.set(cx + ox * (r - 0.1), top + 0.17, cz + oz * (r - 0.1)); vb.castShadow = true; rg.add(vb);
    RES.lamp = new T.Mesh(new T.SphereGeometry(0.08, 12, 8), new T.MeshBasicMaterial({ color: "#d23b2f" })); RES.lamp.position.set(cx + ox * (r - 0.1), top + 0.4, cz + oz * (r - 0.1)); rg.add(RES.lamp);
    const fg = new T.Group(); rg.add(fg); RES.float = fg;
    const fb = new T.Mesh(new T.SphereGeometry(0.26, 24, 14), new T.MeshStandardMaterial({ color: "#f07f1e", roughness: 0.4 })); fb.castShadow = true; fg.add(fb);
    const band = new T.Mesh(new T.TorusGeometry(0.255, 0.03, 8, 32), new T.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.4 })); band.rotation.x = Math.PI / 2; fg.add(band);
    RES.arm = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 1, 8), pipeM); rg.add(RES.arm);
    RES.pivot = [cx + ox * (r - 0.2), top + 0.12, cz + oz * (r - 0.2)]; RES.fxz = [cx + ox * (r - 1.05), cz + oz * (r - 1.05)];
    RES.stream = new T.Mesh(new T.CylinderGeometry(0.07, 0.11, 1, 10), wmat.clone()); rg.add(RES.stream); RES.t2in = t2in;
    rg.visible = false;
    { const og = WD.outer.geometry, op = og.attributes.position.array;
      for (let i = 0; i < op.length / 3; i++) for (const pd of RES.pads) { const dx = op[3 * i] - pd.cx, dz = op[3 * i + 2] - pd.cz; if (dx * dx + dz * dz < 64) op[3 * i + 1] = Math.min(op[3 * i + 1], pd.bot - 0.6); }
      og.attributes.position.needsUpdate = true; og.computeVertexNormals(); }
    // rolos da manta geotêxtil (um por canal) que desenrolam na frente do revestimento
    WD.rolls = new T.InstancedMesh(new T.CylinderGeometry(0.17, 0.17, 1, 14), new T.MeshStandardMaterial({ color: "#4d5356", roughness: 0.8 }), 12); WD.rolls.castShadow = true; WD.rolls.frustumCulled = false; root.add(WD.rolls);
    WD.dozer = dozer(root); WD.arr = arrows(root, 700); WD.rib = null;
  }
  function dozer(root) {
    const g = new T.Group(), Y = new T.MeshStandardMaterial({ color: "#e2a11b", roughness: 0.55 }), D = new T.MeshStandardMaterial({ color: "#2a2a2a", roughness: 0.9 }),
      Gl = new T.MeshStandardMaterial({ color: "#2f3d47", roughness: 0.15, metalness: 0.4 }), S = new T.MeshStandardMaterial({ color: "#55575a", roughness: 0.5, metalness: 0.6 });
    const b = (sz, ps, m) => { const k = new T.Mesh(new T.BoxGeometry(sz[0], sz[1], sz[2]), m); k.position.set(ps[0], ps[1], ps[2]); k.castShadow = k.receiveShadow = true; g.add(k); return k; };
    b([0.55, 0.62, 3.1], [-0.88, 0.31, 0], D); b([0.55, 0.62, 3.1], [0.88, 0.31, 0], D);
    b([1.5, 0.8, 2.3], [0, 0.98, -0.25], Y); b([1.3, 0.5, 1.0], [0, 1.1, 1.05], Y);
    b([1.25, 1.05, 1.15], [0, 1.9, -0.75], Y); b([1.28, 0.6, 0.9], [0, 2.0, -0.7], Gl); b([1.3, 0.08, 1.2], [0, 2.46, -0.75], Y);
    b([2.7, 0.95, 0.16], [0, 0.55, 2.05], Y); b([0.12, 0.12, 1.2], [-0.8, 0.8, 1.5], S); b([0.12, 0.12, 1.2], [0.8, 0.8, 1.5], S);
    const ex = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.7, 8), D); ex.position.set(0.45, 1.65, 0.9); g.add(ex);
    g.visible = false; root.add(g); return g;
  }
  function arrows(root, n) {
    const sh = new T.Shape(); sh.moveTo(-0.3, -0.16); sh.lineTo(0, 0.12); sh.lineTo(0.3, -0.16); sh.lineTo(0.3, 0.02); sh.lineTo(0, 0.3); sh.lineTo(-0.3, 0.02); sh.closePath();
    const g = new T.ShapeGeometry(sh); g.rotateX(Math.PI / 2);
    const M = new T.InstancedMesh(g, new T.MeshBasicMaterial({ color: "#b5ecff", transparent: true, opacity: 0.92, depthWrite: false, side: T.DoubleSide, fog: false }), n);
    M.frustumCulled = false; M.renderOrder = 5; root.add(M); return { M, o: new T.Object3D() };
  }
  /** ponto de um caminho do sistema: [x, y (superfície da água), z, direção] */
  function pathPt(name, u, o) {
    const R = o.R, G = o.G;
    if (name === "central") { const s2 = mix(SYS.SA, SYS.SB, u), p = at(MAIN, s2), ce = centerAt(MAIN, s2, R, G); return [p[0], base(p[0], p[1]) - ce.cut - 0.75 * dEnd(s2) + 0.43 * dEnd(s2), p[1], p[2]]; }
    if (name === "out" || name.startsWith("br")) { const c = name === "out" ? SYS.out : SYS.br[+name.slice(2)], p = at(c, u); return [p[0], surface(p[0], p[1], R, G) - 0.4 + 0.24, p[1], p[2]]; }
    if (RES && RES.paths[name]) { const q = RES.paths[name], x = mix(q[0][0], q[1][0], u), y = mix(q[0][1], q[1][1], u), z = mix(q[0][2], q[1][2], u); return [x, y, z, Math.atan2(q[1][0] - q[0][0], q[1][2] - q[0][2])]; }
    if (name.startsWith("L:")) { const v = name.slice(2).split(",").map(Number), x = mix(v[0], v[2], u), z = mix(v[1], v[3], u); return [x, surface(x, z, R, G) + 0.06, z, Math.atan2(v[2] - v[0], v[3] - v[1])]; }
    if (name.startsWith("cvb")) { const c = SYS.cv[+name.slice(3)], p = at(c, u), nx = Math.cos(p[2]), nz = -Math.sin(p[2]), x = p[0] - nx * 0.35, z = p[1] - nz * 0.35; return [x, base(x, z) + 0.45, z, p[2]]; }
    if (name.startsWith("cv")) { const c = SYS.cv[+name.slice(2)], p = at(c, u), nx = Math.cos(p[2]), nz = -Math.sin(p[2]), x = p[0] + nx * 1.05, z = p[1] + nz * 1.05; return [x, base(x, z) - 0.32 + 0.17, z, p[2]]; }
    return [0, 0, 0, 0];
  }
  const pathLen = name => RES && RES.paths[name] ? Math.hypot(RES.paths[name][1][0] - RES.paths[name][0][0], RES.paths[name][1][2] - RES.paths[name][0][2]) : name.startsWith("L:") ? (v => Math.hypot(v[2] - v[0], v[3] - v[1]))(name.slice(2).split(",").map(Number)) : name === "central" ? MAIN.len * (SYS.SB - SYS.SA) : name === "out" ? SYS.out.len : name.startsWith("br") ? SYS.br[+name.slice(2)].len : SYS.cv[+name.replace(/\D/g, "")].len;
  function palFloor(P, o) { const p = at(SYS.br[P.br], P.u), b = ((o.br && o.br[P.br]) || 0) > 0; return [p[0], surface(p[0], p[1], o.R, o.G) - (b ? 0.4 : 0), p[1], p[2]]; }
  function updWorks(o) {
    // paliçadas: estacas descem e são fincadas, travessa, manta desenrola, barro acumula antes
    SYS.pal.forEach((P, k) => {
      const ki = (o.pal && o.pal[k]) || 0; P.g.visible = ki > 0; if (!ki) return;
      const f = palFloor(P, o); P.g.position.set(f[0], 0, f[2]); P.g.rotation.y = f[3];
      for (const st of P.st) {
        const e0 = cl((ki * 1.7 - st.dl * 0.7) / 0.55), e = e0 < 1 ? e0 * e0 : 1, bx = st.off + Math.tan(st.tl) * 0.72;
        st.m.rotation.set(0, 0, st.tl);
        st.m.position.set(bx - 0.6 * Math.sin(st.tl), f[1] - 0.3 + 0.6 * Math.cos(st.tl) + (1 - e) * 2.2, 0);
      }
      const kr = sm(0.55, 0.75, ki); P.rail.visible = kr > 0; P.rail.position.set(0, f[1] + 0.5 + (1 - kr) * 1.3, -0.06);
      const km = (o.manta && o.manta[k]) || 0; P.man.visible = km > 0.01; P.man.scale.set(1, Math.max(0.01, km), 1); P.man.position.set(0, f[1] + 0.52, -0.11);
      const kd = (o.mound && o.mound[k]) || 0; P.mo.visible = kd > 0.01; P.mo.scale.set(0.55 * kd, 0.22 * kd + 0.01, 0.5 * kd); P.mo.position.set(0, f[1] + 0.02, -0.5);
    });
    // reservatório
    const kr = o.resv || 0; RES.g.visible = kr > 0;
    if (kr > 0) {
      RES.g.position.y = -(1 - eO(kr)) * 3.2;
      const lv = o.level || 0, wy = mix(RES.bot + 0.08, RES.top - 0.15, lv); RES.water.visible = lv > 0.01; RES.water.position.y = wy;
      const l2 = o.level2 || 0; RES.water2.visible = l2 > 0.01; RES.water2.position.y = mix(RES.bot2 + 0.08, RES.top2 - 0.15, l2);
      RES.wr.offset.set(Math.sin(o.t * 0.6) * 0.1, o.t * 0.15); RES.chw.visible = (o.sf || 0) > 0.97;
      const fy = Math.max(wy, RES.bot + 0.3) + 0.06 + Math.sin(o.t * 2.1) * 0.015; RES.float.position.set(RES.fxz[0], fy, RES.fxz[1]); RES.float.visible = true;
      const pv = new T.Vector3(...RES.pivot), fv = new T.Vector3(RES.fxz[0], fy + 0.1, RES.fxz[1]); RES.arm.position.copy(pv).add(fv).multiplyScalar(0.5); RES.arm.scale.set(1, pv.distanceTo(fv), 1); RES.arm.lookAt(fv); RES.arm.rotateX(Math.PI / 2);
      const vo = o.valve || 0; RES.lamp.material.color.set(vo > 0.5 ? "#36d36b" : "#d23b2f");
      RES.stream.visible = vo > 0.05; if (vo > 0.05) { const ti = RES.t2in, h = Math.max(0.2, ti[1] - (mix(RES.bot2 + 0.08, RES.top2 - 0.15, l2))); RES.stream.position.set(ti[0], ti[1] - h / 2, ti[2]); RES.stream.scale.set(vo, h, vo); }
    }
    // rolos da manta geotêxtil na frente do revestimento
    { const gt = o.gt || 0, ob2 = new T.Object3D(); let n2 = 0;
      if (gt > 0 && gt < 1) {
        const put = (x, y, z, ang, w) => { ob2.position.set(x, y + 0.17, z); ob2.rotation.set(0, ang, Math.PI / 2); ob2.scale.set(1, w, 1); ob2.updateMatrix(); WD.rolls.setMatrixAt(n2++, ob2.matrix); };
        const s2 = mix(SYS.SA, SYS.SB, gt), q = at(MAIN, s2); put(q[0], base(q[0], q[1]) - centerAt(MAIN, s2, 1, 1).cut - 0.75 * dEnd(s2), q[1], q[2], 1.9 * (1 - gt * 0.5));
        SYS.br.forEach(c => { const u = Math.min(1, gt * 1.08); if (u >= 1) return; const p2 = at(c, u); put(p2[0], surface(p2[0], p2[1], 1, 1) - 0.4, p2[1], p2[2], 1.0 * (1 - u * 0.5)); });
      }
      for (let j = n2; j < 12; j++) { ob2.scale.setScalar(0); ob2.updateMatrix(); WD.rolls.setMatrixAt(j, ob2.matrix); }
      WD.rolls.instanceMatrix.needsUpdate = true; }
    // fitas de destaque
    if ((o.ribbons || 0) > 0 && !WD.rib) buildRibbons();
    if (WD.rib) { const k = o.ribbons || 0; WD.rib.grp.visible = k > 0.01; WD.rib.blue.opacity = 0.8 * k; WD.rib.blueS.opacity = 0.8 * k * (o.ribSys ?? 1); WD.rib.sand.opacity = 0.7 * k * (o.ribSand ?? 1); }
    // trator
    const dz = o.dozer; WD.dozer.visible = !!dz;
    if (dz) { const p = pathPt(dz.p, dz.u, o), y = dz.p.startsWith("cvb") ? p[1] - 0.45 : dz.p === "central" ? p[1] - 0.43 : p[1]; WD.dozer.position.set(p[0], y, p[2]); WD.dozer.rotation.set(0, p[3] + (dz.rev ? Math.PI : 0), 0); }
    // setas de fluxo
    const A = WD.arr, ob = A.o; let n = 0;
    for (const sp of o.arrows || []) {
      if (!(sp.k > 0.01)) continue;
      const L = pathLen(sp.p) * Math.abs((sp.u1 ?? 1) - (sp.u0 ?? 0)), gap = sp.gap || 1.6, cnt = Math.max(1, Math.floor(L / gap)), ph = (o.t * (sp.sp || 1.2) / gap) % 1;
      for (let j = 0; j < cnt && n < 700; j++) {
        const q = (j + ph) / cnt, u = mix(sp.u0 ?? 0, sp.u1 ?? 1, q), p = pathPt(sp.p, u, o), fade = sm(0, 0.08, q) * sm(1, 0.9, q);
        ob.position.set(p[0], p[1] + 0.05, p[2]); ob.rotation.set(0, p[3] + ((sp.u1 ?? 1) < (sp.u0 ?? 0) ? Math.PI : 0), 0);
        ob.scale.setScalar(Math.max(0.001, sp.k * fade * (sp.size || 1))); ob.updateMatrix(); A.M.setMatrixAt(n++, ob.matrix);
      }
    }
    for (let j = n; j < 700; j++) { ob.scale.setScalar(0); ob.updateMatrix(); A.M.setMatrixAt(j, ob.matrix); }
    A.M.instanceMatrix.needsUpdate = true; A.M.count = 700;
  }
  const eO = x => 1 - Math.pow(1 - cl(x), 3);
  function ribbon(pts, w, mat) {
    const n = pts.length, pos = new Float32Array(n * 6), idx = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2, p = pts[i];
      pos.set([p[0] + nx, p[1], p[2] + nz, p[0] - nx, p[1], p[2] - nz], i * 6);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new T.BufferGeometry(); g.setAttribute("position", new T.BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new T.Mesh(g, mat); m.renderOrder = 6; m.frustumCulled = false; return m;
  }
  function buildRibbons() {
    const o = { R: 1, G: 1 }, root = WD.root, grp = new T.Group();
    const blue = new T.MeshBasicMaterial({ color: "#1f8fe8", transparent: true, opacity: 0.6, depthWrite: false, fog: false, side: T.DoubleSide }), blueS = blue.clone();
    const sand = new T.MeshBasicMaterial({ color: "#f1cf8e", transparent: true, opacity: 0.6, depthWrite: false, fog: false, side: T.DoubleSide });
    const samp = (name, u0, u1, n, up) => { const r = []; for (let k = 0; k <= n; k++) { const p = pathPt(name, mix(u0, u1, k / n), o); r.push([p[0], p[1] + up, p[2]]); } return r; };
    grp.add(ribbon(samp("central", 0, 1, 160, 0.12), 2.4, blueS), ribbon(samp("out", 0, 1, 20, 0.12), 1.4, blue));
    SYS.br.forEach((c, j) => grp.add(ribbon(samp("br" + j, 0, 1, 24, 0.12), 1.5, blueS)));
    SYS.cv.forEach((c, k) => {
      const segs = c.gap ? [[0.0, (mainX(c.z0) - c.gap - 1 + 28) / 56], [(mainX(c.z0) + c.gap + 1 + 28) / 56, 1]] : [[0, 1]];
      for (const [u0, u1] of segs) { grp.add(ribbon(samp("cv" + k, u0, u1, 60, 0.1), 0.9, blue)); grp.add(ribbon(samp("cvb" + k, u0, u1, 60, -0.25), 1.1, sand)); }
    });
    root.add(grp); WD.rib = { grp, blue, blueS, sand };
  }
  const pulse2 = (e0, at1) => (e0 >= at1 ? 0 : 0);

  // ------------------------------------------------------------------ atualização por quadro
  let lastKey = "";
  function updTerrain(T0, o) {
    const { M, Wm, F, st } = T0, _rp = T0.rp, R = o.R, G = o.G;
    evalField(F, R, G, o.flow * (o.natW ?? 1), o.slump); evalSys(F, o);
    const p = M.geometry.attributes.position.array, col = M.geometry.attributes.color.array;
    const wp = Wm.geometry.attributes.position.array, wc = Wm.geometry.attributes.color.array, n = F.n, wet = o.wet, sink = T0 === WD.main;
    const L = PAL.layers, NL = L.length;
    const Y = T0.Y || (T0.Y = new Float32Array(n));
    for (let i = 0; i < n; i++) {
      let y = F.base[i] - F.cut[i] + F.fan[i] * G * (1 - (o.resv || 0)) - F.cs[i] + F.add[i];
      if (o.resv > 0 && RES) for (const pd of RES.pads) {
        const dx = F.P[2 * i] - pd.cx, dz = F.P[2 * i + 1] - pd.cz, dd = Math.sqrt(dx * dx + dz * dz);
        if (dd < pd.r + 3.2) { const tg = dd < pd.r + 0.12 ? pd.bot : pd.top - 0.04, k = (1 - sm(pd.r + 0.6, pd.r + 3.2, dd)) * sm(0, 0.5, o.resv); if (y > tg) y = mix(y, tg, k); }
      }
      if (sink && inPatch(F.P[2 * i], F.P[2 * i + 1])) y -= 3;
      p[3 * i + 1] = y; Y[i] = y;
    }
    M.geometry.attributes.position.needsUpdate = true; M.geometry.computeVertexNormals();
    const nr = M.geometry.attributes.normal.array;
    for (let i = 0; i < n; i++) {
      const c = F.cut[i], dep = F.fan[i] * G, y = Y[i], ny = nr[3 * i + 1];
      const sv = sm(-0.35, 0.45, F.soil[i]);
      let rr = mix(PAL.a[0], PAL.b[0], sv), gg = mix(PAL.a[1], PAL.b[1], sv), bb = mix(PAL.a[2], PAL.b[2], sv), wm = 1 - 0.36 * wet;
      if (c > 0.02) {
        // parede: estratos claros horizontais; fundo: terra escura e molhada, mais escura quanto mais fundo (oclusão)
        const wall = 1 - sm(0.5, 0.9, ny);
        const e = (F.base[i] - c) * 1.3 + F.wn[i] * 0.3, b = ((e % 1) + 1) % 1 * NL, i0 = Math.floor(b) % NL, i1 = (i0 + 1) % NL, f = sm(0.4, 0.6, b - Math.floor(b));
        const k = sm(0.02, 0.25, c) * (0.25 + 0.75 * sm(0, 0.6, wall)) * sm(0.0, 0.6, c + wall * 0.3);
        rr = mix(rr, mix(L[i0][0], L[i1][0], f), k); gg = mix(gg, mix(L[i0][1], L[i1][1], f), k); bb = mix(bb, mix(L[i0][2], L[i1][2], f), k);
        const ao = 1 - 0.42 * sm(0.4, 5.5, c) * (1 - wall * 0.6);
        wm = mix(wm, 1 - 0.12 * wet, wall) * ao;
      }
      if (F.wd[i] > 0.004) { const k = 0.7 * sm(0.004, 0.05, F.wd[i]); rr = mix(rr, PAL.mud[0], k); gg = mix(gg, PAL.mud[1], k); bb = mix(bb, PAL.mud[2], k); }
      if (dep > 0.02) { const k = sm(0.02, 0.35, dep); rr = mix(rr, PAL.fan[0], k); gg = mix(gg, PAL.fan[1], k); bb = mix(bb, PAL.fan[2], k); }
      if (F.bm[i] > 0) { const k = F.bm[i] * 0.8; rr = mix(rr, PAL.berm[0], k); gg = mix(gg, PAL.berm[1], k); bb = mix(bb, PAL.berm[2], k); }
      if (F.lin[i] > 0) { const k = F.lin[i], v = sm(-0.4, 0.5, F.wn[i] + F.soil[i]); rr = mix(rr, mix(PAL.stone2[0], PAL.stone[0], v), k); gg = mix(gg, mix(PAL.stone2[1], PAL.stone[1], v), k); bb = mix(bb, mix(PAL.stone2[2], PAL.stone[2], v), k); wm = mix(wm, 1 - 0.2 * wet, k); }
      if (o.reveg > 0 && (c > 0.02 || F.bm[i] > 0)) { const k = o.reveg * Math.max(sm(0.03, 0.3, c), F.bm[i]) * (1 - F.lin[i]) * (1 - sm(0.004, 0.03, F.wd[i] + F.ws[i])), v = sm(-0.4, 0.5, F.soil[i] + F.wn[i]);
        rr = mix(rr, mix(PAL.gr[0], PAL.gr2[0], v), k); gg = mix(gg, mix(PAL.gr[1], PAL.gr2[1], v), k); bb = mix(bb, mix(PAL.gr[2], PAL.gr2[2], v), k); wm = mix(wm, 1 - 0.1 * wet, k); }
      col[3 * i] = rr * wm; col[3 * i + 1] = gg * wm; col[3 * i + 2] = bb * wm;
      // água: enxurrada no canal, poças e lâmina escorrendo
      const w = F.wd[i];
      wp[3 * i + 1] = y + Math.max(w, 0.012) + 0.004;
      const chA = w > 0.004 ? 0.95 * sm(0.004, 0.035, w) : 0;
      const pudA = o.puddle * sm(0.6, 0.74, F.pud[i]) * (c < 0.04 ? 0.85 : 0);
      const shA = o.sheet * 0.22 * (0.55 + 0.45 * sm(0.3, 0.7, F.pud[i])) * (c < 0.04 ? 1 : 0.3);
      let a = Math.max(chA, pudA, shA), hi = sm(0.35, 0, a);
      let r0 = mix(PAL.water[0], PAL.waterHi[0], hi), g0 = mix(PAL.water[1], PAL.waterHi[1], hi), b0 = mix(PAL.water[2], PAL.waterHi[2], hi);
      const ws = F.ws[i];
      if (ws > 0.004 && ws >= w) {
        wp[3 * i + 1] = y + ws + 0.004;
        const sa = 0.86 * sm(0.004, 0.04, ws), m = (o.mud ?? 0) * F.mu[i], e = sm(0.25, 0.02, ws) * 0.5;
        r0 = mix(mix(PAL.sys[0], PAL.sysHi[0], e), PAL.water[0], m); g0 = mix(mix(PAL.sys[1], PAL.sysHi[1], e), PAL.water[1], m); b0 = mix(mix(PAL.sys[2], PAL.sysHi[2], e), PAL.water[2], m);
        a = Math.max(a * 0.3, sa);
      }
      wc[4 * i] = r0; wc[4 * i + 1] = g0; wc[4 * i + 2] = b0; wc[4 * i + 3] = a;
    }
    M.geometry.attributes.color.needsUpdate = true;
    Wm.geometry.attributes.position.needsUpdate = true; Wm.geometry.attributes.color.needsUpdate = true; Wm.geometry.computeVertexNormals();
    M.material.roughness = mix(0.95, 0.6, wet);
    st.offset.set(0, o.t * 0.55); T0.rp.offset.set(Math.sin(o.t * 0.7) * 0.05, o.t * 0.8);
  }
  function updVeg(o) {
    const V = WD.veg, F = WD.F_inst, ob = V.o; evalField(F, o.R, o.G, 0, o.slump); evalSys(F, o);
    let k = 0;
    const put = (M, i, p, y, s, tilt = 0) => { ob.position.set(p.x, y, p.z); ob.rotation.set(tilt, p.ry, tilt * 0.6); ob.scale.setScalar(s); ob.updateMatrix(); M.setMatrixAt(i, ob.matrix); };
    V.tufts.forEach((p, i) => { const c = F.cut[k] + F.cs[k] * 3 + Math.abs(F.add[k]) * 2, y = F.base[k] - F.cut[k] + F.fan[k] * o.G + F.add[k] - F.cs[k]; k++; const rv = o.reveg || 0, sysC = (F.lin ? F.lin[k - 1] : 0) + (F.ws ? sm(0.004, 0.02, F.ws[k - 1]) : 0); let s = p.s * mix(1 - sm(0.04, 0.14, c), sysC > 0.05 ? 0 : 0.85, rv); if (o.resv > 0 && RES && RES.pads.some(pd => Math.hypot(p.x - pd.cx, p.z - pd.cz) < pd.r + 0.6)) s = 0; put(V.tuftM, i, p, y, s, sm(0.0, 0.08, c) * 0.9 * (1 - rv)); });
    V.shrubs.forEach((p, i) => { const c = F.cut[k] + F.cs[k] * 3 + Math.abs(F.add[k]) * 2, y = F.base[k] - F.cut[k] + F.add[k]; k++; const rv2 = (o.reveg || 0) * ((F.lin && F.lin[k - 1] > 0.05) || (F.ws && F.ws[k - 1] > 0.004) ? 0 : 0.7); put(V.shrubM, i, p, y, p.s * mix(1 - sm(0.1, 0.4, c), 1, rv2), sm(0, 0.3, c) * 0.8 * (1 - rv2)); });
    V.trees.forEach((p, i) => { const c = F.cut[k], y = F.base[k] - c; k++; const s = p.s * (1 - sm(0.3, 1.2, c)); put(V.trunkM, i, p, y, s, p.tl + sm(0, 0.6, c)); put(V.crownM, i, p, y, s, p.tl + sm(0, 0.6, c)); });
    if (!V.farDone) { V.far.forEach((p, j) => { const i = V.trees.length + j, y = base(p.x, p.z) - 0.05; put(V.trunkM, i, p, y, p.s, p.tl); put(V.crownM, i, p, y, p.s, p.tl); }); V.farDone = true; }
    for (const M of [V.tuftM, V.shrubM, V.trunkM, V.crownM]) M.instanceMatrix.needsUpdate = true;
  }
  function updCollapse(o) {
    const C = WD.coll, cf = o.collapse;
    if (!cf) { C.parts.forEach(p => p.M.visible = false); C.dm.opacity = 0; return; }
    const ce = centerAt(MAIN, cf.s, o.R, o.G, o.flow), pa = at(MAIN, cf.s), nx = Math.cos(pa[2]) * cf.side, nz = -Math.sin(pa[2]) * cf.side;
    const fx = pa[0], fz = pa[1], b0 = base(fx, fz), floorY = b0 - ce.cut, rim = ce.half * 1.05, lt = o.t - cf.t;
    C.parts.forEach((p, i) => {
      p.M.visible = lt > -0.05;
      const st = cl((lt - p.h * 0.18) / (0.55 / p.sp)), e = st * st;     // queda acelerada
      const along = (p.h - 0.5) * 2.6, d = rim - p.out * e - 0.2 * p.s;
      const x = fx + nx * d + Math.sin(pa[2]) * along, z = fz + nz * d + Math.cos(pa[2]) * along;
      const y = mix(b0 - 0.15 - p.h * 0.6, floorY + p.s * 0.55, e);
      p.M.position.set(x, y, z); p.M.rotation.set(e * 3 * p.sp + p.ry, p.ry, e * 2); p.M.scale.set(p.s * 1.3, p.s * 0.8, p.s);
    });
    // poeira
    const dk = lt > 0 ? Math.exp(-lt * 1.4) * sm(0, 0.25, lt) : 0; C.dm.opacity = 0.55 * dk;
    for (let i = 0; i < 160; i++) {
      const a = h2(i, 1, 77) * 6.283, rr = (0.3 + h2(i, 2, 77) * 2.2) * sm(0, 1.5, lt), up = h2(i, 3, 77) * 2.4 * sm(0, 2, lt);
      C.dpos[i * 3] = fx + nx * (rim - 0.8) + Math.cos(a) * rr; C.dpos[i * 3 + 1] = floorY + 0.3 + up; C.dpos[i * 3 + 2] = fz + nz * (rim - 0.8) + Math.sin(a) * rr;
    }
    C.dg.attributes.position.needsUpdate = true;
  }

  /** um quadro: o: {t, R, G, rain, sheet, puddle, flow, wet, cam, splash:[x,z], splashR, sedOn, collapse:{s,side,t}, light} */
  function update(scene, o) {
    if (!WD) build();
    if (WD.root.parent !== scene) scene.add(WD.root);
    scene.background = WD.sky; scene.environment = WD.sky; scene.fog = WD.fog;
    o.slump = o.collapse ? { c: MAIN, s: o.collapse.s, amt: 0.22 * sm(o.collapse.t, o.collapse.t + 0.6, o.t) } : null;
    const key = [o.reveg, o.R, o.G, o.flow, o.wet, o.sheet, o.puddle, o.slump && o.slump.amt].map(v => (+v || 0).toFixed(4)).join("|") +
      (o.sysOn ? JSON.stringify([o.cv, o.cvW, o.cc, o.oc, o.br, o.sf, o.mud, o.mudU, o.gt, o.natW, Math.round((o.resv || 0) * 20)]) : "");
    if (key !== lastKey) { lastKey = key; updTerrain(WD.main, o); updTerrain(WD.patch, o); updVeg(o); }
    for (const T0 of [WD.main, WD.patch]) { T0.st.offset.set(0, o.t * 0.55); T0.rp.offset.set(Math.sin(o.t * 0.7) * 0.05, o.t * 0.8); }
    const L = o.light ?? 1;
    WD.sun.intensity = 2.3 * L; WD.hemi.intensity = 1.05 * (0.75 + 0.25 * L);
    WD.fog.density = 0.0035 + 0.003 * (o.rain ?? 0);
    // chuva em volta da câmera (na frente dela)
    const cam = o.cam, dir = new T.Vector3(); cam.getWorldDirection(dir);
    const c = cam.position.clone().addScaledVector(dir, o.rainAhead ?? 12);
    WD.rain.update(o.t, [c.x, c.y, c.z], o.rain ?? 1, o.rainBox ?? 30, o.rainLen ?? 0.7);
    WD.splash.update(o.t, o.splash || null, o.splashR ?? 4, o.rain ?? 1, (x, z) => surface(x, z, o.R, o.G));
    WD.sed.update(o.t, o);
    updCollapse(o); updWorks(o);
  }
  /** altura do chão num ponto qualquer, no estado (R, G): para câmera, etiqueta e respingo */
  function surface(x, z, R, G) {
    let cut = 0;
    for (const c of CH) {
      const m = c.w; if (x < c.bb[0] - m || x > c.bb[1] + m || z < c.bb[2] - m || z > c.bb[3] + m) continue;
      const st = chState(c, R, G); if (!st) continue;
      let best = 1e9, bs = 0; const pts = c.pts;
      for (let j = 1; j < pts.length; j++) {
        const ax = pts[j - 1][0], az = pts[j - 1][1], bx = pts[j][0] - ax, bz = pts[j][1] - az, l2 = bx * bx + bz * bz;
        const u = cl(((x - ax) * bx + (z - az) * bz) / l2), qx = ax + bx * u - x, qz = az + bz * u - z, d2 = qx * qx + qz * qz;
        if (d2 < best) { best = d2; bs = (c.L[j - 1] + u * (c.L[j] - c.L[j - 1])) / c.len; }
      }
      if (bs <= st.head) continue;
      const x1 = Math.sqrt(best) / halfAt(st, bs, 0); if (x1 >= 1) continue;
      let taper = sm(st.head, st.head + st.tl, bs); if (st.te) taper *= sm(1, 1 - st.te, bs);
      const v = 1 - x1, bx = 1 - sm(0.6, 1, x1);
      cut = Math.max(cut, st.D * (0.6 + 0.4 * bs) * taper * (v + (bx - v) * st.k));
    }
    return base(x, z) - cut;
  }
  return { update, base, surface, at, centerAt, pathPt, palFloor, SYS, get RES() { return RES; }, get MAIN() { return MAIN; }, ensure() { if (!WD) build(); } };
})();
