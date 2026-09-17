// Dedicated worker: page preprocessing off the main thread (contract §15.6).
import { fromTransfer, runBinarize, runPrepare, runProbes, toTransfer, type WorkerRequest, type WorkerResponse } from './protocol';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse, options?: { transfer?: Transferable[] }): void;
}

const scope = self as unknown as WorkerScope;

async function handle(request: WorkerRequest): Promise<{ response: WorkerResponse; transfer: Transferable[] }> {
  switch (request.op) {
    case 'prepare': {
      const source =
        request.source.kind === 'blob'
          ? request.source.blob
          : { data: new Uint8ClampedArray(request.source.buffer), width: request.source.width, height: request.source.height };
      const maxDecodeSide = request.source.kind === 'blob' ? request.source.maxDecodeSide : undefined;
      const prepared = await runPrepare(source, request.options, request.encode, maxDecodeSide);
      const image = toTransfer(prepared.image);
      return {
        response: { id: request.id, ok: true, op: 'prepare', image, skewDegrees: prepared.skewDegrees, regions: prepared.regions, jpeg: prepared.jpeg, thumb: prepared.thumb },
        transfer: [image.buffer],
      };
    }
    case 'binarize': {
      const image = toTransfer(runBinarize(fromTransfer(request.image)));
      return { response: { id: request.id, ok: true, op: 'binarize', image }, transfer: [image.buffer] };
    }
    case 'probes': {
      const images = runProbes(fromTransfer(request.image), request.turns, request.side).map((p) => ({ turn: p.turn, image: toTransfer(p.image) }));
      return { response: { id: request.id, ok: true, op: 'probes', images }, transfer: images.map((p) => p.image.buffer) };
    }
  }
}

scope.addEventListener('message', (event) => {
  const request = event.data;
  handle(request).then(
    ({ response, transfer }) => scope.postMessage(response, { transfer }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : 'preprocess_failed';
      scope.postMessage({ id: request.id, ok: false, error: message });
    },
  );
});
