#!/usr/bin/env python3
"""Curiosidades das Eleições Gerais de 2026 a partir dos dados abertos oficiais do TSE.

Baixa os arquivos do Portal de Dados Abertos do TSE (cdn.tse.jus.br), processa
tudo localmente (só biblioteca padrão do Python) e gera:
  - curiosidades_2026.json  (dados estruturados)
  - curiosidades_2026.html  (relatório para ler/compartilhar)

Uso:
    python3 tse_curiosidades.py                 # baixa (se preciso) e analisa
    python3 tse_curiosidades.py --atualizar     # força novo download dos arquivos
    python3 tse_curiosidades.py --dados /pasta  # pasta onde guardar os .zip
"""
import argparse
import collections
import csv
import datetime
import html
import io
import json
import os
import re
import sys
import urllib.request
import zipfile

ANO = 2026
CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele"
ARQUIVOS = {
    "votos": f"{CDN}/votacao_candidato_munzona/votacao_candidato_munzona_{ANO}.zip",
    "detalhe": f"{CDN}/detalhe_votacao_munzona/detalhe_votacao_munzona_{ANO}.zip",
    "candidatos": f"{CDN}/consulta_cand/consulta_cand_{ANO}.zip",
    "bens": f"{CDN}/bem_candidato/bem_candidato_{ANO}.zip",
}
DATA_ELEICAO = datetime.date(ANO, 10, 4)
ELEITO = {"ELEITO", "ELEITO POR QP", "ELEITO POR MÉDIA"}
DEPUTADOS = {"Deputado Federal", "Deputado Estadual", "Deputado Distrital"}
csv.field_size_limit(10**8)


# --------------------------------------------------------------------------- utilidades
def num(n):
    return f"{n:,}".replace(",", ".")


def pct(p, casas=2):
    return f"{p:.{casas}f}".replace(".", ",") + "%"


def reais(v):
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {s}"


PARTICULAS = {"de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas"}


def titulo(s):
    """NOME EM CAIXA ALTA -> Nome em Caixa Alta (mantendo de/da/do minúsculos)."""
    partes = re.split(r"(\s+|-)", s.lower())
    return "".join(p if i and p in PARTICULAS else p[:1].upper() + p[1:] for i, p in enumerate(partes))


def baixar(chave, pasta, forcar, url=None):
    url = url or ARQUIVOS[chave]
    destino = os.path.join(pasta, os.path.basename(url))
    if os.path.exists(destino) and not forcar:
        return destino
    print(f"Baixando {url} ...", file=sys.stderr)
    tmp = destino + ".part"
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
        while bloco := r.read(1 << 20):
            f.write(bloco)
    os.replace(tmp, destino)
    return destino


def linhas(zip_path):
    """Lê o CSV consolidado (_BRASIL.csv) de dentro do zip, sem extrair."""
    with zipfile.ZipFile(zip_path) as z:
        nome = next(n for n in z.namelist() if n.upper().endswith("_BRASIL.CSV"))
        with z.open(nome) as bruto:
            texto = io.TextIOWrapper(bruto, encoding="latin1", newline="")
            yield from csv.DictReader(texto, delimiter=";")


def chave_mun(r):
    return (r["SG_UF"], int(r["CD_MUNICIPIO"]))


# --------------------------------------------------------------------------- leitura
class Dados:
    def __init__(self):
        # (turno, sq) -> info do candidato
        self.cand = {}
        # (turno, cargo, uf) -> {sq: votos}  (UF "BR" usada para presidente)
        self.por_uf = collections.defaultdict(collections.Counter)
        # (turno, cargo, uf, cd_mun) -> {sq: votos}  só para majoritários
        self.por_mun = collections.defaultdict(collections.Counter)
        # sq -> {mun: votos} só para deputados eleitos
        self.mun_eleitos = collections.defaultdict(collections.Counter)
        # sq -> set de municípios (deputados eleitos)
        self.nome_mun = {}
        # (turno, cargo, uf, cd_mun) -> agregados de comparecimento
        self.detalhe = collections.defaultdict(collections.Counter)
        self.detalhe_uf = collections.defaultdict(collections.Counter)
        self.perfil = {}
        self.bens = collections.Counter()
        self.maior_bem = {}  # sq -> (valor, tipo, descrição)
        self.geracao = {}


