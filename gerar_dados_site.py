#!/usr/bin/env python3
"""Gera os JSONs consumidos pelo site (site/public/data/) a partir dos dados do TSE.

Reaproveita o download e as curiosidades de tse_curiosidades.py e acrescenta:
  - resultados por município (presidente, governador, senado, deputados)
  - listas de cidades (top/bottom de cada finalista, viradas entre turnos)
  - cadastro resumido de todos os candidatos (ranking filtrável)
  - malha municipal do IBGE, ligada aos códigos do TSE pelo nome do município

Uso:
    python3 gerar_dados_site.py [--atualizar]
"""
import argparse
import collections
import csv
import difflib
import gzip
import io
import json
import os
import sys
import unicodedata
import urllib.request
import zipfile

import tse_curiosidades as tse

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "site", "public", "data")
IBGE_MALHA = ("https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
              "?formato=application/vnd.geo%2Bjson&qualidade=minima&intrarregiao=municipio")
URL_SECAO_PRESIDENTE = f"{tse.CDN}/votacao_secao/votacao_secao_{tse.ANO}_BR.zip"
URL_DETALHE_SECAO = f"{tse.CDN}/detalhe_votacao_secao/detalhe_votacao_secao_{tse.ANO}.zip"
URL_CONFIG_ELEICOES = "https://resultados.tse.jus.br/oficial/comum/config/ele-c.json"
# nome de urna registrado sem acento -> grafia usual (só exibição)
NOME_EXIBICAO = {"Flavio Bolsonaro": "Flávio Bolsonaro"}
URL_PARTIDO = f"{tse.CDN}/votacao_partido_munzona/votacao_partido_munzona_{tse.ANO}.zip"
URL_FOTOS_BR = f"https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes{tse.ANO}/fotos/foto_cand{tse.ANO}_BR_div.zip"
IBGE_MUNICIPIOS ="https://servicodados.ibge.gov.br/api/v1/localidades/municipios"
TOP_N = {"Presidente": 12, "Governador": 6, "Senador": 6, "Deputado Federal": 10,
         "Deputado Estadual": 10, "Deputado Distrital": 10}
# Municípios cujo nome no TSE difere do IBGE: (UF, nome TSE normalizado) -> código IBGE
NOMES_DIFERENTES = {
    ("RR", "SAOLUIZ"): 1400605,    # São Luiz do Anauá
    ("GO", "BOMJESUS"): 5203500,   # Bom Jesus de Goiás
    ("RN", "BOASAUDE"): 2405306,   # Januário Cicco
}
CARGO_CURTO = {"Presidente": "pres", "Governador": "gov", "Senador": "sen",
               "Deputado Federal": "depf", "Deputado Estadual": "depe", "Deputado Distrital": "depe"}


def normalizar(nome):
    s = unicodedata.normalize("NFKD", nome.upper())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "".join(c for c in s if c.isalnum())


def baixar_json(url, destino, forcar):
    if forcar or not os.path.exists(destino):
        print(f"Baixando {url} ...", file=sys.stderr)
        with urllib.request.urlopen(url, timeout=180) as r:
            dados = r.read()
        if dados[:2] == b"\x1f\x8b":  # a API do IBGE responde gzip mesmo sem pedir
            dados = gzip.decompress(dados)
        with open(destino, "wb") as f:
            f.write(dados)
    with open(destino, encoding="utf-8") as f:
        return json.load(f)


def uf_ibge(m):
    """Sigla da UF num registro da API de localidades (alguns municípios novos não têm microrregião)."""
    try:
        return m["microrregiao"]["mesorregiao"]["UF"]["sigla"]
    except (TypeError, KeyError):
        return m["regiao-imediata"]["regiao-intermediaria"]["UF"]["sigla"]


def ligar_ibge(nomes_tse, municipios_ibge):
    """(uf, cd_tse) -> código IBGE, casando nome normalizado dentro da UF."""
    por_uf = collections.defaultdict(dict)
    for m in municipios_ibge:
        por_uf[uf_ibge(m)][normalizar(m["nome"])] = m["id"]
    ligacao, sem_par = {}, []
    for (uf, cd), nome in nomes_tse.items():
        if uf == "ZZ":
            continue
        tabela = por_uf.get(uf, {})
        n = normalizar(nome)
        if (uf, n) in NOMES_DIFERENTES:
            ligacao[(uf, cd)] = NOMES_DIFERENTES[(uf, n)]
        elif n in tabela:
            ligacao[(uf, cd)] = tabela[n]
        if (uf, cd) in ligacao:
            continue
        parecido = difflib.get_close_matches(n, tabela.keys(), n=1, cutoff=0.8)
        if parecido:
            ligacao[(uf, cd)] = tabela[parecido[0]]
        else:
            sem_par.append(f"{nome} ({uf})")
    if sem_par:
        print(f"Aviso: {len(sem_par)} município(s) sem par no IBGE: {', '.join(sem_par[:20])}", file=sys.stderr)
    return ligacao


