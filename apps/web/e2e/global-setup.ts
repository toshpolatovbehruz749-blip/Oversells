import { startMockAnthropic } from './mock-anthropic';

/** Starts the mocked Messages API once for all browser tests (see README, Tests). */
export default async function globalSetup() {
  const mock = await startMockAnthropic();
  return async () => mock.close();
}