def carregar(arqs):
    d = Dados()
    print("Processando votação por município/zona (alguns minutos)...", file=sys.stderr)
    for r in linhas(arqs["votos"]):
        d.geracao.setdefault("votos", f'{r["DT_GERACAO"]} {r["HH_GERACAO"]}')
        turno = int(r["NR_TURNO"])
        cargo = r["DS_CARGO"]
        sq = r["SQ_CANDIDATO"]
        votos = int(r["QT_VOTOS_NOMINAIS_VALIDOS"])
        k = (turno, sq)
        c = d.cand.get(k)
        if c is None:
            c = d.cand[k] = {
                "sq": sq, "turno": turno, "cargo": cargo,
                "nome": titulo(r["NM_URNA_CANDIDATO"]), "nome_civil": r["NM_CANDIDATO"],
                "partido": r["SG_PARTIDO"], "uf": r["SG_UE"] if cargo == "Presidente" else r["SG_UF"],
                "situacao": r["DS_SIT_TOT_TURNO"], "votos": 0, "votos_brutos": 0, "municipios": set(),
            }
        c["votos"] += votos
        c["votos_brutos"] += int(r["QT_VOTOS_NOMINAIS"])
        if votos:
            c["municipios"].add(chave_mun(r))
        d.por_uf[(turno, cargo, c["uf"])][sq] += votos
        d.nome_mun[chave_mun(r)] = titulo(r["NM_MUNICIPIO"])
        if cargo in DEPUTADOS:
            if r["DS_SIT_TOT_TURNO"] in ELEITO:
                d.mun_eleitos[sq][chave_mun(r)] += votos
        else:
            d.por_mun[(turno, cargo) + chave_mun(r)][sq] += votos
            if cargo == "Presidente":
                d.por_mun[(turno, cargo, "UF:" + r["SG_UF"], 0)][sq] += votos

    print("Processando comparecimento e abstenção...", file=sys.stderr)
    campos = ["QT_APTOS", "QT_COMPARECIMENTO", "QT_ABSTENCOES", "QT_VOTOS_BRANCOS",
              "QT_TOTAL_VOTOS_NULOS", "QT_TOTAL_VOTOS_VALIDOS"]
    for r in linhas(arqs["detalhe"]):
        d.geracao.setdefault("detalhe", f'{r["DT_GERACAO"]} {r["HH_GERACAO"]}')
        turno, cargo = int(r["NR_TURNO"]), r["DS_CARGO"]
        uf_ue = "BR" if cargo == "Presidente" else r["SG_UF"]
        for campo in campos:
            v = int(r[campo])
            d.detalhe[(turno, cargo) + chave_mun(r)][campo] += v
            d.detalhe_uf[(turno, cargo, uf_ue)][campo] += v

    print("Processando perfil dos candidatos...", file=sys.stderr)
    for r in linhas(arqs["candidatos"]):
        d.geracao.setdefault("candidatos", f'{r["DT_GERACAO"]} {r["HH_GERACAO"]}')
        sq = r["SQ_CANDIDATO"]
        p = d.perfil.setdefault(sq, {})
        for campo in ("DT_NASCIMENTO", "DS_GENERO", "DS_OCUPACAO", "DS_COR_RACA",
                      "DS_GRAU_INSTRUCAO", "DS_CARGO", "SG_UF", "NM_URNA_CANDIDATO",
                      "SG_PARTIDO", "DS_SIT_TOT_TURNO"):
            if r[campo] and not r[campo].startswith(("#", "NÃO DIVULG")):
                p[campo] = titulo(r[campo]) if campo == "NM_URNA_CANDIDATO" else r[campo]

    print("Processando bens declarados...", file=sys.stderr)
    for r in linhas(arqs["bens"]):
        try:
            v = float(r["VR_BEM_CANDIDATO"].replace(",", "."))
            d.bens[r["SQ_CANDIDATO"]] += v
            if v > d.maior_bem.get(r["SQ_CANDIDATO"], (0,))[0]:
                d.maior_bem[r["SQ_CANDIDATO"]] = (v, r["DS_TIPO_BEM_CANDIDATO"], r["DS_BEM_CANDIDATO"])
        except ValueError:
            pass
    return d


