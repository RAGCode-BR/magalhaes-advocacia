// Colunas do funil do CRM. Cada ambiente guarda as suas em crm_pipeline_stages;
// a coluna fixa "Contrato fechado" (id "finalizado") é sempre a última e conta
// como venda fechada no relatório.
export const FINAL_STAGE = "finalizado";

export type StageRow = { stage_id: string; label: string; color: string; position: number | null };
export type CrmStage = {
  id: string;
  label: string;
  color: string;
  position: number;
  fixed: boolean;
};

export function orderStages(rows: StageRow[]): CrmStage[] {
  return rows
    .map((row) => ({
      id: row.stage_id,
      label: row.label,
      color: row.color,
      position: row.position ?? 49,
      fixed: row.stage_id === FINAL_STAGE,
    }))
    .sort(
      (a, b) =>
        Number(a.fixed) - Number(b.fixed) || a.position - b.position || a.id.localeCompare(b.id),
    );
}

export function newStageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `c_${Array.from(bytes, (byte) => (byte % 36).toString(36)).join("")}`;
}

// Posição de uma coluna nova: logo depois da última coluna comum (máximo 49).
export function nextStagePosition(stages: CrmStage[]): number {
  const open = stages.filter((stage) => !stage.fixed);
  return open.length ? Math.min(49, Math.max(...open.map((stage) => stage.position)) + 1) : 0;
}
