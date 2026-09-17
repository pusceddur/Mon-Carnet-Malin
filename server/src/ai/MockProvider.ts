// AI_PROVIDER=mock: the real RemoteProvider (prompts, schemas) over the in-process MockTransport.
import { MockTransport, type MockTransportOptions } from './MockTransport';
import { RemoteProvider } from './RemoteProvider';

export class MockProvider extends RemoteProvider {
  readonly mock: MockTransport;

  constructor(options: MockTransportOptions | MockTransport = {}) {
    const transport = options instanceof MockTransport ? options : new MockTransport(options);
    super(transport, 'mock');
    this.mock = transport;
  }
}
