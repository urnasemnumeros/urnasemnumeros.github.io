// Voto misturado: cidades onde um finalista ficou à frente para presidente e o partido do outro foi o mais votado
// em outro cargo (deputado federal, deputado estadual/distrital ou senador; um cargo por vez, voto com voto).
import { Resumo, Candidato, Curiosidade, num, pct, titulo, esc } from "./util";
import { htmlCard } from "./cards";
import { corCandidato } from "./cores";
import { NOME_UF } from "./agregados";

interface CidadeMistura {
  id: string; nome: string; uf: string; pres: number; votosPres: number; validosPres: number;
  partOutro: number; votosOutro: number; validosDep: number;
}
interface Lado { venceu: number; cruzadas: number; lista: CidadeMistura[]; todas: CidadeMistura[] }
interface Cargo {
  brasil: Record<string, number>; votosBrasil: Record<string, number>; validosBrasil: number;
  lados: Record<string, Lado>; semCandidato: Record<string, string[]>;
}
type NomeCargo = "federal" | "estadual" | "senador";
export interface Mistura { partidos: Record<string, string>; minimo: number; federal: Cargo; estadual: Cargo; senador: Cargo }

const CARGO: Record<NomeCargo, { nome: string; curto: string }> = {
  federal: { nome: "deputado federal", curto: "dep. federal" },
  estadual: { nome: "deputado estadual", curto: "dep. estadual" },
  senador: { nome: "senador", curto: "senador" },
};
const lista = (l: string[]) => l.join(", ").replace(/, ([^,]*)$/, " e $1");

