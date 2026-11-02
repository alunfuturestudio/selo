# Desempenho do selo — Lumina como workload

Investigação local de 2 de novembro de 2026. O código da Lumina e sua baseline são somente leitura.

## Resultado

O parser nativo e os workers são agora o padrão de `selo check`; nenhuma flag de aceleração nem cache persistente é necessária. **19,81 s → 1,67 s**, redução de **91,5%** na mediana da CLI completa. As três execuções do novo padrão ficaram abaixo de dois segundos.

| Execução completa | Mediana | Intervalo das 3 rodadas | Redução |
|---|---:|---:|---:|
| CLI instalada, 0.1.1 | 19,805 s | 19,139–20,032 s | referência |
| Novo padrão, nativo/auto (8 workers neste Mac) | **1,674 s** | **1,654–1,796 s** | **91,5%** |
| Nativo, 2 workers | 2,937 s | 2,926–3,006 s | 85,2% |
| Nativo, 4 workers | 2,050 s | 2,047–2,051 s | 89,6% |
| TypeScript, 4 workers | 3,225 s | 3,199–3,493 s | 83,7% |

Resultados brutos: `results/default-final/summary.json`. A variação entre rodadas não foi escondida; selecionar quatro workers ficou ligeiramente acima de dois segundos nesta série. O padrão automático de oito cumpriu a meta com margem.

O trabalho envolve três checkouts independentes:

- engine: este repositório, baseado em `9c82a92` (`@guilhermesilveira/selo` 0.1.1);
- `packs/selo-eslint-raiz`: baseado em `d420fa89fd1861481e313d6cc72263ab666aea85` (0.1.0);
- `packs/selo-solid`: baseado em `5c0f3ecc46e432cdfa8b7fb26f7a63087e9f5a5d` (0.1.0).

Os packs precisam acompanhar o engine para obter o ganho medido. Nenhum destes pacotes foi publicado e nenhuma PR foi aberta. As versões permanecem sem bump; a mudança de padrão e de suporte a Node requer revisão de release, preferencialmente um próximo minor do engine.

## Método

Apple M5 Pro, 18 CPUs disponíveis, Node v24.22.1, macOS arm64. Cada amostra executa uma CLI em **processo novo**, inclui inicialização, imports, workers, mensagens e encerramento, e varre o projeto inteiro. Três rodadas sequenciais, ordem rotacionada; mediana e intervalo são registrados. Não há cache de medições entre execuções. Não foi esvaziado o cache de arquivos do sistema operacional.

A referência principal é a CLI **instalada na Lumina**, versão 0.1.1. A cópia compilada e intocada do commit original também foi medida como controle. Um loader apenas de benchmark troca os imports dos dois packs pelas cópias locais; não escreve no checkout da Lumina. O design pack da Lumina continua sendo o original.

O benchmark completo verifica:

- 4.270 arquivos descobertos, com a mesma configuração, ignores e isenções;
- **154.491 medições de 15 regras**, com valores, caminhos, linhas, nomes, dados, ordem e agregados idênticos;
- SHA-256 completo das medições/agregados: `2608b661df443f5e4dfde6c72fa19ce9bc8a6d0fbf713c71867a53f8f618fd9c`;
- SHA-256 de fontes/configuração/baseline: `f125518150bfcaf9de5857970c5d3d40619f0573d8112af4808511fd8c4f8687`;
- stdout, stderr e código de saída idênticos. As regressões já existentes continuam falhando; nenhuma baseline é abençoada.

`verify-all-fixtures.mjs` compara também 12 regras dos packs originais em 15 fixtures, com os dois backends e 1/2/4 workers. Há violações positivas das três regras ESLint, JSX, callbacks em atributos/filhos, decorators, namespaces, interfaces, imports, comentários/diretivas, CRLF, Unicode, regex, bigint, shebang e sintaxe inválida. Isso evita aceitar equivalência apenas porque uma regra retorna zero na Lumina.

## Gargalos e mudanças

O perfil inicial gastava cerca de 6 s em cada uma das duas regras ESLint: cada regra reinterpretava cada arquivo. O engine retinha todos os ASTs, e as travessias SOLID revisitavam tokens e comentários sem contribuição para suas métricas.

