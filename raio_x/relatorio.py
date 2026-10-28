"""Monta o HTML do Raio-X (A4) a partir do JSON de raio_x.py. O PDF sai de pdf.js.

Uso: python3 raio_x/relatorio.py raio_x/saida/mg_2222.json [--exemplo]
"""
import json
import math
import sys
from datetime import date
from html import escape
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
AMBAR = ["#f6e7cc", "#efcf97", "#e2ac5c", "#c98a2e", "#8f5d17"]  # rampa sequencial na cor da marca
LIMITES = [10, 20, 30, 40]  # faixas do mapa (% dos votos no município); recalculadas por candidato em faixas_para()
PASSOS = [0.5, 1, 2, 2.5, 5, 10, 20, 25]
MAX_ZONAS = 20  # capitais grandes (São Paulo tem 57 zonas) mostram só as maiores
UF_NOME = {"MG": "Minas Gerais", "SP": "São Paulo", "RJ": "Rio de Janeiro", "BA": "Bahia", "RS": "Rio Grande do Sul",
           "PR": "Paraná", "PE": "Pernambuco", "CE": "Ceará", "PA": "Pará", "SC": "Santa Catarina", "GO": "Goiás",
           "MA": "Maranhão", "AM": "Amazonas", "ES": "Espírito Santo", "PB": "Paraíba", "RN": "Rio Grande do Norte",
           "MT": "Mato Grosso", "AL": "Alagoas", "PI": "Piauí", "DF": "Distrito Federal", "MS": "Mato Grosso do Sul",
           "SE": "Sergipe", "RO": "Rondônia", "TO": "Tocantins", "AC": "Acre", "AP": "Amapá", "RR": "Roraima"}


def num(n):
    return f"{int(round(n)):,}".replace(",", ".")


def pct(p, casas=1):
    return f"{p:.{casas}f}".replace(".", ",") + "%"


def cor(p):
    return AMBAR[next((i for i, l in enumerate(LIMITES) if p < l), len(LIMITES))]


def faixas_para(d):
    """Faixas redondas do mapa ajustadas ao candidato: 5 cores até perto do 95º percentil das cidades
    (só as de MIN_VALIDOS+ votos, para cidades minúsculas não esticarem a escala)."""
    todos = sorted(c["pct"] for c in d["cidades"])
    p95 = todos[int(0.95 * (len(todos) - 1))]
    passo = next((p for p in PASSOS if 4 * p >= p95), PASSOS[-1])
    return [passo * i for i in range(1, 5)]


def rotulos_faixas(lim):
    f = lambda v: (f"{v:g}".replace(".", ",")) + "%"
    return [f"menos de {f(lim[0])}"] + [f"{f(a)} a {f(b)}" for a, b in zip(lim, lim[1:])] + [f"{f(lim[-1])} ou mais"]


def mapa_svg(uf, por_id, largura=640, altura=560):
    """Contornos dos municípios do estado em SVG (Mercator simples), pintados pela % do candidato."""
    malha = json.loads((RAIZ / "site/public/data/malha.json").read_text())
    feats = [f for f in malha["features"] if f["properties"]["id"].startswith(uf)]

    def aneis(g):
        return g["coordinates"] if g["type"] == "Polygon" else [a for p in g["coordinates"] for a in p]

    def proj(lon, lat):
        return lon, -math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))

    pts = [proj(*p) for f in feats for a in aneis(f["geometry"]) for p in a]
    x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
    y0, y1 = min(p[1] for p in pts), max(p[1] for p in pts)
    esc = min((largura - 8) / (x1 - x0), (altura - 8) / (y1 - y0))
    dx, dy = (largura - esc * (x1 - x0)) / 2, (altura - esc * (y1 - y0)) / 2
    caminhos = []
    for f in feats:
        d = ""
        for anel in aneis(f["geometry"]):
            xy = [proj(*p) for p in anel]
            d += "M" + "L".join(f"{dx + (x - x0) * esc:.1f},{dy + (y - y0) * esc:.1f}" for x, y in xy) + "Z"
        c = por_id.get(f["properties"]["id"])
        caminhos.append(f'<path d="{d}" fill="{cor(c["pct"]) if c else "#ddd"}"/>')
    return (f'<svg viewBox="0 0 {largura} {altura}" class="mapa" fill-rule="evenodd" stroke="#fff" stroke-width=".35">'
            + "".join(caminhos) + "</svg>")


def barras(itens, rotulo, valor, frac, extra=""):
    return "".join(f'<div class="b"><span class="r">{rotulo(i)}</span><span class="v">{valor(i)}</span>'
                   f'<i><s style="width:{100 * frac(i):.1f}%"></s></i>{extra(i) if extra else ""}</div>' for i in itens)


def tabela(linhas, cab, celulas):
    th = "".join(f'<th{" class=n" if j > 1 else ""}>{c}</th>' for j, c in enumerate(cab))
    tr = "".join("<tr>" + "".join(f'<td{" class=n" if j > 1 else ""}>{v}</td>' for j, v in enumerate(celulas(i, l))) + "</tr>"
                 for i, l in enumerate(linhas))
    return f"<table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table>"


