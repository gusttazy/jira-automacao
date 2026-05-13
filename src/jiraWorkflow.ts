/**
 * ----------------------------------------------------------------------------
 * Criado por: Gustavo Rodrigues de Aguiar
 * Projeto: Automação Jira Kanban Triage
 * Descrição: Inteligência de interação com a interface do Jira.
 * Onde clica, onde escreve, como lida com modais, etc.
 *
 * Tipos de alerta suportados:
 *  - Placa no título do card (fluxo padrão)
 *  - ENERGIA CORTADA (placa na descrição + subcaso "Bateria backup")
 *  - DESCONEXÃO DE BATERIA (placa na descrição, com/sem acento)
 * ----------------------------------------------------------------------------
 */

import { Page, Locator } from "playwright-core";
import { extractPlaca } from "./sheets";

// ─────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────

export type ValidateResult = {
  isValid: boolean;
  tipoAlerta?: string;
  title: string;
  painelAberto?: boolean;
};

type LocatorFactory = () => Locator;

// ─────────────────────────────────────────────
// Constantes de configuração
// ─────────────────────────────────────────────

const DELAYS = {
  PAINEL_ABRIR: 3000,
  DROPDOWN_ABRIR: 2000,
  TRANSICAO_STATUS: 4000,
  MODAL_APARECER: 3000,
  EDITOR_FOCO: 500,
  OPCAO_SELECIONADA: 1000,
  DIGITACAO_MS: 30,
} as const;

const SELECTORS = {
  CARD_BOARD_KIT: '[data-testid="platform-board-kit.ui.card.card"]',
  CARD_GENERICO: '[data-testid*="card"]',
  LINK_SERVICEDESK: 'a[href*="/servicedesk/"]',
  PLACA_REGEX: /[A-Z]{3}-\d[A-Z0-9]\d{2}/i,
  STATUS_BTN_ID: "#issue\\.fields\\.status-view\\.status-button",
} as const;

const COLUNAS = {
  AGUARDANDO: "AGUARDANDO ATENDIMENTO",
  EM_ATENDIMENTO: "EM ATENDIMENTO",
  DONE: "DONE",
} as const;

// ─────────────────────────────────────────────
// Classe principal
// ─────────────────────────────────────────────

export class JiraWorkflow {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ─────────────────────────────────────────
  // Métodos públicos
  // ─────────────────────────────────────────

  /**
   * Retorna todos os cards da coluna "AGUARDANDO ATENDIMENTO".
   */
  async getAguardandoCards(): Promise<Locator[]> {
    console.log("[DEBUG] Buscando cards em AGUARDANDO ATENDIMENTO...");
    return this.getCardsPorColuna((texto) =>
      texto.includes(COLUNAS.AGUARDANDO),
    );
  }

  /**
   * Retorna todos os cards da coluna "EM ATENDIMENTO".
   * Exclui cards que também contenham "AGUARDANDO" ou "DONE" no texto.
   */
  async getEmAtendimentoCards(): Promise<Locator[]> {
    console.log("[DEBUG] Buscando cards em EM ATENDIMENTO...");
    return this.getCardsPorColuna(
      (texto) =>
        texto.includes(COLUNAS.EM_ATENDIMENTO) &&
        !texto.includes(COLUNAS.AGUARDANDO) &&
        !texto.includes(COLUNAS.DONE),
    );
  }

