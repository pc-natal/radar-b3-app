/* Motor de cálculo do Radar B3 em JavaScript — tradução fiel de motor/indicadores.py e motor/simulador.py.
   Funciona no navegador (Web Worker) e no Node (testes). Regras de execução idênticas ao Python:
   sinal no fechamento de t-1, ordem na abertura de t, stop pela mínima do dia, custo por ordem. */
(function (G) {
'use strict';
const CUSTO = 0.0007;

/* ---------------------------------------------------------------- médias e auxiliares */
function sma(x, n) {
  const N = x.length, out = new Float64Array(N).fill(NaN); let s = 0, cnt = 0;
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(x[i])) { s = 0; cnt = 0; continue; }
    s += x[i]; cnt++;
    if (cnt > n) s -= x[i - n];
    if (cnt >= n) out[i] = s / n;
  }
  return out;
}
function ema(x, n, alfa) {
  const N = x.length, out = new Float64Array(N).fill(NaN), a = (alfa === undefined || alfa < 0) ? 2 / (n + 1) : alfa;
  if (N < n) return out;
  let m = 0; for (let i = 0; i < n; i++) m += x[i]; m /= n; out[n - 1] = m;
  for (let i = n; i < N; i++) { m = m + a * (x[i] - m); out[i] = m; }
  return out;
}
function desvio(x, n) {
  const N = x.length, out = new Float64Array(N).fill(NaN); let s = 0, s2 = 0;
  for (let i = 0; i < N; i++) {
    s += x[i]; s2 += x[i] * x[i];
    if (i >= n) { s -= x[i - n]; s2 -= x[i - n] * x[i - n]; }
    if (i >= n - 1) { const v = (s2 - s * s / n) / (n - 1); out[i] = v > 0 ? Math.sqrt(v) : 0; }
  }
  return out;
}
function maxmov(x, n) { const N = x.length, out = new Float64Array(N).fill(NaN);
  for (let i = n - 1; i < N; i++) { let m = x[i - n + 1]; for (let j = i - n + 2; j <= i; j++) if (x[j] > m) m = x[j]; out[i] = m; } return out; }
function minmov(x, n) { const N = x.length, out = new Float64Array(N).fill(NaN);
  for (let i = n - 1; i < N; i++) { let m = x[i - n + 1]; for (let j = i - n + 2; j <= i; j++) if (x[j] < m) m = x[j]; out[i] = m; } return out; }
function nanToNum(x, v) { const o = new Float64Array(x.length); for (let i = 0; i < x.length; i++) o[i] = Number.isNaN(x[i]) ? v : x[i]; return o; }

