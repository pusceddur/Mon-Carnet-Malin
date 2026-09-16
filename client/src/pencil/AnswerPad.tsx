// STUB: client-pencil
import type { Id } from '@aide/shared';
import type { JSX } from 'react';

/** Handwriting box for an exercise answer (saved as an InkAnnotation in the 'answer' space). */
export function AnswerPad(props: { exerciseId: Id; questionId: string; childId: Id; onInkSaved?: (annotationId: Id) => void }): JSX.Element {
  return <div className="answer-pad" data-exercise-id={props.exerciseId} data-question-id={props.questionId} />;
}
