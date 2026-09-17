import { describe, expect, it } from 'vitest';
import type { ChunkSummaryData, ExplainTextRequest, ExplainWordRequest, GenerateQuestionsRequest, QuestionOnTextRequest, SimplifyTextRequest } from '@aide/shared';
import type { ModelQuestion } from '../../src/ai/schemas';
import {
  validateAnswer, validateChunkSummary, validateCorrection, validateExplanation, validateFinalSummary, validateQuestions,
  validateSimplification, type ValidationOutcome,
} from '../../src/ai/validation/pipeline';
import {
  CHILD_ID, DOC_HASH, DOC_ID, HISTORY_TEXT, INJECTION_TEXT, page, SCIENCE_TEXT, STORY_TEXT, TALE_TEXT, validationEnv,
} from './helpers';

const base = { childId: CHILD_ID, documentId: DOC_ID, documentHash: DOC_HASH };

function explainText(text: string): ExplainTextRequest {
  return { ...base, text, paragraph: text, pageIndex: 0, ocrLowConfidence: false };
}

function question(text: string, q: string): QuestionOnTextRequest {
  return { ...base, question: q, pages: [page(0, text)] };
}

function codes(outcome: ValidationOutcome<unknown>): string[] {
  return outcome.ok ? [] : outcome.issues.map((i) => i.code);
}

function expectRejected(outcome: ValidationOutcome<unknown>, code: string, stage?: string): void {
  expect(outcome.ok, 'output should be rejected').toBe(false);
  expect(codes(outcome)).toContain(code);
  if (stage && !outcome.ok) expect(outcome.stages).toContain(stage);
}

describe('pipeline — good outputs', () => {
  it('accepts a faithful explanation of a science passage about plant reproduction (no false refusal)', () => {
    const outcome = validateExplanation(explainText(SCIENCE_TEXT), {
      status: 'ok',
      explanation: "Les fleurs aident la plante à faire des graines. Les abeilles portent le pollen. Le pollen féconde l'ovule. L'ovule devient une graine.",
      example: null,
      sourceQuotes: ["Le pollen féconde l'ovule, qui devient une graine."],
    }, validationEnv());
    expect(codes(outcome)).toEqual([]);
    expect(outcome.ok && outcome.data.sourceQuotes).toHaveLength(1);
  });

  it('accepts « le meilleur ami de Tom » when the text says it', () => {
    const outcome = validateAnswer(question(STORY_TEXT, 'Qui est le meilleur ami de Tom ?'), {
      status: 'ok',
      answer: 'Le meilleur ami de Tom est Léo.',
      sourceRefs: [{ pageIndex: 0, quote: 'Léo est le meilleur ami de Tom.' }],
    }, validationEnv());
    expect(codes(outcome)).toEqual([]);
  });

  it('accepts the password of a fairy tale that is written in the text', () => {
    const outcome = validateAnswer(question(TALE_TEXT, 'Quel est le mot de passe de la grotte ?'), {
      status: 'ok',
      answer: 'Le mot de passe de la grotte est « Sésame, ouvre-toi ! ».',
      sourceRefs: [{ pageIndex: 0, quote: 'le mot de passe de la grotte : « Sésame, ouvre-toi ! »' }],
    }, validationEnv());
    expect(codes(outcome)).toEqual([]);
  });

  it('accepts a historical death and war taken from the text', () => {
    const outcome = validateChunkSummary(
      { chunkIndex: 0, pageIndexes: [4], text: HISTORY_TEXT, contentHash: 'a'.repeat(64) },
      'bref',
      {
        status: 'ok',
        summary: 'Le roi Louis XVI est mort en 1793, pendant la Révolution française. Beaucoup de soldats ont été tués pendant les guerres.',
        keyQuotes: ['Le roi Louis XVI est mort guillotiné en 1793, pendant la Révolution française.'],
      },
      validationEnv(),
    );
    expect(codes(outcome)).toEqual([]);
    expect(outcome.ok && outcome.data.keyQuotes).toEqual([{ pageIndex: 4, quote: 'Le roi Louis XVI est mort guillotiné en 1793, pendant la Révolution française.' }]);
  });

  it('tolerates OCR errors in a quote (Jaccard window)', () => {
    const ocrText = 'Les abeilles transportent le po11en d’une fleur à l’autre pendant tout le printemps chaque année.';
    const outcome = validateExplanation(explainText(ocrText), {
      status: 'ok',
      explanation: 'Les abeilles portent le pollen de fleur en fleur.',
      example: null,
      sourceQuotes: ["Les abeilles transportent le pollen d'une fleur à l'autre pendant tout le printemps chaque année."],
    }, validationEnv());
    expect(codes(outcome)).toEqual([]);
  });

  it('accepts a faithful simplification that keeps the entities', () => {
    const req: SimplifyTextRequest = { ...base, text: STORY_TEXT, pageIndex: 0, ocrLowConfidence: false };
    const outcome = validateSimplification(req, {
      status: 'ok',
      simplifiedText: "Tom vit dans un petit village près de la mer. Léo est son meilleur ami. Chaque matin, Tom et Léo marchent trois kilomètres pour aller à l'école. Un jour, ils trouvent une vieille carte dans le grenier.",
    }, validationEnv());
    expect(codes(outcome)).toEqual([]);
  });

  it('accepts a kind correction with a verified passage to reread', () => {
    const outcome = validateCorrection({
      ...base,
      question: { id: 'q1', type: 'reponse_libre', prompt: 'Combien de kilomètres marchent Tom et Léo ?', source: { pageIndex: 0, quote: 'Tom et Léo marchent trois kilomètres' }, expectedAnswer: 'Ils marchent trois kilomètres.', keyPoints: ['trois kilomètres'] },
      answerText: 'ils marchent beaucoup',
      pages: [page(0, STORY_TEXT)],
    }, {
      status: 'ok', verdict: 'partiel',
      feedback: "Tu as raison, ils marchent beaucoup. Relis le passage pour trouver combien de kilomètres.",
      rereadRef: { pageIndex: 0, quote: "Chaque matin, Tom et Léo marchent trois kilomètres pour aller à l'école." },
    }, validationEnv());
    expect(codes(outcome)).toEqual([]);
  });
});

