import { LruCache } from '@apify/datastructures';

/**
 * The default number of canonical URLs remembered as visited. The cache is deliberately bounded: keeping
 * every URL of an indefinitely large crawl in memory is not an option. Redirect aliases whose target has
 * fallen out of the cache can be crawled again, but exact `uniqueKey` duplicates are still stopped by the
 * request queue itself.
 */
const DEFAULT_MAX_VISITED_URLS = 1_000_000;

const VISITED = true;

export interface UrlVisitClaim {
    /** Mark the claimed URLs as successfully visited. */
    commit(): void;

    /** Release the claim after a failure, so a retry can claim the URLs again. */
    release(): void;
}

/**
 * Tracks canonical URLs that are being, or have already been, visited by a crawl.
 *
 * `claim()` is atomic: for a given URL only one caller can obtain a claim at a time. Concurrent callers
 * wait for the owner's outcome, then either skip (`null`, the URL was visited) or take over after a failed
 * attempt (`release()`). That makes the "visit once" guarantee hold under concurrency without a mutex
 * around the request handler.
 *
 * Visited entries live in an LRU cache, so memory use is capped regardless of how many URLs were seen.
 * In-flight entries are only kept until their owner commits or releases them, which is bounded by the
 * crawler's concurrency.
 *
 * @internal
 */
export class UrlVisitTracker {
    readonly #visited: LruCache<typeof VISITED>;
    readonly #pending = new Map<string, Promise<boolean>>();

    constructor(maxVisitedUrls = DEFAULT_MAX_VISITED_URLS) {
        this.#visited = new LruCache({ maxLength: maxVisitedUrls });
    }

    /** Returns whether the URL is currently claimed or has already been visited. */
    isSeen(urlKey: string): boolean {
        return this.#visited.get(urlKey) === VISITED || this.#pending.has(urlKey);
    }

    /** Returns whether the URL has been successfully visited. */
    isVisited(urlKey: string): boolean {
        return this.#visited.get(urlKey) === VISITED;
    }

    /**
     * Claims every supplied key as one atomic operation.
     *
     * Returns `null` when any of the keys was already visited. When another caller currently holds a
     * claim on one of the keys, waits for that caller to settle and then tries again - a failed attempt
     * releases the keys so this caller can proceed.
     */
    async claim(keys: readonly string[]): Promise<UrlVisitClaim | null> {
        const uniqueKeys = [...new Set(keys.filter((key) => key.length > 0))];

        if (uniqueKeys.length === 0) {
            return { commit() {}, release() {} };
        }

        while (true) {
            const pendingOutcomes: Promise<boolean>[] = [];
            let alreadyVisited = false;

            for (const key of uniqueKeys) {
                if (this.#visited.get(key) === VISITED) {
                    alreadyVisited = true;
                    break;
                }

                const pending = this.#pending.get(key);
                if (pending) {
                    pendingOutcomes.push(pending);
                }
            }

            if (alreadyVisited) {
                return null;
            }

            if (pendingOutcomes.length > 0) {
                // A concurrent request owns at least one of the keys. Once it succeeds we skip; if it
                // fails, it releases the keys and the loop below claims them for this request.
                await Promise.race(pendingOutcomes);
                continue;
            }

            // All keys are free. Reserve them synchronously, so two concurrent claims cannot both win.
            let settle!: (visited: boolean) => void;
            const outcome = new Promise<boolean>((resolve) => {
                settle = resolve;
            });

            for (const key of uniqueKeys) {
                this.#pending.set(key, outcome);
            }

            let settled = false;
            const finish = (visited: boolean) => {
                if (settled) {
                    return;
                }
                settled = true;

                for (const key of uniqueKeys) {
                    if (this.#pending.get(key) === outcome) {
                        this.#pending.delete(key);
                    }
                    if (visited) {
                        this.#visited.add(key, VISITED);
                    }
                }

                settle(visited);
            };

            return {
                commit: () => finish(true),
                release: () => finish(false),
            };
        }
    }

    /** Clears all visit state, e.g. when a queue is purged between runs. */
    clear(): void {
        this.#visited.clear();
        this.#pending.clear();
    }

    /** @internal exposed for tests */
    get size(): number {
        return this.#visited.length() + this.#pending.size;
    }

    /** @internal exposed for tests */
    get maxLength(): number {
        return this.#visited.maxLength;
    }
}
