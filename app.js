/* Radar B3 — aplicativo de bolso (PWA).
   Dados: data/radar.json (ordens do método), data/universo.json, data/hist/<TK>.json, data/cotacoes.json (preços ~15 min).
   Carteira simulada: guardada só neste celular (localStorage), com exportação de backup. */
'use strict';
const $ = s => document.querySelector(s);
const brl = x => x == null || isNaN(x) ? '–' : 'R$ ' + Number(x).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const pct = (x, d = 1) => x == null || isNaN(x) ? '–' : (x > 0 ? '+' : '') + (x * 100).toFixed(d).replace('.', ',') + '%';
const dataBR = s => s ? new Date(s.length <= 10 ? s + 'T12:00' : s).toLocaleDateString('pt-BR') : '–';
const horaBR = s => s ? new Date(s).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '–';
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const nomeTk = t => t === '^BVSP' ? 'IBOV' : t;
const D = {radar: null, universo: [], cot: null, hist: {}};
let aba = 'radar', graficos = [], observadores = [];

/* ---------------- dados ---------------- */
async function busca(arq) { const r = await fetch('data/' + arq + '?v=' + Date.now()); if (!r.ok) throw new Error(arq); return r.json(); }
async function hist(tk) {   // últimos ~3 anos (histórico completo + pregões recentes), para os gráficos
  const k = tk.replace('^', '');
  if (!D.hist[k]) { const x = await labCarrega(tk), n = x.d.length, i0 = Math.max(0, n - 760);
    D.hist[k] = {papel: tk, nome: x.nome, d: x.d.slice(i0), o: Array.from(x.o.subarray(i0)), h: Array.from(x.h.subarray(i0)), l: Array.from(x.l.subarray(i0)), c: Array.from(x.c.subarray(i0))}; }
  return D.hist[k];
}
function preco(tk) {
  const c = D.cot && D.cot.precos && D.cot.precos[tk];
  if (c && c.preco) return {preco: c.preco, quando: D.cot.atualizado, fonte: 'cotação'};
  const u = D.universo.find(x => x.papel === tk);
  return u ? {preco: u.fechamento, quando: D.radar && D.radar.ultimo_pregao, fonte: 'fechamento'} : null;
}
function variacao(tk) { const c = D.cot && D.cot.precos && D.cot.precos[tk]; if (c && c.var != null) return c.var; const u = D.universo.find(x => x.papel === tk); return u && u.var; }

/* ---------------- carteira simulada ---------------- */
const CHAVE = 'radarb3.carteira';
function cart() {
  try { const c = JSON.parse(localStorage.getItem(CHAVE)); if (c && c.ops) return c; } catch (e) {}
  return {capital: 5000, inicio: new Date().toISOString(), ops: []};
}
function salva(c) { try { localStorage.setItem(CHAVE, JSON.stringify(c)); } catch (e) { alerta('Não foi possível salvar neste navegador.'); } }
function posicoes(c) {
  const p = {}; let caixa = c.capital;
  for (const o of c.ops) {
    const q = p[o.papel] || (p[o.papel] = {papel: o.papel, qtd: 0, custo: 0});
    if (o.tipo === 'C') { q.custo += o.qtd * o.preco; q.qtd += o.qtd; caixa -= o.qtd * o.preco; }
    else { const pm = q.qtd ? q.custo / q.qtd : 0; q.custo -= pm * o.qtd; q.qtd -= o.qtd; caixa += o.qtd * o.preco; }
  }
  return {caixa, lista: Object.values(p).filter(x => x.qtd > 0)};
}
function registra(tipo, papel, qtd, px, origem) {
  const c = cart(); qtd = Math.floor(qtd);
  if (qtd <= 0) return alerta('Quantidade inválida.');
  const {caixa, lista} = posicoes(c);
  if (tipo === 'C' && qtd * px.preco > caixa + 0.01) return alerta('Saldo insuficiente na carteira simulada.');
  if (tipo === 'V') { const q = lista.find(x => x.papel === papel); if (!q || q.qtd < qtd) return alerta('Você não tem essa quantidade de ' + papel + '.'); }
  c.ops.push({id: Date.now() + Math.random(), quando: new Date().toISOString(), tipo, papel, qtd, preco: px.preco, ref: px.fonte + ' ' + (px.quando || ''), origem: origem || 'manual'});
  salva(c); return true;
}

