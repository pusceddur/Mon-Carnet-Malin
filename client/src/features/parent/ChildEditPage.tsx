import {
  PREFERENCE_RANGES, QUESTION_TYPES,
  type ExplanationDifficulty, type LayoutMode, type ReadingFont, type ReadingLevel, type ReadingPreferences, type ReadingTheme,
  type TTSPreferences,
} from '@aide/shared';
import { useMemo, useState, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import { createChild, deleteChild, updateChild } from '../../api/children';
import {
  Button, ConfirmDialog, EmptyState, Field, Segmented, Select, Slider, TextInput, Toggle, useToast,
} from '../../design/components';
import { READING_FONTS, readingFontClass, readingStyleVars } from '../../design/reading';
import { format } from '../../i18n/fr';
import { common } from '../../i18n/fr/common';
import { parent } from '../../i18n/fr/parent';
import { describeError, reportSessionError } from '../../state/errors';
import { PATHS } from '../../state/guards';
import { useSessionStore } from '../../state/session';
import { applyRemote } from '../../sync/SyncEngine';
import {
  AVATARS, childToForm, emptyChildForm, formToCreateRequest, formToProfile, roundToStep, toggleQuestionType, validateChildForm,
  type ChildFormErrors, type ChildFormValues,
} from './childForm';
import { formatNumber } from './format';
import { ParentPage, ParentSection } from './ParentPage';

const t = parent.childEdit;
const R = PREFERENCE_RANGES;
const NEW_ID = 'nouveau';

const AGE_OPTIONS = Array.from({ length: R.childAge.max - R.childAge.min + 1 }, (_, i) => {
  const age = R.childAge.min + i;
  return { value: String(age), label: format(t.ageOption, { age }) };
});

const levelOptions = (Object.keys(t.readingLevels) as ReadingLevel[]).map((value) => ({ value, label: t.readingLevels[value] }));
const difficultyOptions = (Object.keys(t.explanationDifficulties) as ExplanationDifficulty[]).map((value) => ({
  value,
  label: t.explanationDifficulties[value],
}));
const themeOptions = (Object.keys(common.themes) as ReadingTheme[]).map((value) => ({ value, label: common.themes[value] }));
const layoutOptions = (Object.keys(t.layoutModes) as LayoutMode[]).map((value) => ({ value, label: t.layoutModes[value] }));
const fontOptions = READING_FONTS.map((value) => ({ value, label: common.readingFonts[value] }));
const countOptions = (['3', '5', '10'] as const).map((value) => ({ value, label: value }));

function ChildForm({ childId }: { childId: string | null }): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const child = useSessionStore((s) => (childId === null ? null : (s.children.find((c) => c.id === childId) ?? null)));
  const [values, setValues] = useState<ChildFormValues>(() => (child ? childToForm(child) : emptyChildForm()));
  const [errors, setErrors] = useState<ChildFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setReading = <K extends keyof ReadingPreferences>(key: K, value: ReadingPreferences[K]): void =>
    setValues((v) => ({ ...v, reading: { ...v.reading, [key]: value } }));
  const setTts = <K extends keyof TTSPreferences>(key: K, value: TTSPreferences[K]): void =>
    setValues((v) => ({ ...v, tts: { ...v.tts, [key]: value } }));

  const previewStyle = useMemo(() => readingStyleVars(values.reading), [values.reading]);
  const backToList = (): void => {
    void navigate(`${PATHS.parent}/enfants`);
  };

  const save = async (): Promise<void> => {
    const found = validateChildForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    try {
      const saved = child ? await updateChild(formToProfile(child, values, Date.now())) : await createChild(formToCreateRequest(values));
      await applyRemote('children', [saved]);
      toast.success(t.saved);
      backToList();
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!child) return;
    try {
      await deleteChild(child.id);
      const now = Date.now();
      await applyRemote('children', [{ ...child, deletedAt: now, updatedAt: Math.max(now, child.updatedAt + 1) }]);
      const session = useSessionStore.getState();
      if (session.selectedChildId === child.id) await session.selectChild(null);
      toast.success(t.deleted);
      setConfirmDelete(false);
      backToList();
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    }
  };

  const title = child ? format(t.titleEdit, { prenom: child.firstName }) : t.titleNew;
  const px = (v: number): string => format(t.pxValue, { value: formatNumber(v, 0) });
  const em = (v: number): string => format(t.emValue, { value: formatNumber(v, 2) });

  return (
    <ParentPage title={title} intro={t.privacyNote}>
      <ParentSection title={t.sections.identity}>
        <div className="form-grid">
          <Field label={t.firstName} error={errors.firstName ? t.errors.firstName : null} required size="parent">
            <TextInput
              value={values.firstName}
              maxLength={R.firstNameLength.max}
              autoComplete="off"
              onChange={(e) => setValues((v) => ({ ...v, firstName: e.target.value }))}
            />
          </Field>
          <Field label={t.age} error={errors.age ? format(t.errors.age, { min: R.childAge.min, max: R.childAge.max }) : null} size="parent">
            <Select value={String(values.age)} options={AGE_OPTIONS} onChange={(e) => setValues((v) => ({ ...v, age: Number(e.target.value) }))} />
          </Field>
        </div>
        <div role="radiogroup" aria-label={t.avatar} className="stack stack--tight">
          <span className="parent-section__hint">{t.avatar}</span>
          <div className="avatar-grid">
            {AVATARS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="radio"
                aria-checked={values.avatar === emoji}
                aria-label={t.avatars[emoji]}
                className="avatar-choice"
                onClick={() => setValues((v) => ({ ...v, avatar: emoji }))}
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
          {errors.avatar && <p className="form-error">{t.errors.avatar}</p>}
        </div>
      </ParentSection>

      <ParentSection title={t.sections.level}>
        <Segmented
          label={t.readingLevel}
          size="parent"
          options={levelOptions}
          value={values.readingLevel}
          onChange={(readingLevel) => setValues((v) => ({ ...v, readingLevel }))}
        />
        <Segmented
          label={t.explanationDifficulty}
          size="parent"
          options={difficultyOptions}
          value={values.explanationDifficulty}
          onChange={(explanationDifficulty) => setValues((v) => ({ ...v, explanationDifficulty }))}
        />
        <p className="parent-section__hint">{t.explanationHint}</p>
      </ParentSection>

      <ParentSection title={t.sections.reading}>
        <Field label={t.font} size="parent">
          <Select value={values.reading.font} options={fontOptions} onChange={(e) => setReading('font', e.target.value as ReadingFont)} />
        </Field>
        <Slider label={t.fontSize} size="parent" min={R.fontSizePx.min} max={R.fontSizePx.max} step={1} value={values.reading.fontSizePx} formatValue={px} onChange={(v) => setReading('fontSizePx', v)} />
        <Slider label={t.lineHeight} size="parent" min={R.lineHeight.min} max={R.lineHeight.max} step={0.1} value={values.reading.lineHeight} formatValue={(v) => formatNumber(v, 1)} onChange={(v) => setReading('lineHeight', roundToStep(v, 0.1))} />
        <Slider label={t.letterSpacing} size="parent" min={R.letterSpacingEm.min} max={R.letterSpacingEm.max} step={0.01} value={values.reading.letterSpacingEm} formatValue={em} onChange={(v) => setReading('letterSpacingEm', roundToStep(v, 0.01))} />
        <Slider label={t.wordSpacing} size="parent" min={R.wordSpacingEm.min} max={R.wordSpacingEm.max} step={0.02} value={values.reading.wordSpacingEm} formatValue={em} onChange={(v) => setReading('wordSpacingEm', roundToStep(v, 0.02))} />
        <Slider label={t.columnWidth} size="parent" min={R.columnWidthEm.min} max={R.columnWidthEm.max} step={1} value={values.reading.columnWidthEm} formatValue={em} onChange={(v) => setReading('columnWidthEm', v)} />
        <Segmented label={t.theme} size="parent" options={themeOptions} value={values.reading.theme} onChange={(v) => setReading('theme', v)} />
        <Segmented label={t.layoutMode} size="parent" options={layoutOptions} value={values.reading.layoutMode} onChange={(v) => setReading('layoutMode', v)} />
        <Toggle label={t.sentenceHighlight} size="parent" checked={values.reading.sentenceHighlight} onChange={(v) => setReading('sentenceHighlight', v)} />
        <Toggle label={t.readingGuide} description={t.readingGuideHint} size="parent" checked={values.reading.readingGuide} onChange={(v) => setReading('readingGuide', v)} />
        <div className="stack stack--tight">
          <span className="parent-section__hint">{t.preview}</span>
          <div className="reading-preview" data-theme={values.reading.theme}>
            <p className={`reading ${readingFontClass(values.reading.font)}`} style={previewStyle}>
              {t.previewText}
            </p>
          </div>
        </div>
      </ParentSection>

      <ParentSection title={t.sections.tts} hint={t.ttsVoiceNote}>
        <Slider label={t.ttsRate} size="parent" min={R.ttsRate.min} max={R.ttsRate.max} step={0.05} value={values.tts.rate} formatValue={(v) => format(t.rateValue, { value: formatNumber(v, 2) })} onChange={(v) => setTts('rate', roundToStep(v, 0.05))} />
        <Slider label={t.ttsPitch} size="parent" min={R.ttsPitch.min} max={R.ttsPitch.max} step={0.05} value={values.tts.pitch} formatValue={(v) => formatNumber(v, 2)} onChange={(v) => setTts('pitch', roundToStep(v, 0.05))} />
      </ParentSection>

      <ParentSection title={t.sections.exercises}>
        <Segmented
          label={t.questionCount}
          size="parent"
          options={countOptions}
          value={String(values.exercises.defaultQuestionCount) as (typeof countOptions)[number]['value']}
          onChange={(v) => setValues((s) => ({ ...s, exercises: { ...s.exercises, defaultQuestionCount: Number(v) as 3 | 5 | 10 } }))}
        />
        <span className="parent-section__hint">{t.questionTypes}</span>
        <div className="check-grid">
          {QUESTION_TYPES.map((type) => (
            <Toggle
              key={type}
              size="parent"
              label={t.questionTypeLabels[type]}
              checked={values.exercises.enabledTypes.includes(type)}
              onChange={(enabled) =>
                setValues((s) => ({ ...s, exercises: { ...s.exercises, enabledTypes: toggleQuestionType(s.exercises.enabledTypes, type, enabled) } }))
              }
            />
          ))}
        </div>
        {errors.questionTypes && <p className="form-error">{t.errors.questionTypes}</p>}
      </ParentSection>

      <div className="parent-sticky-actions">
        {child && (
          <Button variant="danger" size="parent" onClick={() => setConfirmDelete(true)}>
            {t.delete}
          </Button>
        )}
        <Button variant="secondary" size="parent" onClick={backToList}>
          {common.cancel}
        </Button>
        <Button size="parent" loading={saving} onClick={() => void save()}>
          {t.save}
        </Button>
      </div>

      {child && (
        <ConfirmDialog
          open={confirmDelete}
          size="parent"
          tone="danger"
          title={format(t.deleteTitle, { prenom: child.firstName })}
          message={t.deleteMessage}
          confirmLabel={t.deleteConfirm}
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </ParentPage>
  );
}

/** Create (`/parent/enfants/nouveau`) or edit a child profile (§39: only what reading needs). */
export default function ChildEditPage(): JSX.Element {
  const navigate = useNavigate();
  const { childId = NEW_ID } = useParams();
  const exists = useSessionStore((s) => s.children.some((c) => c.id === childId));

  if (childId !== NEW_ID && !exists) {
    return (
      <ParentPage title={parent.children.title}>
        <EmptyState
          emoji="🔎"
          title={t.notFound}
          action={
            <Button variant="secondary" size="parent" onClick={() => navigate(`${PATHS.parent}/enfants`)}>
              {common.back}
            </Button>
          }
        />
      </ParentPage>
    );
  }
  // Remount the form when switching profiles so its local state starts from the right child.
  return <ChildForm key={childId} childId={childId === NEW_ID ? null : childId} />;
}
