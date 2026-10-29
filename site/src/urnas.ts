// Urnas (seções eleitorais) zeradas e com mais votos, por turno.
import { Candidato, num, pct, titulo, esc, barra, cabecalhoMedia, media } from "./util";
import { corCandidato } from "./cores";

interface Urna {
  id: string; uf: string; mun: string; zona: number; secao: number; local: string; end: string;
  a: number; b: number; validos: number; total: number;
}
interface TurnoUrnas {
  secoes: number;
  zeradas: Record<string, { total: number; porUf: Record<string, number>; lista: Urna[]; votos?: number }>;
  maisVotos: Record<string, Urna[]>;
  /** seções com no máximo 10 votos para o finalista; porVotos[i] = seções com exatamente i votos */
  poucos?: Record<string, { total: number; porVotos: number[]; porUf: Record<string, number>; lista: Urna[]; votos?: number }>;
}
type UrnaComparada = Urna & { v1: number; v2: number; d: number; validos1: number; validos2: number; total1?: number };
interface Comparadas { total: number; porUf: Record<string, number>; lista: UrnaComparada[]; votos1?: number; votos2?: number; cand1?: number; cand2?: number }
interface LadoEntreTurnos { caiu: Comparadas }
type UrnaVirada = Urna & { a1: number; b1: number; validos1: number; validos2: number; total1?: number };
export interface DadosUrnas {
  finalistas: [string, string]; turnos: Record<string, TurnoUrnas>;
  /** a mesma urna nos dois turnos */
  entreTurnos?: { comparadas: number; lados: Record<string, LadoEntreTurnos>;
    /** urnas que viraram para cada finalista (o outro estava à frente no 1º turno) */
    viradas?: Record<string, { total: number; porUf: Record<string, number>; lista: UrnaVirada[]; cand1?: number; cand2?: number }> };
}

/** Seção eleitoral identificada nos logs (logs_urna.py), sem os votos dos finalistas. */
type UrnaLog = Pick<Urna, "id" | "uf" | "mun" | "zona" | "secao" | "local" | "end"> & { votos: number } & Record<string, number | string>;
interface ListaLogs { total: number; porUf: Record<string, number>; lista: UrnaLog[] }
interface TurnoLogs {
  secoes: number;
  contadores: Record<string, number>;
  /** votos computados por hora do dia (horário de Brasília); horaSem = os liberados sem biometria */
  hora: number[]; horaSem: number[];
  duracaoMedia: number; duracaoMax: { s: number; urna: UrnaLog | null };
  porUf: Record<string, { secoes: number; votos: number; semBio: number; semBioFalhou: number; depois17: number }>;
  maioriaSemBio: ListaLogs; depois17: ListaLogs;
  /** seções em que os votos computados no log batem (ou não) com o comparecimento oficial */
  confere: { iguais: number; diferentes: number };
}
export interface DadosLogs { dia: Record<string, string>; turnos: Record<string, TurnoLogs> }

const lugar = (u: Pick<Urna, "uf" | "mun">) => (u.uf === "ZZ" ? `${u.mun} (exterior)` : `${u.mun} – ${u.uf}`);

