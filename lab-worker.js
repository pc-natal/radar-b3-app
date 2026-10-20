/* Processador do laboratório: simula as 6.968 configurações (estudo + parâmetros + stop) de um papel
   e guarda os acumulados no fim de cada mês, para o ranking de qualquer período sair na hora. */
importScripts('motor.js');
let S = null;

onmessage = e => {
  const m = e.data;
  if (m.tipo === 'indexar') {
    const {d, o, h, l, c, cdiM} = m, n = c.length;
    const O = Float64Array.from(o), H = Float64Array.from(h), L = Float64Array.from(l), C = Float64Array.from(c);
    const cdi = Motor.cdiDiario(d, cdiM), {ESTUDOS, STOPS} = Motor.GR;
    const mes = [], idxFim = [];
    for (let i = 0; i < n; i++) { const mm = d[i].slice(0, 7); if (!mes.length || mes[mes.length - 1] !== mm) { mes.push(mm); idxFim.push(i); } else idxFim[idxFim.length - 1] = i; }
    const G = mes.length, K = ESTUDOS.length * STOPS.length;
    const cr = new Float32Array(K * G), cf = new Float32Array(K * G), ce = new Uint16Array(K * G), ch = new Uint16Array(K * G);
    const stops = STOPS.map(s => Motor.sinalStop(s[0], s[1], O, H, L, C));
    const logc = new Float64Array(n); for (let t = 0; t < n; t++) logc[t] = Math.log1p(cdi[t]);
    let k = 0;
    for (let i = 0; i < ESTUDOS.length; i++) {
      const sig = Motor.sinalEstudo(ESTUDOS[i][1], ESTUDOS[i][2], O, H, L, C);
      for (let j = 0; j < STOPS.length; j++) {
        const [g, v, us] = stops[j], r = Motor.simula(O, H, L, C, sig, g, v, us, Motor.CUSTO);
        let sr = 0, sf = 0, se = 0, sh = 0, gi = 0;
        for (let t = 0; t < n; t++) {
          sr += r.ret[t]; se += r.ent[t]; sh += r.hc[t];
          if (t >= 1 && r.hc[t - 1] === 0) sf += logc[t];
          if (t === idxFim[gi]) { const p = k * G + gi; cr[p] = sr; cf[p] = sf; ce[p] = se; ch[p] = sh; gi++; }
        }
        k++;
      }
      postMessage({tipo: 'prog', f: (i + 1) / ESTUDOS.length});
    }
    S = {mes, idxFim, G, K, cr, cf, ce, ch};
    postMessage({tipo: 'indexado', tk: m.tk, mes, idxFim});
  } else if (m.tipo === 'ranking') {
    const {m0, m1, cdi} = m, {G, K, cr, cf, ce, ch, idxFim} = S;
    const ret = new Float32Array(K), ops = new Int32Array(K), tempo = new Float32Array(K);
    const dias = idxFim[m1] - (m0 > 0 ? idxFim[m0 - 1] : -1);
    for (let k = 0; k < K; k++) {
      const p1 = k * G + m1, p0 = k * G + m0 - 1;
      let lr = cr[p1] - (m0 > 0 ? cr[p0] : 0);
      if (cdi) lr += cf[p1] - (m0 > 0 ? cf[p0] : 0);
      ret[k] = Math.expm1(lr);
      ops[k] = ce[p1] - (m0 > 0 ? ce[p0] : 0);
      tempo[k] = (ch[p1] - (m0 > 0 ? ch[p0] : 0)) / dias;
    }
    postMessage({tipo: 'ranking', ret, ops, tempo, dias}, [ret.buffer, ops.buffer, tempo.buffer]);
  }
};
