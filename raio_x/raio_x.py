"""Raio-X eleitoral de um candidato a deputado (federal ou estadual) nas Eleições 2026.

Lê só os arquivos oficiais do TSE já baixados em dados_tse/ e gera um JSON com tudo o que o
relatório mostra. Cada número sai daqui; o modelo HTML só formata.

Uso: python3 raio_x/raio_x.py MG 6 "NIKOLAS FERREIRA"   (UF, cargo 6=federal 7=estadual, nome de urna)
"""
import csv
import io
import json
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TSE = RAIZ / "dados_tse"
MIN_VALIDOS = 1000  # listas em % só com cidades de 1.000+ votos para o cargo, como no site


def ler(zip_nome, csv_nome):
    with zipfile.ZipFile(TSE / zip_nome) as z:
        with z.open(csv_nome) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, encoding="latin1"), delimiter=";")


def main(uf, cargo, nome_urna):
    uf, cargo = uf.upper(), str(cargo)

    # votos de todos os candidatos do cargo, por município (somando zonas e voto em trânsito)
    por_cand = defaultdict(lambda: defaultdict(int))
    info = {}
    zonas_cand = defaultdict(lambda: defaultdict(int))
    for r in ler("votacao_candidato_munzona_2026.zip", f"votacao_candidato_munzona_2026_{uf}.csv"):
        if r["CD_CARGO"] != cargo:
            continue
        sq = r["SQ_CANDIDATO"]
        v = int(r["QT_VOTOS_NOMINAIS_VALIDOS"])
        por_cand[sq][r["CD_MUNICIPIO"]] += v
        info.setdefault(sq, {"nome": r["NM_URNA_CANDIDATO"], "nome_civil": r["NM_CANDIDATO"], "partido": r["SG_PARTIDO"],
                             "numero": r["NR_CANDIDATO"], "situacao": r["DS_SIT_TOT_TURNO"], "cargo": r["DS_CARGO"]})
        zonas_cand[sq][(r["CD_MUNICIPIO"], r["NR_ZONA"])] += v

    alvo = [sq for sq, i in info.items() if i["nome"].upper() == nome_urna.upper()]
    if len(alvo) != 1:
        sys.exit(f"Candidato não encontrado (ou ambíguo): {nome_urna} -> {alvo}")
    sq = alvo[0]
    cand = info[sq]

    # denominador por município: votos para o cargo sem brancos e nulos, no critério da divulgação do TSE
    # (QT_VOTOS_CONCORRENTES = válidos + votos anulados sub judice/apuração em separado)
    validos = defaultdict(int)
    validos_estritos = defaultdict(int)
    nomes = {}
    for r in ler("detalhe_votacao_munzona_2026.zip", f"detalhe_votacao_munzona_2026_{uf}.csv"):
        if r["CD_CARGO"] != cargo:
            continue
        validos[r["CD_MUNICIPIO"]] += int(r["QT_VOTOS_CONCORRENTES"])
        validos_estritos[r["CD_MUNICIPIO"]] += int(r["QT_TOTAL_VOTOS_VALIDOS"])
        nomes[r["CD_MUNICIPIO"]] = r["NM_MUNICIPIO"]

    # votos do partido (nominais + legenda) no estado
    partido_total = 0
    for r in ler("votacao_partido_munzona_2026.zip", f"votacao_partido_munzona_2026_{uf}.csv"):
        if r["CD_CARGO"] == cargo and r["SG_PARTIDO"] == cand["partido"]:
            partido_total += int(r["QT_VOTOS_NOMINAIS_VALIDOS"]) + int(r["QT_TOTAL_VOTOS_LEG_VALIDOS"])

    # municípios do site: liga o código do TSE ao do IBGE e ao contorno do mapa
    munis_site = {m["id"]: m for m in json.loads((RAIZ / "site/public/data/municipios.json").read_text())}
    ibge = {m["id"]: m for m in json.loads((RAIZ / "dados_ibge/municipios.json").read_text())}

    votos = por_cand[sq]
    total = sum(votos.values())
    total_estado = sum(validos.values())
    totais = sorted(((sum(v.values()), s) for s, v in por_cand.items()), reverse=True)
    posicao = 1 + sum(1 for t, s in totais if t > total)

    cidades = []
    for cd, nome in nomes.items():
        mid = f"{uf}{cd}"
        site = munis_site.get(mid)
        meso = None
        if site and site.get("ibge") in ibge:
            meso = ibge[site["ibge"]]["microrregiao"]["mesorregiao"]["nome"]
        v = votos.get(cd, 0)
        cidades.append({"id": mid, "nome": site["nome"] if site else nome.title(), "votos": v, "validos": validos[cd],
                        "pct": 100 * v / validos[cd] if validos[cd] else 0, "meso": meso})

    com_voto = [c for c in cidades if c["votos"] > 0]
    por_votos = sorted(cidades, key=lambda c: -c["votos"])
    elegiveis = [c for c in cidades if c["validos"] >= MIN_VALIDOS]
    por_pct = sorted(elegiveis, key=lambda c: -c["pct"])

    def fatia(n):
        return 100 * sum(c["votos"] for c in por_votos[:n]) / total

    mesos = defaultdict(lambda: {"votos": 0, "validos": 0, "cidades": 0})
    for c in cidades:
        k = c["meso"] or "Sem região (município novo)"
        mesos[k]["votos"] += c["votos"]
        mesos[k]["validos"] += c["validos"]
        mesos[k]["cidades"] += 1
    mesos = sorted(({"nome": k, **v, "pct": 100 * v["votos"] / v["validos"] if v["validos"] else 0,
                     "fatia": 100 * v["votos"] / total} for k, v in mesos.items()), key=lambda m: -m["votos"])

    # a capital por zona eleitoral
    capital_cd = max(nomes, key=lambda cd: validos[cd])
    zonas = sorted(({"zona": int(z), "votos": v} for (cd, z), v in zonas_cand[sq].items() if cd == capital_cd),
                   key=lambda z: -z["votos"])

    saida = {
        "uf": uf, "cargo": cand["cargo"], "candidato": cand, "sq": sq,
        "total": total, "validos_estado": total_estado, "validos_estado_estritos": sum(validos_estritos.values()),
        "pct_estado": 100 * total / total_estado, "posicao": posicao, "candidatos_no_cargo": len(totais),
        "partido_total": partido_total, "fatia_partido": 100 * total / partido_total if partido_total else None,
        "municipios": len(cidades), "municipios_com_voto": len(com_voto),
        "concentracao": {"top1": fatia(1), "top5": fatia(5), "top10": fatia(10), "top20": fatia(20)},
        "top_votos": por_votos[:15], "top_pct": por_pct[:15], "menor_pct": sorted(elegiveis, key=lambda c: c["pct"])[:10],
        "min_validos": MIN_VALIDOS, "mesorregioes": mesos,
        "capital": {"nome": next(c["nome"] for c in cidades if c["id"] == f"{uf}{capital_cd}"), "zonas": zonas,
                    "votos": votos.get(capital_cd, 0)},
        "cidades": [{"id": c["id"], "pct": round(c["pct"], 3), "votos": c["votos"]} for c in cidades],
    }
    destino = RAIZ / "raio_x" / "saida"
    destino.mkdir(exist_ok=True)
    arq = destino / f"{uf.lower()}_{cand['numero']}.json"
    arq.write_text(json.dumps(saida, ensure_ascii=False, indent=1))
    print(f"{cand['nome']} ({cand['partido']}-{uf}): {total:,} votos, {saida['pct_estado']:.2f}%, {posicao}º de {len(totais)} -> {arq}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
