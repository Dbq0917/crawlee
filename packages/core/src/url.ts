import { normalizeUrl } from '@apify/utilities';

/**
 * The canonical form of a hostname: lower-case, punycode, and without the optional root dot.
 *
 * Pass both sides of a hostname comparison through this, so that a domain written as `háčky.cz` still matches the
 * `xn--hky-ela4t.cz` that `URL` reports.
 *
 * @internal
 */
export function normalizeHostname(hostname: string): string {
    return hostname.toLowerCase().replace(/\.$/, '');
}

/**
 * Canonicalize a URL for visit deduplication.
 *
 * This is intentionally stricter than raw string equality, but still safe to use as a request identity:
 * it removes fragments (unless asked to keep them), sorts query parameters, drops `utm_*` parameters,
 * lower-cases the scheme and hostname and strips a trailing slash. The rules match
 * {@apilink Request.computeUniqueKey}, so a canonical key can be compared directly with a request's
 * automatic `uniqueKey`.
 *
 * Returns `null` for values that are not valid absolute URLs.
 *
 * @internal
 */
export function canonicalizeUrl(url: string, options: { keepUrlFragment?: boolean } = {}): string | null {
    if (typeof url !== 'string' || url.length === 0) {
        return null;
    }

    const normalized = normalizeUrl(url, options.keepUrlFragment);

    return normalized ? normalizePercentEncoding(normalized) : null;
}

/**
 * Percent-encoded unreserved characters are equivalent to their literal form (RFC 3986, section 6.2.2.2).
 * Normalizing them means `/%7Euser` and `/~user` produce the same visit key, while reserved escapes such
 * as `%2F` are left untouched.
 */
function normalizePercentEncoding(url: string): string {
    const schemeEnd = url.indexOf('//');
    const pathStart = url.indexOf('/', schemeEnd === -1 ? 0 : schemeEnd + 2);

    if (pathStart === -1) {
        return url;
    }

    let pathEnd = url.length;
    for (const separator of ['?', '#']) {
        const index = url.indexOf(separator, pathStart);
        if (index !== -1 && index < pathEnd) {
            pathEnd = index;
        }
    }

    return (
        url.slice(0, pathStart) +
        url.slice(pathStart, pathEnd).replace(/%[0-9a-fA-F]{2}/g, (escape) => {
            const character = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
            return /[A-Za-z0-9\-._~]/.test(character) ? character : escape.toUpperCase();
        }) +
        url.slice(pathEnd)
    );
}
