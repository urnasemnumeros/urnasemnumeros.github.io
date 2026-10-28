# Eleições 2026 em curiosidades

Site interativo com curiosidades das Eleições Gerais de 2026, calculadas a partir dos
**dados abertos oficiais do TSE** (dadosabertos.tse.jus.br) e das malhas do IBGE.

## Estrutura

| Caminho | O que é |
|---|---|
| `tse_curiosidades.py` | Baixa os arquivos do TSE e calcula as curiosidades; gera `curiosidades_2026.html/.json` (relatório simples) |
| `gerar_dados_site.py` | Gera os JSONs do site em `site/public/data/` (usa o script acima) |
| `dados_tse/` | Zips oficiais do TSE (cache; ~470 MB) |
| `dados_ibge/` | Lista de municípios e malhas do IBGE (cache) |
| `site/` | Front-end (Vite + TypeScript + D3) |

## Como rodar

```bash
python3 gerar_dados_site.py          # ~2 min; use --atualizar para baixar de novo do TSE
cd site
npm install
npm run dev                          # http://localhost:5173
```

Para publicar: `npm run build` gera `site/dist/`, uma pasta estática que pode ir para
qualquer hospedagem (GitHub Pages, Netlify, Vercel, servidor próprio).

## Fontes dos dados

- Votação nominal por município e zona, detalhe da apuração, candidatos e bens declarados — TSE.
- Os códigos de município do TSE são ligados aos do IBGE pelo nome; três nomes diferem
  entre as bases e estão mapeados à mão em `NOMES_DIFERENTES`.
- O arquivo de comparecimento do TSE ainda só traz o 1º turno; abstenção é do 1º turno.
- Patrimônio é autodeclarado e não é conferido pelo TSE.
