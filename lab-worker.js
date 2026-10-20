/* Processador do laboratório (roda em segundo plano para não travar o celular).
   - indexar: simula as 6.968 configurações de um papel e guarda os acumulados (mensais para o ranking e de 5 em 5 pregões para o método dinâmico);
   - ranking: resultado de todas as configurações num intervalo de meses (instantâneo depois de indexar);
   - dinamico: método dinâmico com a janela, o critério e o comitê escolhidos. */
importScripts('motor.js', 'dinamico.js');
let S = null, CTX = null;

onmessage = e => {
  const m = e.data;
  if (m.tipo === 'indexar') {
    const {d, o, h, l, c, cdiM} = m;
    const O = Float64Array.from(o), H = Float64Array.from(h), L = Float64Array.from(l), C = Float64Array.from(c), cdi = Motor.cdiDiario(d, cdiM);
    const r = Dinamico.indexa(d, O, H, L, C, cdi, f => postMessage({tipo: 'prog', f}));
    S = r.mensal; CTX = {d, O, H, L, C, cdi, din: r.din};
    postMessage({tipo: 'indexado', tk: m.tk, mes: S.mes, idxFim: S.idxFim, dinOk: r.din.habilita, t0: Dinamico.T0});
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
  } else if (m.tipo === 'dinamico') {
    try {
      const r = Dinamico.executa(CTX, m.par);
      postMessage({tipo: 'dinamico', eq: r.eq, hold: r.hold, ent: r.ent, sai: r.sai, esc: r.esc, atual: r.atual, t0: r.t0, nRe: r.nRe},
        [r.eq.buffer, r.hold.buffer, r.ent.buffer, r.sai.buffer, r.esc.buffer]);
    } catch (err) { postMessage({tipo: 'dinamico', erro: err.message}); }
  }
};