def votos_por_municipio(zip_votos):
    """Uma passada por UF (para caber na memória): (cargo, turno, uf, cd) -> top N candidatos."""
    res = {}
    with zipfile.ZipFile(zip_votos) as z:
        for nome in sorted(z.namelist()):
            if not nome.lower().endswith(".csv") or "_BRASIL" in nome.upper():
                continue
            print(f"  {nome}", file=sys.stderr)
            cont = collections.defaultdict(collections.Counter)
            with z.open(nome) as bruto:
                for r in csv.DictReader(io.TextIOWrapper(bruto, encoding="latin1", newline=""), delimiter=";"):
                    if r["DS_CARGO"] != "Presidente":  # o site é só de presidente
                        continue
                    v = int(r["QT_VOTOS_NOMINAIS_VALIDOS"])
                    if v:
                        cont[(r["DS_CARGO"], int(r["NR_TURNO"]), r["SG_UF"], int(r["CD_MUNICIPIO"]))][r["SQ_CANDIDATO"]] += v
            for k, c in cont.items():
                res[k] = (sum(c.values()), c.most_common(TOP_N[k[0]]))
    return res


def analisar_urnas(zip_secao, finalistas, nomes, validos_sq):
    # validos_sq: candidatos cujos votos o TSE conta como válidos. Votos em candidato com registro anulado
    # aparecem no arquivo por seção com o número dele, mas são nulos (técnicos) no resultado oficial.
    """Votação para presidente por seção (só Brasil, sem o exterior): urnas zeradas e urnas com mais votos, nos dois turnos."""
    a, b = finalistas
    # (turno, uf, cd, zona, seção) -> [votos a, votos b, válidos, total, nº do local]
    sec, locais = {}, {}
    with zipfile.ZipFile(zip_secao) as z:
        nome = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(nome) as bruto:
            for r in csv.DictReader(io.TextIOWrapper(bruto, encoding="latin1", newline=""), delimiter=";"):
                if r["CD_CARGO"] != "1" or r["SG_UF"] == "ZZ":  # ZZ = exterior
                    continue
                uf, cd, zona = r["SG_UF"], int(r["CD_MUNICIPIO"]), int(r["NR_ZONA"])
                k = (int(r["NR_TURNO"]), uf, cd, zona, int(r["NR_SECAO"]))
                s = sec.get(k)
                if s is None:
                    s = sec[k] = [0, 0, 0, 0, r["NR_LOCAL_VOTACAO"]]
                v = int(r["QT_VOTOS"])
                s[3] += v
                if r["SQ_CANDIDATO"] in validos_sq:  # branco (95), nulo (96) e voto anulado ficam fora
                    s[2] += v
                if r["SQ_CANDIDATO"] == a:
                    s[0] += v
                elif r["SQ_CANDIDATO"] == b:
                    s[1] += v
                lk = (uf, cd, zona, r["NR_LOCAL_VOTACAO"])
                if lk not in locais:
                    locais[lk] = (tse.titulo(r["NM_MUNICIPIO"]), tse.titulo(r["NM_LOCAL_VOTACAO"]),
                                  tse.titulo(r["DS_LOCAL_VOTACAO_ENDERECO"]))

    def urna(k, s):
        turno, uf, cd, zona, secao = k
        mun, local, end = locais[(uf, cd, zona, s[4])]
        return {"id": f"{uf}{cd}", "uf": uf, "mun": mun, "zona": zona, "secao": secao, "local": local,
                "end": end, "a": s[0], "b": s[1], "validos": s[2], "total": s[3]}

    MAX_LISTA = 400
    POUCOS, MAX_POUCOS = 10, 200
    MAX_COMPARADAS = 500  # urnas listadas em cada lista de crescimento/queda entre os turnos
    res = {"finalistas": finalistas, "turnos": {}}
    for turno in (1, 2):
        do_turno = [(k, s) for k, s in sec.items() if k[0] == turno]
        if not do_turno:
            continue
        t = {"secoes": len(do_turno), "zeradas": {}, "maisVotos": {}}
        for lado, sq in enumerate(finalistas):
            zeradas = [(k, s) for k, s in do_turno if s[lado] == 0 and s[2] > 0]
            zeradas.sort(key=lambda x: -x[1][2])
            por_uf = collections.Counter(k[1] for k, _ in zeradas)
            t["zeradas"][sq] = {"total": len(zeradas), "porUf": dict(por_uf.most_common()),
                                "votos": sum(s[3] for _, s in zeradas),  # votos computados nessas urnas
                                "lista": [urna(k, s) for k, s in zeradas[:MAX_LISTA]]}
            t["maisVotos"][sq] = [urna(k, s) for k, s in sorted(do_turno, key=lambda x: -x[1][lado])[:10]]
            # seções que deram no máximo POUCOS votos ao finalista (só as que tiveram algum voto válido)
            poucas = [(k, s) for k, s in do_turno if s[lado] <= POUCOS and s[2] > 0]
            poucas.sort(key=lambda x: -x[1][2])
            faixa = collections.Counter(s[lado] for _, s in poucas)
            t.setdefault("poucos", {})[sq] = {
                "total": len(poucas), "porVotos": [faixa.get(v, 0) for v in range(POUCOS + 1)],
                "votos": sum(s[3] for _, s in poucas),
                "porUf": dict(collections.Counter(k[1] for k, _ in poucas).most_common()),
                "lista": [urna(k, s) for k, s in poucas[:MAX_POUCOS]]}
        t["maisVotos"]["total"] = [urna(k, s) for k, s in sorted(do_turno, key=lambda x: -x[1][3])[:10]]
        t["maisVotos"]["totalBR"] = [urna(k, s) for k, s in sorted(
            (x for x in do_turno if x[0][1] != "ZZ"), key=lambda x: -x[1][3])[:10]]
        res["turnos"][str(turno)] = t

    def resumo_urnas(lista, item):
        return {"total": len(lista), "porUf": dict(collections.Counter(k[1] for k, _, _ in lista).most_common()),
                "lista": [item(*p) for p in lista[:MAX_COMPARADAS]],
                # votos computados (com brancos e nulos) nessas urnas, em cada turno
                "votos1": sum(p[1][3] for p in lista), "votos2": sum(p[2][3] for p in lista)}

    # a mesma urna nos dois turnos: quanto cada finalista ganhou ou perdeu nela
    pares = [(k, sec[(1,) + k[1:]], s) for k, s in sec.items()
             if k[0] == 2 and (1,) + k[1:] in sec and s[2] > 0 and sec[(1,) + k[1:]][2] > 0]
    res["entreTurnos"] = {"comparadas": len(pares), "lados": {}}
    for lado, sq in enumerate(finalistas):
        def item(k, s1, s2):
            u = urna(k, s2)
            u.update({"v1": s1[lado], "v2": s2[lado], "d": s2[lado] - s1[lado], "validos1": s1[2], "validos2": s2[2], "total1": s1[3]})
            return u
        pares.sort(key=lambda x: x[2][lado] - x[1][lado])
        caiu = [p for p in pares if p[2][lado] < p[1][lado]]
        perdas = resumo_urnas(caiu, item)
        # votos do próprio finalista nessas urnas, em cada turno (a diferença é quanto ele perdeu)
        perdas["cand1"], perdas["cand2"] = sum(p[1][lado] for p in caiu), sum(p[2][lado] for p in caiu)
        res["entreTurnos"]["lados"][sq] = {"caiu": perdas}

    # urnas que viraram: o outro finalista estava à frente no 1º turno e este venceu no 2º (só entre os dois)
    def item_virada(k, s1, s2):
        u = urna(k, s2)
        u.update({"a1": s1[0], "b1": s1[1], "validos1": s1[2], "validos2": s2[2], "total1": s1[3]})
        return u
    res["entreTurnos"]["viradas"] = {}
    for lado, sq in enumerate(finalistas):
        outro = 1 - lado
        viradas = [p for p in pares if p[1][outro] > p[1][lado] and p[2][lado] > p[2][outro]]
        # maiores viradas primeiro: quanto a diferença entre os dois mudou a favor de quem virou
        viradas.sort(key=lambda p: -((p[2][lado] - p[2][outro]) - (p[1][lado] - p[1][outro])))
        v = resumo_urnas(viradas, item_virada)
        # votos de quem virou nessas urnas, em cada turno (a diferença é quanto ele ganhou)
        v["cand1"], v["cand2"] = sum(p[1][lado] for p in viradas), sum(p[2][lado] for p in viradas)
        res["entreTurnos"]["viradas"][sq] = v

    def lugar(u):
        return f"{u['mun']}, exterior" if u["uf"] == "ZZ" else f"{u['mun']}-{u['uf']}"

    # cards de curiosidade (sempre com as quantidades)
    cards = []
    for turno, t in res["turnos"].items():
        for lado, sq in enumerate(finalistas):
            z = t["zeradas"][sq]
            outro = finalistas[1 - lado]
            if z["total"]:
                u = z["lista"][0]
                cards.append({
                    "titulo": f"Urnas sem nenhum voto para {nomes[sq]} · {turno}º turno",
                    "destaque": f"{tse.num(z['total'])} urnas",
                    "texto": f"De {tse.num(t['secoes'])} seções, {tse.num(z['total'])} não deram nenhum voto a {nomes[sq]} "
                             f"no {turno}º turno. A maior delas: seção {u['secao']}, zona {u['zona']}, em {u['local']} "
                             f"({lugar(u)}), onde {nomes[outro]} teve {tse.num(u['b' if lado == 0 else 'a'])} "
                             f"de {tse.num(u['validos'])} votos válidos."})
            else:
                cards.append({"titulo": f"Urnas sem nenhum voto para {nomes[sq]} · {turno}º turno", "destaque": "0 urnas",
                              "texto": f"{nomes[sq]} recebeu pelo menos um voto em todas as {tse.num(t['secoes'])} seções no {turno}º turno."})
        pa, pb = (t["poucos"][sq]["total"] for sq in finalistas)
        cards.append({
            "titulo": f"Urnas com no máximo 10 votos para um finalista · {turno}º turno",
            "destaque": f"{tse.num(pa)} × {tse.num(pb)}",
            "texto": f"De {tse.num(t['secoes'])} seções, {tse.num(pa)} deram no máximo 10 votos a {nomes[finalistas[0]]} "
                     f"e {tse.num(pb)} deram no máximo 10 votos a {nomes[finalistas[1]]} no {turno}º turno."})
        u = t["maisVotos"]["total"][0]
        cards.append({
            "titulo": f"A urna mais movimentada · {turno}º turno", "destaque": f"{tse.num(u['total'])} votos",
            "texto": f"Seção {u['secao']}, zona {u['zona']}, em {u['local']} ({lugar(u)}): {tse.num(u['total'])} votos, "
                     f"sendo {tse.num(u['a'])} para {nomes[finalistas[0]]} e {tse.num(u['b'])} para {nomes[finalistas[1]]}."})
    et = res["entreTurnos"]
    va, vb = (et["viradas"][sq]["total"] for sq in finalistas)
    cards.append({
        "titulo": "Urnas que viraram do 1º para o 2º turno", "destaque": f"{tse.num(va)} × {tse.num(vb)}",
        "texto": f"Entre os dois finalistas, {tse.num(va)} urnas que tinham {nomes[finalistas[1]]} à frente no 1º turno "
                 f"deram vitória a {nomes[finalistas[0]]} no 2º; {tse.num(vb)} fizeram o caminho inverso "
                 f"(de {tse.num(et['comparadas'])} seções comparadas)."})
    for sq in finalistas:
        c = et["lados"][sq]["caiu"]
        if c["total"]:
            u = c["lista"][0]
            cards.append({
                "titulo": f"Urnas em que {nomes[sq]} perdeu votos do 1º para o 2º turno",
                "destaque": f"{tse.num(c['total'])} urnas",
                "texto": f"De {tse.num(et['comparadas'])} seções comparadas, {tse.num(c['total'])} deram menos votos a {nomes[sq]} "
                         f"no 2º turno do que no 1º. A maior queda: seção {u['secao']}, zona {u['zona']}, em {u['local']} "
                         f"({lugar(u)}), de {tse.num(u['v1'])} para {tse.num(u['v2'])} votos."})
    return res, cards