function ifr(c, n, tipo) {
  const N = c.length, g = new Float64Array(N), p = new Float64Array(N);
  for (let i = 1; i < N; i++) { const d = c[i] - c[i - 1]; if (d > 0) g[i] = d; else p[i] = -d; }
  let mg, mp;
  if (tipo === 0) { mg = ema(g.subarray(1), n, 1 / n); mp = ema(p.subarray(1), n, 1 / n); }
  else { mg = sma(g.subarray(1), n); mp = sma(p.subarray(1), n); }
  const out = new Float64Array(N).fill(NaN);
  for (let i = 0; i < mg.length; i++) if (!Number.isNaN(mg[i])) out[i + 1] = mp[i] === 0 ? 100 : 100 - 100 / (1 + mg[i] / mp[i]);
  return out;
}
function atrWilder(h, l, c, n) {
  const N = c.length, tr = new Float64Array(N); tr[0] = h[0] - l[0];
  for (let i = 1; i < N; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  return ema(tr, n, 1 / n);
}

/* ---------------------------------------------------------------- estudos (sinais 0/1) */
function estCruzNiveis(x, baixo, alto) {
  const N = x.length, s = new Int8Array(N); let st = 0;
  for (let i = 1; i < N; i++) {
    if (Number.isNaN(x[i - 1]) || Number.isNaN(x[i])) { s[i] = st; continue; }
    if (x[i - 1] <= baixo && x[i] > baixo) st = 1; else if (x[i - 1] >= alto && x[i] < alto) st = 0;
    s[i] = st;
  }
  return s;
}
function estReversao(x, baixo, alto) {
  const N = x.length, s = new Int8Array(N); let st = 0;
  for (let i = 0; i < N; i++) { if (!Number.isNaN(x[i])) { if (x[i] < baixo) st = 1; else if (x[i] > alto) st = 0; } s[i] = st; }
  return s;
}
function estAcima(a, b) { const N = a.length, s = new Int8Array(N); for (let i = 0; i < N; i++) if (!(Number.isNaN(a[i]) || Number.isNaN(b[i])) && a[i] > b[i]) s[i] = 1; return s; }
function estSuperContagem(o, c, n) {
  const N = c.length, L1 = new Float64Array(N);
  for (let i = 1; i < N; i++) {
    if (c[i] > c[i - 1]) L1[i] = L1[i - 1] < 0 ? 1 : L1[i - 1] + 1;
    else if (c[i] < c[i - 1]) L1[i] = L1[i - 1] > 0 ? -1 : L1[i - 1] - 1;
    else L1[i] = L1[i - 1];
  }
  const L2 = sma(L1, n), L3 = new Float64Array(N);
  for (let i = 1; i < N; i++) {
    if (Number.isNaN(L2[i])) continue;
    if (L1[i] > 2 && L2[i] > 0 && c[i] > c[i - 1] && c[i] > o[i]) L3[i] = 1;
    else if (L2[i] < 0 && L3[i - 1] === 1) L3[i] = -1;
    else L3[i] = L3[i - 1];
  }
  const L4 = sma(L3, n), s = new Int8Array(N);
  for (let i = 0; i < N; i++) if (!Number.isNaN(L4[i]) && L4[i] > 0) s[i] = 1;
  return s;
}
function estSuperSinal(c, nm, nd, ndm) {
  const N = c.length, mm = sma(c, nm), dp = desvio(c, nd), mdp = sma(dp, ndm), s = new Int8Array(N); let st = 0;
  for (let i = 0; i < N; i++) {
    if (!(Number.isNaN(mm[i]) || Number.isNaN(mdp[i]))) {
      if (c[i] > mm[i] && dp[i] < mdp[i]) st = 1; else if (c[i] < mm[i] && dp[i] > mdp[i]) st = 0;
    }
    s[i] = st;
  }
  return s;
}
function estAcumEstatistica(c, l, n, m, filtro, nd, ndm) {
  const N = c.length, mm = sma(c, n), dp = desvio(c, n), z = new Float64Array(N);
  for (let i = 0; i < N; i++) if (!Number.isNaN(dp[i]) && dp[i] > 0) z[i] = (c[i] - mm[i]) / dp[i];
  const L2 = sma(z, m), vol = desvio(c, nd), mvol = sma(vol, ndm), s = new Int8Array(N); let st = 0;
  for (let i = 1; i < N; i++) {
    if (Number.isNaN(L2[i]) || Number.isNaN(mm[i])) { s[i] = st; continue; }
    let compra = L2[i] > 0 && c[i] >= c[i - 1] && l[i] >= l[i - 1];
    let venda = L2[i] < 0 && c[i] <= c[i - 1] && l[i] <= l[i - 1];
    if (filtro === 1) {
      if (Number.isNaN(mvol[i])) { s[i] = st; continue; }
      compra = compra && c[i] > mm[i] && vol[i] < mvol[i];
      venda = venda && c[i] < mm[i] && vol[i] > mvol[i];
    }
    if (compra) st = 1; else if (venda) st = 0;
    s[i] = st;
  }
  return s;
}
function estCanal(h, l, c, ne, ns) {
  const N = c.length, hi = maxmov(h, ne), lo = minmov(l, ns), s = new Int8Array(N); let st = 0;
  for (let i = 1; i < N; i++) {
    if (!(Number.isNaN(hi[i - 1]) || Number.isNaN(lo[i - 1]))) { if (c[i] > hi[i - 1]) st = 1; else if (c[i] < lo[i - 1]) st = 0; }
    s[i] = st;
  }
  return s;
}
function estBollinger(c, n, k) {
  const N = c.length, mm = sma(c, n), dp = desvio(c, n), s = new Int8Array(N); let st = 0;
  for (let i = 1; i < N; i++) {
    if (!Number.isNaN(dp[i - 1])) {
      const inf0 = mm[i - 1] - k * dp[i - 1], inf1 = mm[i] - k * dp[i], sup0 = mm[i - 1] + k * dp[i - 1], sup1 = mm[i] + k * dp[i];
      if (c[i - 1] < inf0 && c[i] > inf1) st = 1; else if (c[i - 1] > sup0 && c[i] < sup1) st = 0;
    }
    s[i] = st;
  }
  return s;
}
function hiloGann(h, l, c, n) {
  const N = c.length, mh = sma(h, n), ml = sma(l, n), g = new Int8Array(N), lvl = new Float64Array(N).fill(NaN); let st = 0;
  for (let i = 1; i < N; i++) {
    if (Number.isNaN(mh[i - 1])) continue;
    if (c[i] > mh[i - 1]) st = 1; else if (c[i] < ml[i - 1]) st = 0;
    g[i] = st; lvl[i] = ml[i];
  }
  return [g, lvl];
}

/* ---------------------------------------------------------------- stops */
function stopAtr(h, l, c, n, k) {
  const N = c.length, a = atrWilder(h, l, c, n), hh = maxmov(h, n), ll = minmov(l, n), g = new Int8Array(N), lvl = new Float64Array(N).fill(NaN);
  let st = 1, nv = NaN, ns = NaN;
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(hh[i])) continue;
    const ls = hh[i] - k * a[i], ss = ll[i] + k * a[i];
    if (st === 1) { nv = Number.isNaN(nv) ? ls : Math.max(nv, ls); if (c[i] < nv) { st = 0; ns = ss; } }
    else { ns = Number.isNaN(ns) ? ss : Math.min(ns, ss); if (c[i] > ns) { st = 1; nv = ls; } }
    g[i] = st; lvl[i] = st === 1 ? nv : ls;
  }
  return [g, lvl];
}
function stopPctMin(l, x) { const N = l.length, g = new Int8Array(N).fill(1), lvl = new Float64Array(N); for (let i = 0; i < N; i++) lvl[i] = l[i] * (1 - x); return [g, lvl]; }
function psar(h, l, c, af0, afmax) {
  const m = c.length, g = new Int8Array(m), lvl = new Float64Array(m).fill(NaN);
  if (m < 3) return [g, lvl];
  let up = c[1] >= c[0], sar = up ? l[0] : h[0], ep = up ? h[1] : l[1], af = af0;
  for (let i = 2; i < m; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, l[i - 1], l[i - 2]);
      if (l[i] < sar) { up = false; sar = ep; ep = l[i]; af = af0; } else if (h[i] > ep) { ep = h[i]; af = Math.min(af + af0, afmax); }
    } else {
      sar = Math.max(sar, h[i - 1], h[i - 2]);
      if (h[i] > sar) { up = true; sar = ep; ep = h[i]; af = af0; } else if (l[i] < ep) { ep = l[i]; af = Math.min(af + af0, afmax); }
    }
    g[i] = up ? 1 : 0;
    const nxt = sar + af * (ep - sar);
    lvl[i] = up ? Math.min(nxt, l[i], l[i - 1]) : NaN;
  }
  return [g, lvl];
}

