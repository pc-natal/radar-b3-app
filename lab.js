/* Laboratório de Estratégias dentro do Radar B3: ranking de todas as configurações num período,
   montagem de estratégias (1 a 3 indicadores, com ou sem stop) e comparação entre papéis.
   Usa o mesmo motor do estudo (motor.js, validado contra o Python). */
'use strict';
const LAB = {tk: '^BVSP', ini: '2015-01-02', fim: null, cdi: true, capital: 5000, sub: 'ranking', cache: {}, cdiM: null, recent: null,
  worker: null, indexadoDe: null, n: 1, membros: null, regra: 'maioria', rank: null, filtroEst: '', filtroStop: '', minOps: 3, topo: 30};
const SKIP = ['tipo', 'rev', 'filtro'];
const ROT = {n: 'Período', baixo: 'Nível de compra', alto: 'Nível de venda', m: 'Média', f: 'Média curta', s: 'Média longa', sg: 'Sinal', k: '%K / desvios', d: '%D',
  nm: 'Média do preço', nd: 'Período do desvio', ndm: 'Média do desvio', ne: 'Compra: máx. de N dias', ns: 'Venda: mín. de N dias', x: 'Distância da mínima', af: 'Aceleração', afmax: 'Aceleração máx.'};
const PADRAO = {};
Motor.GR.ESTUDOS.forEach(e => { if (!PADRAO[e[1]]) PADRAO[e[1]] = {...e[2]}; });
Object.assign(PADRAO['IFR Wilder'], {n: 14, baixo: 30, alto: 70}); Object.assign(PADRAO['IFR Cutler'], {n: 14, baixo: 30, alto: 70});
const PADRAO_STOP = {'Sem stop': {}, 'HiLo': {n: 8}, 'ATR': {n: 14, k: 3}, '% mínima': {x: 0.03}, 'PSAR': {af: 0.02, afmax: 0.2}};
const NOMES_ESTUDO = [...new Set(Motor.GR.ESTUDOS.map(e => e[1]))], NOMES_STOP = Object.keys(PADRAO_STOP);
const NS = Motor.GR.STOPS.length;
LAB.membros = [{est: 'IFR Wilder', p: {...PADRAO['IFR Wilder']}, stop: 'HiLo', sp: {...PADRAO_STOP['HiLo']}},
  {est: 'Super Contagem', p: {...PADRAO['Super Contagem']}, stop: 'HiLo', sp: {...PADRAO_STOP['HiLo']}},
  {est: 'Cruz. MME', p: {...PADRAO['Cruz. MME']}, stop: 'Sem stop', sp: {}}];

/* ---------------- dados ---------------- */
async function labCarrega(tk) {
  const k = tk.replace('^', '');
  if (LAB.cache[k]) return LAB.cache[k];
  if (!LAB.cdiM) LAB.cdiM = await (await fetch('data/cdi.json')).json();
  if (!LAB.recent) { try { LAB.recent = await (await fetch('data/recent.json?v=' + Date.now())).json(); } catch (e) { LAB.recent = {}; } }
  const j = await (await fetch('data/full/' + k + '.json')).json();
  let {d, o, h, l, c} = j; d = d.slice(); o = o.slice(); h = h.slice(); l = l.slice(); c = c.slice();
  const r = LAB.recent[tk];
  if (r && r.d.length) {
    // reescala o histórico ao ajuste mais recente (dividendos pagos depois do arquivo completo) e acrescenta os pregões novos
    const ult = d[d.length - 1], q = r.d.indexOf(ult);
    if (q >= 0 && r.c[q] > 0) {
      const f = r.c[q] / c[c.length - 1];
      if (Math.abs(f - 1) > 1e-6) for (let i = 0; i < c.length; i++) { o[i] *= f; h[i] *= f; l[i] *= f; c[i] *= f; }
    }
    for (let i = 0; i < r.d.length; i++) if (r.d[i] > ult) { d.push(r.d[i]); o.push(r.o[i]); h.push(r.h[i]); l.push(r.l[i]); c.push(r.c[i]); }
  }
  const out = {d, o: Float64Array.from(o), h: Float64Array.from(h), l: Float64Array.from(l), c: Float64Array.from(c), nome: j.nome};
  out.cdi = Motor.cdiDiario(d, LAB.cdiM);
  return (LAB.cache[k] = out);
}
const busca_ = (arr, v, dir) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dir === 'r' ? arr[m] <= v : arr[m] < v) lo = m + 1; else hi = m; } return lo; };
function fatia(d, ini, fim) { return [Math.max(busca_(d, ini, 'l'), 1), busca_(d, fim, 'r')]; }

/* ---------------- simulação de estratégias do usuário ---------------- */
function simulaMembro(D_, m) {
  const s = Motor.sinalEstudo(m.est, m.p, D_.o, D_.h, D_.l, D_.c), [g, v, us] = Motor.sinalStop(m.stop, m.sp, D_.o, D_.h, D_.l, D_.c);
  return Motor.simula(D_.o, D_.h, D_.l, D_.c, s, g, v, us, Motor.CUSTO);
}
function combina(D_, membros, regra, usaCdi) {
  const T = D_.c.length, sims = membros.map(m => simulaMembro(D_, m)), cdi = D_.cdi;
  const eq = new Float64Array(T), hold = new Int8Array(T), ent = new Int8Array(T);
  if (sims.length === 1 || regra === 'sozinha') {
    const {ret, hc, ent: en} = sims[0]; let acc = 1;
    for (let t = 0; t < T; t++) { let f = Math.exp(ret[t]); if (usaCdi && (t === 0 || hc[t - 1] === 0)) f *= 1 + cdi[t]; acc *= f; eq[t] = acc; hold[t] = hc[t]; ent[t] = en[t]; }
    return {eq, hold, ent};
  }
  const n = sims.length, voto = regra === 'todas' ? n : Math.floor(n / 2) + 1; let a = 0; eq[0] = 1;
  for (let t = 1; t < T; t++) {
    let v = 0; for (const s of sims) v += s.ho[t];
    const b = a === 0 ? (v >= voto ? 1 : 0) : ((n - v) >= (n - voto + 1) ? 0 : 1);
    let f = 1 + a * (D_.o[t] / D_.c[t - 1] - 1);
    if (a === 0 && usaCdi) f *= 1 + cdi[t];
    if (a !== b) { f *= 1 - Motor.CUSTO; if (b === 1) ent[t] = 1; }
    if (b === 1) f *= D_.c[t] / D_.o[t];
    a = b; eq[t] = eq[t - 1] * f; hold[t] = a;
  }
  return {eq, hold, ent};
}
function operacoesDe(d, eq, hold, ent, a, b) {
  const ops = []; let s = -1;
  for (let t = a; t < b; t++) {
    if (ent[t]) s = t;
    if (s >= 0 && hold[t] === 0) { ops.push({e: d[s], x: d[t], r: eq[t] / eq[s - 1] - 1, dias: Math.round((new Date(d[t]) - new Date(d[s])) / 864e5)}); s = -1; }
  }
  if (s >= 0) ops.push({e: d[s], x: null, r: eq[b - 1] / eq[s - 1] - 1, dias: Math.round((new Date(d[b - 1]) - new Date(d[s])) / 864e5)});
  return ops;
}

/* ---------------- interface ---------------- */
const opt = (lista, atual) => lista.map(([v, t]) => `<option value="${v}" ${String(v) === String(atual) ? 'selected' : ''}>${t}</option>`).join('');
const pctP = (x, d = 1) => x == null || isNaN(x) ? '–' : (x * 100).toFixed(d).replace('.', ',') + '%';
const corv = x => x > 0 ? 'pos' : x < 0 ? 'neg' : '';