/* ---------------- interface comum ---------------- */
function alerta(msg) { const d = $('#dlg'); $('#dlg-c').innerHTML = `<p>${msg}</p><button class="btn" id="dlg-ok">OK</button>`; $('#dlg-ok').onclick = () => d.close(); d.showModal(); return false; }
function limpaGraficos() { observadores.forEach(o => o.disconnect()); observadores = []; graficos.forEach(g => { try { g.remove(); } catch (e) {} }); graficos = []; }
function grafico(el, alt, log) {
  const g = LightweightCharts.createChart(el, {height: alt || el.clientHeight || 240, layout: {background: {color: 'transparent'}, textColor: css('--tinta2'), fontFamily: 'IBM Plex Sans'},
    grid: {vertLines: {visible: false}, horzLines: {color: css('--linha')}}, rightPriceScale: {borderVisible: false, mode: log ? 1 : 0}, timeScale: {borderVisible: false},
    crosshair: {mode: 0}, localization: {locale: 'pt-BR', priceFormatter: p => p.toLocaleString('pt-BR', {maximumFractionDigits: 2})}});
  const ob = new ResizeObserver(() => { try { g.applyOptions({width: el.clientWidth}); } catch (e) {} }); ob.observe(el); observadores.push(ob);
  graficos.push(g); return g;
}
const serieLinha = (d, v) => d.map((t, i) => ({time: t, value: v[i]})).filter(x => x.value != null);
const DENTRO_DE_MAIS = ['desempenho', 'ajustes', 'estudo'];
function abre(t) { aba = t; document.querySelectorAll('#nav button').forEach(b => b.setAttribute('aria-current', b.dataset.t === (DENTRO_DE_MAIS.includes(t) ? 'mais' : t))); limpaGraficos(); window.scrollTo(0, 0); TELAS[t](); try { localStorage.setItem('radarb3.aba', t); } catch (e) {} }

