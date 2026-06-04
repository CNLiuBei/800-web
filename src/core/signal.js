// 响应式原语 - Signals 实现

let currentEffect = null;
const effectQueue = new Set();
let isFlushing = false;

export function signal(initialValue) {
    let value = initialValue;
    const subscribers = new Set();

    const s = {
        get value() {
            if (currentEffect) subscribers.add(currentEffect);
            return value;
        },
        set value(newValue) {
            if (newValue === value) return;
            value = newValue;
            subscribers.forEach(fn => {
                effectQueue.add(fn);
            });
            flush();
        },
        peek() { return value; },
        subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    };

    return s;
}

export function computed(fn) {
    const s = signal(undefined);
    effect(() => { s.value = fn(); });
    return { get value() { return s.value; }, subscribe: s.subscribe };
}

export function effect(fn) {
    const execute = () => {
        currentEffect = execute;
        try { fn(); }
        finally { currentEffect = null; }
    };
    execute();
    return () => {
        // 从 effectQueue 中移除，防止已销毁的 effect 继续执行
        effectQueue.delete(execute);
    };
}

export function batch(fn) {
    const prev = isFlushing;
    isFlushing = true;
    fn();
    isFlushing = prev;
    if (!prev) flush();
}

function flush() {
    if (isFlushing) return;
    isFlushing = true;
    queueMicrotask(() => {
        effectQueue.forEach(fn => fn());
        effectQueue.clear();
        isFlushing = false;
    });
}

// 绑定 signal 到 DOM 元素属性
export function bind(el, prop, sig) {
    effect(() => {
        const val = sig.value;
        if (prop === 'text') el.textContent = val;
        else if (prop === 'html') el.innerHTML = val;
        else if (prop === 'class') el.className = val;
        else if (prop === 'style') Object.assign(el.style, val);
        else if (prop === 'visible') el.style.display = val ? '' : 'none';
        else el.setAttribute(prop, val);
    });
}
