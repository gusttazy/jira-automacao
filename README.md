# 🤖 Jira Ticket Triage Automation

Automação inteligente para triagem de tickets em boards Kanban do **Jira Service Management**, desenvolvida com **Node.js**, **TypeScript** e **Playwright**.

O bot monitora o board em tempo real, identifica tickets que precisam ser tratados com base em uma planilha de referência (CSV), e executa toda a transição de status automaticamente — incluindo preenchimento de formulários modais e comentários.

> **Autor:** Gustavo Rodrigues de Aguiar

---

## 🚀 Funcionalidades

### Monitoramento Contínuo
- Loop infinito 24/7 que verifica novas tickets a cada **15 segundos** (configurável)
- Recarregamento automático do board a cada ciclo para garantir dados frescos
- Logs detalhados com timestamps para rastreabilidade completa

### Validação Inteligente de Tickets
- Extração automática de **placas de veículos** do texto dos cards via regex
- Suporte a placas no formato **antigo** (ABC-1234) e **Mercosul** (ABC-1D23)
- Cruzamento instantâneo com base de dados CSV usando lookup **O(1)** via `Map`
- Identificação do **tipo de alerta** associado à placa (ex: `RECORRENTE`, `INDUZIDO`)

### Tratamento de Alertas Especiais

#### 🔌 ENERGIA CORTADA
- Detecção automática de tickets com título **"ENERGIA CORTADA"**
- Abertura do painel lateral para leitura da **descrição completa** do ticket
- **Subcaso 1:** Se a placa da descrição existe na planilha → trata com o tipo de alerta da planilha
- **Subcaso 2:** Se a descrição contém **"Bateria backup conectada"** → trata com justificativa `SSX - EVENTO Bateria backup conectada`
- Múltiplos seletores com fallback para extrair a descrição (rich-text, ak-renderer, testid genérico)

#### 🔋 DESCONEXÃO DE BATERIA
- Detecção automática de tickets com título **"DESCONEXÃO DE BATERIA"** (com ou sem acento)
- Abertura do painel lateral para leitura da descrição e extração da placa
- Cruzamento da placa com a planilha CSV — se encontrada, trata com o tipo de alerta correspondente
- Tickets sem placa ou com placa fora da planilha são ignorados automaticamente

### Transição Automática de Status
- **Fluxo completo:** `Aguardando Atendimento → Em Atendimento → Done`
- **Fluxo reduzido:** `Em Atendimento → Done` (para tickets já em andamento)
- Abertura automática do painel lateral do ticket
- Seleção de opções nos dropdowns de transição com múltiplas estratégias de fallback

### Preenchimento de Modais
- Detecção e interação automática com a modal **"Alerta Tratado"**
- Preenchimento do dropdown **"Suporte – Meios de contato"** (React Select) com valor "Nenhum"
- Digitação de comentário automático no editor **ProseMirror** (rich-text): `[AUTOMAÇÃO] <tipo_alerta>`
- Confirmação via botão "Atualizar" e aguardo do fechamento da modal

### Processamento em Duas Colunas
- **Prioridade 1:** Processa todos os tickets em **"Aguardando Atendimento"**
- **Prioridade 2:** Se nenhum ticket foi tratado, processa tickets em **"Em Atendimento"**
- Gerenciamento dinâmico de índices — quando um card é movido, o bot ajusta a iteração

### Resiliência e Auto-Restart
- **Bootstrap com auto-restart:** em caso de erro fatal, o bot fecha o navegador de forma segura, aguarda um cooldown configurável e reinicia automaticamente toda a automação
- Logs com **timestamps** em todas as mensagens (info, warn, erro, restart, debug)
- Fechamento seguro do `BrowserContext` via `fecharNavegadorComSeguranca()` — ignora erros se já estiver fechado
- Stack trace completa registrada no console para diagnóstico
- Contador de tentativas de restart para rastreabilidade
- Sessão persistente via `launchPersistentContext` — mantém autenticação entre execuções