/* ---------------- RADAR ---------------- */
function telaRadar() {
  const R = D.radar, o = R.ordens, dt = R.detalhes;
  const card = (t, cls, rot, extra) => { const d = dt[t] || {}; return `<div class="ordem ${cls}"><div><div class="tag">${rot}</div><div class="tk">${t}</div><div class="nm">${d.nome || ''}</div></div>
    <div class="dir">${brl(d.fechamento)}<br><span class="muted">stop ${brl(d.stop)}</span>${extra || ''}</div></div>`; };
  const nada = !o.vender.length && !o.comprar.length;
  $('#tela').innerHTML = `
  <section class="cartao"><h2>Ordens para o próximo pregão</h2>
    <p class="muted">Calculadas com o fechamento de ${dataBR(R.ultimo_pregao)}. Executar na abertura.</p>
    ${o.vender.map(t => card(t, 'c-v', 'Vender')).join('')}
    ${o.comprar.map(t => card(t, 'c-c', 'Comprar', `<br><span class="muted">≈ ${brl(R.capital_referencia / R.vagas)}</span>`)).join('')}
    ${o.manter.map(t => card(t, 'c-m', 'Manter')).join('')}
    ${nada ? '<p class="muted">Nenhuma compra ou venda nova. Mantenha as posições.</p>' : ''}
    ${posicoes(cart()).lista.length === 0 && cart().ops.length === 0 ? '<button class="btn" id="copia">Começar a simulação copiando a carteira do método</button>' : (nada ? '' : '<button class="btn" id="executa">Executar na minha carteira simulada</button>')}
    <button class="btn sec" id="porque">Por que essas ações?</button>
  </section>
  <section class="cartao"><h2>Carteira do método</h2>
    <p class="muted">Até ${R.vagas} ações ao mesmo tempo, as mais fortes entre as que têm sinal de compra. Caixa no CDI.</p>
    <table><tr><th>Papel</th><th>Desde</th><th>Resultado</th><th>Stop</th></tr>
    ${R.posicoes_metodo.map(p => `<tr><td><b>${p.papel}</b></td><td>${dataBR(p.desde)}</td><td class="${p.resultado >= 0 ? 'pos' : 'neg'}">${pct(p.resultado)}</td><td>${brl(p.stop)}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Sem posições: 100% no CDI.</td></tr>'}
    </table>
  </section>
  <section class="cartao"><h2>R$ ${R.capital_referencia.toLocaleString('pt-BR')} seguindo o método desde 2006</h2>
    <div class="seg" id="per"><button data-a="1" aria-pressed="false">1 ano</button><button data-a="5" aria-pressed="false">5 anos</button><button data-a="99" aria-pressed="true">Tudo</button></div>
    <div class="legenda"><span><i style="background:${css('--linha-m')}"></i>Método</span><span><i style="background:${css('--linha-i')}"></i>IBOV</span><span><i style="background:${css('--linha-c')}"></i>CDI</span></div>
    <div class="graf" id="g-curva"></div>
    <p class="muted">Simulação histórica (backtest). Resultado passado não garante resultado futuro.</p>
  </section>`;
  const desenha = anos => {
    limpaGraficos(); const C = R.curva; let i0 = 0;
    if (anos < 99) { const lim = new Date(); lim.setFullYear(lim.getFullYear() - anos); i0 = C.datas.findIndex(d => new Date(d) >= lim); }
    const g = grafico($('#g-curva'), 240, true), base = k => C[k][i0];
    [['metodo', '--linha-m'], ['ibov', '--linha-i'], ['cdi', '--linha-c']].forEach(([k, cor]) => {
      if (!C[k]) return; const s = g.addLineSeries({color: css(cor), lineWidth: k === 'metodo' ? 3 : 2, priceLineVisible: false, lastValueVisible: false});
      s.setData(serieLinha(C.datas.slice(i0), C[k].slice(i0).map(v => v / base(k) * R.capital_referencia)));
    });
    g.timeScale().fitContent();
  };
  desenha(99);
  document.querySelectorAll('#per button').forEach(b => b.onclick = () => { document.querySelectorAll('#per button').forEach(x => x.setAttribute('aria-pressed', x === b)); desenha(+b.dataset.a); });
  $('#porque').onclick = () => {
    const tks = [...o.vender, ...o.comprar, ...o.manter];
    $('#dlg-c').innerHTML = `<h2>Configurações que deram o sinal</h2>${tks.map(t => `<div><b>${t}</b><div class="muted">${(dt[t].membros || []).join('<br>')}</div></div>`).join('')}
      <p class="muted">Toda semana o método escolhe, para cada ação, as 3 configurações (estudo + parâmetros + stop) de melhor desempenho nos últimos 5 anos e segue a maioria.</p><button class="btn" id="dlg-ok">Fechar</button>`;
    $('#dlg-ok').onclick = () => $('#dlg').close(); $('#dlg').showModal();
  };
  if ($('#executa')) $('#executa').onclick = () => executaOrdens();
  if ($('#copia')) $('#copia').onclick = () => copiaMetodo();
}
function copiaMetodo() {
  // compra, em partes iguais, as ações que o método terá no próximo pregão (manter + comprar)
  const R = D.radar, alvo = [...R.ordens.manter, ...R.ordens.comprar].slice(0, R.vagas); const feitas = [];
  const fatia = posicoes(cart()).caixa / R.vagas;
  for (const t of alvo) { const px = preco(t); if (!px) continue; const q = Math.floor(fatia / px.preco); if (q > 0 && registra('C', t, q, px, 'cópia do método')) feitas.push(`Comprou ${q} ${t} a ${brl(px.preco)}`); }
  alerta(feitas.length ? 'Simulação iniciada:<br>' + feitas.join('<br>') + '<br><br>A partir de agora, siga as ordens diárias com o botão "Executar".' : 'Nada a copiar.');
}
function executaOrdens() {
  const R = D.radar, c = cart(); let feitas = [];
  for (const t of R.ordens.vender) { const q = posicoes(cart()).lista.find(x => x.papel === t); if (q) { const px = preco(t); if (registra('V', t, q.qtd, px, 'radar')) feitas.push(`Vendeu ${q.qtd} ${t} a ${brl(px.preco)}`); } }
  const {caixa, lista} = posicoes(cart()); const livres = Math.max(1, R.vagas - lista.length);
  const fatia = caixa / Math.max(livres, R.ordens.comprar.length);
  for (const t of R.ordens.comprar) { const px = preco(t); if (!px) continue; const q = Math.floor(fatia / px.preco); if (q > 0 && registra('C', t, q, px, 'radar')) feitas.push(`Comprou ${q} ${t} a ${brl(px.preco)}`); }
  alerta(feitas.length ? 'Registrado na carteira simulada:<br>' + feitas.join('<br>') : 'Nada a executar (sem posições para vender ou sem saldo).');
}

/* ---------------- CARTEIRA SIMULADA ---------------- */
function telaCarteira() {
  const c = cart(), {caixa, lista} = posicoes(c);
  let total = caixa; const linhas = lista.map(p => { const px = preco(p.papel); const v = p.qtd * (px ? px.preco : 0); total += v;
    return `<div class="item" data-tk="${p.papel}"><span class="tk">${p.papel}</span><span class="nm">${p.qtd} ações · médio ${brl(p.custo / p.qtd)}</span><span class="pr">${brl(v)}<br><span class="${(px.preco * p.qtd - p.custo) >= 0 ? 'pos' : 'neg'}">${pct(px.preco * p.qtd / p.custo - 1)}</span></span></div>`; });
  $('#tela').innerHTML = `
  <section class="cartao"><h2>Minha carteira simulada</h2>
    <div class="kpis"><div class="kpi"><div class="r">Patrimônio</div><div class="v">${brl(total)}</div></div>
    <div class="kpi"><div class="r">Resultado</div><div class="v ${total >= c.capital ? 'pos' : 'neg'}">${pct(total / c.capital - 1)}</div></div>
    <div class="kpi"><div class="r">Em caixa</div><div class="v">${brl(caixa)}</div></div><div class="kpi"><div class="r">Desde</div><div class="v" style="font-size:15px">${dataBR(c.inicio)}</div></div></div>
    <div class="lin"><button class="btn c" id="b-comprar">Comprar</button><button class="btn v" id="b-vender">Vender</button></div>
  </section>
  <section class="cartao"><h3>Posições</h3><div class="lista">${linhas.join('') || '<div class="vazio">Nenhuma posição. Use Comprar ou o botão do Radar.</div>'}</div></section>
  <section class="cartao"><h3>Histórico de operações</h3>
    <table><tr><th>Data</th><th>Op.</th><th>Papel</th><th>Qtd</th><th>Preço</th></tr>
    ${c.ops.slice().reverse().map(o => `<tr><td>${horaBR(o.quando)}</td><td class="${o.tipo === 'C' ? 'pos' : 'neg'}">${o.tipo === 'C' ? 'Compra' : 'Venda'}</td><td>${o.papel}</td><td>${o.qtd}</td><td>${brl(o.preco)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhuma operação ainda.</td></tr>'}</table>
    <p class="muted">Preço usado: última cotação disponível (atraso de cerca de 15 minutos) ou o último fechamento.</p>
  </section>`;
  $('#b-comprar').onclick = () => dlgOrdem('C'); $('#b-vender').onclick = () => dlgOrdem('V');
  document.querySelectorAll('.item[data-tk]').forEach(e => e.onclick = () => dlgOrdem('V', e.dataset.tk));
}
function dlgOrdem(tipo, tk) {
  const {caixa, lista} = posicoes(cart());
  const opcoes = tipo === 'C' ? D.universo.filter(u => u.papel !== '^BVSP') : lista.map(p => ({papel: p.papel, nome: p.qtd + ' ações'}));
  if (!opcoes.length) return alerta('Você não tem posições para vender.');
  $('#dlg-c').innerHTML = `<h2>${tipo === 'C' ? 'Comprar (simulado)' : 'Vender (simulado)'}</h2>
    <label>Papel<select id="o-tk">${opcoes.map(u => `<option value="${u.papel}" ${u.papel === tk ? 'selected' : ''}>${u.papel} — ${u.nome || ''}</option>`).join('')}</select></label>
    <div id="o-px" class="muted"></div>
    <label>Quantidade<input id="o-q" type="number" inputmode="numeric" min="1" step="1"></label>
    <div id="o-tot" class="muted"></div>
    <div class="lin"><button class="btn sec" id="o-x">Cancelar</button><button class="btn ${tipo === 'C' ? 'c' : 'v'}" id="o-ok">Confirmar</button></div>`;
  const atual = () => { const t = $('#o-tk').value, px = preco(t); $('#o-px').innerHTML = px ? `Preço: <b>${brl(px.preco)}</b> (${px.fonte} ${px.fonte === 'cotação' ? horaBR(px.quando) : dataBR(px.quando)})` : 'Sem preço';
    if (!$('#o-q').value || $('#o-q').dataset.auto) { const q = tipo === 'C' ? Math.floor(Math.min(caixa, D.radar.capital_referencia / D.radar.vagas) / px.preco) : (lista.find(p => p.papel === t) || {}).qtd; $('#o-q').value = q || 1; $('#o-q').dataset.auto = 1; }
    $('#o-tot').textContent = 'Total: ' + brl(px.preco * (+$('#o-q').value || 0)) + (tipo === 'C' ? ' · saldo ' + brl(caixa) : ''); };
  $('#o-tk').onchange = () => { $('#o-q').dataset.auto = 1; $('#o-q').value = ''; atual(); };
  $('#o-q').oninput = () => { delete $('#o-q').dataset.auto; atual(); };
  atual();
  $('#o-x').onclick = () => $('#dlg').close();
  $('#o-ok').onclick = () => { const t = $('#o-tk').value; if (registra(tipo, t, +$('#o-q').value, preco(t))) { $('#dlg').close(); abre('carteira'); } };
  $('#dlg').showModal();
}

/* ---------------- MERCADO ---------------- */
function telaMercado(filtro = '') {
  const f = filtro.toUpperCase();
  const lst = D.universo.filter(u => !f || u.papel.includes(f) || (u.nome || '').toUpperCase().includes(f));
  $('#tela').innerHTML = `<section class="cartao"><input id="busca" placeholder="Buscar ação (ex.: PETR4, Vale)" value="${filtro}">
    <div class="lista">${lst.map(u => { const px = preco(u.papel), v = variacao(u.papel); const sinal = D.radar.ordens.comprar.includes(u.papel) ? '🟢' : D.radar.ordens.vender.includes(u.papel) ? '🔴' : D.radar.ordens.manter.includes(u.papel) ? '🔵' : '';
      return `<div class="item" data-tk="${u.papel}"><span class="tk">${nomeTk(u.papel)} ${sinal}</span><span class="nm">${u.nome}</span><span class="pr">${brl(px && px.preco)}<br><span class="${v >= 0 ? 'pos' : 'neg'}">${pct(v, 2)}</span></span></div>`; }).join('')}</div>
    <p class="muted">${D.cot ? 'Cotações de ' + horaBR(D.cot.atualizado) + ' (atraso ~15 min).' : 'Mostrando o último fechamento.'} 🟢 compra · 🔴 venda · 🔵 mantido pelo método.</p></section>`;
  const b = $('#busca'); b.oninput = () => { const pos = b.selectionStart; telaMercado(b.value); const n = $('#busca'); n.focus(); n.setSelectionRange(pos, pos); };
  document.querySelectorAll('.item[data-tk]').forEach(e => e.onclick = () => telaPapel(e.dataset.tk));
}
function hiloIfr(H) {
  const n = 8, hi = [], ifr = []; let st = 1, ag = 0, ap = 0;
  for (let i = 0; i < H.c.length; i++) {
    if (i >= n) { let sh = 0, sl = 0; for (let k = i - n; k < i; k++) { sh += H.h[k]; sl += H.l[k]; } sh /= n; sl /= n;
      if (H.c[i] > sh) st = 1; else if (H.c[i] < sl) st = -1; hi.push({time: H.d[i], value: st === 1 ? sl : sh, color: st === 1 ? css('--compra') : css('--venda')}); }
    if (i > 0) { const d = H.c[i] - H.c[i - 1], g = Math.max(d, 0), p = Math.max(-d, 0);
      if (i <= 14) { ag += g / 14; ap += p / 14; } else { ag = (ag * 13 + g) / 14; ap = (ap * 13 + p) / 14; }
      if (i >= 14) ifr.push({time: H.d[i], value: ap === 0 ? 100 : 100 - 100 / (1 + ag / ap)}); }
  }
  return {hi, ifr};
}
async function telaPapel(tk) {
  limpaGraficos();
  $('#tela').innerHTML = '<div class="vazio">carregando…</div>';
  const H = await hist(tk), px = preco(tk), dt = D.radar.detalhes[tk];
  const st = D.radar.ordens.comprar.includes(tk) ? ['c-c', 'Sinal de COMPRA'] : D.radar.ordens.vender.includes(tk) ? ['c-v', 'Sinal de VENDA'] : D.radar.ordens.manter.includes(tk) ? ['c-m', 'Na carteira do método'] : null;
  $('#tela').innerHTML = `<section class="cartao"><button class="btn sec" id="volta">← Mercado</button>
    <h2>${nomeTk(tk)} · ${H.nome}</h2><div class="kpis"><div class="kpi"><div class="r">Preço</div><div class="v">${brl(px && px.preco)}</div></div><div class="kpi"><div class="r">Dia</div><div class="v ${variacao(tk) >= 0 ? 'pos' : 'neg'}">${pct(variacao(tk), 2)}</div></div></div>
    ${st ? `<div class="ordem ${st[0]}"><div><div class="tag">${st[1]}</div><div class="nm">${(dt && dt.membros || []).join(' · ')}</div></div></div>` : ''}
    <div class="seg" id="per"><button data-m="3">3 meses</button><button data-m="12" aria-pressed="true">1 ano</button><button data-m="36">3 anos</button></div>
    <div class="legenda"><span><i style="background:${css('--compra')}"></i>HiLo de alta</span><span><i style="background:${css('--venda')}"></i>HiLo de baixa</span></div>
    <div class="graf" id="g-p"></div><h3>IFR (14)</h3><div class="graf p" id="g-i"></div>
    ${tk !== '^BVSP' ? '<div class="lin"><button class="btn c" id="pc">Comprar</button><button class="btn v" id="pv">Vender</button></div>' : ''}</section>`;
  $('#volta').onclick = () => abre('mercado');
  const desenha = m => {
    limpaGraficos(); const i0 = Math.max(0, H.d.length - Math.round(m * 21));
    const g = grafico($('#g-p')), cs = g.addCandlestickSeries({upColor: css('--compra'), downColor: css('--venda'), borderVisible: false, wickUpColor: css('--compra'), wickDownColor: css('--venda')});
    cs.setData(H.d.slice(i0).map((t, k) => ({time: t, open: H.o[i0 + k], high: H.h[i0 + k], low: H.l[i0 + k], close: H.c[i0 + k]})));
    const {hi, ifr} = hiloIfr(H); const lh = g.addLineSeries({lineWidth: 2, priceLineVisible: false, lastValueVisible: false, lineType: 1}); lh.setData(hi.filter(x => x.time >= H.d[i0]));
    g.timeScale().fitContent();
    const gi = grafico($('#g-i')), si = gi.addLineSeries({color: css('--acento'), lineWidth: 2, priceLineVisible: false}); si.setData(ifr.filter(x => x.time >= H.d[i0]));
    [30, 70].forEach(v => si.createPriceLine({price: v, color: css('--apag'), lineWidth: 1, lineStyle: 2, axisLabelVisible: true})); gi.timeScale().fitContent();
  };
  desenha(12);
  document.querySelectorAll('#per button').forEach(b => b.onclick = () => { document.querySelectorAll('#per button').forEach(x => x.setAttribute('aria-pressed', x === b)); desenha(+b.dataset.m); });
  if ($('#pc')) { $('#pc').onclick = () => dlgOrdem('C', tk); $('#pv').onclick = () => dlgOrdem('V', tk); }
}

/* ---------------- DESEMPENHO ---------------- */
async function telaDesempenho() {
  const c = cart();
  $('#tela').innerHTML = `<section class="cartao"><h2>Minha simulação × método × IBOV</h2>
    <p class="muted">Desde o início da sua carteira simulada (${dataBR(c.inicio)}), com o mesmo capital inicial.</p>
    <div class="legenda"><span><i style="background:${css('--acento')}"></i>Minha carteira</span><span><i style="background:${css('--linha-m')}"></i>Método</span><span><i style="background:${css('--linha-i')}"></i>IBOV</span></div>
    <div class="graf" id="g-d"></div><div class="kpis" id="k-d"></div>
    <p class="muted">Este é o teste ao vivo: se, ao longo de semanas, o método e a sua simulação se comportarem como no histórico, ganha-se confiança para usar dinheiro real.</p></section>`;
  const ini = c.inicio.slice(0, 10), C = D.radar.curva;
  const papeis = [...new Set(c.ops.map(o => o.papel))]; const hs = {}; for (const p of papeis) hs[p] = await hist(p);
  const ib = await hist('^BVSP'); const dias = ib.d.filter(d => d >= ini);
  if (dias.length < 2) { $('#k-d').innerHTML = '<div class="vazio" style="grid-column:1/-1">Ainda não há pregões fechados desde o início da simulação. Volte amanhã.</div>'; return; }
  const minha = dias.map(d => { let caixa = c.capital; const q = {}; for (const o of c.ops) { if (o.quando.slice(0, 10) > d) continue; q[o.papel] = (q[o.papel] || 0) + (o.tipo === 'C' ? o.qtd : -o.qtd); caixa += (o.tipo === 'C' ? -1 : 1) * o.qtd * o.preco; }
    let v = caixa; for (const p in q) { const H = hs[p], k = H.d.lastIndexOf(H.d.filter(x => x <= d).pop()); v += q[p] * (k >= 0 ? H.c[k] : 0); } return v; });
  const ibv = dias.map(d => ib.c[ib.d.indexOf(d)]); const ib0 = ibv[0];
  const k0 = C.datas.findIndex(d => d >= ini); const met = k0 >= 0 ? C.datas.slice(k0).map((d, i) => ({time: d, value: C.metodo[k0 + i] / C.metodo[k0] * c.capital})) : [];
  const g = grafico($('#g-d'), 240, true);
  g.addLineSeries({color: css('--acento'), lineWidth: 3, priceLineVisible: false}).setData(dias.map((d, i) => ({time: d, value: minha[i]})));
  if (met.length) g.addLineSeries({color: css('--linha-m'), lineWidth: 2, priceLineVisible: false}).setData(met);
  g.addLineSeries({color: css('--linha-i'), lineWidth: 2, priceLineVisible: false}).setData(dias.map((d, i) => ({time: d, value: ibv[i] / ib0 * c.capital})));
  g.timeScale().fitContent();
  $('#k-d').innerHTML = `<div class="kpi"><div class="r">Minha carteira</div><div class="v">${pct(minha.at(-1) / c.capital - 1)}</div></div>
    <div class="kpi"><div class="r">IBOV no período</div><div class="v">${pct(ibv.at(-1) / ib0 - 1)}</div></div>
    <div class="kpi"><div class="r">Método no período</div><div class="v">${met.length ? pct(met.at(-1).value / c.capital - 1) : '–'}</div></div>`;
}

/* ---------------- AJUSTES ---------------- */
function telaAjustes() {
  const c = cart();
  $('#tela').innerHTML = `
  <section class="cartao"><h2>Notificações no celular</h2>
    <p>Os alertas de compra e venda chegam pelo app gratuito <b>ntfy</b> (Play Store), todo dia útil por volta das 19h.</p>
    <ol class="muted"><li>Instale o <b>ntfy</b> na Play Store.</li><li>Toque em <b>+</b> e assine o tópico combinado.</li><li>Ao tocar na notificação, abra este app.</li></ol></section>
  <section class="cartao"><h2>Carteira simulada</h2>
    <label>Capital inicial (R$)<input id="a-cap" type="number" inputmode="decimal" value="${c.capital}"></label>
    <button class="btn sec" id="a-salva">Salvar capital</button>
    <button class="btn sec" id="a-exp">Copiar backup da carteira</button>
    <button class="btn sec" id="a-imp">Restaurar backup</button>
    <button class="btn v" id="a-zera">Recomeçar do zero</button>
    <p class="muted">A carteira simulada fica guardada só neste celular. Faça backup de vez em quando (copie e guarde, por exemplo, no seu e-mail).</p></section>
  <section class="cartao"><h2>Instalar como aplicativo</h2>
    <p class="muted">No Chrome do Android: menu ⋮ → <b>Instalar app</b> (ou "Adicionar à tela inicial"). O Radar B3 vira um ícone como qualquer aplicativo.</p></section>
  <section class="cartao"><h2>Sobre</h2><p class="muted">Método dinâmico de indicadores técnicos (IFR, HiLo, Super Contagem e outros) recalculado todo dia útil. Simulação educacional: não é recomendação de investimento. A decisão e o risco são seus.</p>
    <p class="muted">Dados de ${dataBR(D.radar.ultimo_pregao)} · gerado em ${horaBR(D.radar.atualizado)}</p></section>`;
  $('#a-salva').onclick = () => { const x = cart(); x.capital = +$('#a-cap').value || 5000; salva(x); alerta('Capital atualizado.'); };
  $('#a-exp').onclick = async () => { const t = JSON.stringify(cart()); try { await navigator.clipboard.writeText(t); alerta('Backup copiado. Cole num e-mail para você mesmo.'); } catch (e) { alerta('<textarea style="width:100%;height:120px">' + t + '</textarea>'); } };
  $('#a-imp').onclick = () => { $('#dlg-c').innerHTML = '<h2>Restaurar backup</h2><textarea id="a-txt" style="width:100%;height:140px" placeholder="Cole aqui o backup"></textarea><div class="lin"><button class="btn sec" id="a-x">Cancelar</button><button class="btn" id="a-ok">Restaurar</button></div>';
    $('#a-x').onclick = () => $('#dlg').close(); $('#a-ok').onclick = () => { try { const x = JSON.parse($('#a-txt').value); if (!x.ops) throw 0; salva(x); $('#dlg').close(); abre('carteira'); } catch (e) { alerta('Backup inválido.'); } }; $('#dlg').showModal(); };
  $('#a-zera').onclick = () => { $('#dlg-c').innerHTML = '<h2>Recomeçar do zero?</h2><p>Todas as operações simuladas serão apagadas.</p><div class="lin"><button class="btn sec" id="a-x">Cancelar</button><button class="btn v" id="a-ok">Apagar</button></div>';
    $('#a-x').onclick = () => $('#dlg').close(); $('#a-ok').onclick = () => { salva({capital: cart().capital, inicio: new Date().toISOString(), ops: []}); $('#dlg').close(); abre('carteira'); }; $('#dlg').showModal(); };
}

function telaMais() {
  $('#tela').innerHTML = `<section class="cartao"><h2>Mais</h2><div class="lista">
    <div class="item" data-t="estudo"><span class="tk" style="min-width:130px">Estudo completo</span><span class="nm" style="white-space:normal">Dashboard do estudo: 972 carteiras, ranking no tempo, método dinâmico papel a papel</span></div>
    <div class="item" data-t="desempenho"><span class="tk" style="min-width:130px">Desempenho</span><span class="nm" style="white-space:normal">Minha carteira simulada × método × IBOV</span></div>
    <div class="item" data-t="ajustes"><span class="tk" style="min-width:130px">Ajustes</span><span class="nm" style="white-space:normal">Notificações, capital, backup da carteira</span></div></div></section>`;
  document.querySelectorAll('.item[data-t]').forEach(e => e.onclick = () => abre(e.dataset.t));
}
function telaEstudo() {
  $('#tela').innerHTML = `<section class="cartao" style="padding:8px"><button class="btn sec" id="volta">← Mais</button>
    <iframe src="estudo/index.html" title="Estudo completo" style="width:100%;height:calc(100vh - 230px);min-height:420px;border:0;border-radius:8px"></iframe></section>`;
  $('#volta').onclick = () => abre('mais');
}
const TELAS = {radar: telaRadar, carteira: telaCarteira, mercado: () => telaMercado(), lab: () => telaLab(), mais: telaMais, estudo: telaEstudo, desempenho: telaDesempenho, ajustes: telaAjustes};
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => abre(b.dataset.t));

(async () => {
  try {
    [D.radar, D.universo] = await Promise.all([busca('radar.json'), busca('universo.json')]);
    try { D.cot = await busca('cotacoes.json'); } catch (e) { D.cot = null; }
    $('#sub').innerHTML = `pregão de ${dataBR(D.radar.ultimo_pregao)}`;
    let a = 'radar'; try { a = localStorage.getItem('radarb3.aba') || 'radar'; } catch (e) {}
    const h = location.hash.slice(1); abre(TELAS[h] ? h : (TELAS[a] ? a : 'radar'));
  } catch (e) { $('#tela').innerHTML = `<div class="vazio">Não foi possível carregar os dados (${e.message}). Verifique a internet.</div>`; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