  /**
   * Valida se o card contém uma placa presente no mapa da planilha.
   * Despacha para validadores especializados conforme o tipo de alerta:
   *  1. "ENERGIA CORTADA" → validateEnergiaCortada()
   *  2. "DESCONEXÃO DE BATERIA" → validateDesconexaoBateria()
   *  3. Fluxo padrão → extrai placa diretamente do título do card
   */
  async validateTicket(
    card: Locator,
    placaMap: Map<string, string>,
  ): Promise<ValidateResult> {
    const flatText = await this.getCardText(card);
    console.log(
      `[VALIDAÇÃO] Texto do card: "${flatText.substring(0, 120)}..."`,
    );

    // ─── Novo caso: ENERGIA CORTADA ───
    if (flatText.toUpperCase().includes("ENERGIA CORTADA")) {
      return this.validateEnergiaCortada(card, placaMap);
    }

    // ─── Novo caso: DESCONEXÃO DE BATERIA ───
    if (flatText.toUpperCase().includes("DESCONEXÃO DE BATERIA") || flatText.toUpperCase().includes("DESCONEXAO DE BATERIA")) {
      return this.validateDesconexaoBateria(card, placaMap);
    }

    // ─── Fluxo original: placa no título ───
    const placa = extractPlaca(flatText);
    if (!placa) {
      console.log("[VALIDAÇÃO] ❌ Nenhuma placa encontrada no card.");
      return { isValid: false, title: flatText.substring(0, 60) + "..." };
    }

    console.log(`[VALIDAÇÃO] Placa encontrada: "${placa}"`);

    const tipoAlerta = placaMap.get(placa);
    if (!tipoAlerta) {
      console.log(
        `[VALIDAÇÃO] ❌ Placa "${placa}" NÃO encontrada na planilha.`,
      );
      return { isValid: false, title: `Placa ${placa} não está na planilha` };
    }

    console.log(
      `[VALIDAÇÃO] ✅ Placa "${placa}" encontrada! Tipo de Alerta: ${tipoAlerta}`,
    );
    return { isValid: true, tipoAlerta, title: flatText.substring(0, 80) };
  }

  /**
   * Validação específica para tickets "ENERGIA CORTADA".
   * Abre o painel lateral para extrair placa e evento da descrição.
   */
  private async validateEnergiaCortada(
    card: Locator,
    placaMap: Map<string, string>,
  ): Promise<ValidateResult> {
    console.log(
      '[VALIDAÇÃO] 🔌 Ticket "ENERGIA CORTADA" detectado. Abrindo painel para ler descrição...',
    );

    await this.abrirPainelLateral(card);

    const descricao = await this.extrairDescricaoPainelLateral();
    console.log(
      `[VALIDAÇÃO] Descrição extraída: "${descricao.substring(0, 200)}..."`,
    );

    const placa = extractPlaca(descricao);

    if (!placa) {
      console.log(
        "[VALIDAÇÃO] ❌ Nenhuma placa encontrada na descrição do ticket ENERGIA CORTADA.",
      );
      await this.fecharPainelLateral();
      return {
        isValid: false,
        title: "ENERGIA CORTADA (sem placa na descrição)",
        painelAberto: false,
      };
    }

    console.log(`[VALIDAÇÃO] Placa encontrada na descrição: "${placa}"`);

    // Subcaso 1: placa está na planilha
    const tipoAlerta = placaMap.get(placa);
    if (tipoAlerta) {
      console.log(
        `[VALIDAÇÃO] ✅ Placa "${placa}" encontrada na planilha! Tipo: ${tipoAlerta}`,
      );
      return {
        isValid: true,
        tipoAlerta,
        title: `ENERGIA CORTADA - ${placa}`,
        painelAberto: true,
      };
    }

    // Subcaso 2: evento "Bateria backup conectada"
    if (/bateria\s+backup\s+conectada/i.test(descricao)) {
      const justificativa = "SSX - EVENTO Bateria backup conectada";
      console.log(
        `[VALIDAÇÃO] ✅ Placa "${placa}" NÃO está na planilha, mas evento é "Bateria backup conectada". Justificativa: ${justificativa}`,
      );
      return {
        isValid: true,
        tipoAlerta: justificativa,
        title: `ENERGIA CORTADA - ${placa}`,
        painelAberto: true,
      };
    }

    // Nenhum subcaso se aplica
    console.log(
      `[VALIDAÇÃO] ❌ Placa "${placa}" NÃO está na planilha e evento NÃO é "Bateria backup conectada".`,
    );
    await this.fecharPainelLateral();
    return {
      isValid: false,
      title: `ENERGIA CORTADA - ${placa} (não qualificado)`,
      painelAberto: false,
    };
  }

