import knexFactory from 'knex';
import { describe, expect, it } from 'vitest';
import { buildInitialSchema, INITIAL_TABLES } from '../../src/db/migrations/001_initial';

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
