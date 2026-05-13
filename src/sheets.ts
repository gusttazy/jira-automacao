/**
 * ----------------------------------------------------------------------------
 * Criado por: Gustavo Rodrigues de Aguiar
 * Projeto: Automação Jira Kanban Triage
 * ----------------------------------------------------------------------------
 */

import * as fs from "fs";
import { parse } from "csv-parse";

// ─────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────

/**
 * Aceita placa antiga (ABC-1234) e nova Mercosul (ABC-1D23).
 */
const PLACA_REGEX = /[A-Z]{3}-\d[A-Z0-9]\d{2}/i;

/**
 * Variações de cabeçalho aceitas no CSV para cada coluna necessária.
 * Adicionar novos aliases aqui caso o arquivo mude, sem tocar no resto do código.
 */
const ALIASES_COLUNA = {
  PLACA: ["PLACA MODELO", "PLACA-MODELO", "Placa Modelo", "placa modelo"],
  TIPO_ALERTA: ["TIPO DE ALERTA", "Tipo de Alerta", "tipo de alerta"],
} as const;

// ─────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────

/**
 * Procura pelo primeiro alias existente no registro e retorna o valor, ou ''.
 */
function resolverCampo(
  record: Record<string, string>,
  aliases: readonly string[],
): string {
  for (const alias of aliases) {
    if (record[alias] !== undefined) return record[alias].trim();
  }
  return "";
}

// ─────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────

/**
 * Extrai a placa brasileira de qualquer texto.
 * Ex: "PHG-9A56 - I/TOYOTA HILUX CD4X2 SRV" → "PHG-9A56"
 * Ex: "YAMAHA/ FAZER/ 2020 - QZR-3I18"       → "QZR-3I18"
 */
export function extractPlaca(text: string): string | null {
  const match = text.match(PLACA_REGEX);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Lê o CSV e devolve um Map<placa, tipoAlerta> para lookup O(1) posterior.
 */
export async function loadSpreadsheet(
  filePath: string,
): Promise<Map<string, string>> {
  const parser = fs.createReadStream(filePath).pipe(
    parse({
      delimiter: [";", ","],
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
    }),
  );

  const placaMap = new Map<string, string>();
  let linhasSemPlaca = 0;

  for await (const record of parser) {
    const placaModeloCompleta = resolverCampo(record, ALIASES_COLUNA.PLACA);
    const tipoAlerta = resolverCampo(record, ALIASES_COLUNA.TIPO_ALERTA);

    if (!placaModeloCompleta || !tipoAlerta) continue;

    const placa = extractPlaca(placaModeloCompleta);

    if (placa) {
      placaMap.set(placa, tipoAlerta);
    } else {
      linhasSemPlaca++;
      console.warn(
        `[WARN] Placa não reconhecida na linha: "${placaModeloCompleta}"`,
      );
    }
  }

  if (linhasSemPlaca > 0) {
    console.warn(`[WARN] ${linhasSemPlaca} linha(s) sem placa reconhecível.`);
  }

  return placaMap;
}