# --------------------------------------------------------------------------- análise
def situacao_final(d):
    """sq -> registro do candidato no último turno que disputou."""
    final = {}
    for (turno, sq), c in sorted(d.cand.items()):
        final[sq] = c
    return final


def idade(nasc):
    try:
        n = datetime.datetime.strptime(nasc, "%d/%m/%Y").date()
    except (TypeError, ValueError):
        return None
    return DATA_ELEICAO.year - n.year - ((DATA_ELEICAO.month, DATA_ELEICAO.day) < (n.month, n.day))


def eleito_a(d, c):
    return "eleita" if d.perfil.get(c["sq"], {}).get("DS_GENERO") == "FEMININO" else "eleito"


def rot(c):
    return f'{c["nome"]} ({c["partido"]}-{c["uf"]})'


def mun(d, k):
    return f"{d.nome_mun.get(k, '?')} ({k[0]})"


def analisar(d):
    sec = collections.OrderedDict()
    final = situacao_final(d)

    def add(secao, titulo, destaque, texto, dados=None):
        sec.setdefault(secao, []).append(
            {"titulo": titulo, "destaque": destaque, "texto": texto, "dados": dados or {}})

    # ---------------- Presidente
    S = "Presidência da República"
    for turno in (1, 2):
        tot = d.por_uf.get((turno, "Presidente", "BR"))
        if not tot:
            continue
        validos = sum(tot.values())
        rank = tot.most_common()
        top = [(d.cand[(turno, sq)], v) for sq, v in rank]
        if turno == 2:
            (a, va), (b, vb) = top[0], top[1]
            add(S, "Resultado do 2º turno", pct(100 * va / validos),
                f'{rot(a)} venceu com {num(va)} votos válidos, {num(va - vb)} a mais que {rot(b)} '
                f'({pct(100 * vb / validos)}).')
        else:
            linhas_ = "; ".join(f'{rot(c)}: {pct(100 * v / validos)}' for c, v in top[:5])
            add(S, "Resultado do 1º turno", f"{len(top)} candidatos", linhas_ + ".")

    # municípios: viradas, extremos, empates
    def vencedor(cont):
        r = cont.most_common(2)
        return r[0][0] if r and r[0][1] > 0 else None

    mun1 = {k[2:]: v for k, v in d.por_mun.items() if k[:2] == (1, "Presidente") and not str(k[2]).startswith("UF:") and k[2] != "ZZ"}
    mun2 = {k[2:]: v for k, v in d.por_mun.items() if k[:2] == (2, "Presidente") and not str(k[2]).startswith("UF:") and k[2] != "ZZ"}
    if mun2:
        finalistas = [sq for sq, _ in d.por_uf[(2, "Presidente", "BR")].most_common(2)]
        a, b = (d.cand[(2, sq)] for sq in finalistas)
        viradas = []
        for m, c2 in mun2.items():
            c1 = mun1.get(m)
            if not c1:
                continue
            v1, v2 = vencedor(c1), vencedor(c2)
            if v1 and v2 and v1 != v2:
                viradas.append((m, v1, v2, sum(c2.values())))
        if viradas:
            por_quem = collections.Counter(d.cand[(2, v2)]["nome"] for _, _, v2, _ in viradas)
            maior = max(viradas, key=lambda x: x[3])
            nome_v1 = d.cand[(1, maior[1])]["nome"]
            add(S, "Municípios que “viraram” do 1º para o 2º turno", num(len(viradas)),
                f'Em {num(len(viradas))} cidades o vencedor do 2º turno não foi quem liderou no 1º '
                f'({", ".join(f"{n}: {num(q)}" for n, q in por_quem.most_common())}). '
                f'A maior delas foi {mun(d, maior[0])}, onde {nome_v1} liderou no 1º turno e '
                f'{d.cand[(2, maior[2])]["nome"]} venceu no 2º.')
        for cand in (a, b):
            melhor = max(((m, 100 * c[cand["sq"]] / sum(c.values())) for m, c in mun2.items()
                          if sum(c.values()) >= 1000), key=lambda x: x[1])
            pior = min(((m, 100 * c[cand["sq"]] / sum(c.values())) for m, c in mun2.items()
                        if sum(c.values()) >= 1000), key=lambda x: x[1])
            add(S, f'Reduto e deserto de {cand["nome"]}', pct(melhor[1], 1),
                f'Maior votação proporcional no 2º turno: {pct(melhor[1], 1)} em {mun(d, melhor[0])}. '
                f'Menor: {pct(pior[1], 1)} em {mun(d, pior[0])} (cidades com 1.000+ votos válidos).')
        divididos = sorted(((m, abs(c[a["sq"]] - c[b["sq"]]), sum(c.values())) for m, c in mun2.items()
                            if sum(c.values()) >= 5000), key=lambda x: (x[1], -x[2]))
        if divididos:
            m, dif, tot = divididos[0]
            empates = [x for x in mun2.items() if x[1][a["sq"]] == x[1][b["sq"]] and sum(x[1].values()) > 0]
            txt = (f'Entre cidades com 5.000+ votos válidos, {mun(d, m)} foi a mais rachada: '
                   f'diferença de apenas {num(dif)} voto(s) entre os finalistas em {num(tot)} válidos.')
            if empates:
                txt += f' Empate exato em {len(empates)} cidade(s): ' + ", ".join(mun(d, e[0]) for e in empates[:5]) + "."
            add(S, "A cidade mais dividida do país", f"{num(dif)} voto(s)", txt)
        # estados
        ufs = {k[2][3:]: v for k, v in d.por_mun.items() if k[:2] == (2, "Presidente") and str(k[2]).startswith("UF:")}
        ganhos = collections.Counter(d.cand[(2, vencedor(c))]["nome"] for uf, c in ufs.items() if uf != "ZZ")
        add(S, "Mapa dos estados no 2º turno",
            " × ".join(str(ganhos[c["nome"]]) for c in (a, b)),
            f'{a["nome"]} venceu em {ganhos[a["nome"]]} UFs e {b["nome"]} em {ganhos[b["nome"]]}.')
        zz = ufs.get("ZZ")
        if zz and sum(zz.values()):
            w = vencedor(zz)
            add(S, "O voto dos brasileiros no exterior", pct(100 * zz[w] / sum(zz.values()), 1),
                f'{d.cand[(2, w)]["nome"]} venceu entre os {num(sum(zz.values()))} votos válidos do exterior.')

    # ---------------- Governadores
    S = "Governadores"
    gov1 = {k[2]: v for k, v in d.por_uf.items() if k[:2] == (1, "Governador")}
    gov2 = {k[2]: v for k, v in d.por_uf.items() if k[:2] == (2, "Governador")}
    resultados = []
    for uf, c in gov1.items():
        rodada = gov2.get(uf, c)
        turno = 2 if uf in gov2 else 1
        (w, vw), (s, vs) = rodada.most_common(2)
        tot = sum(rodada.values())
        resultados.append((uf, turno, d.cand[(turno, w)], 100 * vw / tot, 100 * (vw - vs) / tot, vw - vs,
                           d.cand[(turno, s)]))
    if resultados:
        no1 = [r for r in resultados if r[1] == 1]
        add(S, "Resolvidos já no 1º turno", f"{len(no1)} de {len(resultados)}",
            f'{len(no1)} estados elegeram governador no 1º turno; {len(resultados) - len(no1)} foram ao 2º.')
        r = max(resultados, key=lambda x: x[3])
        add(S, "A vitória mais folgada", pct(r[3], 1),
            f'{rot(r[2])} foi eleito com {pct(r[3], 1)} dos votos válidos no {r[1]}º turno.')
        r = min(resultados, key=lambda x: x[4])
        add(S, "A disputa mais apertada", f"{num(r[5])} votos",
            f'{rot(r[2])} venceu {rot(r[6])} no {r[1]}º turno por {num(r[5])} votos ({pct(r[4])} dos válidos).')
        viradas = []
        for uf, c2 in gov2.items():
            lider1 = gov1[uf].most_common(1)[0][0]
            w2 = c2.most_common(1)[0][0]
            if lider1 != w2:
                viradas.append(f'{d.cand[(2, w2)]["nome"]} ({uf}), que ficou em 2º no 1º turno')
        if gov2:
            add(S, "Viradas no 2º turno", str(len(viradas)),
                ("Quem chegou atrás e venceu: " + "; ".join(viradas) + ".") if viradas
                else "Em todos os estados com 2º turno, quem liderou o 1º turno também venceu.")

    # ---------------- Senado
    S = "Senado"
    sen = [c for (t, _), c in d.cand.items() if t == 1 and c["cargo"] == "Senador"]
    if sen:
        top = max(sen, key=lambda c: c["votos"])
        add(S, "O senador mais votado do país", num(top["votos"]),
            f'{rot(top)} recebeu {num(top["votos"])} votos.')
        elsen = [c for c in sen if c["situacao"] in ELEITO]
        # % dos votos dados ao senado no estado (cada eleitor pode ter 2 votos)
        def share(c):
            return 100 * c["votos"] / sum(d.por_uf[(1, "Senador", c["uf"])].values())
        if elsen:
            m = max(elsen, key=share)
            add(S, "Domínio absoluto no estado", pct(share(m), 1),
                f'{rot(m)} ficou com {pct(share(m), 1)} de todos os votos nominais para o Senado no seu estado.')
            m = min(elsen, key=lambda c: c["votos"])
            add(S, "Eleito com menos votos", num(m["votos"]), f'{rot(m)} conquistou a vaga com {num(m["votos"])} votos.')

    # ---------------- Deputados
    for cargo, S in (("Deputado Federal", "Câmara dos Deputados"),
                     ("Deputado Estadual", "Assembleias Legislativas")):
        cs = [c for (t, _), c in d.cand.items() if t == 1 and c["cargo"] == cargo]
        if not cs:
            continue
        eleitos = [c for c in cs if c["situacao"] in ELEITO]
        top = sorted(cs, key=lambda c: -c["votos"])[:5]
        add(S, "Os mais votados do país", num(top[0]["votos"]),
            "; ".join(f'{rot(c)}: {num(c["votos"])}' for c in top) + ".")

        def share(c):
            val = d.detalhe_uf[(1, cargo, c["uf"])]["QT_TOTAL_VOTOS_VALIDOS"]
            return 100 * c["votos"] / val if val else 0
        m = max(cs, key=share)
        add(S, "Maior fatia do eleitorado do próprio estado", pct(share(m), 1),
            f'{rot(m)} sozinho teve {pct(share(m), 1)} dos votos válidos para {cargo.lower()} em {m["uf"]}.')
        if eleitos:
            menos = min(eleitos, key=lambda c: c["votos"])
            fora = max((c for c in cs if c["situacao"] not in ELEITO), key=lambda c: c["votos"])
            add(S, "Eleito com menos votos", num(menos["votos"]),
                f'{rot(menos)} se elegeu com só {num(menos["votos"])} votos, puxado pelo quociente partidário.')
            add(S, "O “azar” do quociente", num(fora["votos"]),
                f'{rot(fora)} teve {num(fora["votos"])} votos e não se elegeu — '
                f'{num(fora["votos"] // max(menos["votos"], 1))}x mais que {menos["nome"]}, que entrou.')
            conc = []
            for c in eleitos:
                if c["uf"] == "DF":  # DF tem um único município
                    continue
                mm = d.mun_eleitos.get(c["sq"])
                if mm and c["votos"]:
                    k, v = mm.most_common(1)[0]
                    conc.append((100 * v / c["votos"], c, k))
            if conc:
                p, c, k = max(conc, key=lambda x: x[0])
                add(S, "Voto de uma cidade só", pct(p, 1),
                    f'{rot(c)} tirou {pct(p, 1)} de seus votos em uma única cidade: {mun(d, k)}.')
            esp = max(eleitos, key=lambda c: len(c["municipios"]))
            add(S, "Votado em todo canto", f'{num(len(esp["municipios"]))} cidades',
                f'{rot(esp)} recebeu votos em {num(len(esp["municipios"]))} municípios de {esp["uf"]}.')
            partidos = collections.Counter(c["partido"] for c in eleitos)
            add(S, "Bancadas eleitas", f'{len(partidos)} partidos',
                "Maiores bancadas: " + ", ".join(f"{p} {n}" for p, n in partidos.most_common(6)) + ".")

        # candidatos aptos com 0 votos: aparecem no cadastro com resultado,
        # mas não somaram nenhum voto nominal válido
        com_voto = {c["sq"] for c in cs if c["votos_brutos"] > 0}
        zerados = [sq for sq, p in d.perfil.items()
                   if p.get("DS_CARGO", "").title() == cargo and p.get("DS_SIT_TOT_TURNO") in ("SUPLENTE", "NÃO ELEITO")
                   and sq not in com_voto]
        um = [c for c in cs if c["votos_brutos"] == 1]
        add(S, "Nem o próprio voto?", num(len(zerados)),
            f'{num(len(zerados))} candidatos a {cargo.lower()} com candidatura válida terminaram com zero votos, '
            f'e {num(len(um))} tiveram exatamente 1 voto.')

    # ---------------- Comparecimento
    S = "Comparecimento, brancos e nulos (1º turno, Presidente)"
    br = d.detalhe_uf.get((1, "Presidente", "BR"))
    if br:
        add(S, "Abstenção no Brasil", pct(100 * br["QT_ABSTENCOES"] / br["QT_APTOS"]),
            f'{num(br["QT_ABSTENCOES"])} de {num(br["QT_APTOS"])} eleitores aptos não votaram. '
            f'Brancos: {num(br["QT_VOTOS_BRANCOS"])}; nulos: {num(br["QT_TOTAL_VOTOS_NULOS"])}.')
        ms = [(k[2:], v) for k, v in d.detalhe.items() if k[:2] == (1, "Presidente") and k[2] != "ZZ" and v["QT_APTOS"] >= 1000]
        taxa = lambda v: 100 * v["QT_ABSTENCOES"] / v["QT_APTOS"]
        hi, lo = max(ms, key=lambda x: taxa(x[1])), min(ms, key=lambda x: taxa(x[1]))
        add(S, "Onde mais (e menos) se faltou", pct(taxa(hi[1]), 1),
            f'Maior abstenção: {mun(d, hi[0])}, {pct(taxa(hi[1]), 1)}. '
            f'Menor: {mun(d, lo[0])}, só {pct(taxa(lo[1]), 1)} (cidades com 1.000+ eleitores).')
        bn = lambda v: 100 * (v["QT_VOTOS_BRANCOS"] + v["QT_TOTAL_VOTOS_NULOS"]) / max(v["QT_COMPARECIMENTO"], 1)
        hi = max(ms, key=lambda x: bn(x[1]))
        add(S, "Campeã de brancos e nulos", pct(bn(hi[1]), 1),
            f'Em {mun(d, hi[0])}, {pct(bn(hi[1]), 1)} de quem foi votar anulou ou votou em branco para presidente.')
        zz = d.detalhe.get((1, "Presidente", "ZZ"), None)
        ext = collections.Counter()
        for k, v in d.detalhe.items():
            if k[:3] == (1, "Presidente", "ZZ"):
                ext.update(v)
        if ext["QT_APTOS"]:
            add(S, "Abstenção no exterior", pct(100 * ext["QT_ABSTENCOES"] / ext["QT_APTOS"], 1),
                f'Dos {num(ext["QT_APTOS"])} eleitores aptos no exterior, só {num(ext["QT_COMPARECIMENTO"])} votaram.')

    # ---------------- Perfil dos eleitos
    S = "Perfil dos eleitos"
    eleitos = [c for c in final.values() if c["situacao"] in ELEITO]
    com_idade = [(idade(d.perfil.get(c["sq"], {}).get("DT_NASCIMENTO")), c) for c in eleitos]
    com_idade = [x for x in com_idade if x[0] is not None]
    if com_idade:
        j = min(com_idade, key=lambda x: x[0]); v = max(com_idade, key=lambda x: x[0])
        add(S, "O mais jovem e o mais velho", f"{j[0]} × {v[0]} anos",
            f'Mais jovem: {rot(j[1])}, {j[0]} anos, {eleito_a(d, j[1])} {j[1]["cargo"].lower()}. '
            f'Mais velho: {rot(v[1])}, {v[0]} anos, {eleito_a(d, v[1])} {v[1]["cargo"].lower()}.')
    for cargo in ("Deputado Federal", "Deputado Estadual", "Senador", "Governador"):
        grupo = [c for c in eleitos if c["cargo"] == cargo]
        if not grupo:
            continue
        mulheres = sum(1 for c in grupo if d.perfil.get(c["sq"], {}).get("DS_GENERO") == "FEMININO")
        add(S, f"Mulheres eleitas — {cargo}", pct(100 * mulheres / len(grupo), 1),
            f'{mulheres} de {len(grupo)} eleitos para {cargo.lower()} são mulheres.')
    ocup = collections.Counter(d.perfil.get(c["sq"], {}).get("DS_OCUPACAO") for c in eleitos)
    ocup.pop(None, None)
    if ocup:
        raras = [o for o, n in ocup.items() if n == 1]
        add(S, "Profissões declaradas pelos eleitos", ocup.most_common(1)[0][0].title(),
            "Mais comuns: " + ", ".join(f"{o.title()} ({n})" for o, n in ocup.most_common(5)) +
            (". Algumas que aparecem uma única vez: " + ", ".join(o.title() for o in sorted(raras)[:8]) + "." if raras else "."))

    # ---------------- Patrimônio
    S = "Patrimônio declarado"
    if d.bens:
        sq, v = d.bens.most_common(1)[0]
        p = d.perfil.get(sq, {})
        bem = d.maior_bem.get(sq, (0, "", ""))
        add(S, "Maior patrimônio declarado", reais(v),
            f'{p.get("NM_URNA_CANDIDATO", sq)} ({p.get("SG_PARTIDO", "?")}-{p.get("SG_UF", "?")}), '
            f'candidatura a {p.get("DS_CARGO", "?").lower()}, declarou {reais(v)} em bens — '
            f'só o item "{bem[1]}: {bem[2]}" vale {reais(bem[0])}. Os valores são autodeclarados e '
            f'o TSE não os confere; cifras assim costumam ser erro de digitação.')
        ric = max(eleitos, key=lambda c: d.bens.get(c["sq"], 0))
        add(S, "O eleito mais rico", reais(d.bens.get(ric["sq"], 0)),
            f'{rot(ric)}, {eleito_a(d, ric)} {ric["cargo"].lower()}, declarou {reais(d.bens.get(ric["sq"], 0))}.')
        zero = [c for c in eleitos if d.bens.get(c["sq"], 0) == 0]
        add(S, "Eleitos sem nenhum bem declarado", num(len(zero)),
            f'{len(zero)} eleitos declararam patrimônio zero' +
            (f', entre eles {", ".join(rot(c) for c in zero[:4])}.' if zero else "."))

    return sec


