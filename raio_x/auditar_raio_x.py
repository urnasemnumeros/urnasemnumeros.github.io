"""Confere um Raio-X gerado por raio_x.py contra a API oficial de divulgação do TSE (resultados.tse.jus.br).

Para cada município: votos do candidato e votos computados para o cargo (sem brancos e nulos).
Também confere o total do estado. Fonte independente dos arquivos de dados abertos usados no cálculo.

Uso: python3 raio_x/auditar_raio_x.py raio_x/saida/mg_2222.json
"""
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ELEICAO = {"6": "6259", "7": "6259"}  # deputados federal e estadual: eleição estadual 2026
BASE = "https://resultados.tse.jus.br/oficial/ele2026/{e}/dados/{uf}/{uf}{mun}-c{c:04d}-e{e:0>6}-u.json"


def buscar(uf, mun, cargo):
    url = BASE.format(e=ELEICAO[cargo], uf=uf.lower(), mun=mun, c=int(cargo))
    for _ in range(3):
        try:
            return json.load(urllib.request.urlopen(url, timeout=30))
        except Exception:
            continue
    raise RuntimeError(f"não consegui baixar {url}")


def votos_do(j, sq, numero):
    for a in j["carg"][0]["agr"]:
        for p in a["par"]:
            for c in p["cand"]:
                if c.get("sqcand") == sq or c.get("n") == numero:
                    return int(c["vap"])
    return 0  # candidato sem votos no município não aparece


def main(arq):
    d = json.load(open(arq))
    uf, sq, numero = d["uf"], d["sq"], d["candidato"]["numero"]
    cargo = "6" if "Federal" in d["cargo"] else "7"
    validos = {c["id"]: c for c in d["top_votos"] + d["top_pct"] + d["menor_pct"]}

    def conferir(c):
        j = buscar(uf, c["id"][2:], cargo)
        api_v, api_vvc = votos_do(j, sq, numero), int(j["v"]["vvc"])
        esperado_vvc = validos[c["id"]]["validos"] if c["id"] in validos else None
        ok = api_v == c["votos"] and (esperado_vvc is None or api_vvc == esperado_vvc)
        return ok, c["id"], c["votos"], api_v

    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(conferir, d["cidades"]))
    erros = [r for r in res if not r[0]]
    soma_api = sum(r[3] for r in res)
    print(f"municípios conferidos: {len(res)}  divergências: {len(erros)}")
    print(f"soma da API: {soma_api:,}  total do relatório: {d['total']:,}  {'OK' if soma_api == d['total'] else 'DIFERENTE'}")
    for e in erros[:20]:
        print("  divergência:", e)
    return 0 if not erros and soma_api == d["total"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