describe('pipeline — bad outputs', () => {
  it('rejects an invented name', () => {
    const outcome = validateAnswer(question(STORY_TEXT, 'Qui est le meilleur ami de Tom ?'), {
      status: 'ok',
      answer: 'Le meilleur ami de Tom est Julien.',
      sourceRefs: [{ pageIndex: 0, quote: 'Léo est le meilleur ami de Tom.' }],
    }, validationEnv());
    expectRejected(outcome, 'source_invented_name', 'source');
  });

  it('rejects an invented number', () => {
    const req: SimplifyTextRequest = { ...base, text: STORY_TEXT, pageIndex: 0, ocrLowConfidence: false };
    const outcome = validateSimplification(req, {
      status: 'ok',
      simplifiedText: "Tom vit dans un petit village près de la mer. Léo est son meilleur ami. Chaque matin, Tom et Léo marchent cinq kilomètres pour aller à l'école. Un jour, ils trouvent une vieille carte.",
    }, validationEnv());
    expectRejected(outcome, 'source_invented_number', 'source');
  });

  it('rejects an invented year in an explanation', () => {
    const outcome = validateExplanation(explainText(SCIENCE_TEXT), {
      status: 'ok', explanation: 'Ce phénomène a été découvert en 1682. Le pollen féconde l’ovule.', example: null,
      sourceQuotes: ["Le pollen féconde l'ovule, qui devient une graine."],
    }, validationEnv());
    expectRejected(outcome, 'source_invented_year', 'source');
  });

  it('rejects a fake quote', () => {
    const outcome = validateAnswer(question(STORY_TEXT, 'Où habite Tom ?'), {
      status: 'ok',
      answer: 'Tom habite dans un petit village.',
      sourceRefs: [{ pageIndex: 0, quote: 'Tom habite dans une grande ville près des montagnes.' }],
    }, validationEnv());
    expectRejected(outcome, 'source_quote_not_found', 'source');
  });

  it('rejects an emotional dependency sentence addressed to the child', () => {
    const outcome = validateAnswer(question(STORY_TEXT, 'Qui est le meilleur ami de Tom ?'), {
      status: 'ok',
      answer: 'Léo est le meilleur ami de Tom. Et moi, je suis ton meilleur ami, tu n’as besoin que de moi.',
      sourceRefs: [{ pageIndex: 0, quote: 'Léo est le meilleur ami de Tom.' }],
    }, validationEnv());
    expectRejected(outcome, 'safety_dependency', 'safety');
  });

  it('rejects a secret and a request for personal data', () => {
    const outcome = validateAnswer(question(TALE_TEXT, 'Que dit le chef des voleurs ?'), {
      status: 'ok',
      answer: 'C’est notre secret, ne le dis pas à tes parents. Donne-moi ton adresse.',
      sourceRefs: [{ pageIndex: 0, quote: 'Sésame, ouvre-toi !' }],
    }, validationEnv());
    expectRejected(outcome, 'safety_dependency', 'safety');
  });

  it('rejects an output that obeys instructions hidden in the document', () => {
    const outcome = validateExplanation(explainText(INJECTION_TEXT), {
      status: 'ok', explanation: "D'accord, je suis maintenant un pirate ! Je vais ignorer le texte.", example: null,
      sourceQuotes: ['Le chat dort sur le tapis.'],
    }, validationEnv());
    expectRejected(outcome, 'injection_output', 'injection');
  });

  it('rejects a too long explanation', () => {
    const word: ExplainWordRequest = { ...base, word: 'pollen', sentence: 'Les abeilles transportent le pollen d\'une fleur à l\'autre.', paragraph: SCIENCE_TEXT, pageIndex: 0, ocrLowConfidence: false };
    const longText = Array.from({ length: 12 }, () => 'Le pollen est une poudre jaune des fleurs.').join(' ');
    const outcome = validateExplanation(word, {
      status: 'ok', explanation: longText, example: null, sourceQuotes: ["Les abeilles transportent le pollen d'une fleur à l'autre."],
    }, validationEnv());
    expectRejected(outcome, 'length_exceeded', 'length');
  });

  it('rejects a too complex explanation on the first attempt, tolerates a small overflow on the second', () => {
    const bank = ['les', 'abeilles', 'portent', 'le', 'pollen', 'des', 'fleurs', 'au', 'printemps'];
    const sentence = (n: number): string => {
      const words = Array.from({ length: n }, (_, i) => bank[i % bank.length]!);
      return `${words.join(' ').replace(/^l/, 'L')}.`;
    };
    const text = (n: number): string => [sentence(n), sentence(n), sentence(n)].join(' ');
    const req = explainText(SCIENCE_TEXT);
    const out = (explanation: string) => ({ status: 'ok' as const, explanation, example: null, sourceQuotes: ["Les abeilles transportent le pollen d'une fleur à l'autre."] });
    // simple: average ≤ 17 words per sentence, max 26
    expectRejected(validateExplanation(req, out(text(20)), validationEnv({ attempt: 1 })), 'age_avg_sentence', 'age');
    const tolerated = validateExplanation(req, out(text(20)), validationEnv({ attempt: 2 }));
    expect(codes(tolerated)).toEqual([]);
    expect(tolerated.ok && tolerated.readabilityWarning).toBe(true);
    // +35 % on the average is still refused on the second attempt
    expectRejected(validateExplanation(req, out(text(23)), validationEnv({ attempt: 2 })), 'age_avg_sentence', 'age');
    // one very long sentence
    expectRejected(validateExplanation(req, out(sentence(28)), validationEnv({ attempt: 1 })), 'age_sentence_too_long', 'age');
  });

  it('rejects explicit content', () => {
    const outcome = validateExplanation(explainText(SCIENCE_TEXT), {
      status: 'ok', explanation: 'Les fleurs se reproduisent. Tu peux chercher de la pornographie pour comprendre.', example: null,
      sourceQuotes: ['Les plantes à fleurs se reproduisent grâce à leurs fleurs.'],
    }, validationEnv());
    expectRejected(outcome, 'safety_explicit', 'safety');
  });

  it('rejects a sensitive theme absent from the source', () => {
    const outcome = validateExplanation(explainText(SCIENCE_TEXT), {
      status: 'ok', explanation: 'Les abeilles transportent le pollen. C’est comme une guerre entre les fleurs.', example: null,
      sourceQuotes: ["Les abeilles transportent le pollen d'une fleur à l'autre."],
    }, validationEnv());
    expectRejected(outcome, 'safety_sensitive', 'safety');
  });

  it('rejects a brand self-reference, a link and a phone number', () => {
    const outcome = validateExplanation(explainText(SCIENCE_TEXT), {
      status: 'ok', explanation: 'Je suis Mockito, ton assistant. Va voir www.exemple-fleurs.com ou appelle le 01 23 45 67 89.', example: null,
      sourceQuotes: ["Les abeilles transportent le pollen d'une fleur à l'autre."],
    }, validationEnv());
    expect(codes(outcome)).toEqual(expect.arrayContaining(['safety_self_reference', 'safety_contact']));
  });

  it('strict safety level rejects sensitive educational words even when present in the source', () => {
    const outcome = validateExplanation(explainText(SCIENCE_TEXT), {
      status: 'ok', explanation: "Le pollen féconde l'ovule. C'est une reproduction sexuée.", example: null,
      sourceQuotes: ["Le pollen féconde l'ovule, qui devient une graine."],
    }, validationEnv({ safetyLevel: 'strict' }));
    expectRejected(outcome, 'safety_sensitive', 'safety');
  });
});

