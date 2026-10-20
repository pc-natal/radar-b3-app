/* Método dinâmico em JavaScript — tradução de motor/dinamico.py (notas, seleção e composição).
   A cada 5 pregões, olhando só o passado (janela de 1 a 5 anos ou expansiva), escolhe as melhores
   configurações (estudo + parâmetros + stop) e segue a escolha (Top-1, unânime ou maioria). */
(function (G) {
'use strict';
const Mo = G.Motor, fr = Math.fround;
const PASSO = 5, JANMAX = 1250, AQUEC = 250, T0 = AQUEC + JANMAX;

/* chave de cada configuração do universo "clássicos" (mesma regra do Python) */
function chave(nome, p) {
  switch (nome) {
    case 'IFR Wilder': case 'IFR Cutler': case 'IFR Reversão (IFR2)': return `${nome}|${p.n},${p.baixo},${p.alto}`;
    case 'IFR + MMS': return `${nome}|${p.n},${p.m}`;
    case 'Cruz. MMS': case 'Cruz. MME': return `${nome}|${p.f},${p.s}`;
    case 'Preço > MME': case 'Super Contagem': case 'HiLo (estudo)': return `${nome}|${p.n}`;
    case 'MACD': return `${nome}|${p.f},${p.s},${p.sg}`;
    case 'Estocástico Lento': return p.d === 3 ? `${nome}|${p.k},3,${p.baixo},${p.alto}` : null;
    case 'Super Sinal': return `${nome}|${p.nm},${p.nd},${p.ndm}`;
    case 'Acumulação Estatística': return `${nome}|${p.n},${p.m}`;
    case 'Super Acum. Estatística': return `${nome}|${p.n},${p.nd},${p.ndm}`;
    case 'Rompimento de Canal': return `${nome}|${p.ne},${p.ns}`;
    case 'Bollinger': return `${nome}|${p.n},${p.k}`;
  }
  return null;
}
const ENXUTO = new Set(['IFR Wilder|14,30,70', 'IFR Wilder|9,30,70', 'IFR Cutler|14,30,70', 'IFR Reversão (IFR2)|2,10,70', 'IFR Reversão (IFR2)|2,20,60',
  'IFR + MMS|14,9', 'Cruz. MMS|9,21', 'Cruz. MMS|21,50', 'Cruz. MME|9,21', 'Cruz. MME|21,50', 'Preço > MME|20', 'Preço > MME|50', 'Preço > MME|200',
  'MACD|12,26,9', 'Estocástico Lento|14,3,20,80', 'Super Contagem|11', 'Super Sinal|15,28,9', 'Acumulação Estatística|34,11',
  'Super Acum. Estatística|17,31,55', 'Rompimento de Canal|20,10', 'Rompimento de Canal|55,20', 'Bollinger|20,2', 'HiLo (estudo)|8', 'HiLo (estudo)|13']);
function universo(nome) {
  const {ESTUDOS, STOPS} = Mo.GR, NS = STOPS.length, K = ESTUDOS.length * NS, v = new Uint8Array(K);
  for (let k = 0; k < K; k++) {
    const e = ESTUDOS[(k / NS) | 0], s = STOPS[k % NS];
    v[k] = nome === 'Todas (~7 mil)' ? 1 : nome === 'IFR + HiLo' ? ((e[1] === 'IFR Wilder' || e[1] === 'IFR Cutler') && s[0] === 'HiLo' ? 1 : 0) : (ENXUTO.has(chave(e[1], e[2])) ? 1 : 0);
  }
  return v;
}

/* ---------------------------------------------------------------- 1) indexação: acumulados de cada configuração */
function indexa(d, O, H, L, C, cdi, onProg) {
  const n = C.length, {ESTUDOS, STOPS} = Mo.GR, NS = STOPS.length, K = ESTUDOS.length * NS;
  const mes = [], idxFim = [];
  for (let i = 0; i < n; i++) { const mm = d[i].slice(0, 7); if (!mes.length || mes[mes.length - 1] !== mm) { mes.push(mm); idxFim.push(i); } else idxFim[idxFim.length - 1] = i; }
  const Gm = mes.length, cr = new Float32Array(K * Gm), cf = new Float32Array(K * Gm), ce = new Uint16Array(K * Gm), ch = new Uint16Array(K * Gm);
  const grade = []; for (let g = T0 - 1 - JANMAX; g < n; g += PASSO) grade.push(g); if (grade[grade.length - 1] !== n - 1) grade.push(n - 1);
  const Gd = grade.length, habilita = n > T0 + 60;
  const S1 = habilita ? new Float32Array(K * Gd) : null, S2 = habilita ? new Float32Array(K * Gd) : null, NE = habilita ? new Uint16Array(K * Gd) : null;
  const stops = STOPS.map(s => Mo.sinalStop(s[0], s[1], O, H, L, C)), logc = new Float64Array(n); for (let t = 0; t < n; t++) logc[t] = Math.log1p(cdi[t]);
  let k = 0;
  for (let i = 0; i < ESTUDOS.length; i++) {
    const sig = Mo.sinalEstudo(ESTUDOS[i][1], ESTUDOS[i][2], O, H, L, C);
    for (let j = 0; j < NS; j++) {
      const [g, v, us] = stops[j], r = Mo.simula(O, H, L, C, sig, g, v, us, Mo.CUSTO);
      let sr = 0, sr2 = 0, sf = 0, se = 0, sh = 0, gi = 0, gd = 0;
      for (let t = 0; t < n; t++) {
        const x = r.ret[t]; sr += x; sr2 += x * x; se += r.ent[t]; sh += r.hc[t];
        if (t >= 1 && r.hc[t - 1] === 0) sf += logc[t];
        if (t === idxFim[gi]) { const p = k * Gm + gi; cr[p] = sr; cf[p] = sf; ce[p] = se; ch[p] = sh; gi++; }
        if (habilita && t === grade[gd]) { const p = k * Gd + gd; S1[p] = sr; S2[p] = sr2; NE[p] = se; gd++; }
      }
      k++;
    }
    if (onProg) onProg((i + 1) / ESTUDOS.length);
  }
  return {mensal: {mes, idxFim, G: Gm, K, cr, cf, ce, ch}, din: {grade, Gd, S1, S2, NE, K, habilita, n}};
}

/* ---------------------------------------------------------------- 2) seleção: melhores configurações em cada reavaliação */
function selecao(din, ctx, par) {
  const {grade, Gd, S1, S2, NE, K} = din, {janela, criterio, top, diverso} = par, valido = par.valido;
  let j0 = 0; while (grade[j0] < T0 - 1) j0++;
  const nRe = Gd - j0, out = new Int32Array(nRe * top), p = Math.floor(janela / PASSO);
  const ests = ctx.estId, sc = new Float32Array(K);
  const SQ = fr(Math.sqrt(252));
  for (let jj = 0; jj < nRe; jj++) {
    const j = j0 + jj, ji = janela > 0 ? j - p : 0, dias = grade[j] - grade[ji];
    let q1, q2, q3; if (criterio === 'multi') { if (janela > 0) { q1 = Math.max(1, Math.floor(p / 2)); q2 = p; q3 = 2 * p; } }
    for (let k = 0; k < K; k++) {
      if (!valido[k]) { sc[k] = -1e9; continue; }
      const b = k * Gd, ne = fr(NE[b + j] - NE[b + ji]);
      if (!(ne >= 1)) { sc[k] = -1e9; continue; }
      let s;
      if (criterio === 'retorno') s = fr(fr(S1[b + j] - S1[b + ji]) / dias);
      else if (criterio === 'sharpe') {
        const ret = fr(S1[b + j] - S1[b + ji]), m = fr(ret / dias), a = fr(fr(S2[b + j] - S2[b + ji]) / dias), v = fr(a - fr(m * m));
        s = fr(fr(m / fr(Math.sqrt(Math.max(v, fr(1e-8))))) * SQ);
      } else {
        s = 0;
        const qs = janela > 0 ? [q1, q2, q3] : [50, 150, null];
        for (const q of qs) { const jq = q === null ? ji : Math.max(j - q, 0), den = Math.max(grade[j] - grade[jq], 1); s = fr(s + fr(fr(S1[b + j] - S1[b + jq]) / den)); }
      }
      sc[k] = s;
    }
    if (!diverso) {
      // os `top` maiores (empate: menor índice)
      const bi = [], bs = [];
      for (let k = 0; k < K; k++) {
        const s = sc[k]; if (bi.length === top && !(s > bs[top - 1])) continue;
        let pos = bi.length; while (pos > 0 && s > bs[pos - 1]) pos--;
        bi.splice(pos, 0, k); bs.splice(pos, 0, s); if (bi.length > top) { bi.pop(); bs.pop(); }
      }
      for (let q = 0; q < top; q++) out[jj * top + q] = bi[q];
    } else {
      // candidatos: as `cand` maiores notas (empate: menor índice), depois os `top` primeiros de estudos diferentes
      const cand = Math.min(200, K - 1), ordenada = sc.slice().sort(), thr = ordenada[K - cand], pick = [];
      for (let k = 0; k < K; k++) if (sc[k] > thr) pick.push(k);
      for (let k = 0; k < K && pick.length < cand; k++) if (sc[k] === thr) pick.push(k);
      pick.sort((x, y) => sc[y] - sc[x] || x - y);
      const vistos = new Set(); let q = 0;
      for (const k of pick) { const e = ests[k]; if (vistos.has(e)) continue; vistos.add(e); out[jj * top + q++] = k; if (q === top) break; }
      while (q < top) { out[jj * top + q] = out[jj * top + q - 1]; q++; }
    }
  }
  return {sel: out, nRe, j0};
}

/* ---------------------------------------------------------------- 3) composição: segue a escolha dia a dia */
function compoe(ctx, sel, nRe, j0, top, voto, filtro200) {
  const {O, H, L, C, cdi, din} = ctx, n = C.length, {ESTUDOS, STOPS} = Mo.GR, NS = STOPS.length, grade = din.grade;
  const usados = new Set(sel); const sims = new Map();
  const stops = {};
  usados.forEach(k => {
    const e = ESTUDOS[(k / NS) | 0], s = STOPS[k % NS]; const sg = Mo.sinalEstudo(e[1], e[2], O, H, L, C);
    const st = stops[k % NS] || (stops[k % NS] = Mo.sinalStop(s[0], s[1], O, H, L, C));
    sims.set(k, Mo.simula(O, H, L, C, sg, st[0], st[1], st[2], Mo.CUSTO));
  });
  const eq = new Float64Array(n).fill(1), hold = new Int8Array(n), ent = new Int8Array(n), sai = new Int8Array(n), esc = new Int32Array(n).fill(-1);
  const inicio = grade[j0] + 1; let a = 0;
  let perm = null; if (filtro200) { const m = Mo.ema(C, 200); perm = new Int8Array(n); for (let i = 0; i < n; i++) perm[i] = Number.isNaN(m[i]) ? 0 : (C[i] > m[i] ? 1 : 0); }
  for (let t = T0; t < n; t++) {
    let jj = Math.floor((t - inicio) / PASSO); if (jj >= nRe) jj = nRe - 1;
    let b, m;
    if (top === 1) { m = sel[jj * top]; b = sims.get(m).ho[t]; }
    else { let v = 0; for (let q = 0; q < top; q++) v += sims.get(sel[jj * top + q]).ho[t]; b = a === 0 ? (v >= voto ? 1 : 0) : ((top - v) >= (top - voto + 1) ? 0 : 1); m = sel[jj * top]; }
    if (perm && perm[t - 1] === 0) b = 0;
    let f = 1 + a * (O[t] / C[t - 1] - 1);
    if (a === 0) f *= 1 + cdi[t];
    if (a !== b) { f *= 1 - Mo.CUSTO; if (b === 1) ent[t] = 1; else sai[t] = 1; }
    if (b === 1) {
      if (top === 1) { const s = sims.get(m); f *= s.fi[t]; a = s.hc[t]; if (a === 0) sai[t] = 1; } else { f *= C[t] / O[t]; a = 1; }
    } else a = 0;
    eq[t] = eq[t - 1] * f; hold[t] = a; esc[t] = m;
  }
  return {eq, hold, ent, sai, esc, perm};
}

/* ---------------------------------------------------------------- 4) o que o método manda fazer hoje */
function situacaoAtual(ctx, sel, nRe, top, voto, hold, perm) {
  const {O, H, L, C} = ctx, n = C.length, {ESTUDOS, STOPS} = Mo.GR, NS = STOPS.length, membros = [];
  for (let q = 0; q < top; q++) {
    const k = sel[(nRe - 1) * top + q], e = ESTUDOS[(k / NS) | 0], s = STOPS[k % NS];
    const sg = Mo.sinalEstudo(e[1], e[2], O, H, L, C), [g, v, us] = Mo.sinalStop(s[0], s[1], O, H, L, C);
    const quer = sg[n - 1] === 1 && (us === 0 || g[n - 1] === 1);
    membros.push({k, nome: Mo.descreve(e, s), quer, stop: us && !Number.isNaN(v[n - 1]) ? v[n - 1] : null});
  }
  const votos = membros.filter(m => m.quer).length, hoje = hold[n - 1];
  let amanha = top === 1 ? (membros[0].quer ? 1 : 0) : (hoje === 0 ? (votos >= voto ? 1 : 0) : (((top - votos) >= (top - voto + 1)) ? 0 : 1));
  if (perm && perm[n - 1] === 0) amanha = 0;
  return {membros, votos, hoje, amanha};
}

function executa(ctx, par) {
  const din = ctx.din; if (!din.habilita) throw new Error('histórico curto demais para o método dinâmico');
  par.valido = par.valido || universo(par.universo);
  if (!ctx.estId) { const {ESTUDOS, STOPS} = Mo.GR, NS = STOPS.length; ctx.estId = []; for (let k = 0; k < din.K; k++) ctx.estId.push(ESTUDOS[(k / NS) | 0][1]); }
  const {sel, nRe, j0} = selecao(din, ctx, par);
  const r = compoe(ctx, sel, nRe, j0, par.top, par.voto, par.filtro200);
  r.atual = situacaoAtual(ctx, sel, nRe, par.top, par.voto, r.hold, r.perm);
  r.t0 = T0; r.sel = sel; r.nRe = nRe; r.j0 = j0;
  return r;
}
G.Dinamico = {PASSO, JANMAX, T0, indexa, executa, universo, selecao, compoe};
})(typeof self !== 'undefined' ? self : globalThis);
if (typeof module !== 'undefined') module.exports = (typeof self !== 'undefined' ? self : globalThis).Dinamico;
