"""Cotações recentes (atraso ~15 min do Yahoo) dos papéis do app -> data/cotacoes.json."""
import json, datetime as dt
import yfinance as yf

uni = json.load(open('data/universo.json', encoding='utf8'))
tks = [u['papel'] for u in uni]
sym = [t if t.startswith('^') else t + '.SA' for t in tks]
d = yf.download(sym, period='5d', interval='15m', progress=False, auto_adjust=False, group_by='ticker')
dd = yf.download(sym, period='10d', interval='1d', progress=False, auto_adjust=False, group_by='ticker')
out = {}
hoje = dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).date()
for t, s in zip(tks, sym):
    try:
        c = d[s]['Close'].dropna(); diario = dd[s]['Close'].dropna()
        ult = float(c.iloc[-1]); quando = c.index[-1]
        ant = diario[diario.index.date < quando.date()]
        out[t] = dict(preco=round(ult, 2), var=round(ult / float(ant.iloc[-1]) - 1, 4) if len(ant) else None, hora=str(quando))
        op = dd[s]['Open'].dropna(); op = op[op.index.date == quando.date()]
        if len(op) and float(op.iloc[-1]) > 0:
            out[t]['abertura'] = round(float(op.iloc[-1]), 2); out[t]['dia'] = str(quando.date())
    except Exception:
        pass
json.dump(dict(atualizado=dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).isoformat(timespec='minutes'), precos=out),
          open('data/cotacoes.json', 'w', encoding='utf8'), separators=(',', ':'))
print(len(out), 'cotações')


# ---------------------------------------------------------------- alerta de stop tocado (uma vez por dia por papel)
def alerta_stops():
    import os, requests
    topico = os.environ.get('NTFY_TOPIC')
    try:
        radar = json.load(open('data/radar.json', encoding='utf8'))
    except Exception:
        return
    arq = 'data/alertas.json'
    try:
        estado = json.load(open(arq, encoding='utf8'))
    except Exception:
        estado = {}
    hoje = dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).date().isoformat()
    ja = estado.get(hoje, []); vendendo = set(radar.get('ordens', {}).get('vender', []))
    for p in radar.get('posicoes_metodo', []):
        t, stop, px = p['papel'], p.get('stop'), out.get(p['papel'], {}).get('preco')
        if not stop or not px or t in ja or t in vendendo:
            continue
        if px <= stop:
            msg = f'{t} tocou o stop de proteção: preço R$ {px:.2f}, stop R$ {stop:.2f} (cotação com atraso de ~15 min). Confira antes de agir.'
            if topico:
                requests.post('https://ntfy.sh/', json=dict(topic=topico, title=f'Radar B3: {t} tocou o stop', message=msg, tags=['warning'], priority=5,
                                                            click='https://pc-natal.github.io/radar-b3-app/'), timeout=30)
            print('ALERTA', msg); ja.append(t)
    json.dump({hoje: ja}, open(arq, 'w', encoding='utf8'))


alerta_stops()