CAMPOS_COMPAREC = ["QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCOES", "QT_VOTOS_BRANCOS", "QT_VOTOS_NULOS"]


def primeiro(votos):
    """Partido mais votado; None se houver empate no primeiro lugar."""
    (p1, v1), *resto = votos.most_common(2)
    return None if resto and resto[0][1] == v1 else p1


def mistura_partidos(zip_partido, municipios, finalistas, partidos, minimo=1000, n=10):
    """Voto "misturado": presidente (1º turno, mesmo dia) × voto no partido em outro cargo, por cidade.

    `partidos` liga cada finalista ao seu partido (ex.: {sq_lula: "PT", sq_flavio: "PL"}).
    Um cargo por vez (deputado federal, deputado estadual/distrital, senador), para comparar voto com voto:
    a % do partido é sobre os votos válidos daquele cargo (nominais + legenda). No Senado de 2026 cada eleitor
    deu 2 votos; a % continua comparável, e ficam de fora os estados em que o partido não teve candidato.
    Lista as cidades onde um finalista ficou à frente para presidente e o partido do OUTRO foi o mais votado
    no cargo; a força da mistura é o menor dos dois percentuais.
    """
    cargos = {"Deputado Federal": "federal", "Deputado Estadual": "estadual", "Deputado Distrital": "estadual", "Senador": "senador"}
    total = {c: collections.Counter() for c in set(cargos.values())}
    por_partido = {c: collections.defaultdict(collections.Counter) for c in set(cargos.values())}
    with zipfile.ZipFile(zip_partido) as z:
        nome = next(x for x in z.namelist() if x.upper().endswith("_BRASIL.CSV"))
        with z.open(nome) as bruto:
            for r in csv.DictReader(io.TextIOWrapper(bruto, encoding="latin1", newline=""), delimiter=";"):
                c = cargos.get(r["DS_CARGO"])
                if not c or r["NR_TURNO"] != "1":
                    continue
                k = f"{r['SG_UF']}{int(r['CD_MUNICIPIO'])}"
                v = int(r["QT_VOTOS_NOMINAIS_VALIDOS"]) + int(r["QT_TOTAL_VOTOS_LEG_VALIDOS"])
                total[c][k] += v
                por_partido[c][k][r["SG_PARTIDO"]] += v
    por_id = {m["id"]: m for m in municipios.values()}
    a, b = finalistas
    res = {"partidos": partidos, "minimo": minimo}
    for c in ("federal", "estadual", "senador"):
        # estados em que cada partido teve votos (candidato) nesse cargo
        presente = collections.defaultdict(set)
        for k, p in por_partido[c].items():
            for sg, v in p.items():
                if v:
                    presente[sg].add(por_id[k]["uf"] if k in por_id else None)
        cidades = []
        for k, t in total[c].items():
            m = por_id.get(k)
            d = m and m["r"].get("pres1")
            if not t or not d or not d["t"]:
                continue
            votos = dict(d["c"])
            pres = {sq: 100 * votos.get(sq, 0) / d["t"] for sq in finalistas}
            part = {sq: 100 * por_partido[c][k][partidos[sq]] / t for sq in finalistas}
            cidades.append({"id": k, "nome": m["nome"], "uf": m["uf"], "validosPres": d["t"], "validosDep": t,
                            "pres": pres, "part": part, "primeiro": primeiro(por_partido[c][k]),
                            "votosPres": {sq: votos.get(sq, 0) for sq in finalistas},
                            "votosPart": {sq: por_partido[c][k][partidos[sq]] for sq in finalistas}})
        br_t = sum(total[c].values())
        lado = {}
        for sq, outro in ((a, b), (b, a)):
            venceu = [x for x in cidades if x["pres"][sq] > x["pres"][outro] and x["uf"] in presente[partidos[outro]]]
            cruzadas = [x for x in venceu if x["primeiro"] == partidos[outro]]  # sem empates (ver "primeiro")
            grandes = [x for x in venceu if x["validosPres"] >= minimo]
            grandes.sort(key=lambda x: -min(x["pres"][sq], x["part"][outro]))
            def item(x):
                return {"id": x["id"], "nome": x["nome"], "uf": x["uf"], "pres": round(x["pres"][sq], 2),
                        "votosPres": x["votosPres"][sq], "validosPres": x["validosPres"],
                        "partOutro": round(x["part"][outro], 2), "votosOutro": x["votosPart"][outro],
                        "validosDep": x["validosDep"]}
            cruzadas.sort(key=lambda x: -min(x["pres"][sq], x["part"][outro]))
            lado[sq] = {"venceu": len(venceu), "cruzadas": len(cruzadas),
                        "lista": [item(x) for x in grandes[:n]],
                        # todas as cidades em que o partido do outro foi o mais votado nas demais disputas
                        "todas": [item(x) for x in cruzadas]}
        br = {sq: sum(p[partidos[sq]] for p in por_partido[c].values()) for sq in finalistas}
        res[c] = {"brasil": {sq: round(100 * v / br_t, 2) for sq, v in br.items()},
                  "votosBrasil": br, "validosBrasil": br_t, "lados": lado,
                  "semCandidato": {sq: sorted({m["uf"] for m in por_id.values() if m["uf"] != "ZZ"} - presente[partidos[sq]])
                                   for sq in finalistas}}
    return res