  /**
   * Validação específica para tickets "DESCONEXÃO DE BATERIA".
   * Abre o painel lateral para extrair placa da linha "Unidade:" na descrição.
   */
  private async validateDesconexaoBateria(
    card: Locator,
    placaMap: Map<string, string>,
  ): Promise<ValidateResult> {
    console.log(
      '[VALIDAÇÃO] 🔋 Ticket "DESCONEXÃO DE BATERIA" detectado. Abrindo painel para ler descrição...',
    );

    await this.abrirPainelLateral(card);

    const descricao = await this.extrairDescricaoPainelLateral();
    console.log(
      `[VALIDAÇÃO] Descrição extraída: "${descricao.substring(0, 200)}..."`,
    );

    const placa = extractPlaca(descricao);

    if (!placa) {
      console.log(
        "[VALIDAÇÃO] ❌ Nenhuma placa encontrada na descrição do ticket DESCONEXÃO DE BATERIA.",
      );
      await this.fecharPainelLateral();
      return {
        isValid: false,
        title: "DESCONEXÃO DE BATERIA (sem placa na descrição)",
        painelAberto: false,
      };
    }

    console.log(`[VALIDAÇÃO] Placa encontrada na descrição: "${placa}"`);

    const tipoAlerta = placaMap.get(placa);
    if (tipoAlerta) {
      console.log(
        `[VALIDAÇÃO] ✅ Placa "${placa}" encontrada na planilha! Tipo: ${tipoAlerta}`,
      );
      return {
        isValid: true,
        tipoAlerta,
        title: `DESCONEXÃO DE BATERIA - ${placa}`,
        painelAberto: true,
      };
    }

    // Placa não está na planilha → não qualificado
    console.log(
      `[VALIDAÇÃO] ❌ Placa "${placa}" NÃO está na planilha.`,
    );
    await this.fecharPainelLateral();
    return {
      isValid: false,
      title: `DESCONEXÃO DE BATERIA - ${placa} (não qualificado)`,
      painelAberto: false,
    };
  }

  /**
   * Extrai o texto da descrição do ticket no painel lateral.
   * Tenta múltiplos seletores com fallback (padrão do projeto).
   */
  private async extrairDescricaoPainelLateral(): Promise<string> {
    console.log("[AÇÃO] Extraindo texto da descrição no painel lateral...");

    const tentativas: Array<{ label: string; factory: () => Locator }> = [
      {
        label: "rich-text description",
        factory: () =>
          this.page.locator(
            '[data-testid="issue.views.field.rich-text.description"]',
          ),
      },
      {
        label: "ak-renderer-document",
        factory: () => this.page.locator(".ak-renderer-document"),
      },
      {
        label: "description testid genérico",
        factory: () => this.page.locator('[data-testid*="description"]'),
      },
      {
        label: "issue-view body",
        factory: () =>
          this.page.locator('[data-testid="issue-view-body"]'),
      },
    ];

    for (const { label, factory } of tentativas) {
      const loc = factory();
      const count = await loc.count();
      if (count > 0) {
        const texto = ((await loc.first().textContent()) || "")
          .replace(/\s+/g, " ")
          .trim();
        if (texto.length > 10) {
          console.log(
            `[DEBUG] Descrição encontrada via "${label}" (${texto.length} chars)`,
          );
          return texto;
        }
      }
    }

    // Fallback: texto completo do painel
    console.log(
      "[WARN] Nenhum seletor de descrição funcionou. Usando texto geral do painel.",
    );
    const painelTexto = await this.page
      .locator("main, [role='main'], #jira-issue-view")
      .first()
      .textContent();
    return (painelTexto || "").replace(/\s+/g, " ").trim();
  }

  /**
   * Fluxo completo: Aguardando Atendimento → Em Atendimento → Done + modal.
   */
  async transitarStatus(
    card: Locator,
    tipoAlerta: string,
    skipAbrirPainel = false,
  ): Promise<void> {
    if (!skipAbrirPainel) {
      await this.abrirPainelLateral(card);
    }

    // Aguardando → Em Atendimento
    await this.clicarBotaoStatus("Aguardando Atendimento");
    await this.page.waitForTimeout(DELAYS.DROPDOWN_ABRIR);
    await this.selecionarOpcaoDropdown(
      [
        () =>
          this.page.getByRole("option", {
            name: /Iniciar atendimento|EM ATENDIMENTO/i,
          }),
        () => this.page.locator('[role="listbox"] >> text=/EM ATENDIMENTO/i'),
        () =>
          this.page
            .locator('[id*="react-select"][id*="listbox"] div')
            .filter({ hasText: /EM ATENDIMENTO/i }),
        () => this.page.getByText("Iniciar atendimento"),
      ],
      "EM ATENDIMENTO",
    );

    console.log(
      '[AÇÃO] ✅ Clicou em "EM ATENDIMENTO". Aguardando Jira processar...',
    );
    await this.page.waitForTimeout(DELAYS.TRANSICAO_STATUS);

    // Em Atendimento → Done
    await this.transitarParaDone(tipoAlerta);

    console.log("[AÇÃO] ✅ Ticket finalizado com sucesso!");
  }