async function telaLab() {
  limpaGraficos();
  const papeis = D.universo.map(u => [u.papel, (u.papel === '^BVSP' ? 'IBOV' : u.papel) + ' · ' + u.nome]);
  const dados_ = await labCarrega(LAB.tk).catch(() => null);
  if (!dados_) { $('#tela').innerHTML = '<div class="vazio">Não foi possível carregar o histórico deste papel.</div>'; return; }
  if (!LAB.fim || LAB.fim > dados_.d[dados_.d.length - 1] || LAB.fim < dados_.d[0]) LAB.fim = dados_.d[dados_.d.length - 1];
  if (LAB.ini < dados_.d[0]) LAB.ini = dados_.d[0];
  $('#tela').innerHTML = `
  <section class="cartao"><h2>Laboratório de estratégias</h2>
    <p class="muted">Teste qualquer indicador (ou 2 a 3 combinados), com ou sem stop, em qualquer período. Sinal no fechamento, ordem na abertura do dia seguinte, custo de 0,07% por ordem.</p>
    <label>Papel<button class="btn sec" id="l-tk" style="margin:0;text-align:left;display:flex;justify-content:space-between"><span><b>${nomeTk(LAB.tk)}</b> · ${dados_.nome || ''}</span><span>🔍 trocar</span></button></label>
    ${dados_.d.length < 1500 ? `<p class="muted" style="color:var(--venda)">Histórico curto: ${dados_.d.length} pregões (desde ${dataBR(dados_.d[0])}). Resultados valem pouco estatisticamente, e o método dinâmico precisa de cerca de 6 anos de dados.</p>` : ''}
    <div class="lin"><label>Início<input id="l-ini" type="date" min="${dados_.d[0]}" max="${dados_.d.at(-1)}" value="${LAB.ini}"></label>
    <label>Fim<input id="l-fim" type="date" min="${dados_.d[0]}" max="${dados_.d.at(-1)}" value="${LAB.fim}"></label></div>
    <div class="lin"><label>Capital (R$)<input id="l-cap" type="number" inputmode="decimal" value="${LAB.capital}"></label>
    <label>Dinheiro parado<select id="l-cdi"><option value="1" ${LAB.cdi ? 'selected' : ''}>rende CDI</option><option value="0" ${!LAB.cdi ? 'selected' : ''}>sem rendimento</option></select></label></div>
    <div class="seg" id="l-sub"><button data-s="ranking" aria-pressed="${LAB.sub === 'ranking'}">Ranking</button><button data-s="montar" aria-pressed="${LAB.sub === 'montar'}">Montar</button><button data-s="dinamico" aria-pressed="${LAB.sub === 'dinamico'}">Dinâmico</button><button data-s="comparar" aria-pressed="${LAB.sub === 'comparar'}">Comparar</button><button data-s="carteira" aria-pressed="${LAB.sub === 'carteira'}">Carteira</button></div>
  </section><div id="l-corpo"></div>`;
  $('#l-tk').onclick = () => escolhePapel(t => { if (!t) return; LAB.tk = t; LAB.rank = null; telaLab(); });
  $('#l-ini').onchange = e => { LAB.ini = e.target.value; subLab(); };
  $('#l-fim').onchange = e => { LAB.fim = e.target.value; subLab(); };
  $('#l-cap').onchange = e => { LAB.capital = +e.target.value || 5000; subLab(); };
  $('#l-cdi').onchange = e => { LAB.cdi = e.target.value === '1'; subLab(); };
  document.querySelectorAll('#l-sub button').forEach(b => b.onclick = () => { LAB.sub = b.dataset.s; document.querySelectorAll('#l-sub button').forEach(x => x.setAttribute('aria-pressed', x === b)); subLab(); });
  subLab();
}
function subLab() { limpaGraficos(); ({ranking: labRanking, montar: labMontar, dinamico: labDinamico, comparar: labComparar, carteira: labCarteira})[LAB.sub](); }

/* ---- ranking ---- */
function garanteWorker() { if (!LAB.worker) LAB.worker = new Worker('lab-worker.js'); return LAB.worker; }
function indexa(D_) {
  return new Promise(res => {
    if (LAB.indexadoDe === LAB.tk + D_.d.length) return res(LAB.mesInfo);
    const w = garanteWorker();
    w.onmessage = e => {
      const m = e.data;
      if (m.tipo === 'prog') { const el = $('#l-prog'); if (el) el.textContent = Math.round(m.f * 100) + '%'; }
      if (m.tipo === 'indexado') { LAB.indexadoDe = LAB.tk + D_.d.length; LAB.mesInfo = {mes: m.mes, idxFim: m.idxFim, dinOk: m.dinOk, t0: m.t0}; res(LAB.mesInfo); }
    };
    w.onerror = () => { LAB.worker = null; LAB.indexadoDe = null; res({erro: true}); };
    w.postMessage({tipo: 'indexar', tk: LAB.tk, d: D_.d, o: Array.from(D_.o), h: Array.from(D_.h), l: Array.from(D_.l), c: Array.from(D_.c), cdiM: LAB.cdiM});
  });
}
function pedeRanking(m0, m1) { return new Promise(res => { LAB.worker.onmessage = e => { if (e.data.tipo === 'ranking') res(e.data); }; LAB.worker.postMessage({tipo: 'ranking', m0, m1, cdi: LAB.cdi}); }); }

