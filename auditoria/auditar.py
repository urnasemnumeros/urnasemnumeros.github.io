#!/usr/bin/env python3
"""Auditoria independente dos números do site.

Não reaproveita nada de gerar_dados_site.py: lê de novo os arquivos brutos do TSE (dados abertos) e os
resultados da API oficial de divulgação (resultados.tse.jus.br, baixados em auditoria/api_tse), recalcula
cada número e compara com os JSONs que o site publica (site/public/data).

Saídas:
  auditoria/relatorio.json   todas as conferências (ok / divergência), com fonte e observação
  auditoria/esperado.json    valores esperados das contas que o site faz no navegador (conferidos no DOM)

Uso: python3 -I auditoria/auditar.py
"""
import collections
import csv
import io
import json
import os
import re
import sys
import unicodedata
import zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
DADOS = os.path.join(RAIZ, "dados_tse")
SITE = os.path.join(RAIZ, "site", "public", "data")
API = os.path.join(AQUI, "api_tse")

UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split()
REGIOES = {"Norte": "AC AM AP PA RO RR TO", "Nordeste": "AL BA CE MA PB PE PI RN SE",
           "Centro-Oeste": "DF GO MS MT", "Sudeste": "ES MG RJ SP", "Sul": "PR RS SC"}
REGIOES = {k: v.split() for k, v in REGIOES.items()}
# capitais pelo código IBGE (lista própria da auditoria)
CAPITAIS = {"AC": 1200401, "AL": 2704302, "AP": 1600303, "AM": 1302603, "BA": 2927408, "CE": 2304400, "DF": 5300108,
            "ES": 3205309, "GO": 5208707, "MA": 2111300, "MT": 5103403, "MS": 5002704, "MG": 3106200, "PA": 1501402,
            "PB": 2507507, "PR": 4106902, "PE": 2611606, "PI": 2211001, "RJ": 3304557, "RN": 2408102, "RS": 4314902,
            "RO": 1100205, "RR": 1400100, "SC": 4205407, "SP": 3550308, "SE": 2800308, "TO": 1721000}

conferencias = []


def conferir(area, item, site, esperado, fonte, tol=0, nota=""):
    if isinstance(site, (int, float)) and isinstance(esperado, (int, float)) and not isinstance(site, bool):
        ok = abs(site - esperado) <= tol
    else:
        ok = site == esperado
    conferencias.append({"area": area, "item": item, "site": site, "esperado": esperado, "fonte": fonte,
                         "ok": ok, "nota": nota})
    return ok


def ler_csv(zip_path, terminado_em):
    with zipfile.ZipFile(zip_path) as z:
        nome = next(n for n in z.namelist() if n.upper().endswith(terminado_em.upper()))
        with z.open(nome) as bruto:
            yield from csv.DictReader(io.TextIOWrapper(bruto, encoding="latin1", newline=""), delimiter=";")


