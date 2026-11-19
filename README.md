# ⚙️ Painel Qualidade

Painel de automações do WMS do time de qualidade. Abre em tela cheia dentro do WMS, usando o login de quem está usando. Não precisa instalar nada.

**Instalar:** abra a página do painel (GitHub Pages deste repositório) e arraste o botão para a barra de favoritos.

## Automações
- **📦 On-Hand**: pede o On-Hand Inventory Map ao WMS, junta as planilhas do .zip, remove as zonas `AV, D, DEM, EXZO, MI, MO, OS, RO, TS, RTS` (configurável) e baixa a planilha `.xlsx` pronta, com a aba **Resumo**.

## Como funciona
- `index.html`: página de instalação com o favorito "carregador".
- `painel.js`: o painel. O favorito carrega sempre a versão mais nova daqui, então atualizar este arquivo atualiza todo mundo.
- Tudo roda no navegador, com o login da pessoa. Nenhum dado do WMS é enviado para fora.