  /**
   * Fluxo reduzido: Em Atendimento → Done + modal (para tickets já em andamento).
   */
  async transitarStatusDone(
    card: Locator,
    tipoAlerta: string,
    skipAbrirPainel = false,
  ): Promise<void> {
    if (!skipAbrirPainel) {
      await this.abrirPainelLateral(card);
    }
    await this.transitarParaDone(tipoAlerta);
    console.log("[AÇÃO] ✅ Ticket EM ATENDIMENTO finalizado com sucesso!");
  }

  // ─────────────────────────────────────────
  // Métodos privados — fluxo de navegação
  // ─────────────────────────────────────────

  /**
   * Clica no card e aguarda o painel lateral carregar.
   */
  private async abrirPainelLateral(card: Locator): Promise<void> {
    console.log("[AÇÃO] Clicando no card para abrir painel lateral...");
    await card.click();
    await this.page.waitForTimeout(DELAYS.PAINEL_ABRIR);
    console.log("[AÇÃO] Painel lateral carregado.");
  }

  /**
   * Clica no botão de status (com fallback por aria-label).
   */
  private async clicarBotaoStatus(contexto: string): Promise<void> {
    console.log(`[AÇÃO] Clicando no botão de status (${contexto})...`);

    const btnId = this.page.locator(SELECTORS.STATUS_BTN_ID);
    if ((await btnId.count()) > 0) {
      await btnId.click({ force: true });
      return;
    }

    const btnFallback = this.page.locator(
      'button[aria-label*="Atendimento"], button[aria-label*="Alterar"]',
    );
    if ((await btnFallback.count()) > 0) {
      await btnFallback.first().click({ force: true });
      return;
    }

    throw new Error(
      `Botão de status não encontrado. Contexto: "${contexto}". URL: ${this.page.url()}`,
    );
  }

  /**
   * Trecho reutilizável: abre dropdown de status e clica em "Done".
   */
  private async transitarParaDone(tipoAlerta: string): Promise<void> {
    console.log('[AÇÃO] Abrindo dropdown para transição "Done"...');
    await this.clicarBotaoStatus("Em Atendimento → Done");
    await this.page.waitForTimeout(DELAYS.DROPDOWN_ABRIR);
    await this.selecionarOpcaoDone();
    console.log(
      '[AÇÃO] ✅ Clicou em "Done". Aguardando modal "Alerta Tratado"...',
    );
    await this.preencherModalAlertaTratado(tipoAlerta);
  }

  /**
   * Tenta cada factory de Locator em ordem e clica na primeira que encontrar.
   * Lança erro com contexto se nenhuma funcionar.
   */
  private async selecionarOpcaoDropdown(
    tentativas: LocatorFactory[],
    nomeOpcao: string,
  ): Promise<void> {
    for (const factory of tentativas) {
      const opt = factory();
      if ((await opt.count()) > 0) {
        await opt.first().click({ force: true });
        console.log(`[AÇÃO] ✅ Opção "${nomeOpcao}" selecionada.`);
        return;
      }
    }
    throw new Error(
      `Opção "${nomeOpcao}" não encontrada no dropdown. URL: ${this.page.url()}`,
    );
  }

  /**
   * Seleciona a opção "Done" no dropdown de transição de status.
   */
  private async selecionarOpcaoDone(): Promise<void> {
    await this.selecionarOpcaoDropdown(
      [
        () => this.page.getByRole("option", { name: /Done|Concluído/i }),
        () => this.page.locator('[role="listbox"] >> text=/Done/i'),
        () =>
          this.page
            .locator('[id*="react-select"][id*="listbox"] div')
            .filter({ hasText: /Done/i }),
        () => this.page.getByText("Done", { exact: true }),
      ],
      "Done",
    );
  }

