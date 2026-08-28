import { describe, it, expect, vi } from 'vitest';
import { commitWithRetry } from '../../megaventoryConnector';

const grpcErr = (code: number) => Object.assign(new Error(`${code} boom`), { code });

describe('commitWithRetry', () => {
  it('retries DEADLINE_EXCEEDED and succeeds', async () => {
    const commit = vi.fn().mockRejectedValueOnce(grpcErr(4)).mockResolvedValueOnce([]);
    await commitWithRetry({ commit }, 3, 1);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-transient codes immediately', async () => {
    const commit = vi.fn().mockRejectedValue(grpcErr(7)); // PERMISSION_DENIED
    await expect(commitWithRetry({ commit }, 3, 1)).rejects.toThrow('7 boom');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt cap', async () => {
    const commit = vi.fn().mockRejectedValue(grpcErr(14)); // UNAVAILABLE
    await expect(commitWithRetry({ commit }, 3, 1)).rejects.toThrow('14 boom');
    expect(commit).toHaveBeenCalledTimes(3);
  });
});
