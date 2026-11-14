import { UrlVisitTracker } from '@crawlee/core/internal';

describe('UrlVisitTracker', () => {
    test('gives exactly one concurrent claimant ownership', async () => {
        const tracker = new UrlVisitTracker();

        const first = tracker.claim(['https://example.com/page']);
        const waiters = Array.from({ length: 25 }, () => tracker.claim(['https://example.com/page']));

        const firstClaim = await first;
        expect(firstClaim).not.toBeNull();
        firstClaim!.commit();

        await expect(Promise.all(waiters)).resolves.toEqual(Array.from({ length: 25 }, () => null));

        await expect(tracker.claim(['https://example.com/page'])).resolves.toBeNull();
        expect(tracker.isVisited('https://example.com/page')).toBe(true);
    });

    test('lets a waiter take over after a failed attempt releases its claim', async () => {
        const tracker = new UrlVisitTracker();
        const first = (await tracker.claim(['https://example.com/page']))!;
        const secondPromise = tracker.claim(['https://example.com/page']);

        first.release();

        const second = await secondPromise;
        expect(second).not.toBeNull();
        second!.commit();
        expect(tracker.isVisited('https://example.com/page')).toBe(true);
    });

    test('keeps the number of remembered URLs bounded', async () => {
        const tracker = new UrlVisitTracker(2);

        for (const url of ['a', 'b', 'c']) {
            (await tracker.claim([url]))!.commit();
        }

        expect(tracker.isVisited('a')).toBe(false);
        expect(tracker.isVisited('b')).toBe(true);
        expect(tracker.isVisited('c')).toBe(true);
        expect(tracker.size).toBeLessThanOrEqual(2);
    });
});