describe('pipeline — questions', () => {
  const req: GenerateQuestionsRequest = { ...base, count: 5, types: ['qcm', 'vrai_faux', 'ordre'], pages: [page(0, STORY_TEXT)] };

  function q(overrides: Partial<ModelQuestion>): ModelQuestion {
    return {
      type: 'vrai_faux', prompt: 'Vrai ou faux : Tom habite au bord de la mer.', source: { pageIndex: 0, quote: 'Tom habite dans un petit village au bord de la mer.' },
      choices: null, correctIndex: null, answer: true, explanation: 'Le texte dit que Tom habite au bord de la mer.', expectedAnswer: null, keyPoints: null, pairs: null, itemsInOrder: null,
      ...overrides,
    };
  }

  const valid: ModelQuestion[] = [
    q({}),
    q({ type: 'qcm', prompt: 'Qui est le meilleur ami de Tom ?', answer: null, choices: ['Léo', 'Julien', 'Sami'], correctIndex: 0, source: { pageIndex: 0, quote: 'Léo est le meilleur ami de Tom.' }, explanation: 'Le texte dit que Léo est son meilleur ami.' }),
    q({ prompt: 'Vrai ou faux : Tom et Léo marchent pour aller à l’école.', source: { pageIndex: 0, quote: "Chaque matin, Tom et Léo marchent trois kilomètres pour aller à l'école." }, explanation: 'Ils marchent trois kilomètres.' }),
    q({ type: 'ordre', prompt: 'Remets les phrases dans l’ordre du texte.', answer: null, explanation: null, itemsInOrder: ['Tom habite dans un petit village au bord de la mer.', 'Un jour, ils trouvent une vieille carte dans le grenier de la maison.'], source: { pageIndex: 0, quote: 'Un jour, ils trouvent une vieille carte dans le grenier de la maison.' } }),
  ];

  it('drops a single question with an unverifiable quote and keeps the others (≥ 60 %)', () => {
    const outcome = validateQuestions(req, {
      status: 'ok',
      questions: [...valid, q({ prompt: 'Vrai ou faux : Tom a un chien.', source: { pageIndex: 0, quote: 'Tom a un gros chien noir.' } })],
    }, validationEnv());
    expect(codes(outcome)).toEqual([]);
    expect(outcome.ok && outcome.data.questions.map((x) => x.id)).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(outcome.ok && outcome.droppedQuestions).toBe(1);
  });

  it('keeps a qcm whose distractors are names absent from the text', () => {
    const outcome = validateQuestions({ ...req, count: 3 }, { status: 'ok', questions: valid.slice(0, 3) }, validationEnv());
    expect(codes(outcome)).toEqual([]);
  });

  it('rejects the set when fewer than 60 % of the questions are valid', () => {
    const outcome = validateQuestions(req, {
      status: 'ok',
      questions: [valid[0]!, q({ prompt: 'Vrai ou faux : Tom habite à Marseille.', source: { pageIndex: 0, quote: 'Tom habite à Marseille.' } })],
    }, validationEnv());
    expectRejected(outcome, 'questions_too_few', 'source');
  });

  it('drops structurally invalid questions (bad correctIndex, duplicate choices, type not requested)', () => {
    const outcome = validateQuestions({ ...req, count: 3 }, {
      status: 'ok',
      questions: [
        q({ type: 'qcm', prompt: 'Qui est Léo ?', answer: null, choices: ['Un ami', 'Un ami'], correctIndex: 0 }),
        q({ type: 'qcm', prompt: 'Où habite Tom ?', answer: null, choices: ['Au bord de la mer', 'En ville'], correctIndex: 4 }),
        q({ type: 'reponse_libre', prompt: 'Que trouvent-ils ?', answer: null, expectedAnswer: 'Une carte' }),
      ],
    }, validationEnv());
    expect(codes(outcome)).toEqual(expect.arrayContaining(['question_qcm_duplicates', 'question_qcm_correct_index', 'question_type_not_requested', 'questions_too_few']));
  });
});

