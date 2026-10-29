#!/usr/bin/env python3
"""Lê os logs das urnas eletrônicas (log.jez) publicados pelo TSE e gera site/public/data/logs.json.

O TSE publica, por UF e turno, um zip com os arquivos de cada seção (BU, RDV, log...). Os zips somam
mais de 100 GB por turno; este script não os salva: lê o índice de cada zip por HTTP Range e baixa só
os trechos que contêm os logs, em blocos grandes e em paralelo. O resultado de cada UF fica em cache
em dados_tse/logs/ (dá para interromper e continuar depois).

O log registra eventos com data e hora, nunca quem votou nem em quem. Daqui saem:
  - votos habilitados por biometria x liberados pelo mesário sem biometria
  - outros eventos (CPF, voto corrigido, eleitor que já tinha votado, impedido, tecla indevida...)
  - votos por faixa de horário (horário de Brasília)
  - urnas com mais votos sem biometria e urnas que receberam votos depois das 17h

Uso:
    python3 logs_urna.py [--turnos 1,2] [--ufs AC,SP] [--refazer]
"""
import argparse
import collections
import csv
import io
import json
import os
import re
import struct
import sys
import time
import urllib.request
import zipfile
import zlib
from concurrent.futures import ProcessPoolExecutor, as_completed

import tse_curiosidades as tse

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, "site", "public", "data", "logs.json")
CACHE = os.path.join(AQUI, "dados_tse", "logs")
URL_ZIP = ("https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes{ano}/arqurnatot/"
           "bu_imgbu_logjez_rdv_vscmr_{ano}_{turno}t_{uf}.zip")
DIA = {1: "04/10/2026", 2: "25/10/2026"}
UFS = ("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO").split()
# horas a somar ao horário local da urna para chegar ao de Brasília
FUSO = {"AC": 2, "AM": 1, "MS": 1, "MT": 1, "RO": 1, "RR": 1}
FUSO_MUNICIPIO = {("PE", 30015): -1}  # Fernando de Noronha, 1h à frente de Brasília
BLOCO = 48 << 20  # bytes por pedido HTTP
NOME = re.compile(r"o\d{5}([a-z]{2})(\d{5})(\d{4})(\d{4})-log\.jez$")
ENCERRA = 17 * 60  # votação vai até as 17h de Brasília
MIN_VOTOS_LISTA = 50  # seções pequenas demais distorcem as porcentagens
MAX_LISTA = 300


# ---------------------------------------------------------------- download por HTTP Range
def abrir(url, ini=None, fim=None, tentativas=5):
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"Range": f"bytes={ini}-{fim}"} if ini is not None else {})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception:
            if t == tentativas - 1:
                raise
            time.sleep(2 * (t + 1))


class ArquivoRemoto(io.RawIOBase):
    """Arquivo somente leitura sobre HTTP Range; basta para o zipfile ler o índice (diretório central)."""

    def __init__(self, url):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
            self.tamanho = int(r.headers["Content-Length"])

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, o, de=0):
        self.pos = o if de == 0 else self.pos + o if de == 1 else self.tamanho + o
        return self.pos

    def readinto(self, b):
        n = min(len(b), self.tamanho - self.pos)
        if n <= 0:
            return 0
        d = abrir(self.url, self.pos, self.pos + n - 1)
        b[:len(d)] = d
        self.pos += len(d)
        return len(d)


def blocos_de_logs(url):
    """Agrupa os logs do zip em blocos contíguos de ~BLOCO bytes: [(ini, fim, [(nome, offset, tamanho)])]."""
    remoto = ArquivoRemoto(url)
    infos = sorted(zipfile.ZipFile(io.BufferedReader(remoto, 1 << 20)).infolist(), key=lambda i: i.header_offset)
    fins = [i.header_offset for i in infos[1:]] + [remoto.tamanho]
    blocos, atual = [], None
    for i, fim in zip(infos, fins):
        if not NOME.search(i.filename):
            continue
        if atual is None or fim - atual[0] > BLOCO:
            atual = [i.header_offset, fim, []]
            blocos.append(atual)
        atual[1] = fim
        atual[2].append((i.filename, i.header_offset, i.compress_size, i.compress_type))
    return blocos


