import type { TextBlock } from '@aide/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ChangeEvent, type JSX } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button, EmptyState, Field, IconButton, Segmented, Select, Spinner, TextArea, useToast } from '../../design/components';
import { getDocument, getJob, getPage } from '../../documents/DocumentCache';
import { ProcessingError, processingQueue, useDocumentProgress } from '../../documents/ProcessingQueue';
import { editorErrorMessage, jobErrorMessage, pageStatusLabel } from '../../documents/ui/labels';
import { usePageSourceImage, useRotatedPreview } from '../../documents/ui/pageSource';
import '../../documents/ui/parentDocuments.css';
import { FULL_FRAME, QuadEditor, type NormalizedQuad } from '../../documents/ui/QuadEditor';
import { format } from '../../i18n/fr';
import { documents } from '../../i18n/fr/documents';
import type { QuarterTurn } from '../../ocr/preprocess/geometry';
import { useOnlineStatus } from '../../platform/online';
import { ParentPage, ParentSection } from './ParentPage';

const t = documents.editor;

type Tab = 'image' | 'text';
type Action = 'rerun' | 'server' | 'retake' | 'save';

interface EditableBlock extends TextBlock {
  key: number;
}

/** Page editor: rotation, 4-corner frame, new photo, reprocessing (local or server) and manual text correction. */
export default function PageEditorPage(): JSX.Element {
  const params = useParams();
  const documentId = params.documentId ?? '';
  const pageIndex = Number.parseInt(params.pageIndex ?? '', 10);
  const validIndex = Number.isInteger(pageIndex) && pageIndex >= 0;
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnlineStatus();

  const doc = useLiveQuery(async () => (await getDocument(documentId)) ?? false, [documentId], null);
  const page = useLiveQuery(async () => (validIndex ? ((await getPage(documentId, pageIndex)) ?? false) : false), [documentId, pageIndex], null);
  const job = useLiveQuery(async () => (validIndex ? ((await getJob(documentId, pageIndex)) ?? null) : null), [documentId, pageIndex], null);
  const progress = useDocumentProgress(documentId);
  const processingThis = progress?.processingPageIndex === pageIndex;

  const [tab, setTab] = useState<Tab>('image');
  const [action, setAction] = useState<Action | null>(null);
  const [rotation, setRotation] = useState<QuarterTurn>(0);
  const [quad, setQuad] = useState<NormalizedQuad | null>(null);
  const [framing, setFraming] = useState(false);
  const [blocks, setBlocks] = useState<EditableBlock[]>([]);
  const [dirty, setDirty] = useState(false);
  const nextKey = useRef(0);
  const retakeInput = useRef<HTMLInputElement | null>(null);

  // Rotation and frame start from the values used by the last reading of this page.
  const jobSignature = job ? `${job.enqueuedAt}:${job.rotateDegrees}:${JSON.stringify(job.quad)}` : 'none';
  useEffect(() => {
    setRotation(job?.rotateDegrees ?? 0);
    setQuad(job?.quad ?? null);
    setFraming(false);
  }, [jobSignature]);

  // The text follows the stored page, except while the parent has unsaved edits on this same page.
  const pageKey = `${documentId}:${pageIndex}`;
  const loadedFor = useRef<string | null>(null);
  const pageVersion = page ? `${page.updatedAt}` : 'none';
  useEffect(() => {
    if (!page) return;
    if (loadedFor.current === pageKey && dirty) return;
    loadedFor.current = pageKey;
    setBlocks(page.blocks.map((b) => ({ ...b, key: nextKey.current++ })));
    setDirty(false);
  }, [pageKey, pageVersion]);

  const sourceVersion = job ? `${job.source?.fileIndex ?? 'p'}:${page ? page.updatedAt : 0}` : pageVersion;
  const source = usePageSourceImage(documentId, validIndex ? pageIndex : 0, sourceVersion);
  const preview = useRotatedPreview(source.status === 'ready' ? source.value.blob : null, rotation);

  const back = (
    <Button variant="ghost" size="parent" icon="⬅️" onClick={() => navigate(`/parent/documents/${encodeURIComponent(documentId)}`)}>
      {t.back}
    </Button>
  );

  if (doc === null || page === null) {
    return (
      <ParentPage title={documents.admin.title}>
        <Spinner />
      </ParentPage>
    );
  }
  if (doc === false || doc.deletedAt !== null || page === false) {
    return (
      <ParentPage title={documents.admin.title} actions={back}>
        <EmptyState emoji="🔎" title={t.notFound} />
      </ParentPage>
    );
  }

  const number = page.pageIndex + 1;
  const status = pageStatusLabel(page, progress?.processingPageIndex ?? null);
  const busy = action !== null || processingThis;
  // EPUB pages have no image to read again: only their text can be corrected.
  const textOnly = doc.kind === 'epub';
  const shownTab: Tab = textOnly ? 'text' : tab;
  const goToPage = (index: number): void => {
    void navigate(`/parent/documents/${encodeURIComponent(documentId)}/pages/${index}`);
  };

  const run = async (kind: Action, task: () => Promise<void>, success: string): Promise<void> => {
    setAction(kind);
    try {
      await task();
      // A reading that failed again hands the page over to the « lecture intelligente » (§17.7): say so instead of « terminée ».
      const awaitingAi = kind !== 'save' && (await getPage(documentId, pageIndex))?.warnings.includes('awaiting_ai') === true;
      if (awaitingAi) toast.info(t.rerunAwaitingAi);
      else toast.success(success);
    } catch (error) {
      toast.error(error instanceof ProcessingError ? editorErrorMessage(error.code) : t.errors.failed);
    } finally {
      setAction(null);
    }
  };

  const rerun = (useServer: boolean): void => {
    const frame = framing || quad !== null ? (quad ?? FULL_FRAME) : undefined;
    void run(useServer ? 'server' : 'rerun', () => processingQueue.reprocessPage(documentId, pageIndex, { useServer, rotateDegrees: rotation, quad: frame }), t.rerunDone);
    setFraming(false);
  };

  const onRetake = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void run('retake', () => processingQueue.replacePageImage(documentId, pageIndex, file), t.rerunDone);
  };

  const updateBlock = (key: number, patch: Partial<TextBlock>): void => {
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));
    setDirty(true);
  };
  const moveBlock = (key: number, delta: -1 | 1): void => {
    setBlocks((prev) => {
      const from = prev.findIndex((b) => b.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
    setDirty(true);
  };
  const saveText = (): void => {
    void run(
      'save',
      async () => {
        await processingQueue.savePageCorrection(documentId, pageIndex, blocks.map(({ kind, text }) => ({ kind, text })));
        setDirty(false);
      },
      t.textSaved,
    );
  };
  const resetText = (): void => {
    setBlocks(page.blocks.map((b) => ({ ...b, key: nextKey.current++ })));
    setDirty(false);
  };

  const jobError = page.status === 'failed' ? jobErrorMessage(job?.error) : null;

  return (
    <ParentPage title={`${doc.title} · ${format(t.title, { number })}`} actions={back}>
      <div className="docs-editor-nav parent-actions">
        <Button variant="secondary" size="parent" icon="◀️" disabled={page.pageIndex === 0} onClick={() => goToPage(page.pageIndex - 1)}>
          {t.previous}
        </Button>
        <Button variant="secondary" size="parent" icon="▶️" disabled={page.pageIndex >= doc.pageCount - 1} onClick={() => goToPage(page.pageIndex + 1)}>
          {t.next}
        </Button>
      </div>

      <dl className="docs-facts">
        <div>
          <dt>{t.status}</dt>
          <dd>
            <span aria-hidden="true">{status.emoji} </span>
            {status.label}
          </dd>
        </div>
        <div>
          <dt>{t.reliability}</dt>
          <dd>{page.confidence === null ? t.none : format(t.reliabilityValue, { value: page.confidence })}</dd>
        </div>
        <div>
          <dt>{t.source}</dt>
          <dd>{page.textSource ? documents.textSource[page.textSource] : t.none}</dd>
        </div>
      </dl>
      {page.warnings.length > 0 && (
        <p className="docs-chips">
          {page.warnings.map((w) => (
            <span key={w} className="tag">
              {documents.warnings[w]}
            </span>
          ))}
        </p>
      )}
      {jobError && <p className="docs-error">{jobError}</p>}
      {processingThis && (
        <p className="docs-processing" role="status">
          <Spinner size="sm" decorative /> {t.processingNow}
        </p>
      )}

      {!textOnly && (
        <Segmented<Tab>
          size="parent"
          label={t.tabsLabel}
          hideLabel
          value={tab}
          onChange={setTab}
          options={[
            { value: 'image', label: t.tabImage, icon: '🖼️' },
            { value: 'text', label: t.tabText, icon: '📝' },
          ]}
        />
      )}

      {shownTab === 'image' ? (
        <ParentSection title={t.tabImage} hint={framing ? t.frameHint : undefined}>
          <div className="docs-editor-image">
            {source.status === 'loading' || (source.status === 'ready' && preview.status === 'loading') ? (
              <Spinner label={t.loadingImage} />
            ) : preview.status === 'ready' ? (
              <QuadEditor imageUrl={preview.value} alt={format(t.imageAlt, { number })} quad={quad} editing={framing} onChange={setQuad} />
            ) : (
              <EmptyState emoji="🖼️" title={t.noImage} headingLevel={3} />
            )}
          </div>
          <div className="parent-actions">
            <IconButton
              size="parent"
              variant="secondary"
              icon="↻"
              aria-label={t.rotate}
              disabled={busy || source.status !== 'ready'}
              onClick={() => {
                setRotation((r) => (((r + 90) % 360) as QuarterTurn));
                setQuad(null);
                setFraming(false);
              }}
            />
            <Button size="parent" variant="secondary" icon="✂️" aria-pressed={framing} disabled={busy || source.status !== 'ready'} onClick={() => setFraming((f) => !f)}>
              {framing ? t.frameDone : t.frame}
            </Button>
            {(framing || quad !== null) && (
              <Button size="parent" variant="ghost" disabled={busy} onClick={() => setQuad(null)}>
                {t.frameReset}
              </Button>
            )}
          </div>
          {page.textSource === 'manual' && <p className="docs-muted">{t.manualWillBeReplaced}</p>}
          <div className="parent-actions">
            <Button size="parent" icon="🔄" loading={action === 'rerun'} disabled={busy && action !== 'rerun'} onClick={() => rerun(false)}>
              {t.rerun}
            </Button>
            <Button size="parent" variant="secondary" icon="☁️" loading={action === 'server'} disabled={!online || (busy && action !== 'server')} onClick={() => rerun(true)}>
              {t.serverRun}
            </Button>
            <Button size="parent" variant="secondary" icon="📷" loading={action === 'retake'} disabled={busy && action !== 'retake'} onClick={() => retakeInput.current?.click()}>
              {t.retakePhoto}
            </Button>
            <input ref={retakeInput} className="visually-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={onRetake} />
          </div>
          {!online && <p className="docs-muted">{t.serverOffline}</p>}
        </ParentSection>
      ) : (
        <ParentSection title={t.textTitle} hint={t.textHint}>
          {blocks.length === 0 && <p className="docs-muted">{t.noBlocks}</p>}
          <ol className="docs-blocks">
            {blocks.map((block, index) => (
              <li key={block.key} className="docs-block">
                <div className="docs-block__head">
                  <Field label={format(t.blockKind, { number: index + 1 })} size="parent">
                    <Select
                      value={block.kind}
                      onChange={(e) => updateBlock(block.key, { kind: e.target.value === 'title' ? 'title' : 'paragraph' })}
                      options={[
                        { value: 'paragraph', label: t.kindParagraph },
                        { value: 'title', label: t.kindTitle },
                      ]}
                    />
                  </Field>
                  <span className="docs-block__tools">
                    <IconButton size="parent" icon="⬆️" aria-label={format(t.moveBlockUp, { number: index + 1 })} disabled={index === 0} onClick={() => moveBlock(block.key, -1)} />
                    <IconButton size="parent" icon="⬇️" aria-label={format(t.moveBlockDown, { number: index + 1 })} disabled={index === blocks.length - 1} onClick={() => moveBlock(block.key, 1)} />
                    <IconButton
                      size="parent"
                      icon="🗑️"
                      aria-label={format(t.removeBlock, { number: index + 1 })}
                      onClick={() => {
                        setBlocks((prev) => prev.filter((b) => b.key !== block.key));
                        setDirty(true);
                      }}
                    />
                  </span>
                </div>
                <Field label={format(t.blockLabel, { number: index + 1 })} size="parent">
                  <TextArea
                    rows={block.kind === 'title' ? 2 : Math.min(12, Math.max(3, Math.ceil(block.text.length / 70)))}
                    value={block.text}
                    lang="fr"
                    spellCheck
                    onChange={(e) => updateBlock(block.key, { text: e.target.value })}
                  />
                </Field>
              </li>
            ))}
          </ol>
          <div className="parent-actions">
            <Button
              size="parent"
              variant="secondary"
              icon="➕"
              onClick={() => {
                setBlocks((prev) => [...prev, { kind: 'paragraph', text: '', key: nextKey.current++ }]);
                setDirty(true);
              }}
            >
              {t.addBlock}
            </Button>
          </div>
          <div className="parent-sticky-actions">
            {dirty && <p className="parent-sticky-actions__status">{t.unsaved}</p>}
            <Button size="parent" variant="ghost" disabled={!dirty || action === 'save'} onClick={resetText}>
              {t.cancelText}
            </Button>
            <Button size="parent" icon="💾" loading={action === 'save'} disabled={!dirty || processingThis} onClick={saveText}>
              {t.saveText}
            </Button>
          </div>
        </ParentSection>
      )}
    </ParentPage>
  );
}
