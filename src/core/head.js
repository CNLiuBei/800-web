const DEFAULT_TITLE = '800影视';
const DEFAULT_DESCRIPTION = '免费在线观看高清电影、电视剧、动漫。';

export function resetPageMeta() {
    setPageMeta({
        title: DEFAULT_TITLE,
        description: DEFAULT_DESCRIPTION,
        url: location.href,
        image: '',
        type: 'website',
        structuredData: null,
    });
}

export function setPageMeta({ title, description, url, image, type = 'website', structuredData } = {}) {
    const safeTitle = title || DEFAULT_TITLE;
    const safeDescription = description || DEFAULT_DESCRIPTION;
    const safeUrl = url || location.href;
    const safeImage = image ? absoluteUrl(image) : '';

    document.title = safeTitle;
    setMeta('name', 'description', safeDescription);
    setMeta('property', 'og:title', safeTitle);
    setMeta('property', 'og:description', safeDescription);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:url', safeUrl);
    setMeta('name', 'twitter:card', safeImage ? 'summary_large_image' : 'summary');
    setMeta('name', 'twitter:title', safeTitle);
    setMeta('name', 'twitter:description', safeDescription);

    if (safeImage) {
        setMeta('property', 'og:image', safeImage);
        setMeta('name', 'twitter:image', safeImage);
    } else {
        removeMeta('property', 'og:image');
        removeMeta('name', 'twitter:image');
    }

    setCanonical(safeUrl);
    if (structuredData === null) removeStructuredData();
    else if (structuredData) setStructuredData(structuredData);
}

function setMeta(attr, key, content) {
    const selector = `meta[${attr}="${cssEscape(key)}"]`;
    let el = document.head.querySelector(selector);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
    }
    el.setAttribute('content', content || '');
}

function removeMeta(attr, key) {
    document.head.querySelector(`meta[${attr}="${cssEscape(key)}"]`)?.remove();
}

function setCanonical(url) {
    let el = document.head.querySelector('link[rel="canonical"]');
    if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', 'canonical');
        document.head.appendChild(el);
    }
    el.setAttribute('href', url);
}

function setStructuredData(data) {
    let el = document.head.querySelector('script[data-page-jsonld="true"]');
    if (!el) {
        el = document.createElement('script');
        el.setAttribute('type', 'application/ld+json');
        el.setAttribute('data-page-jsonld', 'true');
        document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
}

function removeStructuredData() {
    document.head.querySelector('script[data-page-jsonld="true"]')?.remove();
}

function absoluteUrl(value) {
    try {
        return new URL(value, location.origin).href;
    } catch {
        return '';
    }
}

function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/"/g, '\\"');
}