def copiar_fotos(zip_fotos, sqs, destino):
    """Copia as fotos oficiais (divulgação do TSE) dos candidatos `sqs` para `destino`/<sq>.jpg."""
    os.makedirs(destino, exist_ok=True)
    with zipfile.ZipFile(zip_fotos) as z:
        nomes = set(z.namelist())
        for sq in sqs:
            nome = f"FBR{sq}_div.jpg"
            if nome in nomes:
                with open(os.path.join(destino, f"{sq}.jpg"), "wb") as f:
                    f.write(z.read(nome))


def comparecimento_por_turno(zip_detalhe):
    """Comparecimento para presidente nos dois turnos, por município: (turno, uf, cd) -> Counter."""
    res = collections.defaultdict(collections.Counter)
    with zipfile.ZipFile(zip_detalhe) as z:
        nome = next(n for n in z.namelist() if n.upper().endswith("_BRASIL.CSV"))
        with z.open(nome) as bruto:
            for r in csv.DictReader(io.TextIOWrapper(bruto, encoding="latin1", newline=""), delimiter=";"):
                if r["CD_CARGO"] != "1":
                    continue
                k = (int(r["NR_TURNO"]), r["SG_UF"], int(r["CD_MUNICIPIO"]))
                for campo in CAMPOS_COMPAREC:
                    res[k][campo] += int(r[campo])
    return res


