import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const count = (value: unknown): number => Number(value ?? 0);
const countMap = (rows: { key: string; total: number | string }[]): Record<string, number> =>
  Object.fromEntries(rows.map((row) => [row.key, count(row.total)]));

@Injectable()
export class IdentityDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** System-wide account and access snapshot for administrators. */
  async admin(): Promise<Record<string, unknown>> {
    const q = <T>(sql: string) => this.dataSource.query(sql) as Promise<T>;
    const [users, roles, pending, recentLogins, mustChange, audit] = await Promise.all([
      q<{ key: string; total: string }[]>('SELECT status AS key, COUNT(*)::int AS total FROM app_user GROUP BY status'),
      q<{ key: string; total: string }[]>(
        `SELECT g.role_code AS key, COUNT(DISTINCT g.user_id)::int AS total
           FROM role_grant g JOIN app_user u ON u.id = g.user_id AND u.status = 'ACTIVE'
          WHERE g.revoked_at IS NULL GROUP BY g.role_code`),
      q<{ total: string }[]>(`SELECT COUNT(*)::int AS total FROM app_user WHERE status = 'PENDING_EMAIL'`),
      q<{ total: string }[]>(`SELECT COUNT(DISTINCT user_id)::int AS total FROM session_family WHERE created_at >= now() - interval '24 hours'`)
        .catch(() => [{ total: '0' }]),
      q<{ total: string }[]>(`SELECT COUNT(*)::int AS total FROM app_user WHERE status = 'ACTIVE' AND must_change_password`),
      q<{ action: string; entity_type: string; created_at: Date }[]>(
        `SELECT action, entity_type, created_at FROM audit_log ORDER BY id DESC LIMIT 10`),
    ]);
    const byStatus = countMap(users);
    return {
      users: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        by_status: byStatus,
        pending_email_verification: count(pending[0]?.total),
        must_change_password: count(mustChange[0]?.total),
        active_last_24h: count(recentLogins[0]?.total),
      },
      active_users_by_role: countMap(roles),
      recent_audit: audit.map((row) => ({ action: row.action, entity_type: row.entity_type, created_at: row.created_at })),
      generated_at: new Date().toISOString(),
    };
  }
}