### Leitura de Planilha CSV
- Suporte a delimitadores `;` e `,` automaticamente
- Aliases flexíveis para cabeçalhos (`PLACA MODELO`, `Placa Modelo`, `placa modelo`, etc.)
- Tolerância a linhas vazias, colunas extras e aspas inconsistentes
- Logging de linhas com placas não reconhecidas para diagnóstico

---

## 🏗️ Arquitetura

```
automation-jira/
├── src/
│   ├── index.ts            # Orquestrador principal e loop de execução
│   ├── jiraWorkflow.ts     # Lógica de interação com o Jira (DOM, cliques, transições)
│   ├── sheets.ts           # Leitura do CSV e extração de placas via regex
│   └── interfaces.ts       # Tipos e interfaces TypeScript
├── data/
│   └── dados.csv           # Planilha de referência (NÃO versionada)
├── jira_session_data/      # Sessão do navegador (NÃO versionada)
├── .env                    # Variáveis de ambiente (NÃO versionada)
├── .env.example            # Template de variáveis de ambiente
├── apresentacao.html       # Página de apresentação do projeto
├── apresentacao.css        # Estilos da página de apresentação
├── package.json
├── tsconfig.json
└── .gitignore
```

### Módulos

| Módulo | Arquivo | Responsabilidade |
|---|---|---|
| **Orquestrador** | `index.ts` | Inicialização, carregamento da planilha, navegador, e loop contínuo de polling |
| **Jira Workflow** | `jiraWorkflow.ts` | Toda interação com a UI do Jira: localizar cards, abrir painéis, transitar status, preencher modais, validação de "ENERGIA CORTADA" e "DESCONEXÃO DE BATERIA" |
| **Sheets** | `sheets.ts` | Parsing do CSV, normalização de cabeçalhos, e extração de placas com regex |
| **Interfaces** | `interfaces.ts` | Definição do tipo `TicketData` (placa + tipo de alerta) |

---

## 🛠️ Stack Tecnológica

| Tecnologia | Versão | Uso |
|---|---|---|
| **TypeScript** | ^5.4.5 | Linguagem principal com tipagem estática |
| **Playwright Core** | ^1.43.0 | Automação de browser (Chromium) sem dependências extras |
| **csv-parse** | ^5.5.5 | Parsing de arquivos CSV com delimitadores flexíveis |
| **dotenv** | ^16.x | Carregamento de variáveis de ambiente a partir de `.env` |
| **Node.js** | 18+ | Runtime de execução |
| **ts-node** | ^10.9.2 | Execução direta de TypeScript sem build |

---

## ⚙️ Configurações

Todas as constantes configuráveis estão centralizadas no objeto `CONFIG` em `src/index.ts`:

| Parâmetro | Valor Padrão | Descrição |
|---|---|---|
| `JIRA_QUEUE_URL` | *(variável de ambiente)* | Endereço do board Kanban no Jira Service Management (definido via `.env`) |
| `HEADLESS` | `false` | Se `true`, roda o navegador sem interface gráfica |
| `POLL_INTERVAL_MS` | `15000` (15s) | Intervalo entre ciclos de polling quando nenhum ticket é encontrado |
| `VIEWPORT` | `1920x1080` | Resolução da janela do navegador |
| `CSV_PATH` | `data/dados.csv` | Caminho para a planilha de referência |
| `SESSION_DIR` | `jira_session_data/` | Diretório de persistência da sessão do navegador |
| `COLUNA_AGUARDANDO_TIMEOUT_MS` | `300000` (5min) | Timeout para a coluna "Aguardando Atendimento" aparecer |
| `RESTART_COOLDOWN_MS` | `10000` (10s) | Tempo de espera antes de reiniciar a automação após um erro fatal |

---

## 📦 Como Executar

### Pré-requisitos
- Node.js 18+
- NPM

### Instalação

```bash
# Clonar o repositório
git clone <url-do-repo>
cd automation-jira

# Instalar dependências
npm install

# Instalar o browser Chromium do Playwright
npx playwright install chromium
```

