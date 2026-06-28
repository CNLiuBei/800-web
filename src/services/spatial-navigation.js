const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

const TEXT_INPUT_SELECTOR = 'input, textarea, select, [contenteditable="true"]';
const DIRECTIONS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const ACTIVATE_KEYS = new Set(['Enter', 'NumpadEnter']);
const BACK_KEYS = new Set(['Escape', 'Backspace', 'BrowserBack']);

let initialized = false;
let spatialFocusMode = false;

export function initSpatialNavigation() {
    if (initialized) return;
    initialized = true;
    document.documentElement.classList.add('spatial-navigation-ready');
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', clearSpatialFocusMode, true);
    document.addEventListener('mousedown', clearSpatialFocusMode, true);
    document.addEventListener('touchstart', clearSpatialFocusMode, true);
    document.addEventListener('focusin', (event) => {
        const target = event.target?.closest?.(FOCUSABLE_SELECTOR);
        if (!target) return;
        if (spatialFocusMode) target.classList.add('is-spatial-focused');
        else target.classList.remove('is-spatial-focused');
    });
    document.addEventListener('focusout', (event) => {
        event.target?.closest?.(FOCUSABLE_SELECTOR)?.classList?.remove('is-spatial-focused');
    });
}

function handleKeyDown(event) {
    if (!DIRECTIONS.has(event.key) && !ACTIVATE_KEYS.has(event.key) && !BACK_KEYS.has(event.key)) return;
    if (shouldIgnoreEvent(event)) return;

    if (ACTIVATE_KEYS.has(event.key)) {
        activateFocusedElement(event);
        return;
    }

    if (BACK_KEYS.has(event.key)) {
        navigateBack(event);
        return;
    }

    const candidates = visibleFocusableElements();
    if (candidates.length === 0) return;

    const active = activeFocusable();
    const next = active
        ? nextInDirection(active, candidates, event.key)
        : candidates[0];
    if (!next || next === active) return;

    event.preventDefault();
    spatialFocusMode = true;
    focusElement(next);
}

function shouldIgnoreEvent(event) {
    if (event.altKey || event.metaKey || event.ctrlKey) return true;
    if (document.querySelector('gy-player')) return true;
    const target = event.target;
    if (target?.closest?.('gy-player')) return true;
    if (target?.matches?.(TEXT_INPUT_SELECTOR)) return true;
    if (document.querySelector('.search-overlay:not(.hidden)')) return true;
    return false;
}

function activateFocusedElement(event) {
    const active = activeFocusable();
    if (!active) return;
    event.preventDefault();
    active.click();
}

function navigateBack(event) {
    if (location.hash === '#/' || location.hash === '' || history.length <= 1) return;
    event.preventDefault();
    history.back();
}

function activeFocusable() {
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement) return null;
    return active.closest?.(FOCUSABLE_SELECTOR) || null;
}

function visibleFocusableElements() {
    return [...document.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter((element) => !element.closest('gy-player'))
        .filter((element) => !element.closest('[hidden], .hidden'))
        .filter(isVisible);
}

function isVisible(element) {
    const style = window.getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    return rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= window.innerHeight &&
        rect.left <= window.innerWidth;
}

function nextInDirection(active, candidates, key) {
    const current = active.getBoundingClientRect();
    const currentCenter = center(current);
    const dir = directionVector(key);

    const scored = candidates
        .filter((candidate) => candidate !== active)
        .map((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const candidateCenter = center(rect);
            const dx = candidateCenter.x - currentCenter.x;
            const dy = candidateCenter.y - currentCenter.y;
            const primary = dir.x ? dx * dir.x : dy * dir.y;
            if (primary <= 6) return null;
            const secondary = dir.x ? Math.abs(dy) : Math.abs(dx);
            const overlap = dir.x
                ? axisOverlap(current.top, current.bottom, rect.top, rect.bottom)
                : axisOverlap(current.left, current.right, rect.left, rect.right);
            const distance = Math.hypot(dx, dy);
            return {
                candidate,
                score: primary * 1.8 + secondary * 1.2 + distance * 0.12 - overlap * 0.8,
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score);

    return scored[0]?.candidate || null;
}

function center(rect) {
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
    };
}

function directionVector(key) {
    if (key === 'ArrowLeft') return { x: -1, y: 0 };
    if (key === 'ArrowRight') return { x: 1, y: 0 };
    if (key === 'ArrowUp') return { x: 0, y: -1 };
    return { x: 0, y: 1 };
}

function axisOverlap(aStart, aEnd, bStart, bEnd) {
    return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function focusElement(element) {
    element.focus({ preventScroll: true });
    if (document.activeElement === element) element.classList.add('is-spatial-focused');
    element.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
}

function clearSpatialFocusMode() {
    spatialFocusMode = false;
    document.querySelectorAll('.is-spatial-focused').forEach((element) => {
        element.classList.remove('is-spatial-focused');
    });
}

function prefersReducedMotion() {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
