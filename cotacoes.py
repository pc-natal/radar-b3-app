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
    except Exception:
        pass
json.dump(dict(atualizado=dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).isoformat(timespec='minutes'), precos=out),
          open('data/cotacoes.json', 'w', encoding='utf8'), separators=(',', ':'))
print(len(out), 'cotações')
