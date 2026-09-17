import knexFactory from 'knex';
import { describe, expect, it } from 'vitest';
import { buildInitialSchema, INITIAL_TABLES, SYNC_SEQ_TABLES } from '../../src/db/migrations/001_initial';
import { buildInvitationsSchema } from '../../src/db/migrations/002_invitations';
import { buildClientDiagnosticsSchema } from '../../src/db/migrations/003_client_diagnostics';
import { buildWorkerJobsSchema } from '../../src/db/migrations/004_worker_jobs';

describe('migration 001 renders valid MySQL DDL', () => {
  const mysql = knexFactory({ client: 'mysql2' });
  const statements = buildInitialSchema(mysql.schema, 'mysql').toSQL().map((s) => s.sql);
  const ddl = statements.join(';\n');

  it('creates all tables with utf8mb4 binary collation', () => {
    for (const table of INITIAL_TABLES) expect(ddl).toContain(`create table \`${table}\``);
    const creates = statements.filter((s) => s.startsWith('create table'));
    expect(creates).toHaveLength(INITIAL_TABLES.length);
    for (const s of creates) expect(s).toContain('default character set utf8mb4 collate utf8mb4_bin engine = InnoDB');
  });

  it('uses longtext for JSON and composite primary keys', () => {
    expect(ddl).toMatch(/`blocks_json` longtext not null/);
    expect(ddl).toContain('primary key (`document_id`, `page_index`)');
    expect(ddl).toContain('primary key (`child_id`, `document_id`)');
    expect(ddl).toContain('primary key (`parent_id`, `headword`)');
    expect(ddl).toContain('primary key (`document_id`, `file_index`)');
  });

  it('never indexes TEXT columns and gives every indexed varchar a length', () => {
    const textColumns = new Set<string>();
    for (const m of ddl.matchAll(/`(\w+)` (?:long|medium)?text/g)) textColumns.add(m[1]!);
    const indexed = [...ddl.matchAll(/(?:index|unique|primary key)[^(]*\(([^)]+)\)/g)]
      .flatMap((m) => m[1]!.split(',').map((c) => c.trim().replace(/`/g, '')));
    for (const col of indexed) expect(textColumns.has(col), col).toBe(false);
    expect(ddl).not.toMatch(/varchar\(\)/);
  });
});

describe('migration 001 amendments v1.1 (§15.2, §15.3)', () => {
  const mysql = knexFactory({ client: 'mysql2' });
  const statements = buildInitialSchema(mysql.schema, 'mysql').toSQL().map((s) => s.sql);
  const tableDdl = (name: string): string => statements.filter((s) => s.includes(`\`${name}\``)).join(';\n');

  it('every synced table has server_seq with a (parent_id, server_seq) index', () => {
    for (const table of SYNC_SEQ_TABLES) {
      const ddl = tableDdl(table);
      expect(ddl, table).toMatch(/`server_seq` bigint not null default '0'/);
      expect(ddl, table).toMatch(/index `\w+`\(`parent_id`, `server_seq`\)/);
    }
    expect(tableDdl('sync_counters')).toContain('primary key (`parent_id`)');
  });

  it('adds lockout columns, AI cost/readability, alert seen_at, ai_jobs and page images', () => {
    const users = tableDdl('users');
    for (const col of ['pin_failed_count', 'pin_locked_until', 'login_failed_count', 'login_locked_until']) expect(users).toContain(`\`${col}\``);
    expect(tableDdl('ai_requests')).toMatch(/`cost_micros` bigint/);
    expect(tableDdl('ai_requests')).toMatch(/`readability_warning` boolean not null default '0'/);
    expect(tableDdl('safety_alerts')).toMatch(/`seen_at` bigint null/);
    const jobs = tableDdl('ai_jobs');
    expect(jobs).toMatch(/`result_json` longtext null/);
    expect(jobs).toMatch(/index `\w+`\(`parent_id`, `created_at`\)/);
    expect(tableDdl('document_page_images')).toContain('primary key (`document_id`, `page_index`)');
  });
});

describe('migration 002 (invitations) renders valid MySQL DDL', () => {
  const mysql = knexFactory({ client: 'mysql2' });
  const statements = buildInvitationsSchema(mysql.schema, 'mysql').toSQL().map((s) => s.sql);
  const ddl = statements.join(';\n');

  it('adds users.is_owner as a non-null boolean defaulting to false', () => {
    expect(ddl).toContain("alter table `users` add `is_owner` boolean not null default '0'");
  });

  it('creates app_config with a varchar(64) key, a text value and utf8mb4 binary collation', () => {
    const create = statements.find((s) => s.startsWith('create table `app_config`'));
    expect(create).toBeDefined();
    expect(create).toContain('`key` varchar(64)');
    expect(create).toContain('primary key (`key`)');
    expect(create).toMatch(/`value_json` text not null/);
    expect(create).toMatch(/`updated_at` bigint not null/);
    expect(create).toContain('default character set utf8mb4 collate utf8mb4_bin engine = InnoDB');
  });
});

describe('migration 003 (client diagnostics) renders valid MySQL DDL', () => {
  const mysql = knexFactory({ client: 'mysql2' });
  const statements = buildClientDiagnosticsSchema(mysql.schema, 'mysql').toSQL().map((s) => s.sql);
  const create = statements.find((s) => s.startsWith('create table `client_diagnostics`'));
  const ddl = statements.join(';\n');

  it('creates client_diagnostics with sized varchars, text payloads, bigint timestamps and utf8mb4 binary collation', () => {
    expect(create).toBeDefined();
    expect(create).toContain('`id` varchar(36)');
    expect(create).toContain('primary key (`id`)');
    expect(create).toMatch(/`parent_id` varchar\(36\) not null/);
    expect(create).toMatch(/`kind` varchar\(32\) not null/);
    expect(create).toMatch(/`stage` varchar\(40\) null/);
    expect(create).toMatch(/`message` text not null/);
    expect(create).toMatch(/`context_json` text not null/);
    expect(create).toMatch(/`user_agent` varchar\(400\) not null/);
    expect(create).toMatch(/`occurred_at` bigint not null/);
    expect(create).toMatch(/`created_at` bigint not null/);
    expect(create).toContain('default character set utf8mb4 collate utf8mb4_bin engine = InnoDB');
  });

  it('indexes (parent_id, created_at), never indexes TEXT and cascades the deletion of a parent', () => {
    expect(ddl).toMatch(/index `\w+`\(`parent_id`, `created_at`\)/);
    expect(ddl).not.toMatch(/index `\w+`\([^)]*`(message|context_json)`/);
    expect(ddl).toMatch(/foreign key \(`parent_id`\) references `users` \(`id`\) on delete CASCADE/);
  });
});

describe('migration 004 (worker jobs) renders valid MySQL DDL', () => {
  const mysql = knexFactory({ client: 'mysql2' });
  const statements = buildWorkerJobsSchema(mysql.schema, 'mysql').toSQL().map((s) => s.sql);
  const jobs = statements.filter((s) => s.includes('`worker_jobs`')).join(';\n');
  const state = statements.filter((s) => s.includes('`worker_state`')).join(';\n');

  it('creates worker_jobs with the §17.2 columns, utf8mb4 binary collation and a cascading parent', () => {
    const create = statements.find((s) => s.startsWith('create table `worker_jobs`'));
    expect(create).toBeDefined();
    expect(create).toContain('default character set utf8mb4 collate utf8mb4_bin engine = InnoDB');
    for (const pattern of [
      /`id` varchar\(36\)/, /`parent_id` varchar\(36\) not null/, /`kind` varchar\(16\) not null/, /`tier` varchar\(16\) not null/,
      /`operation` varchar\(40\) not null/, /`document_id` varchar\(36\) null/, /`page_index` int null/, /`image_sha256` varchar\(64\) null/,
      /`request_json` longtext not null/, /`status` varchar\(16\) not null/, /`priority` int not null default '0'/, /`lease_until` bigint null/,
      /`leased_by` varchar\(64\) null/, /`attempts` int not null default '0'/, /`result_json` longtext null/, /`error` varchar\(40\) null/,
      /`created_at` bigint not null/, /`updated_at` bigint not null/, /`expires_at` bigint not null/,
    ]) expect(create).toMatch(pattern);
    expect(create).toContain('primary key (`id`)');
    expect(jobs).toMatch(/foreign key \(`parent_id`\) references `users` \(`id`\) on delete CASCADE/);
  });

  it('indexes (status, priority, created_at), (parent_id, document_id, page_index) and (expires_at), never TEXT', () => {
    expect(jobs).toMatch(/index `\w+`\(`status`, `priority`, `created_at`\)/);
    expect(jobs).toMatch(/index `\w+`\(`parent_id`, `document_id`, `page_index`\)/);
    expect(jobs).toMatch(/index `\w+`\(`expires_at`\)/);
    expect(jobs).not.toMatch(/index `\w+`\([^)]*`(request_json|result_json)`/);
  });

  it('creates worker_state keyed by the worker name', () => {
    expect(state).toContain('`worker_name` varchar(64)');
    expect(state).toContain('primary key (`worker_name`)');
    expect(state).toMatch(/`last_seen_at` bigint not null/);
    expect(state).toMatch(/`limited_until` bigint null/);
    expect(state).toMatch(/`info_json` text not null/);
    expect(state).toContain('default character set utf8mb4 collate utf8mb4_bin engine = InnoDB');
  });
});