### Configuração

1. **Variáveis de ambiente** — Copie o arquivo de exemplo e preencha com a URL do seu board:
   ```bash
   cp .env.example .env
   ```
   Edite o `.env` com a URL do seu board Kanban:
   ```env
   JIRA_QUEUE_URL=https://seu-dominio.atlassian.net/jira/servicedesk/projects/XX/boards/NNN
   ```

2. **Planilha CSV** — Coloque o arquivo `dados.csv` na pasta `data/` com as colunas:
   - `PLACA MODELO` — Placa do veículo (ex: `PHG-9A56 - I/TOYOTA HILUX CD4X2 SRV`)
   - `TIPO DE ALERTA` — Classificação do alerta (ex: `RECORRENTE`, `INDUZIDO`)

3. **Primeira execução** — Na primeira vez, o bot abrirá o Chromium para você fazer login manualmente no Jira. A sessão será salva automaticamente em `jira_session_data/`.

### Execução

```bash
# Modo desenvolvimento (execução direta via ts-node)
npm start

# Build de produção
npm run build
node dist/index.js
```

---

## 🔄 Fluxo de Execução

```
┌─────────────────────────────────────────────────────┐
│         🔄 BOOTSTRAP (auto-restart infinito)        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  1. Carregar planilha CSV → Map<placa, tipo>        │
│  2. Abrir navegador com sessão persistente          │
│  3. Navegar até o board Kanban do Jira              │
│                                                     │
│  ┌─── LOOP DE CICLOS ──────────────────────────┐    │
│  │                                             │    │
│  │  4. Buscar cards em AGUARDANDO              │    │
│  │     ├─ Extrair placa do texto do card       │    │
│  │     ├─ Verificar placa na planilha          │    │
│  │     │                                       │    │
│  │     ├─ [ENERGIA CORTADA?]                   │    │
│  │     │   ├─ Abrir painel lateral             │    │
│  │     │   ├─ Ler descrição do ticket          │    │
│  │     │   ├─ Placa na planilha? → Tratar      │    │
│  │     │   └─ Bateria backup? → SSX            │    │
│  │     │                                       │    │
│  │     ├─ [DESCONEXÃO DE BATERIA?]             │    │
│  │     │   ├─ Abrir painel lateral             │    │
│  │     │   ├─ Extrair placa da descrição       │    │
│  │     │   └─ Placa na planilha? → Tratar      │    │
│  │     │                                       │    │
│  │     ├─ Abrir painel lateral                 │    │
│  │     ├─ Transitar: Aguardando → Em Atend.    │    │
│  │     ├─ Transitar: Em Atend. → Done          │    │
│  │     ├─ Preencher modal "Alerta Tratado"     │    │
│  │     │   ├─ Dropdown: "Nenhum"               │    │
│  │     │   └─ Comentário: [AUTOMAÇÃO] tipo     │    │
│  │     └─ Confirmar e fechar painel            │    │
│  │                                             │    │
│  │  5. Se nenhum tratado, buscar em            │    │
│  │     EM ATENDIMENTO (mesmo fluxo)            │    │
│  │                                             │    │
│  │  6. Se nada encontrado → Aguardar 15s       │    │
│  │  7. Recarregar board → Repetir ♻️            │    │
│  │                                             │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ⚠️  ERRO FATAL?                                    │
│  ├─ Logar erro + stack trace                        │
│  ├─ Fechar navegador com segurança                  │
│  ├─ Aguardar cooldown (10s)                         │
│  └─ Reiniciar tudo automaticamente ♻️                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 🧩 Desafios Técnicos Resolvidos

### DOM Dinâmico (SPA)
O Jira Cloud é uma Single Page Application com DOM altamente dinâmico. Foram implementadas **3 estratégias de localização** com fallbacks encadeados para encontrar cards no board:
1. `data-testid="platform-board-kit.ui.card.card"` — Seletor oficial do board-kit
2. `data-testid` genérico com filtro de placa via regex
3. Links `a[href*="/servicedesk/"]` com filtro de placa

### React Select (Dropdowns)
Os dropdowns do Jira usam React Select, onde o div externo tem `role: generic` e não é clicável. A solução foi localizar o `<input>` interno (via `input[id*="react-select"]`, `input[aria-autocomplete="list"]`, ou `input[role="combobox"]`) e interagir diretamente com ele.

### Editor Rich-Text (ProseMirror)
O campo de comentário usa o editor ProseMirror do Atlassian. O método `.fill()` do Playwright não funciona — a solução foi:
1. Focar o elemento `[contenteditable="true"]`
2. Limpar com `Ctrl+A` + `Backspace`
3. Digitar com `keyboard.type()` simulando entrada humana (delay de 30ms)

### Obstrução de Elementos
O Playwright detecta que botões estão "cobertos" por overlays do Jira. Usamos `force: true` nos cliques após confirmar que o elemento existe via `.count()`.

### Sessão Persistente
Utilizamos `launchPersistentContext` do Playwright para manter cookies e autenticação entre execuções, evitando login manual repetido.

### Cards Dinâmicos
Quando um ticket é transitado, ele sai da coluna e os demais "sobem" de posição. O loop usa `while` com re-busca dos cards a cada iteração para evitar stale references.

### Extração de Descrição (Tickets Especiais)
Tickets dos tipos "ENERGIA CORTADA" e "DESCONEXÃO DE BATERIA" não trazem a placa no título do card — ela aparece apenas na descrição. A solução foi abrir o painel lateral automaticamente e tentar **4 seletores diferentes** com fallback para extrair o texto da descrição (rich-text field, ak-renderer-document, testid genérico, issue-view body).

### Auto-Restart com Bootstrap
Em vez de tentar recuperar o ciclo atual com screenshots e reloads (abordagem anterior), o sistema agora adota uma estratégia de **reinício completo**: ao detectar qualquer erro fatal, fecha o browser context de forma segura, aguarda um cooldown configurável e reinicia toda a automação do zero — garantindo um estado limpo e previsível.

---

## 📋 Formato do CSV

```csv
PLACA MODELO;TIPO DE ALERTA
PHG-9A56 - I/TOYOTA HILUX CD4X2 SRV;RECORRENTE
QZD-1E98 - I/M.BENZ SPRINTER 516;INDUZIDO
ABC-1234 - VW/GOL 1.0;PÁNICO
```

### Cabeçalhos aceitos

| Coluna | Aliases aceitos |
|---|---|
| Placa | `PLACA MODELO`, `PLACA-MODELO`, `Placa Modelo`, `placa modelo` |
| Tipo de Alerta | `TIPO DE ALERTA`, `Tipo de Alerta`, `tipo de alerta` |

A extração da placa usa a regex `/[A-Z]{3}-\d[A-Z0-9]\d{2}/i`, que suporta tanto placas antigas (ABC-1234) quanto Mercosul (ABC-1D23).

---

## 🔒 Segurança

Os seguintes itens **NÃO são versionados** (protegidos pelo `.gitignore`):

| Item | Motivo |
|---|---|
| `data/` | Planilha com dados de veículos |
| `jira_session_data/` | Cookies e sessão do navegador |
| `.env` | Variáveis de ambiente |
| `dist/` | Artefatos de build |
| `node_modules/` | Dependências |
| `package-lock.json` | Lockfile de dependências |
| `.gemini/` | Dados de ferramentas de IA |

---

## 📜 Scripts Disponíveis

| Comando | Descrição |
|---|---|
| `npm start` | Executa o bot diretamente via `ts-node` (modo desenvolvimento) |
| `npm run build` | Compila o TypeScript para JavaScript em `dist/` |
| `npm run lint` | Executa o ESLint nos arquivos TypeScript |

---

## 📄 Licença

Este projeto é de uso privado e não possui licença pública.