export function criarMistura(r: Resumo, cand: Record<string, Candidato>, finalistas: [string, string], abrir: (id: string) => void, observar: () => void) {
  const m = r.mistura;
  const el = document.getElementById("mistura")!;
  if (!m?.federal?.lados[finalistas[0]]?.todas) {
    el.innerHTML = `<p class="nota">Rode <code>python3 gerar_dados_site.py</code> para gerar estes dados.</p>`;
    return;
  }
  const nome = (sq: string) => titulo(cand[sq]?.n ?? "?");
  const part = (sq: string) => m.partidos[sq];
  let cargo: NomeCargo = "federal";

  const linha = (x: CidadeMistura, sq: string, i: number, outro: string) => `
    <li class="mix" data-cidade="${x.id}">
      <span class="rotulo">${esc(titulo(x.nome))} – ${x.uf}</span>
      <span class="mix-l"><small>${esc(nome(sq))} p/ presidente</small><i class="trilho"><span style="width:${x.pres}%;background:${corCandidato(i)}"></span></i><b class="num">${pct(x.pres)}</b><small class="num">${num(x.votosPres)} de ${num(x.validosPres)}</small></span>
      <span class="mix-l"><small>${esc(part(outro))} p/ ${CARGO[cargo].curto}</small><i class="trilho"><span style="width:${x.partOutro}%;background:${corCandidato(1 - i)}"></span></i><b class="num">${pct(x.partOutro)}</b><small class="num">${num(x.votosOutro)} de ${num(x.validosDep)}</small></span>
    </li>`;

  const desenha = () => {
    const d = m[cargo], c = CARGO[cargo];
    // sem candidato do partido no estado, as cidades do estado saem do quadro do finalista adversário
    const fora = finalistas.map((sq, i) => d.semCandidato[sq].length
      ? `O ${esc(part(sq))} não teve candidato a ${c.nome} em ${lista(d.semCandidato[sq].map((u) => NOME_UF[u] ?? u))}, então as cidades desses estados não entram no quadro “${esc(nome(finalistas[1 - i]))} para presidente, ${esc(part(sq))} para ${c.nome}”.` : "").join(" ");
    el.innerHTML = `<div class="resumo-viradas">${finalistas.map((sq, i) => {
        const outro = finalistas[1 - i], l = d.lados[sq];
        return `<div class="bloco"><b class="num" style="color:${corCandidato(i)}">${num(l.cruzadas)}</b>de ${num(l.venceu)} cidades onde ${esc(nome(sq))} ficou à frente tiveram o ${esc(part(outro))} como partido mais votado para ${c.nome}</div>`;
      }).join("")}</div>
      <div class="listas">${finalistas.map((sq, i) => {
        const outro = finalistas[1 - i], todas = d.lados[sq].todas;
        return `<div class="painel lista"><h4><span class="marca" style="background:${corCandidato(i)}"></span>${esc(nome(sq))} para presidente, <span class="marca" style="background:${corCandidato(1 - i)}"></span>${esc(part(outro))} para ${c.nome}</h4>
          <ol>${todas.slice(0, 10).map((x) => linha(x, sq, i, outro)).join("")}</ol>
          ${todas.length > 10 ? `<button type="button" class="mais" data-lado="${sq}">Mostrar mais (${num(todas.length - 10)} restantes)</button>` : ""}</div>`;
      }).join("")}</div>
      <p class="nota">No Brasil, para ${c.nome}: ${finalistas.map((sq) =>
        `${esc(part(sq))} ${num(d.votosBrasil[sq])} votos (${pct(d.brasil[sq])})`).join(" e ")} de ${num(d.validosBrasil)} votos válidos.
        ${cargo === "senador" ? "Em 2026 cada eleitor deu 2 votos para senador, por isso o total de votos válidos é cerca do dobro do de presidente; as % continuam comparáveis." : ""} ${fora}</p>`;
  };

  el.addEventListener("click", (e) => {
    const alvo = e.target as HTMLElement;
    // cada quadro mostra 10 cidades e vai revelando o resto
    const bt = alvo.closest<HTMLButtonElement>(".mais[data-lado]");
    if (bt) {
      const sq = bt.dataset.lado!, i = finalistas.indexOf(sq), todas = m[cargo].lados[sq].todas;
      const ol = bt.closest(".painel")!.querySelector("ol")!;
      const ja = ol.children.length;
      ol.insertAdjacentHTML("beforeend", todas.slice(ja, ja + 50).map((x) => linha(x, sq, i, finalistas[1 - i])).join(""));
      const resta = todas.length - ol.children.length;
      bt.hidden = resta <= 0;
      bt.textContent = `Mostrar mais (${num(resta)} restantes)`;
      return;
    }
    const li = alvo.closest<HTMLElement>("[data-cidade]");
    if (li) abrir(li.dataset.cidade!);
  });
  const botoes = document.querySelectorAll<HTMLButtonElement>("#mistura-cargo [data-cargo]");
  botoes.forEach((b) => b.addEventListener("click", () => {
    botoes.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    cargo = b.dataset.cargo as NomeCargo;
    desenha();
  }));
  desenha();

  // cards (deputado federal: todo eleitor vota uma vez, em todos os estados)
  const itens: Curiosidade[] = finalistas.map((sq, i) => {
    const outro = finalistas[1 - i], l = m.federal.lados[sq], x = l.todas[0];
    return {
      titulo: `${nome(sq)} para presidente, ${part(outro)} para deputado federal`,
      destaque: `${num(l.cruzadas)} cidades`,
      texto: `Em ${num(l.cruzadas)} das ${num(l.venceu)} cidades onde ${nome(sq)} ficou à frente no 1º turno, o ${part(outro)} foi o partido mais votado para deputado federal.` +
        (x ? ` O caso mais forte: ${titulo(x.nome)}-${x.uf}, com ${pct(x.pres)} para ${nome(sq)} (${num(x.votosPres)} votos) e ${pct(x.partOutro)} para o ${part(outro)} (${num(x.votosOutro)} votos).` : ""),
    };
  });
  document.querySelector("#cidades .cards")!.insertAdjacentHTML("beforeend", itens.map((c) => htmlCard("Cidades", c)).join(""));
  observar();
}
