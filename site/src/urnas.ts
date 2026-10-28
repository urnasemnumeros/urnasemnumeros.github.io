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

  function tabelaZeradas(sq: string, i: number, t: TurnoUrnas) {
    const z = t.zeradas[sq];
    const outro = finalistas[1 - i];
    const ufs = Object.entries(z.porUf).map(([uf, n]) => `${uf === "ZZ" ? "Exterior" : uf} ${num(n)}`).join(" · ");
    const linhas = z.lista.map((u, j) => `<tr class="clicavel" data-cidade="${u.id}" ${j >= 10 ? "hidden" : ""}>
        <td><b>${esc(u.local)}</b><br><small>${esc(u.end)}</small></td>
        <td>${esc(lugar(u))}<br><small>Zona ${u.zona} · Seção ${u.secao}</small></td>
        <td class="n">${num(votosDe(u, outro))} <small>de ${num(u.validos)}</small><br><small>${pct((100 * votosDe(u, outro)) / u.validos)} p/ ${nome(outro)}</small><br><small>${computados(u.total)}</small></td></tr>`).join("");
    return `<div class="painel">
      <h4><span class="marca" style="background:${corCandidato(i)}"></span>Nenhum voto para ${nome(sq)}</h4>
      <p class="destaque-painel num">${num(z.total)} <small>urnas de ${num(t.secoes)}</small></p>
      ${z.total ? soma(z.votos) : ""}
      <p class="meta">${z.total ? `Por estado: ${ufs}` : "Recebeu votos em todas as urnas."}</p>
      ${z.total ? `<div class="tabela-wrap"><table>
        <thead><tr><th>Local de votação</th><th>Cidade</th><th class="n">Votos válidos</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
        ${z.lista.length > 10 ? `<button type="button" class="mais" data-expandir>Mostrar todas (${num(z.lista.length)})</button>` : ""}
        ${z.total > z.lista.length ? `<p class="nota">Lista com as ${num(z.lista.length)} maiores urnas, ordenadas por votos válidos.</p>` : ""}` : ""}
    </div>`;
  }

  function painelPoucos(sq: string, i: number, t: TurnoUrnas) {
    const p = t.poucos![sq];
    const outro = finalistas[1 - i];
    const max = Math.max(...p.porVotos, 1);
    const colunas = p.porVotos.map((n, v) => `<div class="col" title="${num(n)} urnas com ${v} voto${v === 1 ? "" : "s"}">
        <small class="num">${num(n)}</small><i class="area"><span style="height:${(100 * n) / max}%;background:${corCandidato(i)}"></span></i><b>${v}</b></div>`).join("");
    const ufs = Object.entries(p.porUf).slice(0, 8).map(([uf, n]) => `${uf === "ZZ" ? "Exterior" : uf} ${num(n)}`).join(" · ");
    const linhas = p.lista.map((u, j) => `<tr class="clicavel" data-cidade="${u.id}" ${j >= 10 ? "hidden" : ""}>
        <td><b>${esc(u.local)}</b><br><small>${esc(u.end)}</small></td>
        <td>${esc(lugar(u))}<br><small>Zona ${u.zona} · Seção ${u.secao}</small></td>
        <td class="n">${num(votosDe(u, sq))} <small>de ${num(u.validos)}</small><br><small>${nome(outro)}: ${num(votosDe(u, outro))}</small><br><small>${computados(u.total)}</small></td></tr>`).join("");
    return `<div class="painel">
      <h4><span class="marca" style="background:${corCandidato(i)}"></span>No máximo 10 votos para ${nome(sq)}</h4>
      <p class="destaque-painel num">${num(p.total)} <small>urnas de ${num(t.secoes)} (${pct((100 * p.total) / t.secoes, 2)})</small></p>
      ${p.total ? soma(p.votos) : ""}
      <p class="mini">Quantas urnas deram exatamente 0, 1, 2… 10 votos</p>
      <div class="colunas" role="img" aria-label="Urnas por número de votos para ${nome(sq)}, de 0 a 10">${colunas}</div>
      <p class="meta">${p.total ? `Onde ficam: ${ufs}${Object.keys(p.porUf).length > 8 ? "…" : ""}` : ""}</p>
      ${p.total ? `<p class="mini">As maiores dessas urnas</p><div class="tabela-wrap"><table>
        <thead><tr><th>Local de votação</th><th>Cidade</th><th class="n">Votos para ${nome(sq)}</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
        ${p.lista.length > 10 ? `<button type="button" class="mais" data-expandir>Mostrar mais (${num(p.lista.length)})</button>` : ""}
        ${p.total > p.lista.length ? `<p class="nota">Lista com as ${num(p.lista.length)} maiores urnas (por votos válidos) entre as ${num(p.total)}.</p>` : ""}` : ""}
    </div>`;
  }
  function poucos() {
    const t = dados.turnos[escolha.poucos];
    if (!t.poucos) return `<p class="nota">Rode <code>python3 gerar_dados_site.py</code> para gerar estes dados.</p>`;
    return `<p class="nota">Seções eleitorais em que o candidato recebeu de 0 a 10 votos para presidente no ${escolha.poucos}º turno (só seções com algum voto válido). Toque numa linha para ver a cidade.</p>
      <div class="disputas">${finalistas.map((sq, i) => painelPoucos(sq, i, t)).join("")}</div>`;
  }

  const sinal = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + num(Math.abs(n));

  // ---- a mesma urna nos dois turnos
  /** Tabela de urnas comparadas (1º → 2º turno): 10 linhas visíveis e "Mostrar mais". */
  const tabelaComparadas = (lista: UrnaComparada[]) => `<div class="tabela-wrap"><table>
      <thead><tr><th>Local de votação</th><th>Cidade</th><th class="n">1º → 2º turno</th></tr></thead>
      <tbody>${lista.map((u, j) => `<tr class="clicavel" data-cidade="${u.id}" ${j >= 10 ? "hidden" : ""}>
        <td><b>${esc(u.local)}</b><br><small>${esc(u.end)}</small></td>
        <td>${esc(lugar(u))}<br><small>Zona ${u.zona} · Seção ${u.secao}</small></td>
        <td class="n">${num(u.v1)} → ${num(u.v2)}<br><small>${sinal(u.d)} votos</small></td></tr>`).join("")}</tbody></table></div>
    ${lista.length > 10 ? `<button type="button" class="mais" data-expandir-aos-poucos>Mostrar mais (${num(lista.length - 10)} restantes)</button>` : ""}`;

  /** Quadro de um finalista: total de urnas em que ganhou (ou perdeu) votos, estados e tabela das maiores variações. */
  function painelComparadas(sq: string, i: number, comparadas: number) {
    const c = dados.entreTurnos!.lados[sq].caiu;
    const ufs = Object.entries(c.porUf).slice(0, 8).map(([uf, n]) => `${uf} ${num(n)}`).join(" · ");
    const verbo = "perdeu", maiores = "maiores quedas";
    return `<div class="painel">
      <h4><span class="marca" style="background:${corCandidato(i)}"></span>Urnas em que ${nome(sq)} ${verbo} votos</h4>
      <p class="destaque-painel num">${num(c.total)} <small>urnas de ${num(comparadas)} (${pct((100 * c.total) / comparadas, 1)})</small></p>
      ${c.total && c.cand1 != null ? `<p class="meta">${nome(sq)} teve <b>${num(c.cand1 - c.cand2!)}</b> votos a menos nessas urnas.</p>` : ""}
      <p class="meta">${c.total ? `Onde ficam: ${ufs}${Object.keys(c.porUf).length > 8 ? "…" : ""}` : `Não ${verbo} votos em nenhuma urna.`}</p>
      ${c.total ? `<p class="mini">As ${maiores}</p>${tabelaComparadas(c.lista)}
        ${c.total > c.lista.length ? `<p class="nota">Lista com as ${num(c.lista.length)} ${maiores} entre as ${num(c.total)} urnas.</p>` : ""}` : ""}
    </div>`;
  }
  /** Urnas que viraram para cada finalista: o outro estava à frente no 1º turno, este venceu no 2º. */
  function viradasUrnas() {
    const et = dados.entreTurnos;
    if (!et?.viradas) return `<p class="nota">Rode <code>python3 gerar_dados_site.py</code> para gerar estes dados.</p>`;
    const v1De = (u: UrnaVirada, sq: string) => (idx(sq) === 0 ? u.a1 : u.b1);
    const placar = (a: number, b: number) => `<span style="color:${corCandidato(0)}">${num(a)}</span> × <span style="color:${corCandidato(1)}">${num(b)}</span>`;
    return `<p class="nota">Seções em que um finalista estava à frente do outro no 1º turno e o outro venceu no 2º (comparando só os dois; ${num(et.comparadas)} seções comparadas). Placar: ${nome(finalistas[0])} × ${nome(finalistas[1])}. Variações grandes numa seção costumam vir de mudanças no eleitorado dela (transferências, seções agregadas), não necessariamente de mudança de voto. Toque numa linha para ver a cidade.</p>
      <div class="disputas">${finalistas.map((sq, i) => {
        const c = et.viradas![sq], outro = finalistas[1 - i];
        const ufs = Object.entries(c.porUf).slice(0, 8).map(([uf, n]) => `${uf} ${num(n)}`).join(" · ");
        const linhas = c.lista.map((u, j) => `<tr class="clicavel" data-cidade="${u.id}" ${j >= 10 ? "hidden" : ""}>
          <td><b>${esc(u.local)}</b><br><small>${esc(lugar(u))} · Zona ${u.zona} · Seção ${u.secao}</small></td>
          <td class="n">${placar(v1De(u, finalistas[0]), v1De(u, finalistas[1]))}</td>
          <td class="n">${placar(votosDe(u, finalistas[0]), votosDe(u, finalistas[1]))}</td></tr>`).join("");
        return `<div class="painel">
          <h4><span class="marca" style="background:${corCandidato(1 - i)}"></span>→<span class="marca" style="background:${corCandidato(i)};margin-left:6px"></span>Urnas que viraram para ${nome(sq)}</h4>
          <p class="meta">${nome(outro)} à frente no 1º turno, ${nome(sq)} venceu no 2º.</p>
          <p class="destaque-painel num">${num(c.total)} <small>urnas de ${num(et.comparadas)} (${pct((100 * c.total) / et.comparadas, 1)})</small></p>
          ${c.total && c.cand1 != null ? `<p class="meta">${nome(sq)} teve <b>${num(c.cand2! - c.cand1)}</b> votos a mais nessas urnas.</p>` : ""}
          <p class="meta">${c.total ? `Onde ficam: ${ufs}${Object.keys(c.porUf).length > 8 ? "…" : ""}` : "Nenhuma urna virou para este lado."}</p>
          ${c.total ? `<p class="mini">As maiores viradas</p><div class="tabela-wrap"><table>
            <thead><tr><th>Local de votação</th><th class="n">1º turno</th><th class="n">2º turno</th></tr></thead>
            <tbody>${linhas}</tbody></table></div>
            ${c.lista.length > 10 ? `<button type="button" class="mais" data-expandir-aos-poucos>Mostrar mais (${num(c.lista.length - 10)} restantes)</button>` : ""}
            ${c.total > c.lista.length ? `<p class="nota">Lista com as ${num(c.lista.length)} maiores viradas (pela mudança na diferença de votos) entre as ${num(c.total)} urnas.</p>` : ""}` : ""}
        </div>`;
      }).join("")}</div>`;
  }
  function perdas() {
    const et = dados.entreTurnos;
    if (!et) return "";
    return `<p class="nota">Seções em que o finalista teve menos votos no 2º turno do que no 1º. Quedas grandes costumam vir de mudanças no eleitorado da seção (transferências, seções agregadas): veja o total de votos computados de cada urna. Toque numa linha para ver a cidade.</p>
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
    return `<p class="nota">Seções eleitorais em que o candidato não recebeu um único voto para presidente no ${escolha.zeradas}º turno. Toque numa linha para ver a cidade.</p>
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
    const aos = alvo.closest<HTMLButtonElement>("[data-expandir-aos-poucos]");
    if (aos) {
      const ocultas = [...aos.closest(".painel")!.querySelectorAll("tr[hidden]")];
      ocultas.slice(0, 50).forEach((tr) => tr.removeAttribute("hidden"));
      const resta = ocultas.length - 50;
      if (resta > 0) aos.textContent = `Mostrar mais (${num(resta)} restantes)`;
      else aos.remove();
      return;
    }
    const exp = alvo.closest<HTMLButtonElement>("[data-expandir]");
    if (exp) {
      exp.closest(".painel")!.querySelectorAll("tr[hidden]").forEach((tr) => tr.removeAttribute("hidden"));
      exp.remove();
      return;
    }
    const linha = alvo.closest<HTMLElement>("[data-cidade]");
    if (linha) abrir(linha.dataset.cidade!);
  });
}