  // ─────────────────────────────────────────
  // Métodos privados — busca de cards
  // ─────────────────────────────────────────

  /**
   * Resolve o locator de cards com 3 estratégias encadeadas.
   * Centraliza a lógica comum entre getAguardandoCards e getEmAtendimentoCards.
   */
  private async resolverLocatorCards(): Promise<{
    locator: Locator;
    count: number;
  }> {
    const estrategias: Array<{ label: string; locator: Locator }> = [
      {
        label: "data-testid board-kit",
        locator: this.page.locator(SELECTORS.CARD_BOARD_KIT),
      },
      {
        label: "data-testid *card* com placa",
        locator: this.page
          .locator(SELECTORS.CARD_GENERICO)
          .filter({ hasText: SELECTORS.PLACA_REGEX }),
      },
      {
        label: "links servicedesk com placa",
        locator: this.page
          .locator(SELECTORS.LINK_SERVICEDESK)
          .filter({ hasText: SELECTORS.PLACA_REGEX }),
      },
    ];

    for (const estrategia of estrategias) {
      const count = await estrategia.locator.count();
      console.log(
        `[DEBUG] Estratégia "${estrategia.label}": ${count} card(s) encontrado(s)`,
      );
      if (count > 0) return { locator: estrategia.locator, count };
    }

    console.log("[DEBUG] Nenhum card encontrado por nenhuma estratégia.");
    return { locator: this.page.locator("__noop__"), count: 0 };
  }

  /**
   * Retorna cards filtrados pelo predicado de texto recebido.
   * Reutilizado por getAguardandoCards e getEmAtendimentoCards.
   */
  private async getCardsPorColuna(
    filtro: (textoUpperCase: string) => boolean,
  ): Promise<Locator[]> {
    const { locator, count } = await this.resolverLocatorCards();
    if (count === 0) return [];

    const resultado: Locator[] = [];

    for (let i = 0; i < count; i++) {
      const card = locator.nth(i);
      const texto = await this.getCardText(card);
      const textoUpper = texto.toUpperCase();

      if (filtro(textoUpper)) {
        resultado.push(card);
        console.log(
          `[DEBUG] ✅ Card [${i}] aceito: "${texto.substring(0, 80)}..."`,
        );
      }
    }

    console.log(`[DEBUG] Total de cards filtrados: ${resultado.length}`);
    return resultado;
  }

  // ─────────────────────────────────────────
  // Métodos privados — modal "Alerta Tratado"
  // ─────────────────────────────────────────

  /**
   * Preenche a modal "Alerta Tratado" com dropdown e comentário.
   */
  private async preencherModalAlertaTratado(tipoAlerta: string): Promise<void> {
    await this.page.waitForTimeout(DELAYS.MODAL_APARECER);

    const modal = await this.resolverModal();

    await this.preencherDropdownSuporteMeiosDeContato(modal);
    await this.preencherComentario(modal, tipoAlerta);
    await this.confirmarModal(modal);
    await this.fecharPainelLateral();
  }

  /**
   * Resolve o locator da modal "Alerta Tratado" com fallback.
   */
  private async resolverModal(): Promise<Locator> {
    const modal = this.page.getByRole("dialog", { name: /Alerta Tratado/i });
    if ((await modal.count()) > 0) {
      await modal.waitFor({ state: "visible", timeout: 15000 });
      console.log('[AÇÃO] Modal "Alerta Tratado" aberta.');
      return modal;
    }

    const modalFallback = this.page
      .locator('[role="dialog"]')
      .filter({ hasText: /Alerta Tratado/i });
    if ((await modalFallback.count()) > 0) {
      await modalFallback.waitFor({ state: "visible", timeout: 15000 });
      console.log('[AÇÃO] Modal "Alerta Tratado" aberta via fallback.');
      return modalFallback;
    }

    throw new Error(
      `Modal "Alerta Tratado" não encontrada. URL: ${this.page.url()}`,
    );
  }