async function labRanking() {
  const D_ = await labCarrega(LAB.tk), corpo = $('#l-corpo');
  corpo.innerHTML = `<section class="cartao"><div class="vazio">Simulando as ${Motor.GR.ESTUDOS.length * NS} estratégias deste papel…<br><b id="l-prog">0%</b><br><span class="muted">(só na primeira vez de cada papel; leva de 15 a 60 s no celular)</span></div></section>`;
  const info = await indexa(D_); if (LAB.sub !== 'ranking') return;
  if (info.erro) { corpo.innerHTML = '<section class="cartao"><div class="vazio">Faltou memória no aparelho para simular as 6.968 estratégias deste papel. Feche outros aplicativos e tente de novo.</div></section>'; return; }
  let m0 = busca_(info.mes, LAB.ini.slice(0, 7), 'l'), m1 = busca_(info.mes, LAB.fim.slice(0, 7), 'r') - 1;
  m0 = Math.min(m0, info.mes.length - 1); m1 = Math.max(m1, m0);
  const R = await pedeRanking(m0, m1); LAB.rank = R;
  const dias = R.dias, anos = dias / 252, K = R.ret.length;
  const iIni = m0 > 0 ? info.idxFim[m0 - 1] + 1 : 0, iFim = info.idxFim[m1];
  const bh = D_.c[iFim] / D_.c[Math.max(iIni - 1, 0)] - 1;
  let cd = 0; for (let t = iIni; t <= iFim; t++) cd += Math.log1p(D_.cdi[t]); cd = Math.expm1(cd);
  const aa = x => Math.pow(1 + x, 1 / anos) - 1;
  let ganhaBH = 0, ganhaCDI = 0; for (let k = 0; k < K; k++) { if (R.ret[k] > bh) ganhaBH++; if (R.ret[k] > cd) ganhaCDI++; }
  const kpi = (r, v, c, cls) => `<div class="kpi"><div class="r">${r}</div><div class="v ${cls || ''}">${v}</div><div class="muted">${c}</div></div>`;
  corpo.innerHTML = `
  <section class="cartao"><h3>${dataBR(D_.d[iIni])} a ${dataBR(D_.d[iFim])} (meses cheios)</h3>
    <div class="kpis">${kpi('Comprar e segurar', pctP(bh), pctP(aa(bh)) + ' ao ano')}${kpi('CDI', pctP(cd), pctP(aa(cd)) + ' ao ano')}
    ${kpi('Ganharam do C&S', pctP(ganhaBH / K, 0), 'das ' + K + ' estratégias')}${kpi('Ganharam do CDI', pctP(ganhaCDI / K, 0), 'das ' + K + ' estratégias')}</div></section>
  <section class="cartao"><h3>Melhores estratégias do período</h3>
    <div class="lin"><label>Estudo<select id="r-est"><option value="">todos</option>${NOMES_ESTUDO.map(n => `<option ${n === LAB.filtroEst ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Stop<select id="r-stop"><option value="">todos</option>${NOMES_STOP.map(n => `<option ${n === LAB.filtroStop ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
    <div class="lin"><label>Mín. de operações<input id="r-ops" type="number" inputmode="numeric" value="${LAB.minOps}"></label><label>Mostrar<input id="r-top" type="number" inputmode="numeric" value="${LAB.topo}"></label></div>
    <div id="r-tab"></div>
    <p class="muted">Toque numa linha para abrir a estratégia em "Montar" e ver a curva e as operações. Atenção: a campeã de um período raramente repete no seguinte (sobreajuste). Teste-a em outros períodos e papéis.</p></section>
  <section class="cartao"><h3>Estudo × Stop (melhor parâmetro de cada célula)</h3><div id="r-heat" class="rolagem"></div></section>`;
  const desenha = () => {
    LAB.filtroEst = $('#r-est').value; LAB.filtroStop = $('#r-stop').value; LAB.minOps = +$('#r-ops').value || 0; LAB.topo = Math.min(300, +$('#r-top').value || 30);
    const E = Motor.GR.ESTUDOS, S = Motor.GR.STOPS, idx = [];
    for (let k = 0; k < K; k++) { const e = E[(k / NS) | 0], s = S[k % NS]; if (R.ops[k] < LAB.minOps) continue; if (LAB.filtroEst && e[1] !== LAB.filtroEst) continue; if (LAB.filtroStop && s[0] !== LAB.filtroStop) continue; idx.push(k); }
    idx.sort((a, b) => R.ret[b] - R.ret[a]);
    $('#r-tab').innerHTML = `<table><tr><th>#</th><th>Estratégia</th><th>Período</th><th>Ao ano</th><th>Ops</th></tr>${idx.slice(0, LAB.topo).map((k, p) =>
      `<tr data-k="${k}" style="cursor:pointer"><td>${p + 1}</td><td style="text-align:left;white-space:normal;font-size:12px">${Motor.descreve(E[(k / NS) | 0], S[k % NS])}</td><td class="${corv(R.ret[k])}">${pctP(R.ret[k], 0)}</td><td>${pctP(aa(R.ret[k]))}</td><td>${R.ops[k]}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhuma estratégia com esses filtros.</td></tr>'}</table>
      <p class="muted">${idx.length} estratégias atendem aos filtros.</p>`;
    document.querySelectorAll('#r-tab tr[data-k]').forEach(tr => tr.onclick = () => {
      const k = +tr.dataset.k, e = E[(k / NS) | 0], s = S[k % NS];
      LAB.n = 1; LAB.membros[0] = {est: e[1], p: {...e[2]}, stop: s[0], sp: {...s[1]}}; LAB.sub = 'montar';
      document.querySelectorAll('#l-sub button').forEach(x => x.setAttribute('aria-pressed', x.dataset.s === 'montar')); subLab();
    });
    // mapa de calor estudo × tipo de stop
    const M = {}; for (let k = 0; k < K; k++) { if (R.ops[k] < LAB.minOps) continue; const e = E[(k / NS) | 0][1], s = S[k % NS][0]; const key = e + '|' + s; if (M[key] === undefined || R.ret[k] > M[key]) M[key] = R.ret[k]; }
    const vals = Object.values(M), mx = Math.max(0.2, ...vals.map(Math.abs));
    const cor = v => v == null ? 'transparent' : (v >= 0 ? `color-mix(in srgb, var(--mantem) ${Math.round(Math.min(1, v / mx) * 75)}%, var(--sup))` : `color-mix(in srgb, var(--venda) ${Math.round(Math.min(1, -v / mx) * 75)}%, var(--sup))`);
    $('#r-heat').innerHTML = `<table class="calor"><tr><th></th>${NOMES_STOP.map(s => `<th>${s}</th>`).join('')}</tr>${NOMES_ESTUDO.map(e => `<tr><td style="text-align:left;white-space:normal;font-size:12px">${e}</td>${NOMES_STOP.map(s => { const v = M[e + '|' + s]; return `<td style="background:${cor(v)}">${v == null ? '' : Math.round(v * 100) + '%'}</td>`; }).join('')}</tr>`).join('')}</table>`;
  };
  ['#r-est', '#r-stop', '#r-ops', '#r-top'].forEach(s => $(s).onchange = desenha); desenha();
}

/* ---- montar ---- */
function cartaoEstrategia(i) {
  const m = LAB.membros[i];
  const campos = (obj, pref) => Object.keys(obj).filter(k => !SKIP.includes(k)).map(k => `<label>${ROT[k] || k}<input data-pref="${pref}" data-pk="${k}" type="number" inputmode="decimal" step="any" value="${obj[k]}"></label>`).join('');
  return `<div class="ordem c-m" style="--c:var(--acento);flex-direction:column;align-items:stretch;gap:8px"><div class="tag">Estratégia ${i + 1}</div>
    <label>Indicador<select data-i="${i}" data-w="est">${opt(NOMES_ESTUDO.map(n => [n, n]), m.est)}</select></label>
    <div class="lin" style="flex-wrap:wrap">${campos(m.p, 'p')}</div>
    <label>Stop<select data-i="${i}" data-w="stop">${opt(NOMES_STOP.map(n => [n, n]), m.stop)}</select></label>
    <div class="lin" style="flex-wrap:wrap">${campos(m.sp, 'sp')}</div></div>`;
}
async function labMontar() {
  const D_ = await labCarrega(LAB.tk), corpo = $('#l-corpo');
  corpo.innerHTML = `
  <section class="cartao"><h3>Quantas estratégias combinar?</h3>
    <div class="seg" id="m-n">${[1, 2, 3].map(n => `<button data-n="${n}" aria-pressed="${LAB.n === n}">${n}</button>`).join('')}</div>
    <div id="m-cards" style="display:flex;flex-direction:column;gap:10px">${Array.from({length: LAB.n}, (_, i) => cartaoEstrategia(i)).join('')}</div>
    ${LAB.n > 1 ? `<label>Regra de combinação<select id="m-regra"><option value="todas" ${LAB.regra === 'todas' ? 'selected' : ''}>Comprar só se TODAS concordam</option><option value="maioria" ${LAB.regra === 'maioria' ? 'selected' : ''}>Comprar e vender por MAIORIA</option></select></label>` : ''}
    <button class="btn" id="m-rodar">Simular</button></section><div id="m-res"></div>`;
  document.querySelectorAll('#m-n button').forEach(b => b.onclick = () => { LAB.n = +b.dataset.n; labMontar(); });
  document.querySelectorAll('#m-cards select').forEach(s => s.onchange = () => {
    const m = LAB.membros[+s.dataset.i];
    if (s.dataset.w === 'est') { m.est = s.value; m.p = {...PADRAO[s.value]}; } else { m.stop = s.value; m.sp = {...PADRAO_STOP[s.value]}; }
    labMontar();
  });
  document.querySelectorAll('#m-cards input').forEach(inp => inp.onchange = () => {
    const card = inp.closest('.ordem'), i = [...document.querySelectorAll('#m-cards .ordem')].indexOf(card), m = LAB.membros[i];
    (inp.dataset.pref === 'p' ? m.p : m.sp)[inp.dataset.pk] = +inp.value;
  });
  if ($('#m-regra')) $('#m-regra').onchange = e => { LAB.regra = e.target.value; };
  $('#m-rodar').onclick = () => simulaMontada(D_);
  simulaMontada(D_);
}
function simulaMontada(D_) {
  const el = $('#m-res'); if (!el) return;
  try {
    const membros = LAB.membros.slice(0, LAB.n), r = combina(D_, membros, LAB.n > 1 ? LAB.regra : 'sozinha', LAB.cdi);
    const [a, b] = fatia(D_.d, LAB.ini, LAB.fim);
    renderRes(el, D_, r, a, b, LAB.n > 1 ? 'Na combinação, o stop de cada estratégia vale para a entrada; o dia-a-dia segue a maioria (ou a unanimidade) das posições.' : '');
  } catch (e) { el.innerHTML = `<section class="cartao"><div class="vazio">Não foi possível simular: ${e.message}</div></section>`; }
}
/* painel de resultado (KPIs, gráfico e operações) usado por "Montar" e "Dinâmico" */
function renderRes(el, D_, r, a, b, nota) {
  if (b - a < 20) { el.innerHTML = '<section class="cartao"><div class="vazio">Escolha um período de pelo menos um mês.</div></section>'; return; }
  const cap = LAB.capital, base = r.eq[a - 1];
  const eq = Array.from(r.eq.subarray(a - 1, b), v => v / base * cap);
  const datas = D_.d.slice(a - 1, b), cdiSl = D_.cdi.slice(a - 1, b);
  const bh = Array.from(D_.c.subarray(a - 1, b), v => v / D_.c[a - 1] * cap);
  let acc = cap; const cd = [cap]; for (let t = a; t < b; t++) { acc *= 1 + D_.cdi[t]; cd.push(acc); }
  const m = Motor.resumo(eq, datas, cdiSl, Array.from(r.hold.subarray(a, b)), Array.from(r.ent.subarray(a, b)));
  const mb = Motor.resumo(bh, datas);
  const ops = operacoesDe(D_.d, r.eq, r.hold, r.ent, a, b), gan = ops.filter(o => o.r > 0), per = ops.filter(o => o.r <= 0);
  const media = x => x.length ? x.reduce((s, o) => s + o.r, 0) / x.length : null;
  const kpi = (rot, v, c, cls) => `<div class="kpi"><div class="r">${rot}</div><div class="v ${cls || ''}">${v}</div><div class="muted">${c}</div></div>`;
  el.innerHTML = `
  <section class="cartao"><h3>Resultado (${dataBR(datas[0])} a ${dataBR(datas.at(-1))})</h3><div class="kpis">
    ${kpi('R$ ' + cap.toLocaleString('pt-BR') + ' viraram', brl(eq.at(-1)), 'comprar e segurar: ' + brl(bh.at(-1)), eq.at(-1) > bh.at(-1) ? 'pos' : '')}
    ${kpi('Ao ano', pctP(m.cagr), 'C&S ' + pctP(mb.cagr), m.cagr > mb.cagr ? 'pos' : '')}
    ${kpi('Pior queda', pctP(m.max_dd), 'C&S ' + pctP(mb.max_dd), 'neg')}
    ${kpi('Operações', String(m.operacoes), m.op_por_ano.toFixed(1).replace('.', ',') + ' por ano')}
    ${kpi('Tempo comprado', pctP(m.tempo_posicionado, 0), 'do período')}
    ${kpi('Acerto', ops.length ? pctP(gan.length / ops.length, 0) : '–', 'ganho médio ' + pctP(media(gan)) + ' · perda média ' + pctP(media(per)))}</div>
    <div class="legenda"><span><i style="background:${css('--linha-m')}"></i>Estratégia</span><span><i style="background:${css('--linha-i')}"></i>Comprar e segurar</span><span><i style="background:${css('--linha-c')}"></i>CDI</span></div>
    <div class="graf" id="m-graf"></div>${nota ? `<p class="muted">${nota}</p>` : ''}</section>
  <section class="cartao"><h3>Rendimento por período</h3>
    <div class="seg" id="p-per"><button data-p="ano" aria-pressed="true">Por ano</button><button data-p="mes" aria-pressed="false">Por mês</button></div>
    <div id="p-tab" class="rolagem" style="max-height:460px"><div class="vazio">calculando…</div></div>
    <p class="muted">C&amp;S = comprar e segurar o próprio papel. IBOV já inclui os dividendos (índice de retorno total). 🏆 = a estratégia ganhou do IBOV e do CDI. O primeiro e o último período podem ser parciais.</p></section>
  <section class="cartao"><h3>Operações</h3><div class="rolagem" style="max-height:420px"><table><tr><th>Entrada</th><th>Saída</th><th>Dias</th><th>Resultado</th></tr>
    ${ops.slice().reverse().map(o => `<tr><td>${dataBR(o.e)}</td><td>${o.x ? dataBR(o.x) : 'aberta'}</td><td>${o.dias}</td><td class="${corv(o.r)}">${pctP(o.r)}</td></tr>`).join('')}</table></div></section>`;
  tabelaPeriodos(datas, eq, bh, cd);
  limpaGraficos();
  const g = grafico($('#m-graf'), 260, true);
  const s1 = g.addLineSeries({color: css('--linha-m'), lineWidth: 3, priceLineVisible: false, lastValueVisible: false}); s1.setData(datas.map((t, i) => ({time: t, value: eq[i]})));
  g.addLineSeries({color: css('--linha-i'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false}).setData(datas.map((t, i) => ({time: t, value: bh[i]})));
  g.addLineSeries({color: css('--linha-c'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false}).setData(datas.map((t, i) => ({time: t, value: cd[i]})));
  if (ops.length <= 150) { const mk = []; ops.forEach(o => { mk.push({time: o.e, position: 'belowBar', color: css('--compra'), shape: 'arrowUp'}); if (o.x) mk.push({time: o.x, position: 'aboveBar', color: css('--venda'), shape: 'arrowDown'}); }); mk.sort((x, y) => x.time < y.time ? -1 : 1); s1.setMarkers(mk); }
  g.timeScale().fitContent();
}

/* ---- método dinâmico ao vivo ---- */
const COMITES = {top1: ['Top-1 (a melhor sozinha)', 1, 1, false], top2: ['Top-2 unânime (as 2 melhores concordam)', 2, 2, false], top3: ['Top-3 maioria (2 de 3)', 3, 2, false],
  top5: ['Top-5 maioria (3 de 5)', 5, 3, false], div3: ['Diverso-3 maioria (melhores de 3 estudos diferentes)', 3, 2, true], div5: ['Diverso-5 maioria (3 de 5)', 5, 3, true]};
const DIN = {universo: 'Todas (~7 mil)', janela: 750, criterio: 'sharpe', comite: 'top3', filtro: '0'};
function pedeDinamico(par) { return new Promise(res => { LAB.worker.onmessage = e => { if (e.data.tipo === 'dinamico') res(e.data); }; LAB.worker.postMessage({tipo: 'dinamico', par}); }); }
async function labDinamico() {
  const D_ = await labCarrega(LAB.tk), corpo = $('#l-corpo');
  corpo.innerHTML = `
  <section class="cartao"><h3>Método dinâmico</h3>
    <p style="border-left:4px solid var(--mantem);padding-left:10px"><b>Esta aba testa o método numa única ação: ${nomeTk(LAB.tk)}</b> (a do campo Papel). Ele escolhe os melhores indicadores para ela, mas não troca de ação. Para o método escolhendo <b>quais ações</b> ter, como no Radar, use a aba <a href="#" id="d-ir-cart">Carteira</a>.</p>
    <p class="muted">A cada 5 pregões, olhando só o passado, o método escolhe as configurações que melhor funcionaram na janela e segue a escolha. Nada do futuro é usado. Ele só começa a operar depois de 6 anos de histórico.</p>
    <label>Entre quais estratégias escolher<select id="d-uni">${opt([['Todas (~7 mil)', 'Todas (~7 mil)'], ['IFR + HiLo', 'Só IFR com stop HiLo'], ['Enxuto (clássicos)', 'Só as clássicas (parâmetros de livro)']], DIN.universo)}</select></label>
    <div class="lin"><label>Olhar para trás<select id="d-jan">${opt([[250, '1 ano'], [500, '2 anos'], [750, '3 anos'], [1000, '4 anos'], [1250, '5 anos'], [0, 'Todo o histórico']], DIN.janela)}</select></label>
    <label>Critério<select id="d-cri">${opt([['retorno', 'Maior retorno'], ['sharpe', 'Retorno por risco (Sharpe)'], ['multi', 'Retorno estável (3 janelas)']], DIN.criterio)}</select></label></div>
    <label>Comitê<select id="d-com">${opt(Object.entries(COMITES).map(([k, v]) => [k, v[0]]), DIN.comite)}</select></label>
    <label>Filtro de tendência<select id="d-fil">${opt([['0', 'Sem filtro'], ['1', 'Só comprar acima da média de 200 dias']], DIN.filtro)}</select></label>
    <button class="btn" id="d-rodar">Simular</button>
    <button class="btn sec" id="d-rec">Preencher com: 3 anos, Sharpe, Top-3</button></section><div id="d-res"></div>`;
  $('#d-ir-cart').onclick = e => { e.preventDefault(); LAB.sub = 'carteira'; telaLab(); };
  const le = () => { DIN.universo = $('#d-uni').value; DIN.janela = +$('#d-jan').value; DIN.criterio = $('#d-cri').value; DIN.comite = $('#d-com').value; DIN.filtro = $('#d-fil').value; };
  $('#d-rec').onclick = () => { Object.assign(DIN, {universo: 'Todas (~7 mil)', janela: 750, criterio: 'sharpe', comite: 'top3', filtro: '0'}); labDinamico(); };
  $('#d-rodar').onclick = async () => {
    le(); const el = $('#d-res');
    el.innerHTML = `<section class="cartao"><div class="vazio">Preparando as ${Motor.GR.ESTUDOS.length * Motor.GR.STOPS.length} estratégias deste papel…<br><b id="l-prog">0%</b><br><span class="muted">(só na primeira vez de cada papel; leva de 15 a 60 s no celular)</span></div></section>`;
    const info = await indexa(D_); if (LAB.sub !== 'dinamico') return;
    if (info.erro) { el.innerHTML = '<section class="cartao"><div class="vazio">Faltou memória no aparelho para simular as 6.968 estratégias deste papel. Feche outros aplicativos e tente de novo.</div></section>'; return; }
    if (!info.dinOk) { el.innerHTML = '<section class="cartao"><div class="vazio">Este papel tem menos de 6 anos de histórico: o método dinâmico não tem dados para operar. Use as abas Ranking e Montar.</div></section>'; return; }
    el.innerHTML = '<section class="cartao"><div class="vazio">Simulando o método dinâmico…</div></section>';
    const [, top, voto, diverso] = COMITES[DIN.comite];
    const r = await pedeDinamico({universo: DIN.universo, janela: DIN.janela, criterio: DIN.criterio, top, voto, diverso, filtro200: DIN.filtro === '1'});
    if (r.erro) { el.innerHTML = `<section class="cartao"><div class="vazio">${r.erro}</div></section>`; return; }
    let [a, b] = fatia(D_.d, LAB.ini, LAB.fim); const primeira = r.t0 + 1;
    const aviso = a < primeira ? `O método começa a operar em ${dataBR(D_.d[r.t0])}; o período foi ajustado.` : '';
    a = Math.max(a, primeira);
    const at = r.atual, hoje = at.hoje ? 'comprado' : 'fora do mercado';
    const acao = at.hoje ? (at.amanha ? ['mantem', 'MANTER COMPRADO'] : ['venda', 'VENDER na abertura']) : (at.amanha ? ['compra', 'COMPRAR na abertura'] : ['fora', 'FICAR FORA']);
    const ult = D_.d.at(-1);
    const mud = []; let ant = -1; for (let t = r.t0; t < D_.d.length; t++) { if (r.esc[t] !== ant) { mud.push({d: D_.d[t], k: r.esc[t]}); ant = r.esc[t]; } }
    const NS = Motor.GR.STOPS.length, nm = k => Motor.descreve(Motor.GR.ESTUDOS[(k / NS) | 0], Motor.GR.STOPS[k % NS]);
    el.innerHTML = `
    <section class="cartao"><h3>O que o método manda fazer agora (${dataBR(ult)})</h3>
      <div class="ordem c-${acao[0] === 'compra' ? 'c' : acao[0] === 'venda' ? 'v' : 'm'}"><div><div class="tag">${acao[1]}</div><div class="nm">Hoje na simulação: ${hoje}</div></div></div>
      <p class="muted">Configurações escolhidas hoje (${at.votos} de ${at.membros.length} indicam compra):</p>
      <ul class="lista">${at.membros.map(m => `<li>${m.quer ? '✅' : '⬜'} ${m.nome}${m.stop ? ' · stop ' + (LAB.tk === '^BVSP' ? Math.round(m.stop).toLocaleString('pt-BR') + ' pts' : brl(m.stop)) : ''}</li>`).join('')}</ul></section>
    <div id="d-core"></div>
    <section class="cartao"><h3>Quem liderou ao longo do tempo</h3><p class="muted">Primeira colocada em cada reavaliação (mudanças mais recentes primeiro). Repare como o melhor indicador muda com o mercado.</p>
      <div class="rolagem" style="max-height:320px"><table><tr><th>Desde</th><th style="text-align:left">Configuração líder</th></tr>${mud.slice(-60).reverse().map(x => `<tr><td>${dataBR(x.d)}</td><td style="text-align:left;white-space:normal;font-size:12px">${nm(x.k)}</td></tr>`).join('')}</table></div></section>`;
    renderRes($('#d-core'), D_, {eq: r.eq, hold: r.hold, ent: r.ent}, a, b, (aviso ? aviso + ' ' : '') + 'Atenção: o desempenho passado de uma variante não prevê o futuro. No estudo, a variante que ia melhor em 2006–2014 não foi a melhor em 2015–2026.');
  };
}

/* ---- comparar papéis ---- */
function labComparar() {
  $('#l-corpo').innerHTML = `<section class="cartao"><h3>Mesma estratégia em todos os papéis do estudo</h3>
    <p class="muted">Usa a estratégia montada na aba "Montar" (${LAB.membros.slice(0, LAB.n).map(m => m.est + ' + ' + m.stop).join(' &amp; ')}${LAB.n > 1 ? ', regra: ' + LAB.regra : ''}) no período escolhido.</p>
    <button class="btn" id="c-rodar">Rodar em todos os papéis</button><div id="c-res"></div></section>`;
  $('#c-rodar').onclick = async () => {
    const el = $('#c-res'), linhas = [], lista = D.universo.filter(u => !u.extra); el.innerHTML = '<div class="vazio"><b id="c-p">0</b>/' + lista.length + '</div>';
    for (let i = 0; i < lista.length; i++) {
      const t = lista[i].papel; $('#c-p').textContent = i + 1;
      try {
        const D_ = await labCarrega(t), [a, b] = fatia(D_.d, LAB.ini, LAB.fim); if (b - a < 60) continue;
        const r = combina(D_, LAB.membros.slice(0, LAB.n), LAB.n > 1 ? LAB.regra : 'sozinha', LAB.cdi), base = r.eq[a - 1];
        const eq = Array.from(r.eq.subarray(a - 1, b), v => v / base), dd = D_.d.slice(a - 1, b);
        const m = Motor.resumo(eq, dd, D_.cdi.slice(a - 1, b), Array.from(r.hold.subarray(a, b)), Array.from(r.ent.subarray(a, b)));
        const anos = (new Date(D_.d[b - 1]) - new Date(D_.d[a - 1])) / 864e5 / 365.25, bh = Math.pow(D_.c[b - 1] / D_.c[a - 1], 1 / anos) - 1;
        linhas.push({t, ini: D_.d[a - 1], cagr: m.cagr, bh, dd: m.max_dd, ops: m.operacoes});
      } catch (e) {}
      await new Promise(r => setTimeout(r, 0));
    }
    linhas.sort((x, y) => y.cagr - x.cagr);
    const ganha = linhas.filter(l => l.cagr > l.bh).length;
    el.innerHTML = `<div class="kpis"><div class="kpi"><div class="r">Ganhou do C&S em</div><div class="v">${Math.round(ganha / linhas.length * 100)}%</div><div class="muted">${ganha} de ${linhas.length} papéis</div></div></div>
      <table><tr><th>Papel</th><th>Ao ano</th><th>C&S</th><th>Queda</th><th>Ops</th></tr>${linhas.map(l => `<tr style="cursor:pointer" data-t="${l.t}"><td><b>${nomeTk(l.t)}</b></td><td class="${l.cagr > l.bh ? 'pos' : 'neg'}">${pctP(l.cagr)}</td><td>${pctP(l.bh)}</td><td>${pctP(l.dd, 0)}</td><td>${l.ops}</td></tr>`).join('')}</table>`;
    el.querySelectorAll('tr[data-t]').forEach(tr => tr.onclick = () => { LAB.tk = tr.dataset.t; LAB.rank = null; LAB.sub = 'montar'; telaLab(); });
  };
}

/* ---- carteira: o app escolhe as ações (até N das 37 do estudo), com parâmetros dinâmicos ou fixos ----
   Mesma lógica do motor Python (carteira.py): sinal no fechamento, ordem na abertura, prioridade pelo
   consenso (dinâmico) ou pela força de 6 meses (fixo), caixa no CDI, custo por ordem. */
const CART = {modo: 'din', grupo: '*', janela: '*', comite: '*', teta: 0.7, vagas: 3, cmp: '', est: 'IFR Wilder', p: {...PADRAO['IFR Wilder']}, stop: 'HiLo', sp: {...PADRAO_STOP['HiLo']}};
const GRUPOS = [['*', 'Todas as estratégias (método atual)'], ['Todas (~7 mil)', 'Grupo "todas as ~7 mil"'], ['IFR + HiLo', 'Só IFR com stop HiLo'], ['Enxuto (clássicos)', 'Só as clássicas']];
const JANELAS = [['*', 'Todas (atual)'], [250, '1 ano'], [500, '2 anos'], [750, '3 anos'], [1000, '4 anos'], [1250, '5 anos'], [0, 'Todo o histórico']];
const COMITES_C = [['*', 'Todos (atual)'], ['Top-1', 'Top-1 (a melhor sozinha)'], ['Top-2 unânime', 'Top-2 (as 2 melhores concordam)'], ['Top-3 maioria', 'Top-3 (2 das 3 melhores)']];

async function carregaEstudo(prog) {
  if (LAB.est37) return LAB.est37;
  const tks = D.universo.filter(u => !u.extra && u.papel !== '^BVSP').map(u => u.papel), P = {};
  for (let i = 0; i < tks.length; i++) { prog && prog(i / tks.length); try { P[tks[i]] = await labCarrega(tks[i]); } catch (e) {} }
  return (LAB.est37 = P);
}
function simCarteira(cal, S, vagas, custo, cdi) {
  // S: [{tk, HO, HC, FI, ON, PERM, FORCA}] alinhados em cal
  const T = cal.length, P = S.length, eq = new Float64Array(T), pos = new Int8Array(P), val = new Float64Array(P), ent = new Array(P).fill(null), ops = [];
  let caixa = 1; eq[0] = 1;
  const sai = (p, t, motivo) => { ops.push({tk: S[p].tk, e: cal[ent[p].t], x: cal[t], r: val[p] / ent[p].v - 1, motivo}); };
  for (let t = 1; t < T; t++) {
    caixa *= 1 + cdi[t];
    for (let p = 0; p < P; p++) if (pos[p]) val[p] *= 1 + S[p].ON[t];
    for (let p = 0; p < P; p++) if (pos[p] && S[p].HO[t] === 0) { const v = val[p] * (1 - custo); val[p] = v; sai(p, t, 'sinal'); caixa += v; val[p] = 0; pos[p] = 0; }
    let livres = vagas; for (let p = 0; p < P; p++) livres -= pos[p];
    if (livres > 0) {
      const cand = []; for (let p = 0; p < P; p++) if (!pos[p] && S[p].HO[t] === 1 && S[p].PERM[t - 1] === 1) cand.push(p);
      if (cand.length) {
        cand.sort((a, b) => S[b].FORCA[t - 1] - S[a].FORCA[t - 1] || a - b);
        let total = caixa; for (let p = 0; p < P; p++) total += val[p]; const fatia = total / vagas;
        for (let q = 0; q < Math.min(livres, cand.length); q++) { const p = cand[q], ap = Math.min(fatia, caixa); if (ap <= 1e-9) break;
          caixa -= ap; val[p] = ap * (1 - custo); pos[p] = 1; ent[p] = {t, v: ap}; }
      }
    }
    for (let p = 0; p < P; p++) if (pos[p]) { val[p] *= S[p].FI[t]; if (S[p].HC[t] === 0) { sai(p, t, 'stop'); caixa += val[p]; val[p] = 0; pos[p] = 0; } }
    let v = caixa; for (let p = 0; p < P; p++) v += val[p]; eq[t] = v;
  }
  const abertas = []; for (let p = 0; p < P; p++) if (pos[p]) abertas.push({tk: S[p].tk, e: cal[ent[p].t], r: val[p] / ent[p].v - 1});
  return {eq, ops, abertas};
}
function alinha(cal, D_, extra) {
  // séries do papel no calendário comum; extra(i_papel) devolve {ho, hc, fi} no índice do próprio papel
  const T = cal.length, mapa = new Map(D_.d.map((d, i) => [d, i]));
  const HO = new Int8Array(T), HC = new Int8Array(T), FI = new Float64Array(T).fill(1), ON = new Float64Array(T), PERM = new Int8Array(T), FORCA = new Float64Array(T).fill(-9);
  for (let t = 0; t < T; t++) { const i = mapa.get(cal[t]); if (i === undefined) continue;
    PERM[t] = 1; if (i > 0) ON[t] = D_.o[i] / D_.c[i - 1] - 1;
    const x = extra(i, t); HO[t] = x.ho; HC[t] = x.hc; FI[t] = x.fi; FORCA[t] = x.forca; }
  return {HO, HC, FI, ON, PERM, FORCA};
}
const mom126 = (D_, i) => i >= 126 ? D_.c[i] / D_.c[i - 126] - 1 : -9;

async function labCarteira() {
  const corpo = $('#l-corpo');
  if (!LAB.familias) { try { LAB.familias = (await (await fetch('data/familias/indice.json')).json()).familias; } catch (e) { LAB.familias = []; } }
  const grupos = GRUPOS.concat(LAB.familias.map(f => ['fam:' + f.nome, 'Só ' + f.nome + ' (parâmetros e stop dinâmicos)']));
  const sel = (id, lista, v) => `<select id="${id}">${opt(lista, v)}</select>`;
  corpo.innerHTML = `<section class="cartao"><h3>Carteira: o app escolhe as ações</h3>
    <p class="muted">Simula uma carteira com as 37 ações do estudo: a cada dia o método escolhe até N ações para ter, compra e vende sozinho. Período, capital e CDI vêm dos campos lá em cima (o campo Papel não é usado aqui).</p>
    <div class="seg" id="c-modo"><button data-m="din" aria-pressed="${CART.modo === 'din'}">Parâmetros dinâmicos</button><button data-m="fixo" aria-pressed="${CART.modo === 'fixo'}">Parâmetros fixos</button></div>
    <div id="c-opc"></div>
    <div class="lin"><label>Máximo de ações${sel('c-vag', [1, 2, 3, 4, 5, 8].map(v => [v, v + (v === 3 ? ' (atual)' : '')]), CART.vagas)}</label>
    <label>Comparar também com<button class="btn sec" id="c-cmp" style="margin:0">${CART.cmp || 'escolher ação…'}</button></label></div>
    <button class="btn" id="c-rodar">Simular</button></section><div id="c-res2"></div>`;
  const opcoes = () => {
    $('#c-opc').innerHTML = CART.modo === 'din' ? `
      <p class="muted">Toda semana, olhando só o passado, as variantes do método escolhem os melhores indicadores <b>de cada ação</b>; a carteira compra as ações em que pelo menos o limiar das variantes concorda.</p>
      <label>Entre quais estratégias escolher${sel('c-gru', grupos, CART.grupo)}</label>
      <p class="muted" style="margin-top:-6px">Escolha "Só …" para fixar o indicador: o método varia os parâmetros e o stop dele ao longo do tempo e escolhe as ações da carteira.</p>
      <div class="lin"><label>Olhar para trás${sel('c-jan', JANELAS, CART.janela)}</label><label>Comitê${sel('c-com', COMITES_C, CART.comite)}</label></div>
      <label>Limiar de consenso${sel('c-teta', [0.34, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(v => [v, v === 1 ? 'todas concordam (100%)' : Math.round(v * 100) + '%' + (v === 0.7 ? ' (atual)' : '')]), CART.teta)}</label>`
      : `<p class="muted">A mesma estratégia em todas as ações; quando várias dão sinal ao mesmo tempo, entram as que mais subiram nos últimos 6 meses.</p>
      <label>Indicador${sel('c-est', NOMES_ESTUDO.map(n => [n, n]), CART.est)}</label><div class="lin" style="flex-wrap:wrap">${campos(CART.p, 'p')}</div>
      <label>Stop${sel('c-stop', NOMES_STOP.map(n => [n, n]), CART.stop)}</label><div class="lin" style="flex-wrap:wrap">${campos(CART.sp, 'sp')}</div>`;
    const ch = (id, f) => { const e = $(id); if (e) e.onchange = f; };
    ch('#c-gru', e => CART.grupo = e.target.value); ch('#c-jan', e => CART.janela = e.target.value); ch('#c-com', e => CART.comite = e.target.value); ch('#c-teta', e => CART.teta = +e.target.value);
    ch('#c-est', e => { CART.est = e.target.value; CART.p = {...PADRAO[CART.est]}; opcoes(); }); ch('#c-stop', e => { CART.stop = e.target.value; CART.sp = {...PADRAO_STOP[CART.stop]}; opcoes(); });
    document.querySelectorAll('#c-opc input[data-pk]').forEach(inp => inp.onchange = () => { (inp.dataset.pref === 'p' ? CART.p : CART.sp)[inp.dataset.pk] = +inp.value; });
  };
  function campos(obj, pref) { return Object.keys(obj).filter(k => !SKIP.includes(k)).map(k => `<label>${ROT[k] || k}<input data-pref="${pref}" data-pk="${k}" type="number" inputmode="decimal" step="any" value="${obj[k]}"></label>`).join(''); }
  opcoes();
  document.querySelectorAll('#c-modo button').forEach(b => b.onclick = () => { CART.modo = b.dataset.m; document.querySelectorAll('#c-modo button').forEach(x => x.setAttribute('aria-pressed', x === b)); opcoes(); });
  $('#c-vag').onchange = e => CART.vagas = +e.target.value;
  $('#c-cmp').onclick = () => escolhePapel(t => { CART.cmp = t; $('#c-cmp').textContent = CART.cmp || 'escolher ação…'; }, true);
  $('#c-rodar').onclick = rodaCarteira;
}

async function rodaCarteira() {
  const el = $('#c-res2'); el.innerHTML = '<section class="cartao"><div class="vazio">Carregando as 37 ações… <b id="c-pr">0%</b><br><span class="muted">(só na primeira vez; ~4 MB)</span></div></section>';
  const P = await carregaEstudo(f => { const x = $('#c-pr'); if (x) x.textContent = Math.round(f * 100) + '%'; });
  let cel = null;
  const fam = CART.grupo.startsWith('fam:') ? CART.grupo.slice(4) : null;
  if (CART.modo === 'din') { try { LAB.celFam = LAB.celFam || {};
      cel = fam ? (LAB.celFam[fam] || (LAB.celFam[fam] = await (await fetch('data/familias/' + LAB.familias.find(f => f.nome === fam).arquivo)).json()))
                : (LAB.celulas || (LAB.celulas = await (await fetch('data/consenso_celulas.json')).json())); } catch (e) { el.innerHTML = '<section class="cartao"><div class="vazio">Dados do método ainda não disponíveis. Tente depois da próxima atualização diária.</div></section>'; return; } }
  el.innerHTML = '<section class="cartao"><div class="vazio">Simulando…</div></section>'; await new Promise(r => setTimeout(r, 30));
  const cal = cel ? cel.datas : [...new Set(Object.values(P).flatMap(x => x.d.filter(d => d >= '2006-01-02')))].sort();
  let S = [];
  if (cel) {
    const usa = cel.celulas.map((c, k) => (CART.grupo === '*' || fam || c.estrategias === CART.grupo) && (CART.janela === '*' || String(c.janela) === String(CART.janela)) && (CART.comite === '*' || c.comite === CART.comite) ? k : -1).filter(k => k >= 0);
    const nVar = usa.length * cel.por_celula, posCal = new Map(cal.map((d, i) => [d, i]));
    for (const [tk, linhas] of Object.entries(cel.papeis)) { const D_ = P[tk]; if (!D_) continue;
      const frac = t => { let s = 0; for (const k of usa) { const ch = linhas[k].charCodeAt(t); if (ch === 46) return -1; s += ch - 48; } return s / nVar; };
      const fr = new Float64Array(cal.length); for (let t = 0; t < cal.length; t++) fr[t] = frac(t);
      S.push({tk, ...alinha(cal, D_, (i, t) => { const f = fr[t]; if (f < 0) return {ho: 0, hc: 0, fi: 1, forca: -9}; const h = f >= CART.teta - 1e-9 ? 1 : 0;
        return {ho: h, hc: h, fi: h ? D_.c[i] / D_.o[i] : 1, forca: f + 1e-6 * Math.max(-1, Math.min(5, mom126(D_, i)))}; })});
    }
  } else {
    for (const [tk, D_] of Object.entries(P)) {
      const s = Motor.sinalEstudo(CART.est, CART.p, D_.o, D_.h, D_.l, D_.c), [g, v, us] = Motor.sinalStop(CART.stop, CART.sp, D_.o, D_.h, D_.l, D_.c);
      const r = Motor.simula(D_.o, D_.h, D_.l, D_.c, s, g, v, us, Motor.CUSTO);
      S.push({tk, ...alinha(cal, D_, i => ({ho: r.ho[i], hc: r.hc[i], fi: r.fi[i], forca: mom126(D_, i - 0)}))});
    }
    // força do dia anterior do próprio papel (como no Python: FORCA[t-1] usa o fechamento de t-1)
  }
  const cdiAll = Motor.cdiDiario(cal, LAB.cdiM), res = simCarteira(cal, S, CART.vagas, Motor.CUSTO, cdiAll);
  // recorte do período escolhido
  let a = cal.findIndex(d => d >= LAB.ini); if (a < 1) a = 1; let b = cal.length - 1; while (b > a && cal[b] > LAB.fim) b--;
  if (b - a < 20) { el.innerHTML = '<section class="cartao"><div class="vazio">Escolha um período de pelo menos um mês (a simulação começa em 2006).</div></section>'; return; }
  const cap = LAB.capital, datas = cal.slice(a - 1, b + 1), eq = Array.from(res.eq.subarray(a - 1, b + 1), x => x / res.eq[a - 1] * cap);
  const serie = D_ => { const m = new Map(D_.d.map((d, i) => [d, D_.c[i]])); let u = null; const arr = datas.map(d => (u = m.get(d) ?? u)); const b0 = arr.find(x => x != null); return arr.map(x => x == null ? cap : x / b0 * cap); };
  const ib = serie(await labCarrega('^BVSP')); let acc = cap; const cd = [cap]; for (let t = a; t <= b; t++) { acc *= LAB.cdi ? 1 + cdiAll[t] : 1; cd.push(acc); }
  const cmp = CART.cmp ? serie(await labCarrega(CART.cmp)) : null;
  const anos = (new Date(datas.at(-1)) - new Date(datas[0])) / 31557600000, aa = arr => Math.pow(arr.at(-1) / cap, 1 / anos) - 1;
  const dd = arr => { let pk = 0, m = 0; for (const x of arr) { pk = Math.max(pk, x); m = Math.min(m, x / pk - 1); } return m; };
  const ops = res.ops.filter(o => o.x >= datas[0] && o.e <= datas.at(-1)), gan = ops.filter(o => o.r > 0);
  const kpi = (r, v, x, cls) => `<div class="kpi"><div class="r">${r}</div><div class="v ${cls || ''}">${v}</div><div class="muted">${x}</div></div>`;
  const nomeCfg = CART.modo === 'din' ? `${fam ? 'Só ' + fam + ' (dinâmico)' : GRUPOS.find(g => g[0] === CART.grupo)[1]} · ${JANELAS.find(j => String(j[0]) === String(CART.janela))[1]} · ${COMITES_C.find(c => c[0] === CART.comite)[1]} · limiar ${Math.round(CART.teta * 100)}%` : `${CART.est} + stop ${CART.stop} (parâmetros fixos)`;
  el.innerHTML = `<section class="cartao"><h3>${dataBR(datas[0])} a ${dataBR(datas.at(-1))}</h3><p class="muted">${nomeCfg} · até ${CART.vagas} ações</p><div class="kpis">
    ${kpi(brl(cap) + ' viraram', brl(eq.at(-1)), pctP(aa(eq)) + ' ao ano', eq.at(-1) > ib.at(-1) ? 'pos' : 'neg')}${kpi('Ibovespa', brl(ib.at(-1)), pctP(aa(ib)) + ' ao ano')}
    ${kpi('CDI', brl(cd.at(-1)), pctP(aa(cd)) + ' ao ano')}${cmp ? kpi(CART.cmp + ' (comprar e segurar)', brl(cmp.at(-1)), pctP(aa(cmp)) + ' ao ano') : ''}
    ${kpi('Pior queda', pctP(dd(eq)), 'IBOV ' + pctP(dd(ib)), 'neg')}${kpi('Operações', String(ops.length), ops.length ? 'acerto ' + pctP(gan.length / ops.length, 0) : '')}</div>
    <div class="legenda"><span><i style="background:${css('--linha-m')}"></i>Carteira</span><span><i style="background:${css('--linha-i')}"></i>IBOV</span><span><i style="background:${css('--linha-c')}"></i>CDI</span>${cmp ? `<span><i style="background:${css('--compra')}"></i>${CART.cmp}</span>` : ''}</div>
    <div class="graf" id="c-graf"></div></section>
    <section class="cartao"><h3>Rendimento por período</h3><div class="seg" id="c-per"><button data-p="ano" aria-pressed="true">Por ano</button><button data-p="mes" aria-pressed="false">Por mês</button></div>
      <div id="c-tab" class="rolagem" style="max-height:460px"></div><p class="muted">🏆 = a carteira ganhou do IBOV e do CDI. IBOV já inclui os dividendos (índice de retorno total). O primeiro e o último período podem ser parciais.</p></section>
    <section class="cartao"><h3>Ações na carteira no fim do período</h3>${res.abertas.length && b === cal.length - 1 ? res.abertas.map(o => `<div><b>${o.tk}</b> desde ${dataBR(o.e)} · <span class="${corv(o.r)}">${pctP(o.r)}</span></div>`).join('') : '<p class="muted">Nenhuma (100% no CDI) ou período encerrado antes de hoje.</p>'}</section>
    <section class="cartao"><h3>Operações (${ops.length})</h3><div class="rolagem" style="max-height:420px"><table><tr><th>Papel</th><th>Entrada</th><th>Saída</th><th>Resultado</th></tr>
      ${ops.slice().reverse().map(o => `<tr><td><b>${o.tk}</b></td><td>${dataBR(o.e)}</td><td>${dataBR(o.x)}${o.motivo === 'stop' ? ' (stop)' : ''}</td><td class="${corv(o.r)}">${pctP(o.r)}</td></tr>`).join('')}</table></div></section>`;
  limpaGraficos(); const g = grafico($('#c-graf'), 280, true), ln = (arr, cor, w) => g.addLineSeries({color: cor, lineWidth: w, priceLineVisible: false, lastValueVisible: false}).setData(datas.map((d, i) => ({time: d, value: arr[i]})));
  ln(eq, css('--linha-m'), 3); ln(ib, css('--linha-i'), 2); ln(cd, css('--linha-c'), 2); if (cmp) ln(cmp, css('--compra'), 2); g.timeScale().fitContent();
  const cols = [['Carteira', eq], ['IBOV', ib], ['CDI', cd]].concat(cmp ? [[CART.cmp, cmp]] : []);
  const tab = modo => {
    const chave = d => modo === 'ano' ? d.slice(0, 4) : d.slice(0, 7), fim = new Map(); datas.forEach((d, i) => fim.set(chave(d), i));
    let ant = 0, ga = 0, n = 0; const lin = [];
    for (const [k, i] of fim) { if (i === 0) continue; const r = arr => arr[i] / arr[ant] - 1, rs = cols.map(c => r(c[1])); n++; const win = rs[0] > rs[1] && rs[0] > rs[2]; if (win) ga++;
      const rot = modo === 'ano' ? k : ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][+k.slice(5) - 1] + '/' + k.slice(2, 4);
      lin.push(`<tr><td><b>${rot}</b></td>${rs.map(x => `<td class="${corv(x)}">${pctP(x)}</td>`).join('')}<td>${win ? '🏆' : ''}</td></tr>`); ant = i; }
    $('#c-tab').innerHTML = `<p class="muted">A carteira ganhou do IBOV e do CDI em <b>${ga} de ${n}</b> ${modo === 'ano' ? 'anos' : 'meses'}.</p><table><tr><th>${modo === 'ano' ? 'Ano' : 'Mês'}</th>${cols.map(c => `<th>${c[0]}</th>`).join('')}<th></th></tr>${lin.reverse().join('')}</table>`;
  };
  document.querySelectorAll('#c-per button').forEach(bt => bt.onclick = () => { document.querySelectorAll('#c-per button').forEach(x => x.setAttribute('aria-pressed', x === bt)); tab(bt.dataset.p); });
  tab('ano');
}

/* escolha de papel com busca (a lista do Android não abria) */
function escolhePapel(cb, permiteNenhum) {
  const lista = D.universo.slice().sort((x, y) => (x.extra ? 1 : 0) - (y.extra ? 1 : 0) || x.papel.localeCompare(y.papel));
  $('#dlg-c').innerHTML = `<h2>Escolher ação</h2><input id="ep-b" type="search" autocomplete="off" placeholder="Código ou nome (ex.: PETR4, Vale)">
    <div id="ep-l" class="lista" style="max-height:55vh;overflow:auto;margin-top:8px"></div>
    <div class="lin">${permiteNenhum ? '<button class="btn sec" id="ep-0">Nenhuma</button>' : ''}<button class="btn sec" id="ep-x">Fechar</button></div>`;
  const desenha = () => { const f = semAcento($('#ep-b').value.trim()); const l = lista.filter(u => !f || u.papel.includes(f) || semAcento(u.nome).includes(f)).slice(0, 80);
    $('#ep-l').innerHTML = l.map(u => `<div class="item" data-tk="${u.papel}"><span class="tk">${nomeTk(u.papel)}</span><span class="nm">${u.nome}${u.extra ? '' : ' · do estudo'}</span></div>`).join('') || '<div class="vazio">Nada encontrado.</div>';
    document.querySelectorAll('#ep-l .item').forEach(e => e.onclick = () => { $('#dlg').close(); cb(e.dataset.tk); }); };
  $('#ep-b').oninput = desenha; $('#ep-x').onclick = () => $('#dlg').close(); if ($('#ep-0')) $('#ep-0').onclick = () => { $('#dlg').close(); cb(''); };
  desenha(); $('#dlg').showModal(); setTimeout(() => $('#ep-b').focus(), 50);
}

/* rendimento por ano ou por mês: estratégia × comprar e segurar × IBOV × CDI */
async function tabelaPeriodos(datas, eq, bh, cd) {
  let ib = null; try { const I = await labCarrega('^BVSP'); const m = new Map(I.d.map((d, i) => [d, I.c[i]])); let u = null; ib = datas.map(d => (u = m.get(d) ?? u)); } catch (e) {}
  const desenha = modo => {
    const el = $('#p-tab'); if (!el) return;
    const chave = d => modo === 'ano' ? d.slice(0, 4) : d.slice(0, 7), fim = new Map(); datas.forEach((d, i) => fim.set(chave(d), i));
    let ant = 0; const lin = []; let gI = 0, n = 0;
    for (const [k, i] of fim) { if (i === 0) continue;   // o 1º ponto é só a base (véspera do início)
      const r = arr => arr && arr[ant] ? arr[i] / arr[ant] - 1 : null;
      const e = r(eq), b = r(bh), x = r(ib), c = r(cd); n++; if (x != null && e > x && e > c) gI++;
      const rot = modo === 'ano' ? k : ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][+k.slice(5) - 1] + '/' + k.slice(2, 4);
      lin.push(`<tr><td><b>${rot}</b></td><td class="${corv(e)}">${pctP(e)}</td><td class="${corv(b)}">${pctP(b)}</td><td class="${corv(x)}">${pctP(x)}</td><td>${pctP(c)}</td><td>${x != null && e > x && e > c ? '🏆' : ''}</td></tr>`); ant = i; }
    el.innerHTML = `<p class="muted">A estratégia ganhou do IBOV e do CDI em <b>${gI} de ${n}</b> ${modo === 'ano' ? 'anos' : 'meses'}.</p>
      <table><tr><th>${modo === 'ano' ? 'Ano' : 'Mês'}</th><th>Estratégia</th><th>C&amp;S</th><th>IBOV</th><th>CDI</th><th></th></tr>${lin.reverse().join('')}</table>`;
  };
  document.querySelectorAll('#p-per button').forEach(bt => bt.onclick = () => { document.querySelectorAll('#p-per button').forEach(x => x.setAttribute('aria-pressed', x === bt)); desenha(bt.dataset.p); });
  desenha('ano');
}