def suplementares_no_2turno(config):
    """(uf, cd) das cidades com eleição suplementar para prefeito no mesmo dia do 2º turno."""
    res = set()
    for pleito in config["pl"]:
        if not any("2º Turno" in e["nm"] and e["tp"] == "8" for e in pleito["e"]):
            continue
        for e in pleito["e"]:
            if e["nm"].startswith("Eleição Suplementar"):
                for abr in e.get("abr", []):
                    for m in abr.get("mu", []):
                        res.add((abr["cd"].upper(), int(m["cd"])))
    return res


def comparar_turnos(comp, municipios, suplementares=frozenset(), minimo=1000):
    """Brasil e cidades: abstenção, brancos e nulos no 1º x 2º turno."""
    brasil = {t: collections.Counter() for t in (1, 2)}
    for (t, uf, cd), c in comp.items():
        brasil[t].update(c)
        m = municipios.get((uf, cd))
        if m is not None:
            m.setdefault("c", {})[str(t)] = [c[k] for k in CAMPOS_COMPAREC]

    def taxa(c, campo, base):
        return 100 * c[campo] / c[base] if c[base] else 0

    linhas = []
    for m in municipios.values():
        if "c" not in m or len(m["c"]) < 2 or m["uf"] == "ZZ":
            continue
        (ap1, co1, ab1, br1, nu1), (ap2, co2, ab2, br2, nu2) = m["c"]["1"], m["c"]["2"]
        if ap1 < minimo or not co1 or not co2:
            continue
        a1, a2 = 100 * ab1 / ap1, 100 * ab2 / ap2
        bn1, bn2 = 100 * (br1 + nu1) / co1, 100 * (br2 + nu2) / co2
        linhas.append({"id": m["id"], "nome": m["nome"], "uf": m["uf"], "aptos": ap2,
                       "ab1": ab1, "ab2": ab2, "a1": round(a1, 2), "a2": round(a2, 2), "da": round(a2 - a1, 2),
                       "bn1": br1 + nu1, "bn2": br2 + nu2, "pbn1": round(bn1, 2), "pbn2": round(bn2, 2),
                       "dbn": round(bn2 - bn1, 2), "sup": (m["uf"], int(m["id"][2:])) in suplementares})
    listas = {
        "abstCaiu": sorted(linhas, key=lambda x: x["da"])[:10],
        "abstSubiu": sorted(linhas, key=lambda x: -x["da"])[:10],
        "bnCaiu": sorted(linhas, key=lambda x: x["dbn"])[:10],
        "bnSubiu": sorted(linhas, key=lambda x: -x["dbn"])[:10],
        "minimo": minimo,
        "cidadesAbstCaiu": sum(1 for x in linhas if x["da"] < 0),
        "cidadesComparadas": len(linhas),
    }
    b1, b2 = brasil[1], brasil[2]
    num = tse.num

    def pts(v):
        return ("+" if v > 0 else "−" if v < 0 else "") + tse.pct(abs(v), 1).replace("%", " pts")

    def obs(x):
        return " No mesmo dia do 2º turno, a cidade teve eleição suplementar para prefeito." if x["sup"] else ""

    cards = [
        {"titulo": "Mais gente votou no 2º turno",
         "destaque": f"+{num(b2['QT_COMPARECIMENTO'] - b1['QT_COMPARECIMENTO'])}",
         "texto": f"Compareceram {num(b1['QT_COMPARECIMENTO'])} eleitores no 1º turno e {num(b2['QT_COMPARECIMENTO'])} no 2º. "
                  f"A abstenção caiu de {tse.pct(taxa(b1, 'QT_ABSTENCOES', 'QT_APTOS'))} ({num(b1['QT_ABSTENCOES'])}) para "
                  f"{tse.pct(taxa(b2, 'QT_ABSTENCOES', 'QT_APTOS'))} ({num(b2['QT_ABSTENCOES'])}), com {num(b2['QT_APTOS'])} aptos."},
        {"titulo": "Menos brancos e nulos no 2º turno",
         "destaque": f"−{num(b1['QT_VOTOS_BRANCOS'] + b1['QT_VOTOS_NULOS'] - b2['QT_VOTOS_BRANCOS'] - b2['QT_VOTOS_NULOS'])}",
         "texto": f"Brancos caíram de {num(b1['QT_VOTOS_BRANCOS'])} para {num(b2['QT_VOTOS_BRANCOS'])} e nulos de "
                  f"{num(b1['QT_VOTOS_NULOS'])} para {num(b2['QT_VOTOS_NULOS'])}. Somado ao maior comparecimento, isso fez os "
                  f"votos válidos crescerem entre os turnos."},
    ]
    if linhas:
        x = listas["abstCaiu"][0]
        cards.append({"titulo": "Onde a abstenção mais caiu", "destaque": pts(x["da"]),
                      "texto": f"Em {x['nome']} ({x['uf']}), a abstenção foi de {tse.pct(x['a1'], 1)} ({num(x['ab1'])} eleitores) "
                               f"no 1º turno para {tse.pct(x['a2'], 1)} ({num(x['ab2'])}) no 2º. Ao todo, a abstenção caiu em "
                               f"{num(listas['cidadesAbstCaiu'])} de {num(len(linhas))} cidades com {num(minimo)}+ eleitores.{obs(x)}"})
        x = listas["abstSubiu"][0]
        cards.append({"titulo": "Onde a abstenção mais subiu", "destaque": pts(x["da"]),
                      "texto": f"Em {x['nome']} ({x['uf']}), a abstenção foi de {tse.pct(x['a1'], 1)} ({num(x['ab1'])} eleitores) "
                               f"no 1º turno para {tse.pct(x['a2'], 1)} ({num(x['ab2'])}) no 2º.{obs(x)}"})
    brasil_out = {str(t): {k: c[k] for k in CAMPOS_COMPAREC} for t, c in brasil.items()}
    return brasil_out, listas, cards


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dados", default=os.path.join(AQUI, "dados_tse"))
    ap.add_argument("--atualizar", action="store_true")
    a = ap.parse_args()
    os.makedirs(SAIDA, exist_ok=True)
    pasta_ibge = os.path.join(AQUI, "dados_ibge")
    os.makedirs(pasta_ibge, exist_ok=True)

    arqs = {k: tse.baixar(k, a.dados, a.atualizar) for k in tse.ARQUIVOS}
    d = tse.carregar(arqs)
    secoes = tse.analisar(d)

    print("Resultados por município...", file=sys.stderr)
    por_mun = votos_por_municipio(arqs["votos"])

    # ---------------- municípios
    ibge = baixar_json(IBGE_MUNICIPIOS, os.path.join(pasta_ibge, "municipios.json"), a.atualizar)
    ligacao = ligar_ibge(d.nome_mun, ibge)

    municipios = {}
    for (uf, cd), nome in d.nome_mun.items():
        det = d.detalhe.get((1, "Presidente", uf, cd), {})
        aptos = det.get("QT_APTOS", 0)
        municipios[(uf, cd)] = {
            "id": f"{uf}{cd}", "ibge": ligacao.get((uf, cd)), "uf": uf, "nome": nome,
            "aptos": aptos, "comparec": det.get("QT_COMPARECIMENTO", 0), "abst": det.get("QT_ABSTENCOES", 0),
            "brancos": det.get("QT_VOTOS_BRANCOS", 0), "nulos": det.get("QT_TOTAL_VOTOS_NULOS", 0),
            "r": {},
        }
    for (cargo, turno, uf, cd), (total, top) in por_mun.items():
        m = municipios.get((uf, cd))
        if m is not None:
            m["r"][f"{CARGO_CURTO[cargo]}{turno}"] = {"t": total, "c": [[sq, v] for sq, v in top]}

    # ---------------- candidatos
    final = tse.situacao_final(d)
    candidatos = {}
    for (turno, sq), c in d.cand.items():
        if c["cargo"] != "Presidente":
            continue
        p = d.perfil.get(sq, {})
        e = candidatos.setdefault(sq, {
            "n": NOME_EXIBICAO.get(c["nome"], c["nome"]), "p": c["partido"], "uf": c["uf"], "c": c["cargo"],
            "s": final[sq]["situacao"], "v1": 0, "v2": None,
            "g": p.get("DS_GENERO", ""), "i": tse.idade(p.get("DT_NASCIMENTO")),
            "o": p.get("DS_OCUPACAO", ""), "b": round(d.bens.get(sq, 0)),
        })
        e["v1" if turno == 1 else "v2"] = c["votos"]
    # % dos válidos no estado (ou país) para o ranking
    for sq, e in candidatos.items():
        # mesmo denominador das curiosidades: total oficial de válidos (nominais + legenda)
        tot = (d.detalhe_uf.get((1, e["c"], e["uf"]), {}).get("QT_TOTAL_VOTOS_VALIDOS")
               or sum(d.por_uf[(1, e["c"], e["uf"])].values()))
        e["pv"] = round(100 * e["v1"] / tot, 3) if tot else 0

    # ---------------- presidente: listas de cidades
    pres = {}
    finalistas = [sq for sq, _ in d.por_uf[(2, "Presidente", "BR")].most_common(2)]
    cidades = [m for m in municipios.values() if m["uf"] != "ZZ" and "pres2" in m["r"]]

    def votos(m, chave, sq):
        return next((v for s, v in m["r"][chave]["c"] if s == sq), 0)

    def linha(m, sq, chave="pres2"):
        v, t = votos(m, chave, sq), m["r"][chave]["t"]
        return {"id": m["id"], "nome": m["nome"], "uf": m["uf"], "votos": v, "validos": t,
                "pct": round(100 * v / t, 2) if t else 0}

    MIN_VALIDOS = 1000
    for sq in finalistas:
        elig = [linha(m, sq) for m in cidades if m["r"]["pres2"]["t"] >= MIN_VALIDOS]
        pres[sq] = {
            "nome": candidatos[sq]["n"], "partido": candidatos[sq]["p"],
            "maiorPct": sorted(elig, key=lambda x: -x["pct"])[:10],
            "menorPct": sorted(elig, key=lambda x: x["pct"])[:10],
            "maiorVotos": sorted((linha(m, sq) for m in cidades), key=lambda x: -x["votos"])[:10],
            "menorVotos": sorted((linha(m, sq) for m in cidades), key=lambda x: (x["votos"], x["validos"]))[:10],
        }
        # crescimento do 1º para o 2º turno, em pontos percentuais e em votos
        cresc = []
        for m in cidades:
            if "pres1" not in m["r"]:
                continue
            l1, l2 = linha(m, sq, "pres1"), linha(m, sq)
            cresc.append({"id": m["id"], "nome": m["nome"], "uf": m["uf"],
                          "v1": l1["votos"], "t1": l1["validos"], "p1": l1["pct"],
                          "v2": l2["votos"], "t2": l2["validos"], "p2": l2["pct"],
                          "dpp": round(l2["pct"] - l1["pct"], 2), "dv": l2["votos"] - l1["votos"]})
        grandes = [c for c in cresc if c["t2"] >= MIN_VALIDOS]
        pres[sq]["crescimento"] = {
            "maiorPct": sorted(grandes, key=lambda x: -x["dpp"])[:10],
            "menorPct": sorted(grandes, key=lambda x: x["dpp"])[:10],
            "maiorVotos": sorted(cresc, key=lambda x: -x["dv"])[:10],
            "menorVotos": sorted(cresc, key=lambda x: x["dv"])[:10],
        }
    viradas = []
    for m in cidades:
        if "pres1" not in m["r"]:
            continue
        lider1 = m["r"]["pres1"]["c"][0][0]
        lider2 = m["r"]["pres2"]["c"][0][0]
        if lider1 != lider2:
            t1, t2 = m["r"]["pres1"]["t"], m["r"]["pres2"]["t"]
            viradas.append({
                "id": m["id"], "nome": m["nome"], "uf": m["uf"],
                "venceu1": lider1, "venceu2": lider2,
                "t1": {s: votos(m, "pres1", s) for s in finalistas}, "validos1": t1,
                "t2": {s: votos(m, "pres2", s) for s in finalistas}, "validos2": t2,
            })
    viradas.sort(key=lambda x: -x["validos2"])

    totais = {}
    for turno in (1, 2):
        c = d.por_uf.get((turno, "Presidente", "BR"))
        if c:
            totais[turno] = {"validos": sum(c.values()), "c": c.most_common()}
    print("Comparecimento por seção nos dois turnos...", file=sys.stderr)
    zip_det_secao = tse.baixar("detalhe_secao", a.dados, a.atualizar, url=URL_DETALHE_SECAO)
    config = baixar_json(URL_CONFIG_ELEICOES, os.path.join(a.dados, "ele-c.json"), a.atualizar)
    suplementares = suplementares_no_2turno(config)
    for k in suplementares:
        if k in municipios:
            municipios[k]["sup"] = True
    comp = comparecimento_por_turno(zip_det_secao)
    # O detalhe por seção conta como "nominais" os votos em candidato com registro anulado (5.246 no 1º turno);
    # o TSE os trata como nulos (técnicos). Nulos = comparecimento − brancos − válidos oficiais.
    for (turno, uf, cd), soma in comp.items():
        mun = municipios.get((uf, cd))
        disputa = mun and mun["r"].get(f"pres{turno}")
        if disputa:
            soma["QT_VOTOS_NULOS"] = soma["QT_COMPARECIMENTO"] - soma["QT_VOTOS_BRANCOS"] - disputa["t"]
    comp_brasil, comp_listas, comp_cards = comparar_turnos(comp, municipios, suplementares)

    print("Votos por partido (voto misturado)...", file=sys.stderr)
    zip_partido = tse.baixar("partido", a.dados, a.atualizar, url=URL_PARTIDO)
    mistura = mistura_partidos(zip_partido, municipios, finalistas, {sq: candidatos[sq]["p"] for sq in finalistas})

    print("Fotos oficiais dos finalistas...", file=sys.stderr)
    zip_fotos = tse.baixar("fotos_br", a.dados, a.atualizar, url=URL_FOTOS_BR)
    copiar_fotos(zip_fotos, finalistas, os.path.join(SAIDA, "..", "fotos"))

    resumo = {
        "geracao": d.geracao,
        "mistura": mistura,
        "finalistas": finalistas,
        "presidente": {"totais": totais, "cidades": pres, "viradas": viradas, "minValidos": MIN_VALIDOS},
        "comparecimento": {"brasil": comp_brasil, **comp_listas},
        # só as curiosidades que o site mostra (o site é focado em presidente)
        "secoes": {
            "Comparecimento: 1º × 2º turno": comp_cards,
            "Comparecimento · 1º turno": [c for c in secoes.get("Comparecimento, brancos e nulos (1º turno, Presidente)", [])
                                          if c["titulo"] != "Abstenção no Brasil"],
        },
    }

    # ---------------- malha (coordenadas arredondadas para reduzir o arquivo)
    malha = baixar_json(IBGE_MALHA, os.path.join(pasta_ibge, "malha_municipios.json"), a.atualizar)
    tse_de_ibge = {str(v): f"{uf}{cd}" for (uf, cd), v in ligacao.items()}

    def arred(coords):
        if isinstance(coords[0], (int, float)):
            return [round(coords[0], 3), round(coords[1], 3)]
        return [arred(c) for c in coords]

    for f in malha["features"]:
        f["geometry"]["coordinates"] = arred(f["geometry"]["coordinates"])
        f["properties"] = {"id": tse_de_ibge.get(str(f["properties"]["codarea"]))}

    def salvar(nome, obj):
        caminho = os.path.join(SAIDA, nome)
        with open(caminho, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  {nome}: {os.path.getsize(caminho) / 1e6:.1f} MB", file=sys.stderr)

    print("Votação por seção (urnas)...", file=sys.stderr)
    zip_secao = tse.baixar("secao", a.dados, a.atualizar, url=URL_SECAO_PRESIDENTE)
    urnas, cards = analisar_urnas(zip_secao, finalistas, {sq: candidatos[sq]["n"] for sq in finalistas},
                                  {sq for sq, c in candidatos.items() if c["c"] == "Presidente"})
    resumo["secoes"]["Urnas"] = cards
    salvar("urnas.json", urnas)
    salvar("resumo.json", resumo)
    salvar("municipios.json", list(municipios.values()))
    salvar("candidatos.json", candidatos)
    salvar("malha.json", malha)
    ufs = baixar_json(IBGE_MALHA.replace("intrarregiao=municipio", "intrarregiao=UF"),
                      os.path.join(pasta_ibge, "malha_ufs.json"), a.atualizar)
    for f in ufs["features"]:
        f["geometry"]["coordinates"] = arred(f["geometry"]["coordinates"])
    salvar("malha_ufs.json", ufs)


if __name__ == "__main__":
    main()