# --------------------------------------------------------------------------- saída
def gerar_html(secoes, geracao):
    blocos = []
    for nome, itens in secoes.items():
        cards = "".join(
            f'<article class="card"><h3>{html.escape(i["titulo"])}</h3>'
            f'<p class="big">{html.escape(i["destaque"])}</p>'
            f'<p>{html.escape(i["texto"])}</p></article>' for i in itens)
        blocos.append(f'<section><h2>{html.escape(nome)}</h2><div class="grid">{cards}</div></section>')
    fontes = " · ".join(f"{html.escape(k)}: gerado em {html.escape(v)}" for k, v in geracao.items())
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Curiosidades Eleições 2026</title>
<style>
:root{{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#5f5f5a;--card:#fff;--line:#e3e2dc;--accent:#0b6e4f}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#161615;--fg:#ecebe6;--muted:#a3a29b;--card:#20201e;--line:#33332f;--accent:#5fc9a0}}}}
:root[data-theme="dark"]{{--bg:#161615;--fg:#ecebe6;--muted:#a3a29b;--card:#20201e;--line:#33332f;--accent:#5fc9a0}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}}
main{{max-width:1100px;margin:0 auto;padding:32px 16px 64px}}
h1{{font-size:clamp(1.8rem,4vw,2.6rem);margin:0 0 4px}}.sub{{color:var(--muted);margin:0 0 32px}}
h2{{font-size:1.25rem;margin:40px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--accent)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}}
.card h3{{font-size:.95rem;margin:0;color:var(--muted);font-weight:600}}
.big{{font-size:1.6rem;font-weight:700;margin:4px 0 6px;color:var(--accent);font-variant-numeric:tabular-nums}}
.card p{{margin:0}}footer{{margin-top:48px;color:var(--muted);font-size:.85rem}}a{{color:var(--accent)}}
</style></head><body><main>
<h1>Curiosidades das Eleições 2026</h1>
<p class="sub">Calculado a partir dos dados abertos oficiais do Tribunal Superior Eleitoral.</p>
{''.join(blocos)}
<footer>Fonte: <a href="https://dadosabertos.tse.jus.br/dataset/resultados-{ANO}">Portal de Dados Abertos do TSE</a>
— votação nominal por município e zona, detalhe da apuração, candidatos e bens declarados. {fontes}.
Os arquivos do TSE ainda podem ser atualizados (recontagens, decisões judiciais).</footer>
</main></body></html>"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dados", default="dados_tse", help="pasta para os arquivos baixados")
    ap.add_argument("--saida", default=".", help="pasta para o JSON e o HTML")
    ap.add_argument("--atualizar", action="store_true", help="baixar de novo os arquivos do TSE")
    a = ap.parse_args()
    os.makedirs(a.dados, exist_ok=True)
    os.makedirs(a.saida, exist_ok=True)
    arqs = {k: baixar(k, a.dados, a.atualizar) for k in ARQUIVOS}
    d = carregar(arqs)
    secoes = analisar(d)
    with open(os.path.join(a.saida, f"curiosidades_{ANO}.json"), "w", encoding="utf-8") as f:
        json.dump({"geracao_arquivos_tse": d.geracao, "secoes": secoes}, f, ensure_ascii=False, indent=2)
    with open(os.path.join(a.saida, f"curiosidades_{ANO}.html"), "w", encoding="utf-8") as f:
        f.write(gerar_html(secoes, d.geracao))
    for nome, itens in secoes.items():
        print(f"\n== {nome}")
        for i in itens:
            print(f'  • {i["titulo"]}: {i["destaque"]}\n    {i["texto"]}')


if __name__ == "__main__":
    main()
