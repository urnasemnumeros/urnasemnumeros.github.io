// Cards de curiosidade compartilháveis: link direto (#id) e download como imagem.
import { toPng } from "html-to-image";
import { Curiosidade, esc, aviso, normalizar } from "./util";

const vistos = new Set<string>();

export function idCard(secao: string, titulo: string) {
  let base = normalizar(`${secao} ${titulo}`).replace(/ +/g, "-").slice(0, 60);
  let id = base, n = 2;
  while (vistos.has(id)) id = `${base}-${n++}`;
  vistos.add(id);
  return id;
}

export function htmlCard(secao: string, c: Curiosidade): string {
  const id = idCard(secao, c.titulo);
  return `<article class="card" id="${id}">
    <p class="rot">${esc(secao)}</p>
    <h4>${esc(c.titulo)}</h4>
    <p class="destaque">${esc(c.destaque)}</p>
    <p class="texto">${esc(c.texto)}</p>
    <p class="fonte-card">Eleições 2026 · dados oficiais do TSE</p>
    <div class="acoes">
      <button type="button" data-acao="link">Copiar link</button>
      <button type="button" data-acao="img">Baixar imagem</button>
    </div>
  </article>`;
}

export function ativarCards() {
  document.addEventListener("click", async (ev) => {
    const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".card .acoes button");
    if (!btn) return;
    const card = btn.closest<HTMLElement>(".card")!;
    if (btn.dataset.acao === "link") {
      const url = `${location.origin}${location.pathname}#${card.id}`;
      try {
        await navigator.clipboard.writeText(url);
        aviso("Link copiado");
      } catch {
        prompt("Copie o link:", url);
      }
      history.replaceState(null, "", `#${card.id}`);
    } else {
      btn.disabled = true;
      try {
        const fundo = getComputedStyle(card).backgroundColor;
        const png = await toPng(card, {
          pixelRatio: 2,
          backgroundColor: fundo,
          filter: (n) => !(n instanceof HTMLElement && n.classList.contains("acoes")),
          style: { opacity: "1", transform: "none", margin: "0" },
        });
        const a = document.createElement("a");
        a.href = png;
        a.download = `eleicoes-2026-${card.id}.png`;
        a.click();
      } catch (e) {
        console.error(e);
        aviso("Não foi possível gerar a imagem");
      } finally {
        btn.disabled = false;
      }
    }
  });

  // animação de entrada
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { e.target.classList.add("visivel"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -40px 0px" });
  const observar = () => document.querySelectorAll(".card:not(.visivel)").forEach((c) => io.observe(c));
  observar();
  return observar;
}