/* ---------------------------------------------------------------- simulação (uma estratégia, posição comprada) */
function simula(o, h, l, c, s, g, lvl, usaStop, custo) {
  const n = c.length, ho = new Int8Array(n), hc = new Int8Array(n), fi = new Float64Array(n).fill(1), ret = new Float64Array(n), ent = new Int8Array(n);
  let pos = 0, rearm = true, stopEf = NaN;
  for (let t = 1; t < n; t++) {
    const quer = s[t - 1] === 1 && (usaStop === 0 || g[t - 1] === 1);
    if (!quer) rearm = true;
    const a = pos;
    if (pos === 1 && !quer) pos = 0;
    else if (pos === 0 && quer && rearm) { pos = 1; ent[t] = 1; stopEf = NaN; }
    const b = pos; ho[t] = b; let f = 1;
    if (b === 1) {
      if (usaStop === 1 && !Number.isNaN(lvl[t - 1])) stopEf = Number.isNaN(stopEf) ? lvl[t - 1] : Math.max(stopEf, lvl[t - 1]);
      if (usaStop === 1 && !Number.isNaN(stopEf) && l[t] <= stopEf) { const px = Math.min(o[t], stopEf); f = px / o[t] * (1 - custo); pos = 0; rearm = false; }
      else f = c[t] / o[t];
    }
    fi[t] = f; hc[t] = pos;
    let fon = 1 + a * (o[t] / c[t - 1] - 1);
    if (a !== b) fon *= (1 - custo);
    ret[t] = Math.log(fon * f);
  }
  return {ho, fi, hc, ret, ent};
}