def membro(dados, ofs, tam, tipo):
    """Conteúdo de um membro do zip a partir do cabeçalho local, dentro de um bloco já baixado."""
    nome_len, extra_len = struct.unpack("<HH", dados[ofs + 26:ofs + 30])
    ini = ofs + 30 + nome_len + extra_len
    bruto = dados[ini:ini + tam]
    return zlib.decompress(bruto, -15) if tipo == zipfile.ZIP_DEFLATED else bruto


# ---------------------------------------------------------------- leitura de um log
def minutos(hora):
    return int(hora[0:2]) * 60 + int(hora[3:5])


def ler_log(texto, dia, fuso_uf):
    """Resume o dia da eleição de uma seção. Horários em minutos do dia, já no horário de Brasília."""
    linhas = [l.split("\t") for l in texto.splitlines() if l.startswith(dia)]
    c = collections.Counter()
    # urna de contingência assumiu a seção durante o dia (a original quebrou)
    if any(len(p) > 4 and p[4].startswith("Início do procedimento de contingência") for p in linhas):
        c["substituida"] = 1
    linhas = [p for p in linhas if len(p) > 4 and p[3] == "VOTA"]
    hora = [0] * 24
    hora_sem = [0] * 24
    votos_t = []  # (minuto local, segundos de votação, sem biometria)
    ep = {}
    seg = lambda h: int(h[0:2]) * 3600 + int(h[3:5]) * 60 + int(h[6:8])
    for p in linhas:
        h, msg = p[0][11:19], p[4]
        if msg.startswith("Aguardando digitação do identificador"):
            ep = {}
        elif msg.startswith("Identificador digitado pelo mesário foi: (CPF)"):
            ep["cpf"] = True
        elif msg.startswith("Solicita digital. Tentativa"):
            ep["tent"] = ep.get("tent", 0) + 1
        elif msg.startswith("Tipo de habilitação do eleitor [biom"):
            ep["bio"] = True
        elif msg.startswith("Solicitação de dado pessoal do eleitor para habilitação manual"):
            ep["manual"] = True
        elif msg == "Eleitor foi habilitado":
            ep["hab"] = seg(h)
        elif msg == "O voto do eleitor foi computado":
            sem = not ep.get("bio")
            c["votos"] += 1
            if sem:
                c["semBio"] += 1
                c["semBioFalhou" if ep.get("tent") else "semBioSemDigital"] += 1
            elif ep.get("tent", 1) > 1:
                c["bioRepetiu"] += 1
            if ep.get("cpf"):
                c["cpf"] += 1
            dur = seg(h) - ep["hab"] if "hab" in ep else None
            votos_t.append((minutos(h), dur, sem))
            ep = {}
        elif msg.startswith("Eleitor corrigiu na tela de confirmação"):
            c["corrigiu"] += 1
        elif msg.startswith("Eleitor foi suspenso e não confirmou"):
            c["suspenso"] += 1
        elif msg.startswith("O eleitor identificado já votou"):
            c["jaVotou"] += 1
        elif msg.startswith("Eleitor impedido"):
            c["impedido"] += 1
        elif msg.startswith("Eleitor não encontrado para o identificador"):
            c["naoEncontrado"] += 1
        elif msg == "Tecla indevida pressionada":
            c["teclaIndevida"] += 1
        elif msg.startswith("Eleitor sem atividade por"):
            c["inativo"] += 1
        elif msg == "Justificativa recebida":
            c["justificativa"] += 1
        elif msg.startswith("Áudio ativado conforme cadastro"):
            c["audio"] += 1
        elif msg == "Urna operando na bateria interna":
            c["bateria"] = 1
        elif msg == "Votação suspensa":
            c["votacaoSuspensa"] += 1
    if not votos_t:
        return None
    # fuso: o da UF; no AM metade do estado está 1h atrás de Manaus, então decide pelo 1º voto
    fuso = fuso_uf
    if fuso_uf == 1 and min(m for m, _, _ in votos_t) < 7 * 60 - 30:
        fuso = 2
    durs = [d for _, d, _ in votos_t if d is not None and 0 <= d < 3600]
    ultimo = 0
    for m, _, sem in votos_t:
        m += fuso * 60
        hora[min(m // 60, 23)] += 1
        if sem:
            hora_sem[min(m // 60, 23)] += 1
        ultimo = max(ultimo, m)
    c["depois17"] = sum(1 for m, _, _ in votos_t if m + fuso * 60 >= ENCERRA)
    return {"c": dict(c), "hora": hora, "horaSem": hora_sem, "ultimo": ultimo,
            "durSoma": sum(durs), "durN": len(durs), "durMax": max(durs, default=0)}


def texto_do_jez(bruto):
    """Texto do log. Se a urna foi substituída durante o dia, o log da urna original vem como outro .jez
    dentro deste; os dois juntos somam os votos da seção."""
    jez = zipfile.ZipFile(io.BytesIO(bruto))
    partes = []
    for n in sorted(jez.namelist(), key=lambda n: not n.endswith(".jez")):  # urna original primeiro
        d = jez.read(n)
        partes.append(texto_do_jez(d) if n.endswith(".jez") else d.decode("latin1"))
    return "\n".join(partes)


def processar_bloco(url, ini, fim, membros, dia, fuso):
    dados = abrir(url, ini, fim - 1)
    out = []
    for nome, ofs, tam, tipo in membros:
        uf, mun, zona, secao = NOME.search(nome).groups()
        try:
            texto = texto_do_jez(membro(dados, ofs - ini, tam, tipo))
        except Exception as e:  # log corrompido: conta e segue
            out.append((uf.upper(), int(mun), int(zona), int(secao), {"erro": str(e)}))
            continue
        out.append((uf.upper(), int(mun), int(zona), int(secao),
                    ler_log(texto, dia, FUSO_MUNICIPIO.get((uf.upper(), int(mun)), fuso))))
    return out


# ---------------------------------------------------------------- agregação
def processar_uf(turno, uf, pool):
    caminho = os.path.join(CACHE, f"{turno}t_{uf}.json")
    url = URL_ZIP.format(ano=tse.ANO, turno=turno, uf=uf)
    blocos = blocos_de_logs(url)
    t0, baixado = time.time(), 0
    secoes, erros = [], 0
    futuros = [pool.submit(processar_bloco, url, ini, fim, m, DIA[turno], FUSO.get(uf, 0)) for ini, fim, m in blocos]
    for f in as_completed(futuros):
        for _, mun, zona, secao, r in f.result():
            if r is None:
                continue
            if "erro" in r:
                erros += 1
                continue
            secoes.append([mun, zona, secao, r])
        baixado += 1
        print(f"\r  {turno}º turno {uf}: {baixado}/{len(blocos)} blocos, {len(secoes)} seções, "
              f"{time.time() - t0:.0f}s", end="", file=sys.stderr)
    print(file=sys.stderr)
    res = {"turno": turno, "uf": uf, "erros": erros, "secoes": secoes}
    with open(caminho + ".tmp", "w") as f:
        json.dump(res, f, separators=(",", ":"))
    os.replace(caminho + ".tmp", caminho)
    return res


def nomes_das_secoes(pasta):
    """(turno, uf, mun, zona, seção) -> (município, local, endereço), do detalhe de votação por seção."""
    zip_det = tse.baixar("detalhe_secao", pasta, False,
                         url=f"{tse.CDN}/detalhe_votacao_secao/detalhe_votacao_secao_{tse.ANO}.zip")
    nomes = {}
    with zipfile.ZipFile(zip_det) as z:
        with z.open(f"detalhe_votacao_secao_{tse.ANO}_BR.csv") as bruto:
            for r in csv.DictReader(io.TextIOWrapper(bruto, encoding="latin1", newline=""), delimiter=";"):
                if r["CD_CARGO"] == "1":
                    nomes[(int(r["NR_TURNO"]), r["SG_UF"], int(r["CD_MUNICIPIO"]), int(r["NR_ZONA"]), int(r["NR_SECAO"]))] = (
                        tse.titulo(r["NM_MUNICIPIO"]), tse.titulo(r["NM_LOCAL_VOTACAO"]),
                        tse.titulo(r["DS_LOCAL_VOTACAO_ENDERECO"]), int(r["QT_COMPARECIMENTO"]))
    return nomes


def resumir_turno(turno, por_uf, nomes):
    total = collections.Counter()
    hora, hora_sem = [0] * 24, [0] * 24
    dur_soma = dur_n = 0
    dur_max = (0, None)
    uf_res = {}
    semBio, depois = [], []
    confere = difere = 0
    for uf, res in por_uf.items():
        cu = collections.Counter()
        for mun, zona, secao, r in res["secoes"]:
            c = r["c"]
            cu.update(c)
            cu["secoes"] += 1
            for i in range(24):
                hora[i] += r["hora"][i]
                hora_sem[i] += r["horaSem"][i]
            dur_soma += r["durSoma"]
            dur_n += r["durN"]
            k = (turno, uf, mun, zona, secao)
            if r["durMax"] > dur_max[0]:
                dur_max = (r["durMax"], k)
            oficial = nomes.get(k)
            if oficial:  # votos computados no log x comparecimento oficial da seção
                if oficial[3] == c.get("votos", 0):
                    confere += 1
                else:
                    difere += 1
            if c.get("votos", 0) >= MIN_VOTOS_LISTA:
                semBio.append((c.get("semBio", 0) / c["votos"], k, c))
            if c.get("depois17"):
                depois.append((r["ultimo"], k, c))
        total.update(cu)
        uf_res[uf] = {"secoes": cu["secoes"], "votos": cu["votos"], "semBio": cu["semBio"],
                      "semBioFalhou": cu["semBioFalhou"], "depois17": cu["depois17"]}

    def urna(k, extra):
        _, uf, mun, zona, secao = k
        m, local, end, _ = nomes.get(k, ("?", "?", "", 0))
        return {"id": f"{uf}{mun}", "uf": uf, "mun": m, "zona": zona, "secao": secao, "local": local, "end": end, **extra}

    def lista(itens, filtro, chave, extra):
        sel = sorted((x for x in itens if filtro(x)), key=chave)
        por = collections.Counter(x[1][1] for x in sel)
        return {"total": len(sel), "porUf": dict(por), "lista": [urna(x[1], extra(x)) for x in sel[:MAX_LISTA]]}

    hm = lambda m: f"{m // 60:02d}:{m % 60:02d}"
    print(f"  {turno}º turno: votos do log = comparecimento oficial em {confere} seções, diferem em {difere}",
          file=sys.stderr)
    return {
        "secoes": total["secoes"],
        "contadores": {k: v for k, v in total.items() if k != "secoes"},
        "hora": hora, "horaSem": hora_sem,
        "duracaoMedia": round(dur_soma / max(dur_n, 1), 1),
        "duracaoMax": {"s": dur_max[0], "urna": urna(dur_max[1], {}) if dur_max[1] else None},
        "porUf": uf_res,
        "confere": {"iguais": confere, "diferentes": difere},
        "maioriaSemBio": lista(semBio, lambda x: x[0] > 0.5, lambda x: (-x[0], -x[2]["votos"]),
                               lambda x: {"votos": x[2]["votos"], "semBio": x[2].get("semBio", 0),
                                          "falhou": x[2].get("semBioFalhou", 0)}),
        "depois17": lista(depois, lambda x: True, lambda x: (-x[0], -x[2]["depois17"]),
                          lambda x: {"votos": x[2]["votos"], "depois": x[2]["depois17"], "ultimo": hm(x[0])}),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--turnos", default="1,2")
    ap.add_argument("--ufs", default=",".join(UFS))
    ap.add_argument("--refazer", action="store_true", help="ignora o cache de dados_tse/logs/")
    ap.add_argument("--processos", type=int, default=10)
    a = ap.parse_args()
    os.makedirs(CACHE, exist_ok=True)
    turnos = [int(t) for t in a.turnos.split(",")]
    ufs = a.ufs.upper().split(",")
    resultado = {}
    with ProcessPoolExecutor(a.processos) as pool:
        for turno in turnos:
            por_uf = {}
            for uf in ufs:
                caminho = os.path.join(CACHE, f"{turno}t_{uf}.json")
                if os.path.exists(caminho) and not a.refazer:
                    with open(caminho) as f:
                        por_uf[uf] = json.load(f)
                else:
                    por_uf[uf] = processar_uf(turno, uf, pool)
            resultado[turno] = por_uf
    print("Nomes dos locais de votação...", file=sys.stderr)
    nomes = nomes_das_secoes(os.path.join(AQUI, "dados_tse"))
    saida = {"dia": {str(t): DIA[t] for t in turnos},
             "turnos": {str(t): resumir_turno(t, por_uf, nomes) for t, por_uf in resultado.items()}}
    with open(SAIDA, "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  logs.json: {os.path.getsize(SAIDA) / 1e6:.1f} MB", file=sys.stderr)


if __name__ == "__main__":
    main()
