import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieSet = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSet, get: () => undefined }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const { setTheme } = await import('./actions');

describe('setTheme', () => {
  beforeEach(() => {
    cookieSet.mockClear();
    revalidatePath.mockClear();
  });

  it('writes the cookie and revalidates the layout', async () => {
    const res = await setTheme('dark');
    expect(res).toEqual({ ok: true, theme: 'dark' });
    expect(cookieSet).toHaveBeenCalledWith(
      'KM_THEME',
      'dark',
      expect.objectContaining({ path: '/', sameSite: 'lax', httpOnly: false }),
    );
    // Without this the root layout keeps its cached render and the freshly
    // written cookie has no effect until some other navigation happens.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('accepts system', async () => {
    const res = await setTheme('system');
    expect(res).toEqual({ ok: true, theme: 'system' });
    expect(cookieSet).toHaveBeenCalledWith('KM_THEME', 'system', expect.anything());
  });

  it('rejects an unsupported value without touching the cookie', async () => {
    const res = await setTheme('rainbow' as never);
    expect(res).toEqual({ ok: false, theme: null });
    expect(cookieSet).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