def norm(s):
    s = "".join(c for c in unicodedata.normalize("NFD", s.upper()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[\s'\-]+", " ", s).strip()


# grafias diferentes da mesma cidade (TSE → IBGE), conferidas uma a uma
NOMES_ALTERNATIVOS = {"Santo Antônio do Leverger-MT", "Dona Eusébia-MG", "Barão de Monte Alto-MG", "São Luiz-RR", "Bom Jesus-GO",
                      "São Thomé das Letras-MG", "São Luís do Paraitinga-SP", "Amparo de São Francisco-SE", "Munhoz de Mello-PR",
                      "Alvorada do Oeste-RO", "Eldorado dos Carajás-PA", "Espigão do Oeste-RO", "Boa Saúde-RN"}


def json_site(nome):
    with open(os.path.join(SITE, nome), encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------------ site
resumo = json_site("resumo.json")
municipios = {m["id"]: m for m in json_site("municipios.json")}
urnas = json_site("urnas.json")
cand_site = json_site("candidatos.json")
malha = json_site("malha.json")
A, B = resumo["finalistas"]
if cand_site[A]["p"] != "PT":
    A, B = B, A  # A = Lula (PT), B = Flávio (PL), como no site
print("finalistas:", cand_site[A]["n"], "×", cand_site[B]["n"], file=sys.stderr)


# ------------------------------------------------------------------ fonte 1: API oficial de resultados
def api(turno, abr):
    with open(os.path.join(API, f"e{6256 + turno}-{abr}-u.json"), encoding="utf-8") as f:
        d = json.load(f)
    cand = {x["sqcand"]: int(x["vap"]) for a in d["carg"][0]["agr"] for p in a["par"] for x in p["cand"]}
    v, e = d["v"], d["e"]
    return {"cand": cand, "vv": int(v["vv"]), "vb": int(v["vb"]), "vn": int(v["tvn"]), "tv": int(v["tv"]),
            "te": int(e["te"]), "c": int(e["c"]), "a": int(e["a"])}


oficial = {t: {ab: api(t, ab.lower()) for ab in ["BR", "ZZ"] + UFS} for t in (1, 2)}
# voto válido = voto em candidato que a API oficial lista (votos em registro anulado são nulos técnicos)
VALIDOS_SQ = set(oficial[1]["BR"]["cand"]) | set(oficial[2]["BR"]["cand"])

# consistência da própria API: estados + exterior = Brasil
for t in (1, 2):
    for campo in ("vv", "te", "c", "a"):
        soma = sum(oficial[t][ab][campo] for ab in UFS + ["ZZ"])
        conferir("API oficial", f"{t}º turno: soma dos estados + exterior = Brasil ({campo})", soma, oficial[t]["BR"][campo],
                 "API de resultados")

# ------------------------------------------------------------------ fonte 2: votação por seção (bruto)
print("lendo votação por seção...", file=sys.stderr)
mun_raw = collections.defaultdict(collections.Counter)       # (t, id) -> votos por candidato + _v/_b/_n/_tot
sec = {}                                                      # (t, uf, cd, zona, secao) -> [a, b, válidos, total]
for r in ler_csv(os.path.join(DADOS, "votacao_secao_2026_BR.zip"), ".csv"):
    if r["DS_CARGO"] != "Presidente":
        continue
    t, uf, cd = int(r["NR_TURNO"]), r["SG_UF"], int(r["CD_MUNICIPIO"])
    v, sq, nv = int(r["QT_VOTOS"]), r["SQ_CANDIDATO"], r["NR_VOTAVEL"]
    m = mun_raw[(t, f"{uf}{cd}")]
    m["_tot"] += v
    k = (t, uf, cd, int(r["NR_ZONA"]), int(r["NR_SECAO"]))
    s = sec.get(k)
    if s is None:
        s = sec[k] = [0, 0, 0, 0]
    s[3] += v
    if nv == "95":
        m["_b"] += v
    elif sq not in VALIDOS_SQ:
        m["_n"] += v
    else:
        m[sq] += v
        m["_v"] += v
        s[2] += v
        if sq == A:
            s[0] += v
        elif sq == B:
            s[1] += v

# bruto × API oficial (Brasil e cada UF)
for t in (1, 2):
    for ab in ["BR", "ZZ"] + UFS:
        ids = [k for (tt, k) in mun_raw if tt == t and (ab == "BR" or k.startswith(ab))]
        tot = collections.Counter()
        for k in ids:
            tot.update(mun_raw[(t, k)])
        of = oficial[t][ab]
        conferir("Bruto × API", f"{t}º turno {ab}: votos válidos", tot["_v"], of["vv"], "votacao_secao × API")
        for sq, v in of["cand"].items():
            conferir("Bruto × API", f"{t}º turno {ab}: votos de {cand_site.get(sq, {}).get('n', sq)}", tot[sq], v,
                     "votacao_secao × API")

# ------------------------------------------------------------------ site: totais nacionais e municípios
for t in ("1", "2"):
    tt = resumo["presidente"]["totais"][t]
    conferir("Placar e totais", f"{t}º turno: votos válidos (resumo.json)", tt["validos"], oficial[int(t)]["BR"]["vv"], "API")
    for sq, v in tt["c"]:
        conferir("Placar e totais", f"{t}º turno: {cand_site[sq]['n']} (resumo.json)", v, oficial[int(t)]["BR"]["cand"][sq], "API")

dif_mun = collections.Counter()
exemplos = []
for (t, k), c in mun_raw.items():
    m = municipios.get(k)
    d = m and m["r"].get(f"pres{t}")
    if not d:
        dif_mun["sem dados no site"] += 1
        exemplos.append(f"{k} {t}º turno: município sem dados no site")
        continue
    site_c = dict(d["c"])
    if d["t"] != c["_v"] or any(site_c.get(sq, 0) != v for sq, v in c.items() if not sq.startswith("_")):
        dif_mun["votos diferentes"] += 1
        exemplos.append(f"{k} {t}º turno: site {d['t']} válidos, bruto {c['_v']}")
conferir("Municípios", "municípios × turnos com votos iguais ao bruto (todos os candidatos)",
         len(mun_raw) - sum(dif_mun.values()), len(mun_raw), "votacao_secao", nota="; ".join(exemplos[:5]))

# por UF a partir de municipios.json (o que o site soma no navegador) × API
for t in (1, 2):
    for uf in UFS + ["ZZ"]:
        s = collections.Counter()
        for m in municipios.values():
            if m["uf"] == uf and m["r"].get(f"pres{t}"):
                s["t"] += m["r"][f"pres{t}"]["t"]
                for sq, v in m["r"][f"pres{t}"]["c"]:
                    s[sq] += v
        of = oficial[t][uf]
        ok = s["t"] == of["vv"] and s[A] == of["cand"][A] and s[B] == of["cand"][B]
        conferir("Estados (municipios.json)", f"{t}º turno {uf}: válidos, Lula e Flávio",
                 [s["t"], s[A], s[B]], [of["vv"], of["cand"][A], of["cand"][B]], "API")

# ------------------------------------------------------------------ comparecimento (detalhe por seção, bruto)
print("lendo detalhe por seção...", file=sys.stderr)
comp_raw = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
for r in ler_csv(os.path.join(DADOS, "detalhe_votacao_secao_2026.zip"), "_BRASIL.csv"):
    if r["DS_CARGO"] != "Presidente":
        continue
    c = comp_raw[(int(r["NR_TURNO"]), f"{r['SG_UF']}{int(r['CD_MUNICIPIO'])}")]
    for i, campo in enumerate(("QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCOES", "QT_VOTOS_BRANCOS", "QT_VOTOS_NULOS")):
        c[i] += int(r[campo])

for t in (1, 2):
    br = [sum(c[i] for (tt, _), c in comp_raw.items() if tt == t) for i in range(4)]
    br.append(br[1] - br[3] - oficial[t]["BR"]["vv"])
    site = resumo["comparecimento"]["brasil"][str(t)]
    of = oficial[t]["BR"]
    conferir("Comparecimento", f"{t}º turno Brasil: aptos (site × API)", site["QT_APTOS"], of["te"], "API")
    conferir("Comparecimento", f"{t}º turno Brasil: comparecimento (site × API)", site["QT_COMPARECIMENTO"], of["c"], "API")
    conferir("Comparecimento", f"{t}º turno Brasil: abstenções (site × API)", site["QT_ABSTENCOES"], of["a"], "API")
    conferir("Comparecimento", f"{t}º turno Brasil: brancos (site × API)", site["QT_VOTOS_BRANCOS"], of["vb"], "API")
    conferir("Comparecimento", f"{t}º turno Brasil: nulos (site × API)", site["QT_VOTOS_NULOS"], of["vn"], "API",
             nota="a API soma nulos e nulos técnicos")
    conferir("Comparecimento", f"{t}º turno Brasil: site × detalhe bruto", [site[k] for k in (
        "QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCOES", "QT_VOTOS_BRANCOS", "QT_VOTOS_NULOS")], br, "detalhe_votacao_secao")
    for uf in UFS:
        s = [0, 0, 0]
        for m in municipios.values():
            c = m.get("c", {}).get(str(t))
            if m["uf"] == uf and c:
                s[0] += c[0]; s[1] += c[1]; s[2] += c[2]
        o = oficial[t][uf]
        conferir("Comparecimento por estado", f"{t}º turno {uf}: aptos, comparecimento, abstenção", s, [o["te"], o["c"], o["a"]], "API")

# nulos = comparecimento − brancos − válidos oficiais (inclui os nulos técnicos)
for k, c in comp_raw.items():
    if k in mun_raw:
        c[4] = c[1] - c[3] - mun_raw[k]["_v"]
dif = [k for k, c in comp_raw.items() if municipios.get(k[1], {}).get("c", {}).get(str(k[0])) != c]
conferir("Comparecimento", "municípios × turnos com comparecimento igual ao bruto", len(comp_raw) - len(dif), len(comp_raw),
         "detalhe_votacao_secao", nota=", ".join(f"{k[1]} t{k[0]}" for k in dif[:5]))


# ------------------------------------------------------------------ listas de cidades (2º turno)
def linha_raw(t, k, sq):
    c = mun_raw[(t, k)]
    return c[sq], c["_v"]


ids_br = sorted({k for (t, k) in mun_raw if not k.startswith("ZZ") and t == 2})
pres = resumo["presidente"]
for sq in (A, B):
    nome = cand_site[sq]["n"]
    linhas = [(k, *linha_raw(2, k, sq)) for k in ids_br]
    pct = [(k, round(100 * v / t, 2), v, t) for k, v, t in linhas if t]
    elig = [x for x in pct if x[3] >= pres["minValidos"]]
    esp = {"maiorPct": [x[1] for x in sorted(elig, key=lambda x: -x[1])[:10]],
           "menorPct": [x[1] for x in sorted(elig, key=lambda x: x[1])[:10]],
           "maiorVotos": [x[1] for x in sorted(linhas, key=lambda x: -x[1])[:10]],
           "menorVotos": [x[1] for x in sorted(linhas, key=lambda x: (x[1], x[2]))[:10]]}
    for lista, valores in esp.items():
        campo = "pct" if "Pct" in lista else "votos"
        conferir("Cidades: mais e menos votados", f"{nome}: {lista}", [x[campo] for x in pres["cidades"][sq][lista]], valores, "votacao_secao")
    cresc = []
    for k in ids_br:
        v1, t1 = linha_raw(1, k, sq)
        v2, t2 = linha_raw(2, k, sq)
        if t1 and t2:
            cresc.append((k, round(round(100 * v2 / t2, 2) - round(100 * v1 / t1, 2), 2), v2 - v1, t2))
    grandes = [x for x in cresc if x[3] >= pres["minValidos"]]
    espc = {"maiorPct": [x[1] for x in sorted(grandes, key=lambda x: -x[1])[:10]],
            "menorPct": [x[1] for x in sorted(grandes, key=lambda x: x[1])[:10]],
            "maiorVotos": [x[2] for x in sorted(cresc, key=lambda x: -x[2])[:10]],
            "menorVotos": [x[2] for x in sorted(cresc, key=lambda x: x[2])[:10]]}
    for lista, valores in espc.items():
        campo = "dpp" if "Pct" in lista else "dv"
        conferir("Cidades: crescimento", f"{nome}: {lista}", [x[campo] for x in pres["cidades"][sq]["crescimento"][lista]],
                 valores, "votacao_secao")


def lider(t, k):
    c = {sq: v for sq, v in mun_raw[(t, k)].items() if not sq.startswith("_")}
    if not c:
        return None, False
    mx = max(c.values())
    top = [sq for sq, v in c.items() if v == mx]
    return top[0], len(top) > 1


viradas_esp, empates = set(), []
for k in ids_br:
    l1, e1 = lider(1, k)
    l2, e2 = lider(2, k)
    if e1 or e2:
        empates.append(k)
    if l1 and l2 and l1 != l2 and not (e1 or e2):
        viradas_esp.add(k)
viradas_site = {x["id"] for x in pres["viradas"]}
conferir("Cidades: viradas", "cidades que trocaram de vencedor (sem empates)", len(viradas_site - set(empates)), len(viradas_esp),
         "votacao_secao", nota=f"{len(empates)} cidades com empate em algum turno: {', '.join(empates[:6])}")
conferir("Cidades: viradas", "mesmo conjunto de cidades (sem empates)", sorted(viradas_site - set(empates)), sorted(viradas_esp), "votacao_secao")

# ------------------------------------------------------------------ abstenção: listas de cidades
linhas = []
for k in ids_br:
    c1, c2 = comp_raw.get((1, k)), comp_raw.get((2, k))
    if not c1 or not c2 or c1[0] < 1000 or not c1[1] or not c2[1]:
        continue
    linhas.append((k, round(100 * c2[2] / c2[0] - 100 * c1[2] / c1[0], 2),
                   round(100 * (c2[3] + c2[4]) / c2[1] - 100 * (c1[3] + c1[4]) / c1[1], 2)))
cl = resumo["comparecimento"]
for lista, chave, sinal in (("abstCaiu", 1, 1), ("abstSubiu", 1, -1), ("bnCaiu", 2, 1), ("bnSubiu", 2, -1)):
    campo = "da" if chave == 1 else "dbn"
    conferir("Abstenção: cidades", lista, [x[campo] for x in cl[lista]],
             [x[chave] for x in sorted(linhas, key=lambda x: sinal * x[chave])[:10]], "detalhe_votacao_secao")
conferir("Abstenção: cidades", "cidades comparadas", cl["cidadesComparadas"], len(linhas), "detalhe_votacao_secao")
conferir("Abstenção: cidades", "cidades onde a abstenção caiu", cl["cidadesAbstCaiu"], sum(1 for x in linhas if x[1] < 0), "detalhe_votacao_secao")

# ------------------------------------------------------------------ urnas (só Brasil)
sec_br = {k: s for k, s in sec.items() if k[1] != "ZZ"}
for t in (1, 2):
    du = urnas["turnos"][str(t)]
    do_t = [(k, s) for k, s in sec_br.items() if k[0] == t]
    conferir("Urnas", f"{t}º turno: seções no Brasil", du["secoes"], len(do_t), "votacao_secao")
    for lado, sq in ((0, A), (1, B)):
        nome = cand_site[sq]["n"]
        zer = [(k, s) for k, s in do_t if s[2] > 0 and s[lado] == 0]
        conferir("Urnas: zeradas", f"{t}º turno {nome}: total", du["zeradas"][sq]["total"], len(zer), "votacao_secao")
        conferir("Urnas: zeradas", f"{t}º turno {nome}: votos computados", du["zeradas"][sq].get("votos"), sum(s[3] for _, s in zer), "votacao_secao")
        conferir("Urnas: zeradas", f"{t}º turno {nome}: por estado", du["zeradas"][sq]["porUf"],
                 dict(collections.Counter(k[1] for k, _ in zer)), "votacao_secao")
        pc = [(k, s) for k, s in do_t if s[2] > 0 and s[lado] <= 10]
        conferir("Urnas: até 10 votos", f"{t}º turno {nome}: total", du["poucos"][sq]["total"], len(pc), "votacao_secao")
        conferir("Urnas: até 10 votos", f"{t}º turno {nome}: urnas com 0…10 votos", du["poucos"][sq]["porVotos"],
                 [sum(1 for _, s in pc if s[lado] == i) for i in range(11)], "votacao_secao")
        conferir("Urnas: mais votadas", f"{t}º turno {nome}: 10 maiores votações",
                 [u["a"] if lado == 0 else u["b"] for u in du["maisVotos"][sq]],
                 sorted((s[lado] for _, s in do_t), reverse=True)[:10], "votacao_secao")

pares = [(k[1:], sec_br[(1,) + k[1:]], s) for k, s in sec_br.items() if k[0] == 2 and (1,) + k[1:] in sec_br
         and s[2] > 0 and sec_br[(1,) + k[1:]][2] > 0]
et = urnas["entreTurnos"]
conferir("Urnas: entre turnos", "seções comparadas nos dois turnos", et["comparadas"], len(pares), "votacao_secao")
for lado, sq in ((0, A), (1, B)):
    nome, outro = cand_site[sq]["n"], 1 - lado
    vir = [p for p in pares if p[1][outro] > p[1][lado] and p[2][lado] > p[2][outro]]
    conferir("Urnas: viradas", f"{nome}: urnas que viraram", et["viradas"][sq]["total"], len(vir), "votacao_secao")
    conferir("Urnas: viradas", f"{nome}: votos a mais nessas urnas", et["viradas"][sq]["cand2"] - et["viradas"][sq]["cand1"],
             sum(p[2][lado] - p[1][lado] for p in vir), "votacao_secao")
    cai = [p for p in pares if p[2][lado] < p[1][lado]]
    conferir("Urnas: perdas", f"{nome}: urnas em que perdeu votos", et["lados"][sq]["caiu"]["total"], len(cai), "votacao_secao")
    conferir("Urnas: perdas", f"{nome}: votos a menos nessas urnas", et["lados"][sq]["caiu"]["cand1"] - et["lados"][sq]["caiu"]["cand2"],
             sum(p[1][lado] - p[2][lado] for p in cai), "votacao_secao")
    conferir("Urnas: perdas", f"{nome}: maior queda", et["lados"][sq]["caiu"]["lista"][0]["d"],
             min(p[2][lado] - p[1][lado] for p in cai), "votacao_secao")

# ------------------------------------------------------------------ voto misturado (votos por partido)
print("lendo votos por partido...", file=sys.stderr)
CARGOS = {"Deputado Federal": "federal", "Deputado Estadual": "estadual", "Deputado Distrital": "estadual", "Senador": "senador"}
part = {c: collections.defaultdict(collections.Counter) for c in ("federal", "estadual", "senador")}
for r in ler_csv(os.path.join(DADOS, "votacao_partido_munzona_2026.zip"), "_BRASIL.csv"):
    c = CARGOS.get(r["DS_CARGO"])
    if c and r["NR_TURNO"] == "1":
        part[c][f"{r['SG_UF']}{int(r['CD_MUNICIPIO'])}"][r["SG_PARTIDO"]] += int(r["QT_VOTOS_NOMINAIS_VALIDOS"]) + int(r["QT_TOTAL_VOTOS_LEG_VALIDOS"])
pA, pB = cand_site[A]["p"], cand_site[B]["p"]
mis = resumo["mistura"]
for cargo, por_mun in part.items():
    presente = collections.defaultdict(set)
    for k, c in por_mun.items():
        for p, v in c.items():
            if v:
                presente[p].add(k[:2])
    for sq, outro, p_outro in ((A, B, pB), (B, A, pA)):
        venceu = cruz = 0
        for k, c in por_mun.items():
            r1 = mun_raw.get((1, k))
            if not r1 or not r1["_v"] or not sum(c.values()) or k[:2] not in presente[p_outro]:
                continue
            if r1[sq] > r1[outro]:
                venceu += 1
                mx = max(c.values())
                if c[p_outro] == mx and sum(1 for v in c.values() if v == mx) == 1:
                    cruz += 1
        lado = mis[cargo]["lados"][sq]
        conferir("Voto misturado", f"{cargo}: cidades com {cand_site[sq]['n']} à frente", lado["venceu"], venceu, "votacao_partido × votacao_secao")
        conferir("Voto misturado", f"{cargo}: dessas, {p_outro} o mais votado", lado["cruzadas"], cruz, "votacao_partido × votacao_secao",
                 nota="empates de partido não contam na auditoria")

# ------------------------------------------------------------------ mapa: ligação TSE × IBGE
with open(os.path.join(RAIZ, "dados_ibge", "municipios.json"), encoding="utf-8") as f:
    ibge = {m["id"]: m for m in json.load(f)}
ids_malha = [f["properties"].get("id") for f in malha["features"]]
ids_site = {k for k in municipios if not k.startswith("ZZ")}
conferir("Mapa", "polígonos do mapa sem município do TSE", sum(1 for i in ids_malha if not i), 0, "malha IBGE")
conferir("Mapa", "municípios do TSE sem polígono no mapa (só os sem contorno no IBGE)", sorted(ids_site - set(ids_malha)), ["MT73709"], "malha IBGE",
         nota="Boa Esperança do Norte-MT: município novo, sem contorno na malha do IBGE (a API do IBGE não o devolve); o site avisa abaixo dos mapas")
conferir("Mapa", "municípios ligados a mais de um polígono", sorted(i for i, n in collections.Counter(ids_malha).items() if i and n > 1), [], "malha IBGE")
nomes_dif = []
for k, m in municipios.items():
    if k.startswith("ZZ"):
        continue
    ig = ibge.get(m["ibge"])
    if not ig:
        nomes_dif.append(f"{k} sem código IBGE")
        continue
    uf_ig = (ig.get("microrregiao") or ig.get("regiao-imediata", {}).get("regiao-intermediaria", {}))
    uf_ig = (uf_ig.get("mesorregiao", {}).get("UF") or uf_ig.get("UF") or {}).get("sigla")
    if uf_ig != m["uf"] or (norm(ig["nome"]) != norm(m["nome"]) and f"{m['nome']}-{m['uf']}" not in NOMES_ALTERNATIVOS):
        nomes_dif.append(f"{m['nome']}-{m['uf']} → IBGE {ig['nome']}-{uf_ig}")
conferir("Mapa", "municípios ligados a uma cidade do IBGE com outro nome ou outra UF", nomes_dif, [], "IBGE",
         nota=f"{len(NOMES_ALTERNATIVOS)} grafias alternativas aceitas, conferidas uma a uma")
conferir("Mapa", "capitais: nome no site", {uf: municipios.get(next((k for k, m in municipios.items() if m["ibge"] == c), ""), {}).get("nome") for uf, c in CAPITAIS.items()},
         {uf: ibge[c]["nome"] for uf, c in CAPITAIS.items()}, "IBGE")

# ------------------------------------------------------------------ valores esperados das contas do navegador
def soma_ufs(t, ufs):
    s = collections.Counter()
    for uf in ufs:
        o = oficial[t][uf]
        s["a"] += o["cand"][A]; s["b"] += o["cand"][B]; s["t"] += o["vv"]
    s["o"] = s["t"] - s["a"] - s["b"]
    return dict(s)


esperado = {"finalistas": [A, B], "placar": {}, "regioes": {}, "estados": {}, "porte": {}, "capitais": {}, "abstEstados": {}}
o2 = oficial[2]["BR"]
esperado["placar"] = {"pctA": round(100 * o2["cand"][A] / o2["vv"], 2), "pctB": round(100 * o2["cand"][B] / o2["vv"], 2),
                      "votosA": o2["cand"][A], "votosB": o2["cand"][B], "validos": o2["vv"], "dif": abs(o2["cand"][A] - o2["cand"][B])}
for t in (1, 2):
    esperado["regioes"][t] = {"Brasil": soma_ufs(t, UFS + ["ZZ"]), "Exterior": soma_ufs(t, ["ZZ"]),
                              **{r: soma_ufs(t, ufs) for r, ufs in REGIOES.items()}}
    esperado["estados"][t] = {uf: soma_ufs(t, [uf]) for uf in UFS}
    esperado["abstEstados"][t] = {uf: {"aptos": oficial[t][uf]["te"], "abst": oficial[t][uf]["a"]} for uf in UFS}

# porte (faixas de eleitores aptos do site) e capitais, a partir do bruto
FAIXAS = [("Até 10 mil eleitores", 10_000), ("10 mil a 50 mil", 50_000), ("50 mil a 200 mil", 200_000),
          ("200 mil a 1 milhão", 1_000_000), ("Mais de 1 milhão", float("inf"))]
for t in (1, 2):
    pf = collections.defaultdict(collections.Counter)
    cap = collections.defaultdict(collections.Counter)
    for k in ids_br:
        c = mun_raw.get((t, k))
        m = municipios.get(k)
        if not c or not m:
            continue
        faixa = next(n for n, mx in FAIXAS if m["aptos"] < mx)
        for alvo in (pf[faixa],):
            alvo["a"] += c[A]; alvo["b"] += c[B]; alvo["t"] += c["_v"]; alvo["cidades"] += 1
        if m["uf"] != "DF":
            g = cap[f"{m['uf']}|{'c' if m['ibge'] == CAPITAIS[m['uf']] else 'i'}"]
            g["a"] += c[A]; g["b"] += c[B]; g["t"] += c["_v"]
    esperado["porte"][t] = {k: dict(v) for k, v in pf.items()}
    esperado["capitais"][t] = {k: dict(v) for k, v in cap.items()}

# outros candidatos (1º turno, API) e redutos (bruto)
o1 = oficial[1]["BR"]
outros = sorted(((sq, v) for sq, v in o1["cand"].items() if sq not in (A, B)), key=lambda x: -x[1])
esperado["outros"] = {"lista": [{"sq": sq, "nome": cand_site[sq]["n"], "votos": v, "pct": round(100 * v / o1["vv"], 2),
                                 "melhorUf": max(UFS, key=lambda u: oficial[1][u]["cand"][sq] / oficial[1][u]["vv"])} for sq, v in outros],
                      "somaOutros": sum(v for _, v in outros),
                      "ganhoA": o2["cand"][A] - o1["cand"][A], "ganhoB": o2["cand"][B] - o1["cand"][B]}
for x in esperado["outros"]["lista"]:
    u = x["melhorUf"]
    x["melhorUfPct"] = round(100 * oficial[1][u]["cand"][x["sq"]] / oficial[1][u]["vv"], 1)
redutos = {}
br1 = collections.Counter(); br2 = collections.Counter()
for k in ids_br:
    if (1, k) in mun_raw and (2, k) in mun_raw:
        br1.update(mun_raw[(1, k)]); br2.update(mun_raw[(2, k)])
esperado["outros"]["dA"] = round(100 * br2[A] / br2["_v"] - 100 * br1[A] / br1["_v"], 1)
esperado["outros"]["dB"] = round(100 * br2[B] / br2["_v"] - 100 * br1[B] / br1["_v"], 1)
for sq, _ in outros[:4]:
    cid = [(k, mun_raw[(1, k)][sq] / mun_raw[(1, k)]["_v"]) for k in ids_br
           if (1, k) in mun_raw and (2, k) in mun_raw and mun_raw[(1, k)]["_v"] >= 1000]
    top = [k for k, _ in sorted(cid, key=lambda x: -x[1])[:100]]
    s1 = collections.Counter(); s2 = collections.Counter()
    for k in top:
        s1.update(mun_raw[(1, k)]); s2.update(mun_raw[(2, k)])
    redutos[cand_site[sq]["n"]] = {"dA": round(100 * s2[A] / s2["_v"] - 100 * s1[A] / s1["_v"], 1),
                                   "dB": round(100 * s2[B] / s2["_v"] - 100 * s1[B] / s1["_v"], 1),
                                   "maisForte": municipios[top[0]]["nome"]}
esperado["outros"]["redutos"] = redutos
esperado["fluxo"] = {"quedaBN": (oficial[1]["BR"]["vb"] + oficial[1]["BR"]["vn"]) - (o2["vb"] + o2["vn"]),
                     "maisComp": o2["c"] - oficial[1]["BR"]["c"]}

# ------------------------------------------------------------------ saída
with open(os.path.join(AQUI, "relatorio.json"), "w", encoding="utf-8") as f:
    json.dump(conferencias, f, ensure_ascii=False, indent=1)
with open(os.path.join(AQUI, "esperado.json"), "w", encoding="utf-8") as f:
    json.dump(esperado, f, ensure_ascii=False)
ruins = [c for c in conferencias if not c["ok"]]
print(f"{len(conferencias)} conferências, {len(ruins)} divergências")
for c in ruins:
    s = json.dumps(c["site"], ensure_ascii=False)[:160]
    e = json.dumps(c["esperado"], ensure_ascii=False)[:160]
    print(f"- [{c['area']}] {c['item']}\n    site:     {s}\n    esperado: {e}\n    {c['nota'][:300]}")