/* ---------------------------------------------------------------- catálogo (idêntico ao Python) */
function grade() {
  const E = [];
  [[0, 'IFR Wilder'], [1, 'IFR Cutler']].forEach(([tipo, nome]) => [2, 3, 5, 9, 14, 21, 30].forEach(n => [20, 30, 40, 45].forEach(lo => [55, 65, 70, 80].forEach(hi =>
    E.push(['IFR', nome, {tipo, n, baixo: lo, alto: hi}])))));
  [2, 3, 5].forEach(n => [5, 10, 20, 30].forEach(lo => [50, 60, 70, 80].forEach(hi => E.push(['IFR', 'IFR Reversão (IFR2)', {tipo: 0, n, baixo: lo, alto: hi, rev: 1}]))));
  [5, 9, 14, 21, 35].forEach(n => [5, 9, 14, 28].forEach(m => E.push(['IFR', 'IFR + MMS', {n, m}])));
  [5, 9, 13, 21].forEach(f => [21, 34, 50, 72, 100, 200].forEach(sl => { if (f < sl) { E.push(['Médias', 'Cruz. MMS', {f, s: sl}]); E.push(['Médias', 'Cruz. MME', {f, s: sl}]); } }));
  [10, 20, 50, 100, 200].forEach(n => E.push(['Médias', 'Preço > MME', {n}]));
  [[12, 26, 9], [8, 21, 5], [8, 21, 9], [12, 26, 5], [16, 35, 9], [5, 35, 5], [20, 25, 69]].forEach(([f, sl, sg]) => E.push(['Médias', 'MACD', {f, s: sl, sg}]));
  [5, 9, 14, 21].forEach(k => [3, 5].forEach(d => [20, 30, 40].forEach(lo => [60, 70, 80].forEach(hi => E.push(['Estocástico', 'Estocástico Lento', {k, d, baixo: lo, alto: hi}])))));
  [5, 9, 14, 21].forEach(n => [9, 14].forEach(k => [10, 20].forEach(lo => [80, 90].forEach(hi => E.push(['Estocástico', 'IFR Estocástico', {n, k, baixo: lo, alto: hi}])))));
  [3, 5, 7, 9, 11, 15, 21].forEach(n => E.push(['Super (TG)', 'Super Contagem', {n}]));
  [10, 15, 20, 30].forEach(nm => [14, 28].forEach(nd => [5, 9, 14].forEach(ndm => E.push(['Super (TG)', 'Super Sinal', {nm, nd, ndm}]))));
  [14, 21, 34, 50].forEach(n => [5, 11, 21].forEach(m => E.push(['Super (TG)', 'Acumulação Estatística', {n, m, filtro: 0, nd: 2, ndm: 2}])));
  [11, 17, 25].forEach(n => [14, 31].forEach(nd => [21, 55].forEach(ndm => E.push(['Super (TG)', 'Super Acum. Estatística', {n, m: n, filtro: 1, nd, ndm}]))));
  [10, 20, 40, 55].forEach(ne => [5, 10, 20].forEach(ns => E.push(['Canal/Topos-Fundos', 'Rompimento de Canal', {ne, ns}])));
  [14, 20, 30].forEach(n => [1.5, 2.0, 2.5].forEach(k => E.push(['Canal/Topos-Fundos', 'Bollinger', {n, k}])));
  [3, 5, 8, 13, 21, 34].forEach(n => E.push(['HiLo', 'HiLo (estudo)', {n}]));
  const S = [['Sem stop', {}]];
  [3, 5, 8, 13, 21].forEach(n => S.push(['HiLo', {n}]));
  [[14, 2.0], [14, 3.0], [22, 3.0], [22, 4.0]].forEach(([n, k]) => S.push(['ATR', {n, k}]));
  [0.02, 0.04].forEach(x => S.push(['% mínima', {x}]));
  S.push(['PSAR', {af: 0.02, afmax: 0.2}]);
  return {ESTUDOS: E, STOPS: S};
}
const GR = grade();