1. O engine descobre arquivos uma vez e divide uma lista ordenada entre workers. Cada worker processa um arquivo por vez. O merge usa o índice do arquivo de entrada, preservando a ordem inclusive quando uma medição aponta para outro caminho.
2. Oxc faz o parse nativo. O adapter conserva posições e a ordem estrutural usada pelo parser anterior. Erros do parse nativo e propostas de import não compatíveis voltam ao parser original.
3. Tokens e escopos ESLint são produzidos pelo parser original sob demanda. O AST não transfere entre threads.
4. O pack ESLint executa as regras embutidas em uma verificação compartilhada por arquivo, mantém apenas mensagens no `WeakMap` da execução e reaproveita parse compatível. Checagens conservadoras de candidatos evitam ESLint apenas quando não existe nó capaz de disparar a regra. ESLint continua decidindo opções, diretivas, violações, posições e mensagens. O helper isolado continua disponível.
5. O walker SOLID pula metadados lexicais; nenhuma regra, meta, limite, configuração ou ratchet foi removido ou relaxado.

## Limites

A equivalência demonstrada cobre a Lumina, fixtures e testes dos três projetos; não é prova de identidade de parsers em toda sintaxe possível. O backend TypeScript fica disponível para diagnóstico, e novos packs devem validar suas suposições de AST. Regras devem ser puras por arquivo e tratar ASTs como somente leitura. Configs carregam uma vez por worker; estado global mutável entre arquivos não é suportado pela execução paralela.

O runtime nativo requer Node `^20.19.0 || >=22.12.0`, com o binding da plataforma instalado. É uma alteração explícita do suporte mínimo anterior.

Dois workers no Mac **não equivalem a uma máquina com cota de duas CPUs**: o Node também usa threads auxiliares. Não foi medido um runner Linux de duas CPUs e estes resultados não são projeção dos 148 s observados no CI. Nenhum arquivo de CI da Lumina foi alterado.

Memória foi observada separadamente, em uma rodada final: o controle original atingiu 3,76 GiB; o nativo aproximadamente 0,61 GiB com um worker, 1,05 GiB com dois, 1,67 GiB com quatro e 2,82 GiB com oito. Picos variam com o GC; estes números não são medianas de três rodadas. A política automática respeita CPUs disponíveis e limita a oito; `--jobs 2` é adequado para testar em um runner pequeno.

## Validação final e commits locais

**160 testes passaram**: 75 no engine, 54 no pack ESLint e 31 no SOLID. Build, lint e typecheck passaram nos três projetos. A comparação semântica adicional dos 12 rules/15 fixtures também passou. A rodada final de medições completas preservou os dois hashes acima em todos os backends/contagens de workers.

Packs revisáveis em commits locais: ESLint `07c25a4`; SOLID `4fba7ae`. Um resumo pequeno e versionado das medições está em `MEASUREMENTS.json`; os arquivos brutos ficam fora do Git. Não houve push.

## Reprodução

Execute a partir da raiz deste checkout, com os packs locais nas pastas indicadas:

```sh
npm ci
node benchmarks/setup-packs.mjs
# Os dois packs são checkouts próprios. Neste ambiente usam o node_modules
# do engine por symlink relativo; npm ci independente também pode ser usado.
npm run build --prefix packs/selo-solid
npm run build --prefix packs/selo-eslint-raiz
npm test
npm run lint
npm run typecheck
npm test --prefix packs/selo-solid
npm run lint --prefix packs/selo-solid
npm run typecheck --prefix packs/selo-solid
npm test --prefix packs/selo-eslint-raiz
npm run lint --prefix packs/selo-eslint-raiz
npm run typecheck --prefix packs/selo-eslint-raiz
```

Se `benchmarks/original-dist` ainda não existir, `node benchmarks/prepare-reference.mjs` compila o commit original em uma pasta temporária e copia apenas seu dist. O script recusa sobrescrever destino existente. Não faz checkout/reset na árvore de trabalho.

```sh
node benchmarks/prepare-reference.mjs
node benchmarks/verify-all-fixtures.mjs /Users/sergio/workspace/lumina
node benchmarks/run.mjs /Users/sergio/workspace/lumina 3
node benchmarks/cli-benchmark.mjs /Users/sergio/workspace/lumina 3
```

`run.mjs` registra medições completas, fingerprint de entrada, tempo por fase no original, CPU e pico de RSS. Rejeita mudança de entrada, diferença de resultado ou alteração da baseline. `cli-benchmark.mjs` mede a CLI completa e rejeita qualquer diferença de stdout/stderr/código de saída ou alteração da baseline. Perfis e saídas completas ficam em `benchmarks/results/`, ignorados pelo Git e preservados localmente.

## Licença e publicação

A API pública do GitHub retornou `license: null` para `guilhermesilveira/selo`; no commit investigado não há LICENSE/COPYING nem campo `license` em package.json. O repositório é público, mas **não foi identificada uma licença que permita chamá-lo de open source**. As alterações permanecem locais e não houve envio upstream, PR ou publicação.
