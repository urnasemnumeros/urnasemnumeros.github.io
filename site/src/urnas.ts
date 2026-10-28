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

const lugar = (u: Urna) => (u.uf === "ZZ" ? `${u.mun} (exterior)` : `${u.mun} – ${u.uf}`);

export function criarUrnas(dados: DadosUrnas, cand: Record<string, Candidato>, finalistas: [string, string], abrir: (id: string) => void) {
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

  const celulasUrna = (u: Urna, valor: string) => `<td><b>${esc(u.local)}</b><br><small>${esc(u.end)}</small></td>
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
  const escolha = { zeradas: turno, poucos: turno, mais: turno } as Record<string, string>;
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
  const desenhar: Record<string, () => string> = { zeradas, poucos, mais };

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
    ${seletor("poucos")}<div data-conteudo="poucos">${poucos()}</div>`;
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