  /**
   * Seleciona "Nenhum" no dropdown React Select "Suporte – Meios de contato".
   * O React Select embute um <input> oculto — interagimos diretamente com ele.
   */
  private async preencherDropdownSuporteMeiosDeContato(
    modal: Locator,
  ): Promise<void> {
    console.log('[AÇÃO] Abrindo dropdown "Suporte – Meios de contato"...');

    const input = modal
      .locator('input[id*="react-select"]')
      .or(modal.locator('input[aria-autocomplete="list"]'))
      .or(modal.locator('input[role="combobox"]'));

    if ((await input.count()) > 0) {
      await input.first().click({ force: true });
    } else {
      console.log(
        "[AÇÃO] Input não encontrado. Usando fallback (chevron SVG)...",
      );
      await modal
        .locator('svg[aria-hidden="true"]')
        .first()
        .click({ force: true });
    }

    await this.page.waitForTimeout(1500);

    const opcaoNenhum = this.page.getByText("Nenhum", { exact: true });
    if ((await opcaoNenhum.count()) > 0) {
      await opcaoNenhum.last().click({ force: true });
      console.log('[AÇÃO] ✅ "Nenhum" selecionado via clique.');
    } else {
      await this.page.keyboard.type("Nenhum", { delay: 50 });
      await this.page.waitForTimeout(500);
      await this.page.keyboard.press("Enter");
      console.log('[AÇÃO] ✅ "Nenhum" selecionado via digitação.');
    }

    await this.page.waitForTimeout(DELAYS.OPCAO_SELECIONADA);
  }

  /**
   * Preenche o comentário no editor ProseMirror (contenteditable).
   * .fill() não funciona em rich-text editors — simulamos teclado.
   */
  private async preencherComentario(
    modal: Locator,
    tipoAlerta: string,
  ): Promise<void> {
    console.log("[AÇÃO] Preenchendo campo de comentário...");
    const comentario = `[AUTOMAÇÃO] ${tipoAlerta}`;

    const editor = modal.locator('[contenteditable="true"]').first();

    if ((await editor.count()) > 0) {
      await editor.click({ force: true });
    } else {
      const placeholder = modal.getByText("Digite /ai para perguntar ao Rovo");
      if ((await placeholder.count()) > 0) {
        await placeholder.click({ force: true });
      } else {
        await modal.locator('[role="textbox"]').first().click({ force: true });
      }
    }

    await this.page.waitForTimeout(DELAYS.EDITOR_FOCO);
    await this.page.keyboard.press("Control+A");
    await this.page.keyboard.press("Backspace");
    await this.page.waitForTimeout(200);
    await this.page.keyboard.type(comentario, { delay: DELAYS.DIGITACAO_MS });

    console.log(`[AÇÃO] ✅ Comentário digitado: "${comentario}"`);
    await this.page.waitForTimeout(500);
  }

  /**
   * Clica em "Atualizar" e aguarda a modal fechar.
   */
  private async confirmarModal(modal: Locator): Promise<void> {
    const btnAtualizar = modal.getByRole("button", { name: /Atualizar/i });
    await btnAtualizar.click({ force: true });
    console.log('[AÇÃO] Botão "Atualizar" clicado. Aguardando modal fechar...');
    await modal.waitFor({ state: "hidden", timeout: 15000 });
    console.log("[AÇÃO] ✅ Modal fechada com sucesso.");
  }

  /**
   * Fecha o painel lateral via botão ou Escape.
   */
  private async fecharPainelLateral(): Promise<void> {
    const btnFechar = this.page.getByRole("button", { name: "Fechar" });
    if ((await btnFechar.count()) > 0) {
      await btnFechar.click({ force: true });
      console.log('[AÇÃO] ✅ Painel lateral fechado via botão "Fechar".');
    } else {
      await this.page.keyboard.press("Escape");
      console.log("[AÇÃO] ✅ Painel lateral fechado via Escape.");
    }
    await this.page.waitForTimeout(1500);
  }

  // ─────────────────────────────────────────
  // Utilitários
  // ─────────────────────────────────────────

  /**
   * Extrai e normaliza o texto de um card Locator.
   */
  private async getCardText(card: Locator): Promise<string> {
    return ((await card.textContent()) || "").replace(/\s+/g, " ").trim();
  }
}