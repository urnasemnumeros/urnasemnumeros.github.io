// Escala divergente vermelho (Lula/PT) <-> azul (Flávio/PL), meio cinza.
// Passos tirados das rampas da paleta de referência (claro e escuro).

const escuro = () =>
  document.documentElement.dataset.theme === "dark" ||
  (document.documentElement.dataset.theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);

const VERMELHO = { claro: ["#f6c2c1", "#ef8d8c", "#e34948", "#a82b2b"], escuro: ["#5c2a29", "#8f3838", "#c44f4f", "#e98a8a"] };
const AZUL = { claro: ["#b7d3f6", "#6da7ec", "#2a78d6", "#184f95"], escuro: ["#1d3557", "#1c5cab", "#3987e5", "#86b6ef"] };
const LARANJA = { claro: ["#fde3d6", "#f7b393", "#eb6834", "#b8441a", "#7a2a0c"], escuro: ["#3f2418", "#7a3a1e", "#b8501f", "#e0703f", "#f5a582"] };
const MEIO = { claro: "#f0efec", escuro: "#383835" };
export const LIMITES_MARGEM = [10, 25, 50]; // pontos percentuais
export const LIMITES_ABST = [15, 20, 25, 30];

export function corMargem(lado: 0 | 1, margemPts: number): string {
  const rampa = (lado === 0 ? VERMELHO : AZUL)[escuro() ? "escuro" : "claro"];
  if (margemPts === 0) return MEIO[escuro() ? "escuro" : "claro"];
  const i = LIMITES_MARGEM.findIndex((l) => margemPts < l);
  return rampa[i === -1 ? 3 : i];
}

export function corAbst(p: number): string {
  const rampa = LARANJA[escuro() ? "escuro" : "claro"];
  const i = LIMITES_ABST.findIndex((l) => p < l);
  return rampa[i === -1 ? 4 : i];
}

export function rampaMargem(lado: 0 | 1) { return (lado === 0 ? VERMELHO : AZUL)[escuro() ? "escuro" : "claro"]; }
export function rampaAbst() { return LARANJA[escuro() ? "escuro" : "claro"]; }
export function corOutro() { return escuro() ? "#199e70" : "#1baf7a"; }
export function corCandidato(lado: number) { return lado === 0 ? "var(--lula)" : lado === 1 ? "var(--flavio)" : "var(--text-3)"; }

// Variação da abstenção entre turnos: verde-azulado (caiu) <-> laranja (subiu), meio cinza.
// Hues diferentes do par vermelho/azul dos candidatos, para não sugerir partido.
const CAIU = { claro: ["#c4ece0", "#7fd3b5", "#1baf7a", "#0f7a54"], escuro: ["#173d31", "#145c45", "#199e70", "#5fcca2"] };
export const LIMITES_VAR = [2, 5, 10]; // pontos percentuais
export function corVarAbst(dpts: number): string {
  const tema = escuro() ? "escuro" : "claro";
  if (Math.abs(dpts) < 0.05) return MEIO[tema];
  const rampa = dpts < 0 ? CAIU[tema] : LARANJA[tema].slice(1);
  const i = LIMITES_VAR.findIndex((l) => Math.abs(dpts) < l);
  return rampa[i === -1 ? 3 : i];
}
export function rampaVar(lado: "caiu" | "subiu") {
  const tema = escuro() ? "escuro" : "claro";
  return lado === "caiu" ? CAIU[tema] : LARANJA[tema].slice(1);
}
