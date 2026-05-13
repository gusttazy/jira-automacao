/**
 * ----------------------------------------------------------------------------
 * Criado por: Gustavo Rodrigues de Aguiar
 * Projeto: Automação Jira Kanban Triage
 *
 * Orquestrador principal da automação. Responsável por:
 *  - Carregar a planilha CSV de placas/alertas
 *  - Iniciar o navegador Chromium com sessão persistente
 *  - Executar o loop contínuo de triagem de tickets
 *  - Auto-restart em caso de erro fatal (bootstrap resiliente)
 * ----------------------------------------------------------------------------
 */

import "dotenv/config";
import { chromium, Page, BrowserContext } from "playwright-core";
import { loadSpreadsheet } from "./sheets";
import { JiraWorkflow } from "./jiraWorkflow";
import * as path from "path";

// ─────────────────────────────────────────────
// Configurações centralizadas
// ─────────────────────────────────────────────

const CONFIG = {
  JIRA_QUEUE_URL:
    process.env.JIRA_QUEUE_URL ?? (() => { throw new Error("Variável de ambiente JIRA_QUEUE_URL não definida. Consulte o .env.example."); })(),
  HEADLESS: false,
  POLL_INTERVAL_MS: 15000,
  VIEWPORT: { width: 1920, height: 1080 },
  CSV_PATH: path.resolve(__dirname, "../data/dados.csv"),
  SESSION_DIR: path.resolve(__dirname, "../jira_session_data"),
  COLUNA_AGUARDANDO_TIMEOUT_MS: 300000,
  RESTART_COOLDOWN_MS: 10000,
} as const;

// ─────────────────────────────────────────────
// Helpers de log com timestamp
// ─────────────────────────────────────────────