def main(arq, exemplo):
    d = json.loads(Path(arq).read_text())
    global LIMITES
    LIMITES = faixas_para(d)
    c = d["candidato"]
    uf = d["uf"]
    nome = escape(c["nome"].title())
    sit = "Eleito" if c["situacao"].startswith("ELEITO") else c["situacao"].capitalize()
    por_id = {x["id"]: x for x in d["cidades"]}
    top = d["top_votos"]
    capital = d["capital"]
    maxz = max(z["votos"] for z in capital["zonas"])
    maxm = d["mesorregioes"][0]["votos"]
    legenda = "".join(f'<span><i style="background:{AMBAR[i]}"></i>{t}</span>' for i, t in
                      enumerate(rotulos_faixas(LIMITES)))
    hoje = date.today().strftime("%d/%m/%Y")
    rotulos = rotulos_faixas(LIMITES)
    faixas = [(rotulos[i], sum(1 for x in d["cidades"] if cor(x["pct"]) == AMBAR[i]), AMBAR[i]) for i in range(len(AMBAR))]
    selo = '<span class="selo">Relatório de exemplo</span>' if exemplo else ""
    rodape = (f'<footer><span>Sem Clarim · Raio-X eleitoral · {nome} ({c["partido"]}-{uf})</span>'
              f'<span>Fonte: TSE, dados abertos · conferido com a API oficial de resultados</span></footer>')

    def pagina(conteudo, n):
        return f'<section class="pag"><header><b>SEM CLARIM</b><span>Raio-X eleitoral · {n}/6</span></header>{conteudo}{rodape}</section>'

    p1 = f'''
      <div class="capa">
        {selo}
        <p class="kicker">Raio-X eleitoral · Eleições 2026</p>
        <h1>{nome}</h1>
        <p class="sub">{escape(c["partido"])} · {escape(c["cargo"])} por {UF_NOME.get(uf, uf)} · nº {c["numero"]} · {sit}</p>
        <div class="tiles">
          <div><b>{num(d["total"])}</b><span>votos</span></div>
          <div><b>{pct(d["pct_estado"], 2)}</b><span>dos votos para {escape(c["cargo"].lower())} em {uf}</span></div>
          <div><b>{d["posicao"]}º</b><span>mais votado entre {num(d["candidatos_no_cargo"])} candidatos</span></div>
          <div><b>{num(d["municipios_com_voto"])}</b><span>de {num(d["municipios"])} municípios com voto</span></div>
        </div>
        <div class="destaques">
          <p><b>{pct(d["fatia_partido"])}</b> de todos os votos do {escape(c["partido"])} para {escape(c["cargo"].lower())} em {uf} (nominais e de legenda) foram dele.</p>
          <p><b>{escape(top[0]["nome"])}</b> deu {num(top[0]["votos"])} votos, {pct(d["concentracao"]["top1"])} do total. As 10 cidades que mais votaram nele somam {pct(d["concentracao"]["top10"])}.</p>
          <p>Maior força proporcional: <b>{escape(d["top_pct"][0]["nome"])}</b>, onde fez {pct(d["top_pct"][0]["pct"])} dos votos.</p>
        </div>
        <p class="nota">Todos os números saem dos arquivos oficiais do TSE e foram conferidos, município por município, com a API oficial de divulgação de resultados do TSE. Gerado em {hoje}.</p>
      </div>'''

    p2 = f'''
      <h2>O mapa do voto</h2>
      <p class="lead">Percentual dos votos para {escape(c["cargo"].lower())} que {nome} recebeu em cada município de {UF_NOME.get(uf, uf)}.</p>
      {mapa_svg(uf, por_id)}
      <div class="legenda">{legenda}</div>
      <p class="nota">Percentual sobre os votos computados para o cargo, sem brancos e nulos (critério da divulgação oficial do TSE). As faixas de cor são ajustadas aos números de cada candidato: compare cores só dentro do mesmo relatório.</p>
      <h2 class="mt">Quantos municípios em cada faixa</h2>
      <div class="barras faixas">{barras(faixas, lambda f: f'<i class="q" style="background:{f[2]}"></i>{f[0]}', lambda f: f'{num(f[1])} <small>municípios</small>', lambda f: f[1] / max(x[1] for x in faixas))}</div>'''

    p3 = f'''
      <h2>Onde vieram mais votos</h2>
      <p class="lead">As 12 cidades com mais votos para {nome}.</p>
      {tabela(top[:12], ["#", "Município", "Votos", "% na cidade", "Fatia do total"],
              lambda i, l: [i + 1, escape(l["nome"]), num(l["votos"]), pct(l["pct"]), pct(100 * l["votos"] / d["total"])])}
      <h2 class="mt">Onde foi mais forte</h2>
      <p class="lead">Maior percentual dos votos no município (só cidades com {num(d["min_validos"])} ou mais votos para o cargo).</p>
      {tabela(d["top_pct"][:10], ["#", "Município", "% na cidade", "Votos", "Votos no cargo"],
              lambda i, l: [i + 1, escape(l["nome"]), pct(l["pct"]), num(l["votos"]), num(l["validos"])])}'''

    p4 = f'''
      <h2>Por região do estado</h2>
      <p class="lead">Votos por mesorregião do IBGE: total, percentual dentro da região e fatia do total do candidato.</p>
      <div class="barras">{barras(d["mesorregioes"], lambda m: escape(m["nome"]), lambda m: f'{num(m["votos"])} <small>{pct(m["pct"])} · {pct(m["fatia"])} do total</small>', lambda m: m["votos"] / maxm)}</div>
      <h2 class="mt">Concentração dos votos</h2>
      <p class="lead">Quanto do total veio das cidades que mais votaram nele.</p>
      <div class="barras conc">{barras([("Maior cidade", "top1"), ("5 maiores", "top5"), ("10 maiores", "top10"), ("20 maiores", "top20")], lambda t: t[0], lambda t: pct(d["concentracao"][t[1]]), lambda t: d["concentracao"][t[1]] / 100)}</div>
      <p class="nota">Os outros {num(d["municipios"] - 20)} municípios somam {pct(100 - d["concentracao"]["top20"])} dos votos.</p>'''

    p5 = f'''
      <h2>{escape(capital["nome"])}, zona por zona</h2>
      <p class="lead">{num(capital["votos"])} votos na capital, divididos pelas {len(capital["zonas"])} zonas eleitorais{"" if len(capital["zonas"]) <= MAX_ZONAS else f" (as {MAX_ZONAS} com mais votos)"}.</p>
      <div class="barras zonas">{barras(capital["zonas"][:MAX_ZONAS], lambda z: f'Zona {z["zona"]}', lambda z: num(z["votos"]), lambda z: z["votos"] / maxz)}</div>
      {"" if len(capital["zonas"]) <= MAX_ZONAS else f'<p class="nota">As outras {len(capital["zonas"]) - MAX_ZONAS} zonas somam {num(sum(z["votos"] for z in capital["zonas"][MAX_ZONAS:]))} votos.</p>'}
      <h2 class="mt">Onde teve menos peso</h2>
      <p class="lead">Menor percentual dos votos no município (cidades com {num(d["min_validos"])} ou mais votos para o cargo).</p>
      {tabela(d["menor_pct"][:8], ["#", "Município", "% na cidade", "Votos", "Votos no cargo"],
              lambda i, l: [i + 1, escape(l["nome"]), pct(l["pct"]), num(l["votos"]), num(l["validos"])])}'''

    p6 = f'''
      <h2>Método, fontes e auditoria</h2>
      <div class="metodo">
        <h3>De onde vêm os números</h3>
        <ul>
          <li>Portal de Dados Abertos do TSE: votação nominal por município e zona, detalhe da apuração por município e zona e votação por partido (arquivos gerados em 27/10/2026).</li>
          <li>Mesorregiões e ligação dos municípios: IBGE.</li>
        </ul>
        <h3>Auditoria</h3>
        <p>Os votos do candidato e o total de votos do cargo foram conferidos em <b>todos os {num(d["municipios"])} municípios</b> com a API oficial de divulgação de resultados do TSE (resultados.tse.jus.br), uma fonte separada dos arquivos de dados abertos: <b>nenhuma divergência</b>. A soma dá {num(d["total"])} votos, igual ao total oficial.</p>
        <h3>Escolhas de método</h3>
        <ul>
          <li>Percentuais sobre os votos computados para o cargo, sem brancos e nulos, como na divulgação oficial do TSE.</li>
          <li>Listas por percentual só com municípios de {num(d["min_validos"])} ou mais votos para o cargo, para cidades minúsculas não dominarem.</li>
          <li>Votos em trânsito somados ao município da seção.</li>
          <li>O voto é secreto: nada aqui identifica como alguém votou. Os números são totais por município e zona.</li>
        </ul>
        <h3>O que este relatório não é</h3>
        <p>É uma descrição dos resultados oficiais, sem opinião, sem recomendação de estratégia e sem vínculo com partidos ou candidatos. Os arquivos do TSE ainda podem mudar com recontagens e decisões judiciais.</p>
      </div>
      <div class="cta">
        <b>Quer o Raio-X de outro candidato, partido ou município?</b>
        <span>semclarim.com.br · semclarim@gmail.com</span>
      </div>'''

    css = (RAIZ / "raio_x/relatorio.css").read_text()
    html = f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Raio-X · {nome}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:wght@600;800&display=block" rel="stylesheet">
<style>{css}</style></head><body>
{pagina(p1, 1)}{pagina(p2, 2)}{pagina(p3, 3)}{pagina(p4, 4)}{pagina(p5, 5)}{pagina(p6, 6)}
</body></html>'''
    saida = Path(arq).with_suffix(".html")
    saida.write_text(html)
    print(saida)


if __name__ == "__main__":
    main(sys.argv[1], "--exemplo" in sys.argv)