function descreve(est, stop) {
  const [, nome, p] = est;
  const ps = Object.keys(p).filter(k => !['tipo', 'rev', 'filtro'].includes(k)).map(k => String(p[k])).join(',');
  const [sn, sp] = stop, vs = Object.values(sp);
  return `${nome}(${ps}) + ${vs.length ? sn + '(' + vs.map(String).join(',') + ')' : sn}`;
}

function sinalEstudo(nome, p, O, H, L, C) {
  switch (nome) {
    case 'IFR Wilder': case 'IFR Cutler': case 'IFR Reversão (IFR2)': {
      const x = ifr(C, p.n, p.tipo); return p.rev ? estReversao(x, p.baixo, p.alto) : estCruzNiveis(x, p.baixo, p.alto); }
    case 'IFR + MMS': { const x = ifr(C, p.n, 1); return estAcima(x, sma(nanToNum(x, 50), p.m)); }
    case 'Cruz. MMS': return estAcima(sma(C, p.f), sma(C, p.s));
    case 'Cruz. MME': return estAcima(ema(C, p.f), ema(C, p.s));
    case 'Preço > MME': return estAcima(C, ema(C, p.n));
    case 'MACD': {
      const e1 = ema(C, p.f), e2 = ema(C, p.s), m = new Float64Array(C.length); for (let i = 0; i < m.length; i++) m[i] = e1[i] - e2[i];
      const idx = []; for (let i = 0; i < m.length; i++) if (!Number.isNaN(m[i])) idx.push(i);
      const v = new Float64Array(idx.length); idx.forEach((i, k) => v[k] = m[i]);
      const ev = ema(v, p.sg), sg = new Float64Array(m.length).fill(NaN); idx.forEach((i, k) => sg[i] = ev[k]);
      return estAcima(m, sg); }
    case 'Estocástico Lento': {
      const hh = maxmov(H, p.k), ll = minmov(L, p.k), kf = new Float64Array(C.length);
      for (let i = 0; i < kf.length; i++) kf[i] = hh[i] > ll[i] ? 100 * (C[i] - ll[i]) / (hh[i] - ll[i] + 1e-12) : 50;
      const kl = sma(nanToNum(kf, 50), 3), d = sma(nanToNum(kl, 50), p.d); return estCruzNiveis(d, p.baixo, p.alto); }
    case 'IFR Estocástico': {
      const x = nanToNum(ifr(C, p.n, 0), 50), hh = maxmov(x, p.k), ll = minmov(x, p.k), st = new Float64Array(x.length);
      for (let i = 0; i < st.length; i++) st[i] = hh[i] > ll[i] ? 100 * (x[i] - ll[i]) / (hh[i] - ll[i] + 1e-12) : 50;
      return estCruzNiveis(st, p.baixo, p.alto); }
    case 'Super Contagem': return estSuperContagem(O, C, p.n);
    case 'Super Sinal': return estSuperSinal(C, p.nm, p.nd, p.ndm);
    case 'Acumulação Estatística': case 'Super Acum. Estatística': return estAcumEstatistica(C, L, p.n, p.m, p.filtro, p.nd, p.ndm);
    case 'Rompimento de Canal': return estCanal(H, L, C, p.ne, p.ns);
    case 'Bollinger': return estBollinger(C, p.n, p.k);
    case 'HiLo (estudo)': return hiloGann(H, L, C, p.n)[0];
  }
  throw new Error('estudo desconhecido: ' + nome);
}
function sinalStop(nome, p, O, H, L, C) {
  const N = C.length;
  switch (nome) {
    case 'Sem stop': return [new Int8Array(N).fill(1), new Float64Array(N).fill(NaN), 0];
    case 'HiLo': return [...hiloGann(H, L, C, p.n), 1];
    case 'ATR': return [...stopAtr(H, L, C, p.n, p.k), 1];
    case '% mínima': return [...stopPctMin(L, p.x), 1];
    case 'PSAR': return [...psar(H, L, C, p.af, p.afmax), 1];
  }
  throw new Error('stop desconhecido: ' + nome);
}