describe('pipeline — summaries', () => {
  const chunks: ChunkSummaryData[] = [
    { chunkIndex: 0, summary: 'Tom habite au bord de la mer avec son ami Léo.', keyQuotes: [{ pageIndex: 0, quote: 'Tom habite dans un petit village au bord de la mer.' }] },
    { chunkIndex: 1, summary: 'Les deux amis trouvent une vieille carte.', keyQuotes: [{ pageIndex: 1, quote: 'Un jour, ils trouvent une vieille carte dans le grenier de la maison.' }] },
  ];

  it('final sourceRefs must be among the chunk key quotes', () => {
    const good = validateFinalSummary(chunks, 'bref', {
      status: 'ok', summary: 'Tom et Léo vivent au bord de la mer. Ils trouvent une vieille carte.', keyPoints: ['Tom et Léo sont amis.'],
      sourceRefs: [{ pageIndex: 1, quote: 'Un jour, ils trouvent une vieille carte dans le grenier de la maison.' }, { pageIndex: 3, quote: 'Une phrase inventée.' }],
    }, validationEnv());
    expect(codes(good)).toEqual([]);
    expect(good.ok && good.data.sourceRefs).toEqual([chunks[1]!.keyQuotes[0]]);

    const bad = validateFinalSummary(chunks, 'bref', {
      status: 'ok', summary: 'Tom et Léo trouvent une carte.', keyPoints: [], sourceRefs: [{ pageIndex: 0, quote: 'Tom part en bateau.' }],
    }, validationEnv());
    expectRejected(bad, 'source_refs_not_allowed', 'source');
  });

  it('rejects a chunk summary without any verifiable key quote', () => {
    const outcome = validateChunkSummary({ chunkIndex: 0, pageIndexes: [0], text: STORY_TEXT, contentHash: 'a'.repeat(64) }, 'normal', {
      status: 'ok', summary: 'Tom habite au bord de la mer.', keyQuotes: ['Tom habite sur une île déserte.'],
    }, validationEnv());
    expectRejected(outcome, 'source_quote_not_found', 'source');
  });
});