export function criarUrnas(dados: DadosUrnas, cand: Record<string, Candidato>, finalistas: [string, string], abrir: (id: string) => void, dadosLogs?: DadosLogs) {
  const el = document.getElementById("urnas-app")!;
  // as colunas a/b do arquivo seguem a ordem do gerador; o site pode ter invertido (PT sempre em vermelho)
  const idx = (sq: string) => dados.finalistas.indexOf(sq);
  const votosDe = (u: Urna, sq: string) => (idx(sq) === 0 ? u.a : u.b);
  const nome = (sq: string) => esc(titulo(cand[sq]?.n ?? "?"));
  const turno = dados.turnos["2"] ? "2" : "1";
  // votos computados = todos os votos para presidente na urna, com brancos e nulos
  const computados = (n?: number) => (n == null ? "" : `${num(n)} votos computados`);
  const soma = (n?: number) => (n == null ? "" : `<p class="meta">Essas urnas somam <b>${num(n)}</b> votos computados.</p>`);

  // ---- ranking por estado e janela com as 10 maiores, nos quadros da perda de votos para baixo
  const TOP = 10;
  const ICONE_URNA = `<svg class="ico-urna" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 11V4.6a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1V11"/><path d="M10.6 7.2l1.2 1.2 2.1-2.3"/><path d="M3.5 11h17"/><path d="M5 11v8.4A1.6 1.6 0 0 0 6.6 21h10.8a1.6 1.6 0 0 0 1.6-1.6V11"/><path d="M9.5 15h5"/></svg>`;
  interface Janela {
    titulo: string; cab: string[]; total: number; porUf: Record<string, number>; cor: string; nota: string;
    linhas: { uf: string; id: string; celulas: string }[];
  }
  const janelas: Janela[] = [];
  /** "As 10 maiores urnas", "As 4 urnas" ou "A urna", conforme quantas existem. */
  const quantas = (total: number, coisa = "urna") =>
    total >= TOP ? `As ${TOP} maiores ${coisa}s` : total === 1 ? `A ${coisa}` : `As ${total} ${coisa}s`;
  const ufsOrdenadas = (porUf: Record<string, number>) =>
    Object.entries(porUf).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  /** Ranking dos estados pela quantidade de urnas e o botão que abre a janela com as 10 maiores. */
  function rankingEBotao(j: Janela, rotulo: string) {
    const k = janelas.push(j) - 1;
    const ufs = ufsOrdenadas(j.porUf);
    const max = ufs[0]?.[1] ?? 1;
    const VISIVEIS = 8;
    const linha = ([uf, n]: [string, number], pos: number) => `<li><button type="button" class="uf-linha" data-janela="${k}" data-uf="${uf}"
        aria-label="${uf}: ${num(n)} urnas. Ver as maiores">
        <span class="uf-pos num">${pos + 1}º</span><b class="uf-sigla">${uf}</b>
        <span class="uf-trilho"><span style="width:${(100 * n) / max}%;background:${j.cor}"></span></span>
        <span class="uf-n num">${num(n)}</span><small class="uf-pct num">${pct((100 * n) / j.total, 1)}</small></button></li>`;
    return `<p class="mini">Ranking dos estados por quantidade de urnas</p>
      <ol class="ranking-uf">${ufs.slice(0, VISIVEIS).map(linha).join("")}</ol>
      ${ufs.length > VISIVEIS ? `<details class="ranking-mais"><summary>Ver os outros ${ufs.length - VISIVEIS} estados</summary>
        <ol class="ranking-uf">${ufs.slice(VISIVEIS).map((e, p) => linha(e, p + VISIVEIS)).join("")}</ol></details>` : ""}
      <button type="button" class="botao-urna" data-janela="${k}" data-uf="">${ICONE_URNA}<span>${rotulo}</span><span class="seta" aria-hidden="true">→</span></button>`;
  }

  let dlg: HTMLDialogElement | null = null;
  function desenharJanela(uf: string) {
    const j = janelas[Number(dlg!.dataset.janela)];
    const ok = j.linhas.filter((l) => !uf || l.uf === uf).slice(0, TOP);
    const nUf = uf ? j.porUf[uf] ?? 0 : j.total;
    const opcoes = [["", j.total] as [string, number], ...ufsOrdenadas(j.porUf)]
      .map(([u, n]) => `<option value="${u}" ${u === uf ? "selected" : ""}>${u ? `${u} · ${num(n)} urnas` : `Todos os estados · ${num(n)} urnas`}</option>`).join("");
    const falta = uf && ok.length < Math.min(TOP, nUf);
    dlg!.innerHTML = `<div class="janela-cab">
        <span class="janela-icone" style="background:${j.cor}">${ICONE_URNA}</span>
        <div><h3>${j.titulo}</h3><p class="meta">${uf ? `${uf} · ${num(nUf)} urnas` : `Brasil · ${num(j.total)} urnas`}</p></div>
        <button type="button" class="janela-fechar" data-fechar aria-label="Fechar">×</button>
      </div>
      <label class="janela-filtro"><span>Estado</span><select>${opcoes}</select></label>
      ${ok.length ? `<div class="tabela-wrap"><table>
        <thead><tr><th class="n">#</th>${j.cab.map((c, i) => `<th${i === j.cab.length - 1 ? ' class="n"' : ""}>${c}</th>`).join("")}</tr></thead>
        <tbody>${ok.map((l, i) => `<tr class="clicavel" data-cidade="${l.id}"><td class="n pos">${i + 1}</td>${l.celulas}</tr>`).join("")}</tbody></table></div>`
        : `<p class="meta">Nenhuma urna de ${uf} está entre as ${num(j.linhas.length)} da lista.</p>`}
      <p class="nota">${falta ? `Só ${ok.length} das ${num(nUf)} urnas de ${uf} estão entre as ${num(j.linhas.length)} da lista. ` : ""}${j.nota} Toque numa linha para ver a cidade.</p>`;
  }
  function abrirJanela(k: number, uf: string) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "janela-urnas";
      document.body.append(dlg);
      dlg.addEventListener("click", (e) => {
        const alvo = e.target as HTMLElement;
        // clique fora da caixa (no fundo escurecido) também fecha
        if (alvo === dlg || alvo.closest("[data-fechar]")) return dlg!.close();
        const linha = alvo.closest<HTMLElement>("[data-cidade]");
        if (linha) { dlg!.close(); abrir(linha.dataset.cidade!); }
      });
      dlg.addEventListener("change", (e) => desenharJanela((e.target as HTMLSelectElement).value));
    }
    dlg.dataset.janela = String(k);
    desenharJanela(uf);
    dlg.showModal();
  }

  const celulasUrna = (u: Pick<Urna, "uf" | "mun" | "zona" | "secao" | "local" | "end">, valor: string) => `<td><b>${esc(u.local)}</b><br><small>${esc(u.end)}</small></td>
        <td>${esc(lugar(u))}<br><small>Zona ${u.zona} · Seção ${u.secao}</small></td>
        <td class="n">${valor}</td>`;

  function tabelaZeradas(sq: string, i: number, t: TurnoUrnas) {
    const z = t.zeradas[sq];
    const outro = finalistas[1 - i];
    const janela: Janela = {
      titulo: `${quantas(z.total)} sem voto para ${nome(sq)}`, cab: ["Local de votação", "Cidade", "Votos válidos"],
      total: z.total, porUf: z.porUf, cor: corCandidato(i),
      nota: `Urnas ordenadas por votos válidos (${escolha.zeradas}º turno).`,
      linhas: z.lista.map((u) => ({ uf: u.uf, id: u.id, celulas: celulasUrna(u,
        `${num(votosDe(u, outro))} <small>de ${num(u.validos)}</small><br><small>${pct((100 * votosDe(u, outro)) / u.validos)} p/ ${nome(outro)}</small><br><small>${computados(u.total)}</small>`) })),
    };
    return `<div class="painel">
      <h4><span class="marca" style="background:${corCandidato(i)}"></span>Nenhum voto para ${nome(sq)}</h4>
      <p class="destaque-painel num">${num(z.total)} <small>urnas de ${num(t.secoes)}</small></p>
      ${z.total ? soma(z.votos) : ""}
      ${z.total ? rankingEBotao(janela, `Ver ${quantas(z.total).toLowerCase()}`) : `<p class="meta">Recebeu votos em todas as urnas.</p>`}
    </div>`;
  }

  function painelPoucos(sq: string, i: number, t: TurnoUrnas) {
    const p = t.poucos![sq];
    const outro = finalistas[1 - i];
    const max = Math.max(...p.porVotos, 1);
    const colunas = p.porVotos.map((n, v) => `<div class="col" title="${num(n)} urnas com ${v} voto${v === 1 ? "" : "s"}">
        <small class="num">${num(n)}</small><i class="area"><span style="height:${(100 * n) / max}%;background:${corCandidato(i)}"></span></i><b>${v}</b></div>`).join("");
    const janela: Janela = {
      titulo: `${quantas(p.total)} com até 10 votos para ${nome(sq)}`, cab: ["Local de votação", "Cidade", `Votos p/ ${nome(sq)}`],
      total: p.total, porUf: p.porUf, cor: corCandidato(i),
      nota: `Urnas ordenadas por votos válidos (${escolha.poucos}º turno).`,
      linhas: p.lista.map((u) => ({ uf: u.uf, id: u.id, celulas: celulasUrna(u,
        `${num(votosDe(u, sq))} <small>de ${num(u.validos)}</small><br><small>${nome(outro)}: ${num(votosDe(u, outro))}</small><br><small>${computados(u.total)}</small>`) })),
    };
    return `<div class="painel">
      <h4><span class="marca" style="background:${corCandidato(i)}"></span>No máximo 10 votos para ${nome(sq)}</h4>
      <p class="destaque-painel num">${num(p.total)} <small>urnas de ${num(t.secoes)} (${pct((100 * p.total) / t.secoes, 2)})</small></p>
      ${p.total ? soma(p.votos) : ""}
      <p class="mini">Quantas urnas deram exatamente 0, 1, 2… 10 votos</p>
      <div class="colunas" role="img" aria-label="Urnas por número de votos para ${nome(sq)}, de 0 a 10">${colunas}</div>
      ${p.total ? rankingEBotao(janela, `Ver ${quantas(p.total).toLowerCase()}`) : ""}
    </div>`;
  }
  function poucos() {
    const t = dados.turnos[escolha.poucos];
    if (!t.poucos) return `<p class="nota">Rode <code>python3 gerar_dados_site.py</code> para gerar estes dados.</p>`;
    return `<p class="nota">Seções eleitorais em que o candidato recebeu de 0 a 10 votos para presidente no ${escolha.poucos}º turno (só seções com algum voto válido). Toque num estado ou no botão da urna para ver as maiores.</p>
      <div class="disputas">${finalistas.map((sq, i) => painelPoucos(sq, i, t)).join("")}</div>`;
  }

  const sinal = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + num(Math.abs(n));

  // ---- a mesma urna nos dois turnos
  /** Quadro de um finalista: total de urnas em que perdeu votos, ranking dos estados e janela com as maiores quedas. */
  function painelComparadas(sq: string, i: number, comparadas: number) {
    const c = dados.entreTurnos!.lados[sq].caiu;
    const janela: Janela = {
      titulo: `${quantas(c.total, "queda")} de ${nome(sq)}`, cab: ["Local de votação", "Cidade", "1º → 2º turno"],
      total: c.total, porUf: c.porUf, cor: corCandidato(i),
      nota: "Quedas grandes costumam vir de mudanças no eleitorado da seção (transferências, seções agregadas).",
      linhas: c.lista.map((u) => ({ uf: u.uf, id: u.id, celulas: celulasUrna(u, `${num(u.v1)} → ${num(u.v2)}<br><small>${sinal(u.d)} votos</small>`) })),
    };
    return `<div class="painel">
      <h4><span class="marca" style="background:${corCandidato(i)}"></span>Urnas em que ${nome(sq)} perdeu votos</h4>
      <p class="destaque-painel num">${num(c.total)} <small>urnas de ${num(comparadas)} (${pct((100 * c.total) / comparadas, 1)})</small></p>
      ${c.total && c.cand1 != null ? `<p class="meta">${nome(sq)} teve <b>${num(c.cand1 - c.cand2!)}</b> votos a menos nessas urnas.</p>` : ""}
      ${c.total ? rankingEBotao(janela, `Ver ${quantas(c.total, "queda").toLowerCase()}`) : `<p class="meta">Não perdeu votos em nenhuma urna.</p>`}
    </div>`;
  }
  /** Urnas que viraram para cada finalista: o outro estava à frente no 1º turno, este venceu no 2º. */
  function viradasUrnas() {
    const et = dados.entreTurnos;
    if (!et?.viradas) return `<p class="nota">Rode <code>python3 gerar_dados_site.py</code> para gerar estes dados.</p>`;
    const v1De = (u: UrnaVirada, sq: string) => (idx(sq) === 0 ? u.a1 : u.b1);
    const placar = (a: number, b: number) => `<span style="color:${corCandidato(0)}">${num(a)}</span> × <span style="color:${corCandidato(1)}">${num(b)}</span>`;
    return `<p class="nota">Seções em que um finalista estava à frente do outro no 1º turno e o outro venceu no 2º (comparando só os dois; ${num(et.comparadas)} seções comparadas). Variações grandes numa seção costumam vir de mudanças no eleitorado dela (transferências, seções agregadas), não necessariamente de mudança de voto. Toque num estado ou no botão da urna para ver as maiores viradas.</p>
      <div class="disputas">${finalistas.map((sq, i) => {
        const c = et.viradas![sq], outro = finalistas[1 - i];
        const janela: Janela = {
          titulo: `${quantas(c.total, "virada")} para ${nome(sq)}`, cab: ["Local de votação", "1º turno", "2º turno"],
          total: c.total, porUf: c.porUf, cor: corCandidato(i),
          nota: `Ordenadas pela mudança na diferença de votos. Placar: ${nome(finalistas[0])} × ${nome(finalistas[1])}.`,
          linhas: c.lista.map((u) => ({ uf: u.uf, id: u.id, celulas: `<td><b>${esc(u.local)}</b><br><small>${esc(lugar(u))} · Zona ${u.zona} · Seção ${u.secao}</small></td>
            <td class="n" data-rot="1º">${placar(v1De(u, finalistas[0]), v1De(u, finalistas[1]))}</td>
            <td class="n" data-rot="2º">${placar(votosDe(u, finalistas[0]), votosDe(u, finalistas[1]))}</td>` })),
        };
        return `<div class="painel">
          <h4><span class="marca" style="background:${corCandidato(1 - i)}"></span>→<span class="marca" style="background:${corCandidato(i)};margin-left:6px"></span>Urnas que viraram para ${nome(sq)}</h4>
          <p class="meta">${nome(outro)} à frente no 1º turno, ${nome(sq)} venceu no 2º.</p>
          <p class="destaque-painel num">${num(c.total)} <small>urnas de ${num(et.comparadas)} (${pct((100 * c.total) / et.comparadas, 1)})</small></p>
          ${c.total && c.cand1 != null ? `<p class="meta">${nome(sq)} teve <b>${num(c.cand2! - c.cand1)}</b> votos a mais nessas urnas.</p>` : ""}
          ${c.total ? rankingEBotao(janela, `Ver ${quantas(c.total, "virada").toLowerCase()}`) : `<p class="meta">Nenhuma urna virou para este lado.</p>`}
        </div>`;
      }).join("")}</div>`;
  }
  function perdas() {
    const et = dados.entreTurnos;
    if (!et) return "";
    return `<p class="nota">Seções em que o finalista teve menos votos no 2º turno do que no 1º. Quedas grandes costumam vir de mudanças no eleitorado da seção (transferências, seções agregadas). Toque num estado ou no botão da urna para ver as maiores quedas.</p>
      <div class="disputas">${finalistas.map((sq, i) => painelComparadas(sq, i, et.comparadas)).join("")}</div>`;
  }

  const fatia = (sq: string) => (u: Urna) => `${pct((100 * votosDe(u, sq)) / Math.max(u.validos, 1))} dos válidos`;

  function maisVotos(rot: string, lista: Urna[], valor: (u: Urna) => number, cor: string, detalhe: (u: Urna) => string) {
    const max = Math.max(...lista.map(valor), 1);
    // média simples da % dos votos válidos do candidato nas urnas da lista
    const cab = cabecalhoMedia(rot, pct(media(lista.map((u) => (100 * valor(u)) / Math.max(u.validos, 1)))), "média dos válidos");
    return `<div class="painel lista quebra">${cab}<ol>${lista.map((u) => barra(
      `${esc(u.local)}<br><small>${esc(lugar(u))} · Zona ${u.zona} · Seção ${u.secao} · ${detalhe(u)}</small>`,
      `${num(valor(u))}<small>votos</small>`,
      valor(u) / max, cor, `data-cidade="${u.id}"`, "li")).join("")}</ol></div>`;
  }

  // Cada tópico tem o próprio seletor de turno, logo abaixo do título, e troca só o próprio conteúdo.
  const turnos = ["2", "1"].filter((t) => dados.turnos[t]);
  const escolha = { zeradas: turno, poucos: turno, mais: turno, logs: turno } as Record<string, string>;
  const seletor = (topico: string) => `<div class="alternar" role="group" aria-label="Turno">
      ${turnos.map((t) => `<button type="button" data-topico="${topico}" data-turno-urna="${t}" aria-pressed="${t === escolha[topico]}">${t}º turno</button>`).join("")}
    </div>`;

  function zeradas() {
    const t = dados.turnos[escolha.zeradas];
    return `<p class="nota">Seções eleitorais em que o candidato não recebeu um único voto para presidente no ${escolha.zeradas}º turno. Toque num estado ou no botão da urna para ver as maiores.</p>
      <div class="disputas">${finalistas.map((sq, i) => tabelaZeradas(sq, i, t)).join("")}</div>`;
  }
  function mais() {
    const t = dados.turnos[escolha.mais];
    return `<div class="listas">
        ${finalistas.map((sq, i) => maisVotos(`Mais votos para ${nome(sq)}`, t.maisVotos[sq], (u) => votosDe(u, sq), corCandidato(i), fatia(sq))).join("")}
      </div>`;
  }
  // ---- logs das urnas: eventos registrados pela urna ao longo do dia (sem identificar eleitor nem voto)
  const duracao = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`);
  function horas(t: TurnoLogs) {
    // colunas das 8h às 16h; antes das 8h (se houver) e das 17h em diante (fila) ficam agrupadas
    const faixas: { rot: string; n: number; sem: number; titulo: string }[] = [];
    const soma = (a: number[], de: number, ate: number) => a.slice(de, ate).reduce((x, y) => x + y, 0);
    // votos antes das 8h são só algumas urnas com o relógio adiantado: abaixo de 0,01% entram na coluna das 8h
    const antes = soma(t.hora, 0, 8), antesSem = soma(t.horaSem, 0, 8);
    const juntar = antes < soma(t.hora, 0, 24) / 1e4;
    if (antes && !juntar) faixas.push({ rot: "<8h", n: antes, sem: antesSem, titulo: "antes das 8h" });
    for (let h = 8; h < 17; h++) faixas.push({ rot: `${h}h`, n: t.hora[h] + (h === 8 && juntar ? antes : 0),
      sem: t.horaSem[h] + (h === 8 && juntar ? antesSem : 0), titulo: `das ${h}h às ${h + 1}h` });
    faixas.push({ rot: "17h+", n: soma(t.hora, 17, 24), sem: soma(t.horaSem, 17, 24), titulo: "depois das 17h (eleitores que já estavam na fila)" });
    const max = Math.max(...faixas.map((f) => f.n), 1);
    const total = faixas.reduce((x, f) => x + f.n, 0);
    const cols = faixas.map((f) => `<div class="col" title="${f.titulo}: ${num(f.n)} votos (${pct((100 * f.n) / total)}), ${num(f.sem)} sem biometria (${pct((100 * f.sem) / Math.max(f.n, 1))})">
        <small class="num">${f.n >= 1e6 ? `${(f.n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : num(f.n)}</small>
        <i class="area"><span style="height:${(100 * f.n) / max}%"><em style="height:${(100 * f.sem) / Math.max(f.n, 1)}%"></em></span></i>
        <b>${f.rot}</b><small class="num pct-hora">${pct((100 * f.n) / total, 0)}</small></div>`).join("");
    return `<div class="painel">
      <h4>Votos por faixa de horário</h4>
      <p class="meta">Horário de Brasília. Cada coluna é uma hora: “9h” são os votos computados das 9h às 9h59.</p>
      <div class="colunas horas" style="grid-template-columns:repeat(${faixas.length},1fr)" role="img"
        aria-label="Votos por hora: ${faixas.map((f) => `${f.titulo}, ${num(f.n)}`).join("; ")}">${cols}</div>
      <p class="legenda-horas"><span><i class="q-bio"></i>com biometria</span><span><i class="q-sem"></i>sem biometria</span></p>
    </div>`;
  }
  function estadosSemBio(t: TurnoLogs) {
    const ufs = Object.entries(t.porUf).map(([uf, u]) => [uf, (100 * u.semBio) / Math.max(u.votos, 1), u] as const)
      .sort((a, b) => b[1] - a[1]);
    const max = ufs[0]?.[1] || 1;
    const VISIVEIS = 8;
    const linha = ([uf, p, u]: (typeof ufs)[number], pos: number) => `<li><div class="uf-linha" title="${uf}: ${num(u.semBio)} de ${num(u.votos)} votos sem biometria">
        <span class="uf-pos num">${pos + 1}º</span><b class="uf-sigla">${uf}</b>
        <span class="uf-trilho"><span style="width:${(100 * p) / max}%;background:var(--sembio)"></span></span>
        <span class="uf-n num">${pct(p, 1)}</span><small class="uf-pct num">${num(u.semBio)}</small></div></li>`;
    return `<div class="painel">
      <h4><span class="marca" style="background:var(--sembio)"></span>Votos sem biometria por estado</h4>
      <p class="meta">Porcentagem dos votos de cada estado em que o eleitor foi liberado pelo mesário.</p>
      <ol class="ranking-uf">${ufs.slice(0, VISIVEIS).map(linha).join("")}</ol>
      ${ufs.length > VISIVEIS ? `<details class="ranking-mais"><summary>Ver os outros ${ufs.length - VISIVEIS} estados</summary>
        <ol class="ranking-uf">${ufs.slice(VISIVEIS).map((e, p) => linha(e, p + VISIVEIS)).join("")}</ol></details>` : ""}
    </div>`;
  }
  function logs() {
    const t = dadosLogs!.turnos[escolha.logs];
    const c = (k: string) => t.contadores[k] ?? 0;
    const votos = c("votos");
    const p = (n: number) => pct((100 * n) / Math.max(votos, 1), 1);
    const stat = (rot: string, n: string, extra = "", dica = "") => `<div class="stat${dica ? " tem-dica\" tabindex=\"0" : ""}"><span>${rot}</span><b class="num">${n}</b>${extra ? `<small>${extra}</small>` : ""}${dica ? `<div class="dica" role="tooltip">${dica}</div>` : ""}</div>`;
    const dm = t.duracaoMax.urna;
    const maioria = t.maioriaSemBio, depois = t.depois17;
    const jMaioria: Janela = {
      titulo: `${maioria.total >= TOP ? `As ${TOP} urnas` : quantas(maioria.total)} com mais votos sem biometria`, cab: ["Local de votação", "Cidade", "Sem biometria"],
      total: maioria.total, porUf: maioria.porUf, cor: "var(--sembio)",
      nota: `Só seções com 50 votos ou mais, ordenadas pela porcentagem sem biometria (${escolha.logs}º turno). “Digital falhou”: o eleitor tentou a digital e não foi reconhecido. Quando quase todos falham na mesma urna, o mais provável é problema no leitor biométrico; quando quase ninguém tentou, são eleitores sem digital cadastrada.`,
      linhas: maioria.lista.map((u) => ({ uf: u.uf, id: u.id, celulas: celulasUrna(u,
        `${num(u.semBio as number)} <small>de ${num(u.votos)}</small><br><small>${pct((100 * (u.semBio as number)) / u.votos)}</small><br><small>digital falhou: ${num(u.falhou as number)}</small>`) })),
    };
    const jDepois: Janela = {
      titulo: `${depois.total >= TOP ? `As ${TOP} urnas` : quantas(depois.total)} que votaram até mais tarde`, cab: ["Local de votação", "Cidade", "Último voto"],
      total: depois.total, porUf: depois.porUf, cor: "var(--text-2)",
      nota: `Ordenadas pelo horário do último voto (Brasília, ${escolha.logs}º turno). Quem está na fila às 17h recebe senha e vota.`,
      linhas: depois.lista.map((u) => ({ uf: u.uf, id: u.id, celulas: celulasUrna(u,
        `${u.ultimo}<br><small>${num(u.depois as number)} voto${u.depois === 1 ? "" : "s"} depois das 17h</small><br><small>de ${num(u.votos)} no dia</small>`) })),
    };
    return `<p class="nota">O log é o diário de bordo de cada urna: registra, com data e hora, cada passo do dia (eleitor habilitado, digital pedida, voto computado…). Não registra quem votou nem em quem. Os números abaixo foram contados em ${num(t.secoes)} logs de seções no Brasil, ${dadosLogs!.dia[escolha.logs]}.</p>
      <p class="mini">Como o eleitor foi liberado para votar</p>
      <div class="stats logs-stats">
        ${stat("Votos computados", num(votos), "", "Cada linha “O voto do eleitor foi computado” no log. É o comparecimento contado pela própria urna, e bate com o número oficial do TSE em quase todas as seções.")}
        ${stat("Com biometria", p(votos - c("semBio")), `${num(votos - c("semBio"))} votos`, "A urna leu a digital e reconheceu o eleitor sozinha, sem o mesário precisar liberar o voto manualmente.")}
        ${stat("Sem biometria", p(c("semBio")), `${num(c("semBio"))} votos liberados pelo mesário`, "O eleitor votou sem ser reconhecido pela digital: o mesário conferiu um documento com foto e liberou a urna. É a soma dos dois quadros seguintes.")}
        ${stat("Digital não reconhecida", p(c("semBioFalhou")), `${num(c("semBioFalhou"))}: tentou a digital e o mesário liberou`, "O eleitor tem digital cadastrada, a urna pediu o dedo, mas nenhuma tentativa bateu. Pode ser dedo ressecado, calejado ou sujo, ou leitor com defeito.")}
        ${stat("Sem digital cadastrada", p(c("semBioSemDigital")), `${num(c("semBioSemDigital"))}: liberados direto pelo mesário`, "A urna nem pediu a digital: o eleitor não tem biometria no cadastro da Justiça Eleitoral. O mesário libera direto, após conferir o documento.")}
        ${stat("Biometria na 2ª tentativa ou depois", p(c("bioRepetiu")), `${num(c("bioRepetiu"))} votos`, "A digital foi reconhecida, mas não de primeira: a urna pediu o dedo de novo uma ou mais vezes antes de liberar.")}
        ${stat("Identificados pelo CPF", p(c("cpf")), `${num(c("cpf"))}; os demais, pelo título`, "O mesário digitou o CPF do eleitor em vez do número do título para encontrá-lo na lista da seção.")}
      </div>
      <p class="mini">Outros eventos registrados</p>
      <div class="stats logs-stats">
        ${stat("Corrigiram o voto", num(c("corrigiu")), "apertaram Corrige na tela de confirmação", "Vezes em que o eleitor apertou a tecla laranja Corrige na tela de confirmação, para refazer o número de algum cargo.")}
        ${stat("Teclas indevidas", num(c("teclaIndevida")), "teclas sem efeito naquela tela", "Teclas apertadas numa tela em que não fazem nada, como Confirma sem ter digitado número. A urna ignora e registra.")}
        ${stat("Eleitor parado na urna", num(c("inativo")), "avisos de eleitor sem atividade", "Avisos de que o eleitor ficou um tempo sem apertar nenhuma tecla. Costumam aparecer com eleitores com dúvida ou dificuldade.")}
        ${stat("Já tinham votado", num(c("jaVotou")), "título ou CPF de quem já votou na seção", "O mesário digitou um título ou CPF de alguém que já tinha votado naquela seção. Em geral é erro de digitação ou eleitor que voltou por engano.")}
        ${stat("Impedidos de votar", num(c("impedido")), "título cancelado, suspenso ou em trânsito", "Eleitores encontrados na seção mas bloqueados pela urna: título cancelado, direitos políticos suspensos ou eleitor em trânsito em outro lugar.")}
        ${stat("Eleitor não encontrado", num(c("naoEncontrado")), "título ou CPF que não é da seção", "O título ou CPF digitado não existe na lista daquela seção. Normalmente o eleitor estava no local errado.")}
        ${stat("Saíram sem votar", num(c("suspenso")), "suspensos pelo mesário sem confirmar voto", "O eleitor foi liberado mas não terminou o voto, e o mesário cancelou a votação dele. Ele fica como faltoso nessa seção.")}
        ${stat("Voto com áudio", num(c("audio")), "fone de ouvido para eleitor com deficiência visual", "Eleitores com deficiência visual cadastrada: a urna ativa o áudio e eles ouvem pelo fone os números e nomes digitados.")}
        ${stat("Justificativas na urna", num(c("justificativa")), "", "Eleitores fora do seu domicílio eleitoral que justificaram a ausência numa urna, em vez de votar.")}
        ${stat("Urnas substituídas", num(c("substituida")), "trocadas por uma urna de contingência durante o dia", "Urnas que deram defeito e foram trocadas por uma de contingência. Os votos já registrados são transferidos e a votação continua na nova urna.")}
        ${stat("Urnas que usaram bateria", num(c("bateria")), "rodaram na bateria interna em algum momento", "Urnas que funcionaram na bateria interna em algum momento do dia, geralmente por queda de energia ou tomada desligada.")}
        ${stat("Votos depois das 17h", num(c("depois17")), "eleitores que estavam na fila", "A votação encerra às 17h (Brasília), mas quem já está na fila recebe senha e vota. Horários convertidos para Brasília.")}
        ${stat("Tempo médio na cabine", duracao(t.duracaoMedia), "da liberação ao voto computado", "Tempo entre o eleitor ser liberado e o voto ser computado, em média. Ficam de fora casos acima de 1 hora, que são falhas.")}
        ${dm ? stat("Voto mais demorado", duracao(t.duracaoMax.s), `${esc(lugar(dm))}, zona ${dm.zona}, seção ${dm.secao}`, "O maior tempo entre liberar o eleitor e computar o voto, desconsiderando casos acima de 1 hora.") : ""}
      </div>
      <div class="disputas logs-paineis">
        ${horas(t)}
        ${estadosSemBio(t)}
      </div>
      <div class="disputas logs-paineis">
        <div class="painel">
          <h4><span class="marca" style="background:var(--sembio)"></span>Mais da metade dos votos sem biometria</h4>
          <p class="destaque-painel num">${num(maioria.total)} <small>urnas com 50+ votos</small></p>
          ${maioria.total ? rankingEBotao(jMaioria, "Ver as com mais votos sem biometria") : `<p class="meta">Nenhuma urna.</p>`}
        </div>
        <div class="painel">
          <h4><span class="marca" style="background:var(--text-2)"></span>Votos depois das 17h</h4>
          <p class="destaque-painel num">${num(depois.total)} <small>urnas de ${num(t.secoes)} (${pct((100 * depois.total) / t.secoes, 1)})</small></p>
          ${depois.total ? rankingEBotao(jDepois, "Ver as que votaram até mais tarde") : `<p class="meta">Nenhuma urna.</p>`}
        </div>
      </div>
      <p class="nota">Liberar o eleitor sem biometria é previsto em lei: acontece quando a digital não é reconhecida depois de quatro tentativas (o mesário confere um dado pessoal e libera) ou quando o eleitor não tem digital cadastrada. Os votos contados nos logs batem com o comparecimento oficial em ${num(t.confere.iguais)} das ${num(t.confere.iguais + t.confere.diferentes)} seções.</p>`;
  }

  const desenhar: Record<string, () => string> = { zeradas, poucos, mais, logs };

  el.innerHTML = `
    <h3 class="sub">As urnas com mais votos</h3>
    ${seletor("mais")}<div data-conteudo="mais">${mais()}</div>
    <h3 class="sub">Urnas que viraram: um finalista à frente no 1º turno, o outro venceu no 2º</h3>
    <div>${viradasUrnas()}</div>
    <h3 class="sub">Urnas em que cada finalista perdeu votos do 1º para o 2º turno</h3>
    <div>${perdas()}</div>
    <h3 class="sub">Urnas zeradas: nenhum voto para um dos finalistas</h3>
    ${seletor("zeradas")}<div data-conteudo="zeradas">${zeradas()}</div>
    <h3 class="sub">Urnas com no máximo 10 votos para um finalista</h3>
    ${seletor("poucos")}<div data-conteudo="poucos">${poucos()}</div>
    ${dadosLogs?.turnos[turno] ? `<h3 class="sub">O que os logs das urnas registram: biometria, eventos e horários</h3>
    ${seletor("logs")}<div data-conteudo="logs">${logs()}</div>` : ""}`;
  el.addEventListener("click", (e) => {
    const alvo = e.target as HTMLElement;
    const bt = alvo.closest<HTMLButtonElement>("[data-turno-urna]");
    if (bt) {
      const topico = bt.dataset.topico!;
      escolha[topico] = bt.dataset.turnoUrna!;
      el.querySelectorAll(`[data-topico="${topico}"]`).forEach((x) => x.setAttribute("aria-pressed", String(x === bt)));
      el.querySelector(`[data-conteudo="${topico}"]`)!.innerHTML = desenhar[topico]();
      return;
    }
    const jan = alvo.closest<HTMLButtonElement>("[data-janela]");
    if (jan) { abrirJanela(Number(jan.dataset.janela), jan.dataset.uf ?? ""); return; }
    const linha = alvo.closest<HTMLElement>("[data-cidade]");
    if (linha) abrir(linha.dataset.cidade!);
  });
}