/* ---------------------------------------------------------------- CDI diário (mesma regra do Python) */
function cdiDiario(datas, cdiMensal) {
  const meses = Object.keys(cdiMensal).sort(), ult = cdiMensal[meses[meses.length - 1]] / 100;
  const cont = {}; datas.forEach(d => { const m = d.slice(0, 7); cont[m] = (cont[m] || 0) + 1; });
  let last = null; const taxa = {};
  meses.forEach(m => { taxa[m] = cdiMensal[m] / 100; });
  // ffill para meses sem dado (após o último mês) e fillna(último) no começo
  const out = new Float64Array(datas.length);
  const todos = Object.keys(cont).sort(); const tm = {};
  todos.forEach(m => { if (taxa[m] !== undefined) last = taxa[m]; tm[m] = last === null ? ult : last; });
  datas.forEach((d, i) => { const m = d.slice(0, 7); out[i] = Math.pow(1 + tm[m], 1 / cont[m]) - 1; });
  return out;
}

/* ---------------------------------------------------------------- métricas */
function resumo(eq, datas, cdi, hold, ent) {
  const n = eq.length, anos = (new Date(datas[n - 1]) - new Date(datas[0])) / 86400000 / 365.25;
  const tot = eq[n - 1] / eq[0] - 1, cagr = anos > 0 ? Math.pow(eq[n - 1] / eq[0], 1 / anos) - 1 : NaN;
  const r = []; for (let i = 1; i < n; i++) r.push(eq[i] / eq[i - 1] - 1);
  const mean = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1));
  let pico = -Infinity, dd = 0; for (let i = 0; i < n; i++) { if (eq[i] > pico) pico = eq[i]; dd = Math.min(dd, eq[i] / pico - 1); }
  const out = {retorno_total: tot, cagr, vol: sd * Math.sqrt(252), max_dd: dd};
  if (cdi) { let ex = 0; for (let i = 1; i < n; i++) ex += r[i - 1] - cdi[i]; out.sharpe = sd > 0 ? (ex / r.length) / sd * Math.sqrt(252) : NaN; }
  if (hold) out.tempo_posicionado = hold.reduce((a, b) => a + b, 0) / hold.length;
  if (ent) { out.operacoes = ent.reduce((a, b) => a + b, 0); out.op_por_ano = anos > 0 ? out.operacoes / anos : NaN; }
  return out;
}

G.Motor = {CUSTO, sma, ema, desvio, ifr, atrWilder, GR, descreve, sinalEstudo, sinalStop, simula, cdiDiario, resumo};
})(typeof self !== 'undefined' ? self : globalThis);
if (typeof module !== 'undefined') module.exports = (typeof self !== 'undefined' ? self : globalThis).Motor;
