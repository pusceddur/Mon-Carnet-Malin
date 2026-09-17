import { newId, type Id } from '@aide/shared';
import { useEffect, useRef, useState, type ChangeEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { Button, Field, IconButton, TextInput, Toggle, useToast } from '../../design/components';
import { detectFileKind, isHeic, titleFromFileName } from '../../documents/DocumentParser';
import { analyzeFile, ImportError, importFiles } from '../../documents/ImportService';
import { draftProblem, isMixedEpub, moveItem, removeItem, totalPages, updateItem, type DraftItem } from '../../documents/ui/importDraft';
import '../../documents/ui/parentDocuments.css';
import { format } from '../../i18n/fr';
import { documents } from '../../i18n/fr/documents';
import { decodeToRgba, encodeRgbaJpeg } from '../../ocr/preprocess/canvas';
import { isIPad, isStandalonePwa } from '../../platform/support';
import { useSessionStore } from '../../state/session';
import { ParentPage, ParentSection } from './ParentPage';

const t = documents.importPage;
const ACCEPT_FILES = 'application/pdf,.pdf,.epub,application/epub+zip,image/*,.heic,.heif';
const KIND_ICONS: Record<DraftItem['kind'], string> = { pdf: '📄', epub: '📘', image: '🖼️' };

async function previewFor(file: File): Promise<string | null> {
  if (!isHeic(file)) return URL.createObjectURL(file);
  // HEIC: only Safari decodes it; a small JPEG preview avoids decoding the full photo in every <img>.
  const rgba = await decodeToRgba(file, 320);
  return URL.createObjectURL(await encodeRgbaJpeg(rgba, 0.8));
}

function InstallGuide({ onContinue }: { onContinue: () => void }): JSX.Element {
  return (
    <ParentSection title={t.installTitle} hint={t.installWhy}>
      <p className="docs-lead">{t.installIntro}</p>
      <ol className="docs-steps">
        <li>{t.installStep1}</li>
        <li>{t.installStep2}</li>
        <li>{t.installStep3}</li>
      </ol>
      <div className="parent-actions">
        <Button variant="ghost" size="parent" onClick={onContinue}>
          {t.continueAnyway}
        </Button>
      </div>
    </ParentSection>
  );
}

/** Import of PDF / EPUB / images / camera photos with an ordered preview list (contract §15.6). */
export default function ImportPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const allChildren = useSessionStore((s) => s.children);
  const children = allChildren.filter((c) => c.deletedAt === null);
  const [installGuideDismissed, setInstallGuideDismissed] = useState(false);
  const needsInstall = isIPad() && !isStandalonePwa();

  const [title, setTitle] = useState('');
  const titleTouched = useRef(false);
  const [childIds, setChildIds] = useState<Set<Id> | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const filesInput = useRef<HTMLInputElement | null>(null);
  const urls = useRef(new Set<string>());

  // Every child is selected by default (profiles may load after the first render).
  const selected = childIds ?? new Set(children.map((c) => c.id));

  useEffect(() => {
    const owned = urls.current;
    return () => {
      for (const url of owned) URL.revokeObjectURL(url);
      owned.clear();
    };
  }, []);

  const addFiles = (files: File[], fromCamera: boolean): void => {
    let photoNumber = photoCount;
    const added: DraftItem[] = [];
    for (const file of files) {
      const kind = detectFileKind(file);
      if (fromCamera) photoNumber++;
      added.push({
        id: newId(),
        file,
        name: fromCamera ? format(t.photoName, { number: photoNumber }) : file.name,
        kind: kind ?? 'image',
        pageCount: kind === 'image' && !isHeic(file) ? 1 : null,
        previewUrl: null,
        error: kind ? null : 'unsupported_file',
      });
    }
    setPhotoCount(photoNumber);
    setItems((prev) => [...prev, ...added]);
    if (!titleTouched.current && title.trim() === '') {
      const named = files.find((f) => !fromCamera && detectFileKind(f) !== null);
      if (named) setTitle(titleFromFileName(named.name));
    }
    for (const item of added) {
      if (item.error) continue;
      if (item.kind === 'image') {
        previewFor(item.file).then(
          (url) => {
            if (url) urls.current.add(url);
            setItems((prev) => updateItem(prev, item.id, { previewUrl: url, pageCount: 1 }));
          },
          () => setItems((prev) => updateItem(prev, item.id, { error: isHeic(item.file) ? 'heic_unsupported' : null, pageCount: 1 })),
        );
      }
      if (item.kind === 'pdf' || item.kind === 'epub') {
        const fallback = item.kind === 'pdf' ? 'pdf_unreadable' : 'epub_unreadable';
        analyzeFile(item.file).then(
          (analyzed) => {
            setItems((prev) => updateItem(prev, item.id, { pageCount: analyzed.pageCount }));
            // The book title is a better proposal than the file name.
            if (analyzed.title && !titleTouched.current) setTitle(analyzed.title);
          },
          (error: unknown) =>
            setItems((prev) => updateItem(prev, item.id, { error: error instanceof ImportError ? error.code : fallback, pageCount: 0 })),
        );
      }
    }
  };

  const onInputChange = (event: ChangeEvent<HTMLInputElement>, fromCamera: boolean): void => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length > 0) addFiles(files, fromCamera);
  };

  const onRemove = (item: DraftItem): void => {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      urls.current.delete(item.previewUrl);
    }
    setItems((prev) => removeItem(prev, item.id));
  };

  const toggleChild = (id: Id, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setChildIds(next);
  };

  const problem = draftProblem(title, items);
  const problemMessage =
    problem === 'title_required' ? t.titleRequired
      : problem === 'files_required' ? t.filesRequired
        : problem === 'has_errors' ? t.fixErrors
          : problem === 'epub_must_be_alone' ? t.errors.epub_must_be_alone
            : problem === 'analyzing' ? t.waitAnalysis
              : null;

  const onSubmit = async (): Promise<void> => {
    setSubmitted(true);
    if (problem !== null || busy) return;
    setBusy(true);
    try {
      await importFiles(
        items.map((i) => i.file),
        { title: title.trim(), childIds: children.filter((c) => selected.has(c.id)).map((c) => c.id) },
      );
      toast.success(items.length === 1 && items[0]!.kind === 'epub' ? t.successEpub : t.success);
      void navigate('/parent/documents');
    } catch (error) {
      const code = error instanceof ImportError ? error.code : 'generic';
      toast.error(t.errors[code]);
      if (error instanceof ImportError && error.fileName) {
        const bad = items.find((i) => i.file.name === error.fileName);
        if (bad && error.code !== 'storage_failed' && error.code !== 'too_many_pages' && error.code !== 'epub_must_be_alone') {
          setItems((prev) => updateItem(prev, bad.id, { error: error.code }));
        }
      }
    } finally {
      setBusy(false);
    }
  };

  if (needsInstall && !installGuideDismissed) {
    return (
      <ParentPage title={t.title}>
        <InstallGuide onContinue={() => setInstallGuideDismissed(true)} />
      </ParentPage>
    );
  }

  const pages = totalPages(items);
  const mixedEpub = isMixedEpub(items);

  return (
    <ParentPage title={t.title} intro={t.intro}>
      <ParentSection title={t.detailsTitle}>
        <Field label={t.titleLabel} hint={t.titleHint} size="parent" required error={submitted && problem === 'title_required' ? t.titleRequired : null}>
          <TextInput
            value={title}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => {
              titleTouched.current = true;
              setTitle(e.target.value);
            }}
          />
        </Field>
        <fieldset className="docs-fieldset">
          <legend className="docs-fieldset__legend">{t.childrenLabel}</legend>
          {children.length === 0 ? (
            <p className="docs-muted">{t.noChildren}</p>
          ) : (
            <div className="check-grid">
              {children.map((child) => (
                <Toggle
                  key={child.id}
                  size="parent"
                  label={`${child.avatar} ${child.firstName}`}
                  checked={selected.has(child.id)}
                  onChange={(on) => toggleChild(child.id, on)}
                />
              ))}
            </div>
          )}
        </fieldset>
      </ParentSection>

      <ParentSection title={t.pagesTitle} hint={t.filesHint}>
        <div className="parent-actions">
          <Button size="parent" variant="secondary" icon="📷" onClick={() => cameraInput.current?.click()}>
            {photoCount > 0 ? t.takeNextPhoto : t.takePhoto}
          </Button>
          <Button size="parent" variant="secondary" icon="📁" onClick={() => filesInput.current?.click()}>
            {t.chooseFiles}
          </Button>
          <input
            ref={cameraInput}
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => onInputChange(e, true)}
          />
          <input
            ref={filesInput}
            className="visually-hidden"
            type="file"
            accept={ACCEPT_FILES}
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => onInputChange(e, false)}
          />
        </div>

        {items.length === 0 ? (
          <p className="docs-muted">{t.listEmpty}</p>
        ) : (
          <>
            <ol className="docs-import-list">
              {items.map((item, index) => {
                const error = item.error ?? (mixedEpub && item.kind === 'epub' ? 'epub_must_be_alone' : null);
                return (
                  <li key={item.id} className={`docs-import-item${error ? ' docs-import-item--error' : ''}`}>
                    <span className="docs-import-item__thumb" aria-hidden="true">
                      {item.previewUrl ? <img src={item.previewUrl} alt="" /> : <span>{KIND_ICONS[item.kind]}</span>}
                    </span>
                    <span className="docs-import-item__main">
                      <span className="docs-import-item__name">{item.name}</span>
                      <span className="docs-import-item__meta">
                        {error
                          ? t.errors[error]
                          : item.pageCount === null
                            ? item.kind === 'epub' ? t.countingEpub : t.counting
                            : format(t.pageCount, { count: item.pageCount })}
                      </span>
                    </span>
                    <span className="docs-import-item__actions">
                      <IconButton size="parent" icon="⬆️" aria-label={format(t.moveUp, { name: item.name })} disabled={index === 0} onClick={() => setItems((prev) => moveItem(prev, item.id, -1))} />
                      <IconButton size="parent" icon="⬇️" aria-label={format(t.moveDown, { name: item.name })} disabled={index === items.length - 1} onClick={() => setItems((prev) => moveItem(prev, item.id, 1))} />
                      <IconButton size="parent" icon="✖️" variant="ghost" aria-label={format(t.remove, { name: item.name })} onClick={() => onRemove(item)} />
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="docs-muted">{format(t.totalPages, { count: pages })}</p>
          </>
        )}
      </ParentSection>

      <div className="parent-sticky-actions">
        {submitted && problemMessage && (
          <p className="parent-sticky-actions__status" role="alert">
            {problemMessage}
          </p>
        )}
        <Button size="parent" icon="📥" loading={busy} onClick={() => void onSubmit()}>
          {t.submit}
        </Button>
      </div>
    </ParentPage>
  );
}
