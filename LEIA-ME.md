# Site da Ecoprad

Página de apresentação: boas-vindas, etapas com o texto rolando à esquerda e o recorte de terreno 3D fixo à direita. A demonstração 3D completa fica em `demo/`.

**Visual final:** fundo creme claro com verde #234028, morros e folhas da capa (as folhas flutuam e sobem com a rolagem), céu nos cartões do convite e do rodapé. Fontes: Oswald na marca, Fraunces nos títulos e Inter no texto (em `fonts/`, licença OFL). O 3D é um diorama solto na página, sem moldura.

## Como abrir
- Dê dois cliques em `index.html` (funciona sem internet).
- Pelo link: https://itsgusbabyyyy.github.io/SENAI-Ecoprad/ abre o site, e a demonstração fica em https://itsgusbabyyyy.github.io/SENAI-Ecoprad/demo/

## Como funciona
- Cada bloco de texto em `index.html` tem `data-u`, o momento da história 3D (de 0 a 10, as mesmas etapas da demonstração), e `data-v`, a vista da câmera.
- Ao rolar, o 3D anda até a etapa do bloco que está no meio da tela e, entre um bloco e outro, faz a transição. Enquanto o bloco está parado, a cena gira de leve para os lados.
- No celular, o 3D fica fixo no alto e o texto passa por baixo.

## Arquivos
- `index.html`, `css/site.css`: página e layout.
- `src/site.js`: fonte da rolagem e do 3D. `site.js` é o arquivo gerado a partir dela:
  `npx esbuild src/site.js --bundle --format=iife --minify --alias:three=./lib/three.module.js --outfile=site.js`
- `terreno.js`: motor do terreno, o mesmo da demonstração.
- `assets/`: emblema, folhas e morros tirados da capa da apresentação, em webp (os PNG originais ficaram em `slides_ref/img/originais_site`).
- `demo/`: a demonstração 3D interativa, com botão para voltar ao site.

Testes: `projeto_erosao/testes/testar_site.py` (38 verificações no computador e no celular).
