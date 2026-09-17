// safety_alerts writes (the parent activity page reads them through activity.ts).
import { newId, type ActivityAlertKind } from '@aide/shared';
import type { Db } from './common';

export interface SafetyAlertInput {
  parentId: string;
  childId: string | null;
  documentId: string | null;
  kind: ActivityAlertKind;
  /** French, shown to the parent. Deterministic for the same content so that duplicates are skipped. */
  detail: string;
  createdAt: number;
  /** Only alerts created at or after this time are considered duplicates (e.g. start of the month). */
  dedupSince?: number;
}

export interface SafetyAlertsRepository {
  /** Inserts unless the same (parent, kind, detail) already exists; true when inserted. */
  insertOnce(alert: SafetyAlertInput): Promise<boolean>;
  existsSince(parentId: string, kind: ActivityAlertKind, since: number): Promise<boolean>;
}

const DETAIL_MAX_CHARS = 1000;

export function createSafetyAlertsRepository(db: Db): SafetyAlertsRepository {
  return {
    async insertOnce(alert) {
      const detail = alert.detail.slice(0, DETAIL_MAX_CHARS);
      const query = db('safety_alerts').where({ parent_id: alert.parentId, kind: alert.kind, detail });
      if (alert.dedupSince !== undefined) query.andWhere('created_at', '>=', alert.dedupSince);
      const existing = (await query.first('id')) as { id: unknown } | undefined;
      if (existing) return false;
      await db('safety_alerts').insert({
        id: newId(),
        parent_id: alert.parentId,
        child_id: alert.childId,
        document_id: alert.documentId,
        kind: alert.kind,
        detail,
        created_at: alert.createdAt,
        seen_at: null,
      });
      return true;
    },
    async existsSince(parentId, kind, since) {
      const row = (await db('safety_alerts').where({ parent_id: parentId, kind }).andWhere('created_at', '>=', since).first('id')) as { id: unknown } | undefined;
      return row !== undefined;
    },
  };
}

export function createMemorySafetyAlertsRepository(): SafetyAlertsRepository & { alerts: (SafetyAlertInput & { id: string })[] } {
  const alerts: (SafetyAlertInput & { id: string })[] = [];
  return {
    alerts,
    insertOnce(alert) {
      const detail = alert.detail.slice(0, DETAIL_MAX_CHARS);
      const duplicate = alerts.some((a) => a.parentId === alert.parentId && a.kind === alert.kind && a.detail === detail
        && (alert.dedupSince === undefined || a.createdAt >= alert.dedupSince));
      if (duplicate) return Promise.resolve(false);
      alerts.push({ ...alert, detail, id: newId() });
      return Promise.resolve(true);
    },
    existsSince(parentId, kind, since) {
      return Promise.resolve(alerts.some((a) => a.parentId === parentId && a.kind === kind && a.createdAt >= since));
    },
  };
}
