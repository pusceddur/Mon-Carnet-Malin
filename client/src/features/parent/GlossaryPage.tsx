import { LIMITS, type GlossaryEntry } from '@aide/shared';
import { useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';
import { deleteGlossaryEntry, listGlossary, putGlossaryEntry } from '../../api/glossary';
import { db } from '../../db/localDb';
import {
  BottomSheet, Button, ConfirmDialog, EmptyState, Field, Select, Spinner, TextArea, TextInput, useToast,
} from '../../design/components';
import { format } from '../../i18n/fr';
import { common } from '../../i18n/fr/common';
import { parent } from '../../i18n/fr/parent';
import { useOnlineStatus } from '../../platform/online';
import { describeError, reportSessionError } from '../../state/errors';
import {
  countWords, emptyGlossaryForm, entryToForm, filterGlossary, formToGlossaryEntry, PARTS_OF_SPEECH, validateGlossaryForm,
  type GlossaryFormErrors, type GlossaryFormValues,
} from './glossaryForm';
import { ParentPage } from './ParentPage';

const t = parent.glossary;
const posOptions = PARTS_OF_SPEECH.map((value) => ({ value, label: t.partsOfSpeech[value] }));

function errorText(error: GlossaryFormErrors[keyof GlossaryFormErrors], field: 'headword' | 'kidDefinition' | 'other'): string | null {
  switch (error) {
    case undefined:
      return null;
    case 'required':
      return field === 'headword' ? t.errors.headword : t.errors.definition;
    case 'duplicate':
      return t.errors.duplicate;
    case 'tooManyWords':
      return format(t.errors.definitionTooLong, { max: LIMITS.kidDefinitionMaxWords });
    default:
      return format(t.errors.tooLong, { max: field === 'headword' ? LIMITS.wordMaxChars : 500 });
  }
}

async function mirrorLocally(entries: GlossaryEntry[]): Promise<void> {
  await db.transaction('rw', db.glossary, async () => {
    await db.glossary.clear();
    await db.glossary.bulkPut(entries);
  });
}

/** Parent glossary entries (take precedence over the built-in glossary and the dictionary). */
export default function GlossaryPage(): JSX.Element {
  const toast = useToast();
  const online = useOnlineStatus();
  const [entries, setEntries] = useState<GlossaryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ original: string | null; values: GlossaryFormValues } | null>(null);
  const [errors, setErrors] = useState<GlossaryFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<GlossaryEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = await db.glossary.toArray().catch(() => []);
      if (!cancelled) setEntries((current) => current ?? local);
      try {
        const remote = await listGlossary();
        await mirrorLocally(remote);
        if (!cancelled) setEntries(remote);
      } catch (error) {
        await reportSessionError(error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => filterGlossary(entries ?? [], query), [entries, query]);

  const openForm = (entry: GlossaryEntry | null): void => {
    setErrors({});
    setEditing({ original: entry?.headword ?? null, values: entry ? entryToForm(entry) : emptyGlossaryForm() });
  };
  const change = <K extends keyof GlossaryFormValues>(key: K, value: GlossaryFormValues[K]): void =>
    setEditing((e) => (e ? { ...e, values: { ...e.values, [key]: value } } : e));

  const save = async (event?: FormEvent<HTMLFormElement>): Promise<void> => {
    event?.preventDefault();
    if (!editing || saving) return;
    const found = validateGlossaryForm(editing.values, (entries ?? []).map((e) => e.headword), editing.original);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const entry = formToGlossaryEntry(editing.values);
    setSaving(true);
    try {
      const saved = await putGlossaryEntry(entry);
      if (editing.original !== null && editing.original !== saved.headword) {
        await deleteGlossaryEntry(editing.original);
        await db.glossary.delete(editing.original);
      }
      await db.glossary.put(saved);
      setEntries((list) => [...(list ?? []).filter((e) => e.headword !== saved.headword && e.headword !== editing.original), saved]);
      setEditing(null);
      toast.success(t.saved);
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!toDelete) return;
    try {
      await deleteGlossaryEntry(toDelete.headword);
      await db.glossary.delete(toDelete.headword);
      setEntries((list) => (list ?? []).filter((e) => e.headword !== toDelete.headword));
      toast.success(t.deleted);
      setToDelete(null);
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    }
  };

  const words = editing ? countWords(editing.values.kidDefinition) : 0;

  return (
    <ParentPage
      title={t.title}
      intro={t.intro}
      actions={
        <Button size="parent" icon="➕" disabled={!online} onClick={() => openForm(null)}>
          {t.add}
        </Button>
      }
    >
      {!online && <p className="form-notice" role="status">{t.offline}</p>}
      {entries === null ? (
        <Spinner size="lg" />
      ) : entries.length === 0 ? (
        <EmptyState emoji="📖" title={t.emptyTitle} message={t.emptyMessage} />
      ) : (
        <>
          <Field label={t.search} size="parent">
            <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoCapitalize="off" spellCheck={false} />
          </Field>
          {visible.length === 0 ? (
            <p className="parent-section__hint">{t.noResult}</p>
          ) : (
            <ul className="parent-list">
              {visible.map((entry) => (
                <li key={entry.headword} className="parent-list__item">
                  <span className="parent-list__main">
                    <span className="parent-list__title">
                      {entry.headword} <span className="tag">{t.partsOfSpeech[entry.partOfSpeech]}</span>
                    </span>
                    <span>{entry.kidDefinition}</span>
                    {entry.example && <span className="parent-list__meta">{entry.example}</span>}
                  </span>
                  <span className="parent-actions">
                    <Button variant="secondary" size="parent" disabled={!online} onClick={() => openForm(entry)}>
                      {t.edit}
                    </Button>
                    <Button variant="ghost" size="parent" disabled={!online} onClick={() => setToDelete(entry)}>
                      {t.delete}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <BottomSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        size="parent"
        height="tall"
        title={editing?.original ? format(t.formTitleEdit, { mot: editing.original }) : t.formTitleNew}
        footer={
          <div className="parent-actions">
            <Button variant="secondary" size="parent" onClick={() => setEditing(null)}>
              {common.cancel}
            </Button>
            <Button size="parent" loading={saving} onClick={() => void save()}>
              {t.save}
            </Button>
          </div>
        }
      >
        {editing && (
          <form className="stack" noValidate onSubmit={(e) => void save(e)}>
            <div className="form-grid">
              <Field label={t.headword} hint={t.headwordHint} error={errorText(errors.headword, 'headword')} required size="parent">
                <TextInput value={editing.values.headword} onChange={(e) => change('headword', e.target.value)} autoCapitalize="off" maxLength={LIMITS.wordMaxChars} />
              </Field>
              <Field label={t.partOfSpeech} size="parent">
                <Select
                  value={editing.values.partOfSpeech}
                  options={posOptions}
                  onChange={(e) => change('partOfSpeech', e.target.value as GlossaryFormValues['partOfSpeech'])}
                />
              </Field>
            </div>
            <Field
              label={t.definition}
              hint={`${format(t.definitionHint, { max: LIMITS.kidDefinitionMaxWords })} ${format(t.wordCount, { count: words, max: LIMITS.kidDefinitionMaxWords })}`}
              error={errorText(errors.kidDefinition, 'kidDefinition')}
              required
              size="parent"
            >
              <TextArea rows={3} value={editing.values.kidDefinition} onChange={(e) => change('kidDefinition', e.target.value)} maxLength={500} />
            </Field>
            <Field label={t.example} optional error={errorText(errors.example, 'other')} size="parent">
              <TextInput value={editing.values.example} onChange={(e) => change('example', e.target.value)} maxLength={500} />
            </Field>
            <Field label={t.forms} hint={t.formsHint} optional error={errorText(errors.forms, 'other')} size="parent">
              <TextInput value={editing.values.forms} onChange={(e) => change('forms', e.target.value)} autoCapitalize="off" />
            </Field>
          </form>
        )}
      </BottomSheet>

      <ConfirmDialog
        open={toDelete !== null}
        size="parent"
        tone="danger"
        title={format(t.deleteTitle, { mot: toDelete?.headword ?? '' })}
        confirmLabel={t.deleteConfirm}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </ParentPage>
  );
}