/** Retorna data/hora formatada em pt-BR para prefixar mensagens de log. */
function timestamp(): string {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const log = {
  secao: (msg: string) => {
    const linha = "=".repeat(60);
    console.log(`\n${linha}\n${msg}\n${linha}`);
  },
  info: (msg: string) => console.log(`[${timestamp()}] ${msg}`),
  warn: (msg: string) => console.warn(`[${timestamp()}] ⚠️  ${msg}`),
  erro: (msg: string) => console.error(`[${timestamp()}] ❌ ${msg}`),
  restart: (msg: string) => {
    const linha = "─".repeat(60);
    console.log(`\n${linha}`);
    console.log(`[${timestamp()}] 🔄 RESTART: ${msg}`);
    console.log(`${linha}`);
  },
  debug: (msg: string) => console.log(`[${timestamp()}] [DEBUG] ${msg}`),
};

// ─────────────────────────────────────────────
// Inicialização
// ─────────────────────────────────────────────

async function carregarPlanilha(): Promise<Map<string, string>> {
  log.info("[1/5] Carregando dados da planilha...");
  const placaMap = await loadSpreadsheet(CONFIG.CSV_PATH);
  log.info(`✅ Planilha carregada! ${placaMap.size} placas encontradas.`);

  const amostra = Array.from(placaMap.entries()).slice(0, 5);
  for (const [placa, tipo] of amostra) {
    log.info(`   📋 "${placa}" -> "${tipo}"`);
  }

  return placaMap;
}

async function iniciarNavegador(): Promise<{ page: Page; context: BrowserContext }> {
  log.info("[2/5] Iniciando navegador (Contexto Persistente)...");
  const context = await chromium.launchPersistentContext(CONFIG.SESSION_DIR, {
    headless: CONFIG.HEADLESS,
    viewport: CONFIG.VIEWPORT,
  });

  const page = context.pages()[0] ?? (await context.newPage());

  log.info("[3/5] Acessando fila do Jira...");
  await page.goto(CONFIG.JIRA_QUEUE_URL, { waitUntil: "domcontentloaded" });

  log.info('⏳ Aguardando coluna "AGUARDANDO ATENDIMENTO" carregar...');
  try {
    await page
      .getByText("AGUARDANDO ATENDIMENTO")
      .first()
      .waitFor({
        state: "visible",
        timeout: CONFIG.COLUNA_AGUARDANDO_TIMEOUT_MS,
      });
    log.info('✅ Coluna "AGUARDANDO ATENDIMENTO" localizada!');
  } catch {
    throw new Error(
      "Coluna AGUARDANDO ATENDIMENTO não apareceu no tempo esperado.",
    );
  }

  // Tempo extra para os cards renderizarem dentro da coluna
  await page.waitForTimeout(3000);
  return { page, context };
}

// ─────────────────────────────────────────────
// Loop principal
// ─────────────────────────────────────────────

async function processarFila(
  jira: JiraWorkflow,
  placaMap: Map<string, string>,
): Promise<boolean> {
  return (
    (await processarColuna(jira, placaMap, "AGUARDANDO")) ||
    (await processarColuna(jira, placaMap, "EM_ATENDIMENTO"))
  );
}

async function processarColuna(
  jira: JiraWorkflow,
  placaMap: Map<string, string>,
  coluna: "AGUARDANDO" | "EM_ATENDIMENTO",
): Promise<boolean> {
  const isAguardando = coluna === "AGUARDANDO";

  const buscarCards = () =>
    isAguardando ? jira.getAguardandoCards() : jira.getEmAtendimentoCards();

  const transitar = (
    card: Awaited<ReturnType<typeof jira.getAguardandoCards>>[number],
    tipoAlerta: string,
    skipAbrirPainel = false,
  ) =>
    isAguardando
      ? jira.transitarStatus(card, tipoAlerta, skipAbrirPainel)
      : jira.transitarStatusDone(card, tipoAlerta, skipAbrirPainel);

  const nomeColuna = isAguardando ? "AGUARDANDO" : "EM ATENDIMENTO";

  const cards = await buscarCards();

  if (cards.length === 0) {
    log.info(`⏳ Nenhum ticket em ${nomeColuna}.`);
    return false;
  }

  log.info(
    `\n📌 Encontrados ${cards.length} ticket(s) em ${nomeColuna}. Analisando...`,
  );

  let tratouAlgum = false;
  let i = 0;

  // While em vez de for-of porque a lista encolhe a cada ticket tratado
  while (i < cards.length) {
    const currentCards = await buscarCards();

    if (i >= currentCards.length) {
      log.info(`[LOOP] Fim dos cards em ${nomeColuna}.`);
      break;
    }

    const card = currentCards[i];
    log.info(`\n--- Analisando card ${nomeColuna} [${i}] ---`);

    const { isValid, tipoAlerta, title, painelAberto } =
      await jira.validateTicket(card, placaMap);

    if (!isValid || !tipoAlerta) {
      log.info(`⏭️  Card [${i}] ignorado. Título: ${title}`);
      i++;
      continue;
    }

    log.info(`🚀 TRATANDO: "${title}" | Justificativa: ${tipoAlerta}`);
    await transitar(card, tipoAlerta, painelAberto ?? false);
    log.info(`✅ Ticket finalizado com sucesso!`);

    tratouAlgum = true;
    // O card saiu da coluna — o próximo ocupa o índice atual, não avançamos i
    cards.length = currentCards.length - 1;
  }

  return tratouAlgum;
}

/**
 * Fecha o browser context de forma segura, ignorando erros se já estiver fechado.
 */
async function fecharNavegadorComSeguranca(
  context: BrowserContext | null,
): Promise<void> {
  if (!context) return;
  try {
    await context.close();
    log.debug("Browser context fechado com sucesso.");
  } catch (e: any) {
    log.debug(`Browser context já estava fechado ou erro ao fechar: ${e.message}`);
  }
}

async function recarregarFila(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
}

async function runAutomation(): Promise<void> {
  const placaMap = await carregarPlanilha();
  const { page, context } = await iniciarNavegador();
  const jira = new JiraWorkflow(page);

  log.info("[4/5] Entrando no loop contínuo de escuta...");

  let ciclo = 0;

  try {
    while (true) {
      ciclo++;
      log.secao(
        `🔍 CICLO #${ciclo} | ${new Date().toLocaleTimeString("pt-BR")} | Buscando tickets...`,
      );

      const tratouAlgum = await processarFila(jira, placaMap);

      if (tratouAlgum) {
        log.info("🔄 Ciclo finalizado. Recarregando fila...");
      } else {
        log.info(
          `⏳ Nenhum ticket atendeu aos requisitos. Aguardando ${CONFIG.POLL_INTERVAL_MS / 1000}s...`,
        );
        await page.waitForTimeout(CONFIG.POLL_INTERVAL_MS);
      }

      await recarregarFila(page);
    }
  } catch (error: any) {
    // Qualquer erro não tratado propaga para o bootstrapAutomation que reinicia tudo
    log.erro(`Erro fatal no ciclo #${ciclo}: ${error.message}`);
    if (error.stack) {
      log.debug(`Stack trace:\n${error.stack}`);
    }
    await fecharNavegadorComSeguranca(context);
    throw error;
  }
}

// ─────────────────────────────────────────────
// Bootstrap com auto-restart
// Garante operação contínua: em caso de erro
// fatal, fecha o navegador, aguarda cooldown e
// reinicia toda a automação do zero.
// ─────────────────────────────────────────────

async function bootstrapAutomation(): Promise<void> {
  let tentativa = 0;

  while (true) {
    tentativa++;
    log.restart(
      `Iniciando automação (tentativa #${tentativa})...`,
    );

    try {
      await runAutomation();
    } catch (error: any) {
      log.restart(
        `Automação encerrada por erro. Motivo: ${error.message}`,
      );
      log.info(
        `⏳ Aguardando ${CONFIG.RESTART_COOLDOWN_MS / 1000}s antes de reiniciar...`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.RESTART_COOLDOWN_MS),
      );
      log.restart(
        `Reiniciando automação (próxima tentativa: #${tentativa + 1})...`,
      );
    }
  }
}

bootstrapAutomation().catch(console.error);
