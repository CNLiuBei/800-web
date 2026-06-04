/* GY Player v1.0.0 | MIT License | 自研轻量 HLS 播放器 */
var ue=Object.defineProperty;var he=(s,e,t)=>e in s?ue(s,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):s[e]=t;var O=(s,e,t)=>he(s,typeof e!="symbol"?e+"":e,t);var V=`
:host {
    --gyp-accent: #ff453a;
    --gyp-bg: #000;
    --gyp-text: #fff;

    /* \u6DB2\u6001\u73BB\u7483\u6750\u8D28\u53D8\u91CF */
    --gyp-glass-bg: linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.04));
    --gyp-glass-bg-solid: rgba(30,30,32,0.92);
    --gyp-glass-blur: blur(28px) saturate(190%) brightness(1.08);
    --gyp-glass-border: rgba(255,255,255,0.10);
    --gyp-glass-rim: inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 1px rgba(0,0,0,0.18);
    --gyp-glass-shadow: 0 10px 40px rgba(0,0,0,0.45);

    --gyp-track: rgba(255, 255, 255, 0.28);
    --gyp-buffered: rgba(255, 255, 255, 0.45);

    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    background: var(--gyp-bg);
    color: var(--gyp-text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
    font-size: 14px;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
    contain: layout style;
}

:host(.gyp-fullscreen) {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    width: 100vw;
    height: 100vh;
    height: 100dvh;   /* \u52A8\u6001\u89C6\u53E3\uFF1A\u907F\u5F00\u79FB\u52A8\u6D4F\u89C8\u5668\u5730\u5740\u680F\u4F38\u7F29\u5BFC\u81F4\u7684\u9AD8\u5EA6\u8DF3\u53D8 */
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.gyp-video {
    width: 100%;
    height: 100%;
    display: block;
    background: #000;
    object-fit: var(--gyp-fit, contain);
}

.gyp-brightness-overlay {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    opacity: 0;
    background: #000;
    transition: opacity 0.12s ease;
}

.hidden { display: none !important; }

/* ===== \u70B9\u51FB\u6355\u83B7\u5C42 ===== */
.gyp-surface {
    position: absolute;
    inset: 0;
    z-index: 1;
    /* \u89E6\u5C4F\u624B\u52BF\uFF08\u6A2A\u6ED1\u8FDB\u5EA6/\u7AD6\u6ED1\u97F3\u91CF\u4EAE\u5EA6\uFF09\u671F\u95F4\u963B\u6B62\u9875\u9762\u8DDF\u968F\u6EDA\u52A8\u4E0E\u6D4F\u89C8\u5668\u624B\u52BF */
    touch-action: none;
}

/* ===== \u9876\u90E8\u680F ===== */
.gyp-top {
    position: absolute;
    top: 0; left: 0; right: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    padding-top: calc(14px + env(safe-area-inset-top, 0px));
    padding-left: calc(18px + env(safe-area-inset-left, 0px));
    padding-right: calc(18px + env(safe-area-inset-right, 0px));
    background: linear-gradient(to bottom, rgba(0,0,0,0.45), transparent);
    z-index: 10;
    transition: opacity 0.3s cubic-bezier(0.32, 0.72, 0, 1), transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
.gyp-title {
    flex: 1;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.01em;
    opacity: 0.98;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 4px rgba(0,0,0,0.55);
}

/* ===== \u5E95\u90E8\u533A\u57DF\uFF1A\u8FDB\u5EA6\u6761 + \u6309\u94AE\uFF0C\u9760\u5E95\u90E8 scrim \u6E10\u53D8\u4FDD\u8BC1\u53EF\u8BFB\uFF08dock \u900F\u660E\uFF09===== */
.gyp-bottom {
    position: absolute;
    left: 12px; right: 12px;
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    left: calc(12px + env(safe-area-inset-left, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 10px;
    z-index: 10;
    transition: opacity 0.3s cubic-bezier(0.32, 0.72, 0, 1), transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
/* \u5E95\u90E8 scrim\uFF1A\u6A2A\u8D2F\u6574\u5BBD\u7684\u6E10\u53D8\u906E\u7F69\uFF0C\u4ECE\u5E95\u90E8\u9ED1\u5230\u900F\u660E\uFF0C\u6258\u4F4F\u8FDB\u5EA6\u6761\u548C\u6309\u94AE */
.gyp-scrim {
    position: absolute;
    left: 0; right: 0; bottom: 0;
    height: 26%;
    min-height: 110px;
    z-index: 9;
    pointer-events: none;
    background: linear-gradient(to top, rgba(0,0,0,0.45), rgba(0,0,0,0.18) 45%, transparent);
    opacity: 1;
    transition: opacity 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}

/* \u8FDB\u5EA6\u6761\u884C\uFF1A\u6A2A\u8D2F\u5BBD\u5EA6\uFF0C\u72EC\u7ACB\u4E8E\u6309\u94AE\u4E4B\u4E0A */
.gyp-progress-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 6px;
}
.gyp-progress-bar .gyp-time {
    flex: 0 0 auto;
    text-shadow: 0 1px 3px rgba(0,0,0,0.6);
}

/* \u6309\u94AE dock\uFF1A\u6DB2\u6001\u73BB\u7483\uFF08SVG \u7F6E\u6362\u6298\u5C04 + \u67D3\u8272 + \u8FB9\u7F18\u9AD8\u5149\uFF0C\u5BF9\u6807 macOS / iOS 26\uFF09*/
.gyp-btns {
    display: flex;
    align-items: center;
    gap: 2px;
    position: relative;
    padding: 6px 10px;
    border-radius: 24px;
    isolation: isolate;
    box-shadow: 0 6px 18px rgba(0,0,0,0.28), 0 0 24px rgba(0,0,0,0.12);
}
/* \u73BB\u7483\u4E09\u5C42\uFF1A\u94FA\u6EE1 dock\uFF0C\u5706\u89D2\u7EE7\u627F */
.gyp-glass, .gyp-glass > div {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
}
/* \u6298\u5C04\u5C42\uFF1A\u80CC\u666F\u6A21\u7CCA + SVG \u7F6E\u6362\u626D\u66F2\uFF08\u4EC5 Chromium \u7CFB\u751F\u6548\uFF0CSafari \u81EA\u52A8\u9000\u5316\u4E3A\u7EAF\u6A21\u7CCA\uFF09*/
.gyp-glass-effect {
    z-index: 0;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    filter: url(#gyp-glass-distortion);
    overflow: hidden;
}
/* \u67D3\u8272\u5C42\uFF1A\u6DF1\u8272\u534A\u900F\u660E\uFF0C\u9002\u914D\u89C6\u9891\u4E0A\u7684\u6DF1\u8272\u573A\u666F */
.gyp-glass-tint {
    z-index: 1;
    background: rgba(28,28,30,0.42);
}
/* \u9AD8\u5149\u5C42\uFF1A\u73BB\u7483\u8FB9\u7F18\u5185\u63CF\u8FB9\u5149\u6CFD */
.gyp-glass-shine {
    z-index: 2;
    box-shadow:
        inset 1px 1px 1px 0 rgba(255,255,255,0.30),
        inset -1px -1px 1px 1px rgba(255,255,255,0.12);
}
/* dock \u5185\u7684\u6309\u94AE\u7B49\u5185\u5BB9\u6D6E\u5728\u73BB\u7483\u4E4B\u4E0A */
.gyp-btns > .gyp-btn,
.gyp-btns > .gyp-volume,
.gyp-btns > .gyp-spacer { position: relative; z-index: 3; }
/* SVG \u6EE4\u955C\u5BB9\u5668\uFF1A\u4E0D\u5360\u5E03\u5C40 */
.gyp-glass-svg { position: absolute; width: 0; height: 0; pointer-events: none; }

/* \u9690\u85CF\u63A7\u4EF6\uFF08\u6C89\u6D78\u6001\uFF09\uFF1Adock \u4E0B\u6ED1\u6DE1\u51FA\uFF0Cscrim \u540C\u6B65\u6DE1\u51FA */
:host(.gyp-immersed) .gyp-top { opacity: 0; pointer-events: none; transform: translateY(-10px); }
:host(.gyp-immersed) .gyp-bottom { opacity: 0; pointer-events: none; transform: translateY(18px); }
:host(.gyp-immersed) .gyp-scrim { opacity: 0; }
:host(.gyp-immersed) .gyp-mini { opacity: 1; }

/* \u9501\u5B9A\u6001\uFF1A\u9690\u85CF\u6240\u6709\u63A7\u4EF6\uFF0C\u53EA\u7559\u89E3\u9501\u6309\u94AE */
:host(.gyp-locked) .gyp-top,
:host(.gyp-locked) .gyp-scrim,
:host(.gyp-locked) .gyp-bottom { opacity: 0; pointer-events: none; }

/* ===== \u8FDB\u5EA6\u6761 ===== */
.gyp-progress {
    position: relative;
    flex: 1;
    height: 20px;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
}
.gyp-progress-track {
    position: absolute;
    left: 0; right: 0;
    height: 5px;
    background: var(--gyp-track);
    border-radius: 5px;
    overflow: hidden;
    transition: height 0.18s cubic-bezier(0.32, 0.72, 0, 1);
}
.gyp-progress:hover .gyp-progress-track,
.gyp-progress.dragging .gyp-progress-track { height: 7px; }

.gyp-progress-buffered {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    background: var(--gyp-buffered);
    border-radius: 5px;
    width: 0;
    transition: width 0.2s ease;
}
.gyp-progress-played {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    background: #fff;
    border-radius: 5px;
    width: 0;
    box-shadow: 0 0 6px rgba(255,255,255,0.45);
}
.gyp-progress-thumb {
    position: absolute;
    top: 50%;
    left: 0;
    width: 28px; height: 16px;
    border-radius: 999px;
    transform: translate(-50%, -50%) scale(0);
    transform-origin: center;
    transition: transform 0.18s cubic-bezier(0.32, 0.72, 0, 1), height 0.15s ease;
    pointer-events: none;
    overflow: hidden;
    /* \u5E73\u65F6\uFF1A\u767D\u8272\u836F\u4E38 */
    background: #fff;
    box-shadow: 0 1px 8px rgba(0,0,0,0.35), 0 0 2px rgba(0,0,0,0.2);
}
.gyp-progress:hover .gyp-progress-thumb,
.gyp-progress.dragging .gyp-progress-thumb { transform: translate(-50%, -50%) scale(1); }

/* \u6DB2\u6001\u73BB\u7483\u900F\u955C\u4E09\u5C42\uFF08\u9ED8\u8BA4\u9690\u85CF\uFF0C\u62D6\u52A8\u65F6\u663E\u73B0\uFF09*/
.gyp-thumb-lens, .gyp-thumb-overlay, .gyp-thumb-specular {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    opacity: 0;
    transition: opacity 0.15s ease;
    pointer-events: none;
}
.gyp-thumb-lens {
    z-index: 0;
    backdrop-filter: blur(0.6px);
    -webkit-backdrop-filter: blur(0.6px);
    filter: url(#gyp-thumb-lens);
}
.gyp-thumb-overlay {
    z-index: 1;
    background: rgba(255,255,255,0.10);
}
.gyp-thumb-specular {
    z-index: 2;
    box-shadow:
        inset 1px 1px 0 rgba(255,255,255,0.35),
        inset 0 0 14px rgba(255,255,255,0.45),
        inset -1px -1px 0 rgba(255,255,255,0.18);
}
/* \u62D6\u52A8\u65F6\uFF1A\u836F\u4E38\u53D8\u900F\u660E\u73BB\u7483\u900F\u955C\uFF0C\u4E09\u5C42\u663E\u73B0 */
.gyp-progress.dragging .gyp-progress-thumb {
    background: transparent;
    box-shadow: none;
}
.gyp-progress.dragging .gyp-thumb-lens,
.gyp-progress.dragging .gyp-thumb-overlay,
.gyp-progress.dragging .gyp-thumb-specular { opacity: 1; }

/* hover \u65F6\u95F4\u6C14\u6CE1\uFF08\u6DB2\u6001\u73BB\u7483\u5C0F\u5361\u7247\uFF0C\u6D6E\u4E8E dock \u4E0A\u65B9\uFF09*/
.gyp-progress-tip {
    position: absolute;
    bottom: 30px;
    transform: translateX(-50%);
    padding: 5px 11px;
    border-radius: 10px;
    background: rgba(20,20,22,0.6);
    background: var(--gyp-glass-bg);
    backdrop-filter: var(--gyp-glass-blur);
    -webkit-backdrop-filter: var(--gyp-glass-blur);
    border: 0.5px solid var(--gyp-glass-border);
    box-shadow: var(--gyp-glass-rim), 0 6px 20px rgba(0,0,0,0.5);
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 12;
}
.gyp-progress:hover .gyp-progress-tip { opacity: 1; }

/* \u8FF7\u4F60\u8FDB\u5EA6\u6761\uFF08\u6C89\u6D78\u6001\u53EF\u89C1\uFF09 */
.gyp-mini {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    height: 3px;
    background: rgba(255,255,255,0.18);
    opacity: 0;
    transition: opacity 0.3s ease;
    z-index: 9;
}
.gyp-mini-bar {
    height: 100%;
    width: 0;
    background: #fff;
}

/* ===== \u6309\u94AE ===== */
.gyp-btn {
    flex: 0 0 auto;
    width: 40px; height: 40px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    color: var(--gyp-text);
    cursor: pointer;
    border-radius: 50%;
    transition: background 0.18s ease, transform 0.12s ease;
    -webkit-tap-highlight-color: transparent;
}
.gyp-btn:hover { background: rgba(255,255,255,0.18); }
.gyp-btn:active { transform: scale(0.9); }
.gyp-btn:focus-visible { outline: 2px solid var(--gyp-accent); outline-offset: 1px; }
.gyp-btn svg { width: 22px; height: 22px; display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.25)); }
.gyp-btn.gyp-btn-text {
    width: auto;
    min-width: 46px;
    padding: 0 12px;
    border-radius: 16px;
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}
.gyp-spacer { flex: 1; }

.gyp-time {
    font-size: 13px;
    font-weight: 500;
    opacity: 0.92;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    padding: 0 8px;
    text-shadow: 0 1px 2px rgba(0,0,0,0.3);
}
.gyp-time-sep { opacity: 0.45; margin: 0 2px; }

/* ===== \u97F3\u91CF\u7EC4\uFF08hover \u5C55\u5F00\u6A2A\u5411\u6ED1\u6761\uFF09===== */
.gyp-volume {
    display: flex;
    align-items: center;
    overflow: hidden;
}
.gyp-volume-slider {
    width: 0;
    opacity: 0;
    height: 5px;
    margin: 0;
    transition: width 0.22s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease, margin 0.22s cubic-bezier(0.32, 0.72, 0, 1);
    position: relative;
    cursor: pointer;
    touch-action: none;
    flex: 0 0 auto;
}
.gyp-volume:hover .gyp-volume-slider,
.gyp-volume.expanded .gyp-volume-slider {
    width: 72px;
    opacity: 1;
    margin: 0 8px 0 2px;
}
.gyp-volume-track {
    position: absolute;
    top: 50%; left: 0; right: 0;
    height: 5px;
    transform: translateY(-50%);
    background: var(--gyp-track);
    border-radius: 5px;
}
.gyp-volume-fill {
    position: absolute;
    top: 50%; left: 0;
    height: 5px;
    transform: translateY(-50%);
    background: #fff;
    border-radius: 5px;
    width: 100%;
}
.gyp-volume-thumb {
    position: absolute;
    top: 50%; left: 100%;
    width: 16px; height: 12px;
    background: #fff;
    border-radius: 999px;
    transform: translate(-50%, -50%);
    box-shadow: 0 1px 6px rgba(0,0,0,0.4), 0 0 2px rgba(0,0,0,0.2);
    transition: transform 0.12s ease;
}
.gyp-volume-slider:active .gyp-volume-thumb { transform: translate(-50%, -50%) scaleY(0.92) scaleX(1.12); }

/* ===== \u4E2D\u592E\u5927\u6309\u94AE\uFF08\u64AD\u653E/\u6682\u505C\u56DE\u663E\uFF0C\u6DB2\u6001\u73BB\u7483\u5706\uFF09===== */
.gyp-center {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    z-index: 6;
    pointer-events: none;
}
.gyp-center-btn {
    width: 72px; height: 72px;
    display: grid;
    place-items: center;
    border: 0.5px solid var(--gyp-glass-border);
    border-radius: 50%;
    background: var(--gyp-glass-bg);
    backdrop-filter: var(--gyp-glass-blur);
    -webkit-backdrop-filter: var(--gyp-glass-blur);
    box-shadow: var(--gyp-glass-rim), 0 6px 24px rgba(0,0,0,0.4);
    color: #fff;
    opacity: 0;
    transform: scale(0.8);
    transition: opacity 0.35s ease, transform 0.35s ease;
}
.gyp-center-btn svg { width: 34px; height: 34px; }
.gyp-center.flash .gyp-center-btn {
    animation: gyp-flash 0.5s cubic-bezier(0.32, 0.72, 0, 1) forwards;
}
@keyframes gyp-flash {
    0% { opacity: 0.95; transform: scale(0.85); }
    100% { opacity: 0; transform: scale(1.35); }
}

/* ===== \u4E2D\u592E\u63D0\u793A\uFF08\u624B\u52BF\u53CD\u9988\uFF0C\u6DB2\u6001\u73BB\u7483\u80F6\u56CA\uFF09===== */
.gyp-hint {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    padding: 12px 22px;
    border-radius: 16px;
    background: var(--gyp-glass-bg);
    backdrop-filter: var(--gyp-glass-blur);
    -webkit-backdrop-filter: var(--gyp-glass-blur);
    border: 0.5px solid var(--gyp-glass-border);
    box-shadow: var(--gyp-glass-rim), 0 6px 24px rgba(0,0,0,0.4);
    font-size: 16px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    z-index: 20;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.2s ease;
    white-space: nowrap;
}
.gyp-hint.visible { opacity: 1; }

/* ===== \u53CC\u51FB\u5FEB\u8FDB/\u5FEB\u9000\u6D9F\u6F2A\u53CD\u9988\uFF08\u79FB\u52A8\u7AEF\u4E24\u4FA7\uFF09===== */
.gyp-dbltap {
    position: absolute;
    top: 0; bottom: 0;
    width: 38%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    z-index: 14;
    pointer-events: none;
    color: #fff;
    /* \u534A\u692D\u5706\u6C34\u6CE2\u7EB9\u5E95\u8272\uFF0C\u5411\u4E2D\u5FC3\u6536\u62E2 */
    background: radial-gradient(circle at center, rgba(255,255,255,0.18), rgba(255,255,255,0.06) 45%, transparent 70%);
    opacity: 0;
}
.gyp-dbltap.hidden { display: none; }
.gyp-dbltap-left { left: 0; border-radius: 0 50% 50% 0 / 0 50% 50% 0; }
.gyp-dbltap-right { right: 0; border-radius: 50% 0 0 50% / 50% 0 0 50%; }
.gyp-dbltap-icon { display: grid; place-items: center; }
.gyp-dbltap-icon svg { width: 38px; height: 38px; filter: drop-shadow(0 1px 4px rgba(0,0,0,0.5)); }
/* \u4E24\u4E2A\u7BAD\u5934\u8FDE\u7EED\u95EA\u52A8\uFF0C\u6A21\u62DF\u65B9\u5411\u6D41\u52A8 */
.gyp-dbltap-icon svg:nth-child(2) { margin-left: -10px; }
.gyp-dbltap-text {
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 3px rgba(0,0,0,0.6);
}
.gyp-dbltap.active {
    animation: gyp-dbltap-pulse 0.6s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes gyp-dbltap-pulse {
    0% { opacity: 0; }
    25% { opacity: 1; }
    100% { opacity: 0; }
}
/* \u7BAD\u5934\u5FAE\u52A8 */
.gyp-dbltap.active .gyp-dbltap-icon {
    animation: gyp-dbltap-nudge 0.5s ease;
}
@keyframes gyp-dbltap-nudge {
    0%, 100% { transform: translateX(0); }
    50% { transform: translateX(var(--gyp-nudge, 4px)); }
}
.gyp-dbltap-left .gyp-dbltap-icon { --gyp-nudge: -4px; }
.gyp-dbltap-right .gyp-dbltap-icon { --gyp-nudge: 4px; }

/* ===== \u7AD6\u6ED1\u4EAE\u5EA6/\u97F3\u91CF\u53EF\u89C6\u5316\u6307\u793A\uFF08\u4E2D\u592E\u6DB2\u6001\u73BB\u7483\u80F6\u56CA\uFF09===== */
.gyp-vslide {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    border-radius: 16px;
    background: var(--gyp-glass-bg);
    backdrop-filter: var(--gyp-glass-blur);
    -webkit-backdrop-filter: var(--gyp-glass-blur);
    border: 0.5px solid var(--gyp-glass-border);
    box-shadow: var(--gyp-glass-rim), 0 6px 24px rgba(0,0,0,0.4);
    z-index: 20;
    pointer-events: none;
}
.gyp-vslide.hidden { display: none; }
.gyp-vslide-icon { flex: 0 0 auto; display: grid; place-items: center; }
.gyp-vslide-icon svg { width: 22px; height: 22px; display: block; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4)); }
.gyp-vslide-track {
    flex: 0 0 auto;
    width: 120px; height: 5px;
    border-radius: 5px;
    background: rgba(255,255,255,0.28);
    overflow: hidden;
}
.gyp-vslide-fill {
    height: 100%;
    width: 0;
    background: #fff;
    border-radius: 5px;
    box-shadow: 0 0 6px rgba(255,255,255,0.45);
}

/* ===== \u79FB\u52A8\u7AEF\u9996\u6B21\u624B\u52BF\u5F15\u5BFC ===== */
.gyp-guide {
    position: absolute;
    inset: 0;
    z-index: 35;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    animation: gyp-mask-in 0.25s ease;
}
.gyp-guide.hidden { display: none; }
.gyp-guide-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px 24px;
    margin: 0 24px;
    max-width: 360px;
    border-radius: 20px;
    background: var(--gyp-glass-bg-solid);
    border: 0.5px solid var(--gyp-glass-border);
    box-shadow: var(--gyp-glass-rim), 0 12px 40px rgba(0,0,0,0.5);
}
.gyp-guide-title {
    font-size: 15px; font-weight: 700;
    letter-spacing: 0.02em; opacity: 0.95;
    text-align: center;
}
.gyp-guide-row {
    display: flex; align-items: center; gap: 14px;
    font-size: 14px; font-weight: 500; opacity: 0.92;
}
.gyp-guide-ico {
    flex: 0 0 auto;
    width: 30px; height: 30px;
    display: grid; place-items: center;
    color: var(--gyp-accent);
}
.gyp-guide-ico svg { width: 24px; height: 24px; display: block; }
.gyp-guide-btn {
    margin-top: 4px;
    padding: 11px 0;
    border: none; border-radius: 14px;
    background: var(--gyp-accent); color: #fff;
    font-size: 14px; font-weight: 700; cursor: pointer;
    transition: transform 0.12s ease, opacity 0.15s ease;
}
.gyp-guide-btn:active { transform: scale(0.96); }

/* ===== \u7F13\u51B2\u8F6C\u5708 ===== */
.gyp-buffering {
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    z-index: 15;
    pointer-events: none;
}

/* ===== \u9996\u5C4F\u52A0\u8F7D\u6001 ===== */
.gyp-loading {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    background: rgba(0,0,0,0.35);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 16;
    pointer-events: none;
}
.gyp-loading-logo {
    max-height: 6rem; max-width: 60%;
    object-fit: contain;
    filter: drop-shadow(0 2px 12px rgba(0,0,0,0.5));
    animation: gyp-logo-pulse 2s ease-in-out infinite;
}
.gyp-loading-logo.hidden { display: none; }
@keyframes gyp-logo-pulse {
    0%, 100% { opacity: 0.85; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.03); }
}
.gyp-spinner {
    width: 48px; height: 48px;
    border: 3px solid rgba(255,255,255,0.2);
    border-top-color: #fff;
    border-radius: 50%;
    animation: gyp-spin 0.8s linear infinite;
}
@keyframes gyp-spin { to { transform: rotate(360deg); } }

/* ===== \u9501\u5B9A\u6309\u94AE\uFF08\u6DB2\u6001\u73BB\u7483\u5706\uFF09===== */
.gyp-lock {
    position: absolute;
    right: 18px;
    right: calc(18px + env(safe-area-inset-right, 0px));
    top: 50%;
    transform: translateY(-50%);
    z-index: 25;
    background: var(--gyp-glass-bg);
    backdrop-filter: var(--gyp-glass-blur);
    -webkit-backdrop-filter: var(--gyp-glass-blur);
    border: 0.5px solid var(--gyp-glass-border);
    box-shadow: var(--gyp-glass-rim), 0 4px 16px rgba(0,0,0,0.35);
    opacity: 0;
    transition: opacity 0.3s ease;
}
:host(.gyp-locked) .gyp-lock,
:host(:not(.gyp-immersed)) .gyp-lock { opacity: 1; }

/* ===== \u9009\u96C6\u9762\u677F\uFF08\u4E0E\u8BBE\u7F6E\u83DC\u5355\u7EDF\u4E00\uFF1A\u53F3\u4E0B\u6D6E\u8D77\u73BB\u7483\u9762\u677F\uFF09===== */
.gyp-ep-panel {
    position: absolute;
    right: 16px;
    right: calc(16px + env(safe-area-inset-right, 0px));
    bottom: 78px;
    width: 300px; max-width: calc(100% - 32px);
    max-height: 56%;
    z-index: 30;
    display: flex; flex-direction: column;
    padding: 8px;
    border-radius: 20px;
    background: var(--gyp-glass-bg);
    backdrop-filter: var(--gyp-glass-blur);
    -webkit-backdrop-filter: var(--gyp-glass-blur);
    border: 0.5px solid var(--gyp-glass-border);
    box-shadow: var(--gyp-glass-rim), 0 12px 40px rgba(0,0,0,0.5);
    animation: gyp-pop 0.2s cubic-bezier(0.32, 0.72, 0, 1);
}
.gyp-ep-panel.hidden { display: none; }

.gyp-ep-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px 6px;
}
.gyp-ep-title {
    font-size: 11px; font-weight: 700;
    letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.5;
}
.gyp-ep-header .gyp-btn { width: 28px; height: 28px; transform: rotate(180deg); }
.gyp-ep-header .gyp-btn svg { width: 16px; height: 16px; }

/* \u5B63\u5BFC\u822A\uFF1A\u2039 \u7B2CN\u5B63 \u2304 \u203A\uFF08\u5BF9\u9F50 web \u8BE6\u60C5\u9875\uFF09*/
.gyp-ep-nav {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 8px 8px;
}
.gyp-ep-nav.hidden { display: none; }
.gyp-ep-arrow {
    flex: 0 0 auto; width: 30px; height: 30px;
    display: grid; place-items: center;
    border: none; border-radius: 50%;
    background: rgba(255,255,255,0.12); color: #fff; cursor: pointer;
    transition: background 0.14s ease;
}
.gyp-ep-arrow:hover:not(:disabled) { background: rgba(255,255,255,0.2); }
.gyp-ep-arrow:disabled { opacity: 0.3; cursor: default; }
.gyp-ep-arrow svg { width: 16px; height: 16px; display: block; }
.gyp-ep-current {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;
    padding: 6px 12px; border: none; border-radius: 9px;
    background: rgba(255,255,255,0.12); color: #fff;
    font-size: 13px; font-weight: 600; cursor: pointer;
    transition: background 0.14s ease;
}
.gyp-ep-current:hover { background: rgba(255,255,255,0.2); }
.gyp-ep-caret { display: inline-flex; opacity: 0.7; }
.gyp-ep-caret svg { width: 14px; height: 14px; display: block; }

/* \u5B63\u4E0B\u62C9\u83DC\u5355\uFF08\u7EDD\u5BF9\u5B9A\u4F4D\u6D6E\u5C42\uFF09*/
.gyp-ep-dropdown {
    position: absolute; left: 8px; right: 8px; top: 76px; z-index: 5;
    background: var(--gyp-glass-bg-solid);
    border: 0.5px solid var(--gyp-glass-border); border-radius: 12px;
    box-shadow: var(--gyp-glass-rim), 0 12px 32px rgba(0,0,0,0.5);
    padding: 5px; max-height: 220px; overflow-y: auto;
    scrollbar-width: none; -ms-overflow-style: none;
}
.gyp-ep-dropdown::-webkit-scrollbar { display: none; }
.gyp-ep-dropdown.hidden { display: none; }
.gyp-ep-option {
    display: block; width: 100%; text-align: left;
    padding: 8px 11px; border: none; border-radius: 8px;
    background: transparent; color: #fff; font-size: 13px; cursor: pointer;
    transition: background 0.14s ease;
}
.gyp-ep-option:hover { background: rgba(255,255,255,0.16); }
.gyp-ep-option.active { background: var(--gyp-accent); }

/* \u5206\u6BB5 chip\uFF08\u96C6\u591A\u65F6\u6309\u6BB5\u5207\u6362\uFF09*/
.gyp-ep-segments {
    display: flex; gap: 6px; flex-wrap: wrap;
    padding: 0 8px 8px;
    max-height: 92px; overflow-y: auto; overscroll-behavior: contain;
    scrollbar-width: none;
}
.gyp-ep-segments::-webkit-scrollbar { display: none; }
.gyp-ep-segments.hidden { display: none; }
.gyp-ep-seg {
    padding: 4px 12px; border-radius: 8px; border: none;
    background: rgba(255,255,255,0.1); color: #fff;
    font-size: 12px; font-weight: 600; cursor: pointer;
    font-variant-numeric: tabular-nums;
    transition: background 0.14s ease;
}
.gyp-ep-seg:hover { background: rgba(255,255,255,0.18); }
.gyp-ep-seg.active { background: var(--gyp-accent); }

/* \u96C6\u5217\u8868\uFF1A\u5355\u5217\u6392\u5E03\uFF0C\u83DC\u5355\u9879\u98CE\u683C */
.gyp-ep-list {
    flex: 1; overflow-y: auto; overscroll-behavior: contain;
    padding: 0 4px 4px;
    display: flex; flex-direction: column;
    gap: 4px;
    scrollbar-width: none; -ms-overflow-style: none;
}
.gyp-ep-list::-webkit-scrollbar { display: none; }
.gyp-ep-item {
    display: flex; flex-direction: column; gap: 2px;
    padding: 10px 11px; border-radius: 10px;
    border: none; background: transparent;
    color: #fff; text-align: left; cursor: pointer; width: 100%;
    transition: background 0.14s ease;
}
.gyp-ep-item:hover { background: rgba(255,255,255,0.16); }
.gyp-ep-item.active { background: rgba(255,255,255,0.1); }
.gyp-ep-line { display: flex; align-items: center; gap: 8px; }
.gyp-ep-num {
    flex: 0 0 auto; font-size: 13px; font-weight: 600;
    opacity: 0.55; font-variant-numeric: tabular-nums;
}
.gyp-ep-item.has-source .gyp-ep-num { opacity: 1; }
.gyp-ep-item.active .gyp-ep-num { opacity: 1; color: var(--gyp-accent); }
.gyp-ep-name { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gyp-ep-item.active .gyp-ep-name { font-weight: 600; }
/* \u6709\u6E90\u6807\u8BB0\uFF1A\u7EFF\u70B9 */
.gyp-ep-dot {
    flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%;
    background: #34c759; box-shadow: 0 0 6px rgba(52,199,89,0.5);
}
.gyp-ep-date { font-size: 11px; opacity: 0.45; padding-left: 2px; }

/* ===== \u8BBE\u7F6E\u83DC\u5355\uFF08\u6DB2\u6001\u73BB\u7483\u9762\u677F\uFF09===== */
.gyp-menu {
    position: absolute;
    right: 16px;
    right: calc(16px + env(safe-area-inset-right, 0px));
    bottom: 78px;
    min-width: 190px;
    max-height: 56%;
    overflow-y: auto;
    padding: 8px;
    border-radius: 20px;
    background: var(--gyp-glass-bg);
    backdrop-filter: var(--gyp-glass-blur);
    -webkit-backdrop-filter: var(--gyp-glass-blur);
    border: 0.5px solid var(--gyp-glass-border);
    box-shadow: var(--gyp-glass-rim), 0 12px 40px rgba(0,0,0,0.5);
    z-index: 30;
    animation: gyp-pop 0.2s cubic-bezier(0.32, 0.72, 0, 1);
    scrollbar-width: none; -ms-overflow-style: none;
}
.gyp-menu::-webkit-scrollbar { display: none; }
@keyframes gyp-pop { from { opacity: 0; transform: translateY(8px) scale(0.96); } }

/* \u62BD\u5C49\u906E\u7F69\uFF1A\u684C\u9762\u7AEF\u4E0D\u663E\u793A\uFF08\u9762\u677F\u4E3A\u89D2\u843D\u5C0F\u6D6E\u5C42\uFF09\uFF0C\u4EC5\u79FB\u52A8\u7AEF\u5E95\u90E8\u62BD\u5C49\u65F6\u663E\u793A\u5E76\u53EF\u70B9\u51FB\u5173\u95ED */
.gyp-sheet-mask {
    position: absolute;
    inset: 0;
    z-index: 29;
    background: rgba(0,0,0,0.45);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.22s ease;
}
.gyp-sheet-mask.hidden { display: none; }
.gyp-menu-title {
    padding: 8px 12px 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0.5;
}
.gyp-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.14s ease;
}
.gyp-menu-item:hover,
.gyp-menu-item:focus-visible { background: rgba(255,255,255,0.16); outline: none; }
.gyp-menu-item .gyp-menu-check {
    width: 16px; height: 16px;
    opacity: 0;
    flex: 0 0 auto;
    color: var(--gyp-accent);
}
.gyp-menu-item.active .gyp-menu-check { opacity: 1; }
.gyp-menu-item.active { color: #fff; font-weight: 600; }

/* ===== \u7EED\u64AD\u63D0\u793A\u6761\uFF08\u6DB2\u6001\u73BB\u7483\u80F6\u56CA\uFF09===== */
.gyp-resume {
    position: absolute;
    bottom: 92px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 18px;
    border-radius: 18px;
    background: var(--gyp-glass-bg);
    backdrop-filter: var(--gyp-glass-blur);
    -webkit-backdrop-filter: var(--gyp-glass-blur);
    border: 0.5px solid var(--gyp-glass-border);
    box-shadow: var(--gyp-glass-rim), 0 10px 32px rgba(0,0,0,0.45);
    z-index: 22;
    white-space: nowrap;
    animation: gyp-slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes gyp-slide-up { from { opacity: 0; transform: translate(-50%, 12px); } }
.gyp-resume-text { font-size: 13px; font-weight: 500; opacity: 0.96; }
.gyp-resume-btn {
    padding: 7px 16px;
    border-radius: 14px;
    border: none;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: transform 0.12s ease, opacity 0.15s ease;
}
.gyp-resume-btn:active { transform: scale(0.94); }
.gyp-resume-yes { background: var(--gyp-accent); color: #fff; box-shadow: 0 2px 8px rgba(255,69,58,0.4); box-shadow: 0 2px 8px color-mix(in srgb, var(--gyp-accent) 50%, transparent); }
.gyp-resume-no { background: rgba(255,255,255,0.2); color: #fff; }

/* ===== \u9519\u8BEF\u8986\u76D6\u5C42 ===== */
.gyp-error {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    background: rgba(0,0,0,0.78);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    z-index: 40;
    text-align: center;
    padding: 24px;
}
.gyp-error-msg { font-size: 15px; font-weight: 500; opacity: 0.92; max-width: 400px; line-height: 1.5; }
.gyp-error-btn {
    padding: 11px 28px;
    border-radius: 16px;
    border: none;
    background: var(--gyp-accent);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(255,69,58,0.4);
    box-shadow: 0 4px 16px color-mix(in srgb, var(--gyp-accent) 45%, transparent);
    transition: transform 0.12s ease;
}
.gyp-error-btn:active { transform: scale(0.95); }
/* ===== \u79FB\u52A8\u7AEF\u9002\u914D ===== */
@media (max-width: 640px) {
    .gyp-volume-slider { display: none; }
    .gyp-btn { width: 42px; height: 42px; }
    .gyp-time { font-size: 12px; }
    .gyp-top {
        padding: 12px 14px;
        padding-top: calc(12px + env(safe-area-inset-top, 0px));
        padding-left: calc(14px + env(safe-area-inset-left, 0px));
        padding-right: calc(14px + env(safe-area-inset-right, 0px));
    }
    /* \u4FDD\u7559\u5B89\u5168\u533A\uFF0C\u907F\u514D\u6A2A\u5C4F\u5218\u6D77\u906E\u6321 */
    .gyp-bottom {
        left: calc(8px + env(safe-area-inset-left, 0px));
        right: calc(8px + env(safe-area-inset-right, 0px));
        bottom: calc(8px + env(safe-area-inset-bottom, 0px));
        gap: 8px;
    }
    .gyp-btns { padding: 5px 8px; border-radius: 22px; }
    .gyp-progress-bar { gap: 8px; padding: 0 4px; }

    /* \u8BBE\u7F6E\u83DC\u5355 \u2192 \u5E95\u90E8\u5168\u5BBD\u62BD\u5C49\uFF08bottom sheet\uFF09\uFF0C\u66F4\u6613\u62C7\u6307\u70B9\u6309 */
    .gyp-menu {
        left: 0; right: 0; bottom: 0;
        min-width: 0;
        width: 100%;
        max-height: 60%;
        padding: 8px 12px calc(16px + env(safe-area-inset-bottom, 0px));
        padding-left: calc(12px + env(safe-area-inset-left, 0px));
        padding-right: calc(12px + env(safe-area-inset-right, 0px));
        border-radius: 20px 20px 0 0;
        animation: gyp-sheet-up 0.26s cubic-bezier(0.32, 0.72, 0, 1);
    }
    /* \u62BD\u5C49\u9876\u90E8\u6293\u624B */
    .gyp-menu::before {
        content: '';
        display: block;
        width: 40px; height: 4px;
        margin: 2px auto 8px;
        border-radius: 999px;
        background: rgba(255,255,255,0.28);
    }
    .gyp-menu-item { padding: 13px 14px; font-size: 15px; }

    /* \u9009\u96C6\u9762\u677F \u2192 \u5E95\u90E8\u5168\u5BBD\u62BD\u5C49 */
    .gyp-ep-panel {
        left: 0; right: 0; bottom: 0;
        width: 100%; max-width: 100%;
        max-height: 72%;
        padding: 8px 10px calc(12px + env(safe-area-inset-bottom, 0px));
        padding-left: calc(10px + env(safe-area-inset-left, 0px));
        padding-right: calc(10px + env(safe-area-inset-right, 0px));
        border-radius: 20px 20px 0 0;
        animation: gyp-sheet-up 0.26s cubic-bezier(0.32, 0.72, 0, 1);
    }
    .gyp-ep-panel::before {
        content: '';
        display: block;
        width: 40px; height: 4px;
        margin: 2px auto 4px;
        border-radius: 999px;
        background: rgba(255,255,255,0.28);
    }
    /* \u96C6\u5217\u8868\u9879\u79FB\u52A8\u7AEF\u52A0\u5927\u70B9\u6309\u9AD8\u5EA6 */
    .gyp-ep-item { padding: 13px 12px; }
    .gyp-ep-name { font-size: 14px; }
    /* \u5B63\u4E0B\u62C9\u79FB\u52A8\u7AEF\u8DDF\u968F\u62BD\u5C49\u5BBD\u5EA6 */
    .gyp-ep-dropdown { left: 10px; right: 10px; top: 84px; }

    /* \u79FB\u52A8\u7AEF\uFF1A\u62BD\u5C49\u906E\u7F69\u53EF\u89C1\u4E14\u53EF\u70B9\u51FB\u5173\u95ED */
    .gyp-sheet-mask:not(.hidden) { opacity: 1; pointer-events: auto; }

    /* \u79FB\u52A8\u7AEF dock \u9632\u6EA2\u51FA\uFF1A\u7F29\u5C0F\u6309\u94AE\u95F4\u8DDD\uFF0C\u6587\u5B57\u6309\u94AE\u7D27\u51D1 */
    .gyp-btns { gap: 0; }
    .gyp-btn.gyp-btn-text { min-width: 40px; padding: 0 8px; }
    /* \u6807\u9898\u5B57\u53F7\u7565\u51CF\uFF0C\u907F\u514D\u6324\u5360\u8FD4\u56DE\u6309\u94AE */
    .gyp-title { font-size: 15px; }
}

/* ===== \u7AD6\u5C4F\u7A84\u5C4F\uFF08\u624B\u673A\u7AD6\u5C4F\uFF09\uFF1A\u7CBE\u7B80\u6B21\u8981\u6309\u94AE\uFF0C\u4FDD\u8BC1\u6838\u5FC3\u63A7\u4EF6\u4E0D\u6EA2\u51FA ===== */
@media (max-width: 480px) and (orientation: portrait) {
    /* \u7AD6\u5C4F\u7A7A\u95F4\u7D27\u5F20\uFF1A\u753B\u4E2D\u753B\u4F7F\u7528\u7387\u4F4E\uFF0C\u9690\u85CF\u8BA9\u51FA\u7A7A\u95F4 */
    #pipBtn { display: none; }
    /* \u97F3\u91CF\u6309\u94AE\u5728\u7AD6\u5C4F\u79FB\u52A8\u7AEF\u610F\u4E49\u6709\u9650\uFF08\u7CFB\u7EDF\u97F3\u91CF\u952E\u66F4\u76F4\u63A5\uFF09\uFF0C\u6536\u8D77 */
    .gyp-volume { display: none; }
    .gyp-btns { padding: 5px 6px; }
    .gyp-btn { width: 40px; height: 40px; }
}

/* \u5E95\u90E8\u62BD\u5C49\u4E0A\u6ED1\u52A8\u753B */
@keyframes gyp-sheet-up { from { opacity: 0.4; transform: translateY(100%); } }

/* ===== \u89E6\u5C4F\u8BBE\u5907\uFF1A\u589E\u5927\u89E6\u6478\u547D\u4E2D\u533A\u3001\u5E38\u663E\u8FDB\u5EA6\u6ED1\u5757 ===== */
@media (hover: none) {
    /* \u8FDB\u5EA6\u6761\u547D\u4E2D\u533A\u52A0\u9AD8\u5230 28px\uFF08\u89C6\u89C9\u8F68\u9053\u4E0D\u53D8\uFF09\uFF0C\u65B9\u4FBF\u624B\u6307\u62D6\u52A8 */
    .gyp-progress { height: 28px; }
    /* \u89E6\u5C4F\u6CA1\u6709 hover\uFF0C\u6ED1\u5757\u9ED8\u8BA4\u5E38\u663E\uFF08\u5C0F\u5C3A\u5BF8\uFF09\uFF0C\u62D6\u52A8\u65F6\u653E\u5927 */
    .gyp-progress-thumb { transform: translate(-50%, -50%) scale(0.5); }
    .gyp-progress.dragging .gyp-progress-thumb { transform: translate(-50%, -50%) scale(1.15); }
    /* \u89E6\u5C4F\u8F68\u9053\u7565\u52A0\u539A\uFF0C\u63D0\u5347\u53EF\u89C1\u6027\u4E0E\u53EF\u64CD\u4F5C\u6027 */
    .gyp-progress-track { height: 6px; }
    .gyp-progress.dragging .gyp-progress-track { height: 8px; }
    /* \u89E6\u5C4F\u6CA1\u6709\u6307\u9488 hover\uFF0C\u6C14\u6CE1\u4EC5\u5728\u62D6\u52A8\u65F6\u663E\u793A */
    .gyp-progress-tip { display: none; }
    .gyp-progress.dragging .gyp-progress-tip { display: block; opacity: 1; }
    /* \u6309\u94AE :active \u7F29\u653E\u5728\u89E6\u5C4F\u4E0A\u4FDD\u7559\u5373\u65F6\u53CD\u9988\uFF0C\u4F46\u53BB\u6389 hover \u80CC\u666F\u5E38\u9A7B */
    .gyp-btn:hover { background: transparent; }
    .gyp-btn:active { background: rgba(255,255,255,0.18); }
    /* \u89E6\u5C4F\u8BBE\u5907\u9501\u5B9A\u65F6\u59CB\u7EC8\u4FDD\u7559\u89E3\u9501\u6309\u94AE\u53EF\u70B9 */
    :host(.gyp-locked) .gyp-lock { opacity: 0.75; pointer-events: auto; }
}

/* \u65E0\u969C\u788D\uFF1A\u7528\u6237\u504F\u597D\u51CF\u5C11\u900F\u660E\u5EA6 \u2192 \u56DE\u9000\u5B9E\u8272\uFF0C\u5173\u95ED\u6A21\u7CCA */
@media (prefers-reduced-transparency: reduce) {
    .gyp-menu, .gyp-ep-panel, .gyp-hint, .gyp-resume,
    .gyp-center-btn, .gyp-lock, .gyp-progress-tip, .gyp-vslide {
        background: var(--gyp-glass-bg-solid) !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
    }
    /* dock \u73BB\u7483\uFF1A\u5173\u95ED\u6298\u5C04\u4E0E\u6A21\u7CCA\uFF0C\u52A0\u6DF1\u67D3\u8272\u4FDD\u8BC1\u53EF\u8BFB */
    .gyp-glass-effect { filter: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
    .gyp-glass-tint { background: var(--gyp-glass-bg-solid) !important; }
    /* \u8FDB\u5EA6\u6761 thumb\uFF1A\u62D6\u52A8\u65F6\u4E5F\u7528\u767D\u8272\u836F\u4E38\uFF0C\u4E0D\u8D70\u73BB\u7483\u900F\u955C */
    .gyp-progress.dragging .gyp-progress-thumb { background: #fff !important; box-shadow: 0 1px 8px rgba(0,0,0,0.35) !important; }
    .gyp-thumb-lens { filter: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
}

/* \u5C0A\u91CD\u51CF\u5C11\u52A8\u6548\u504F\u597D */
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
    }
}
`;var p={play:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.5 4.65C4.5 3.4 5.86 2.62 6.94 3.25l13.5 7.35a1.6 1.6 0 0 1 0 2.8l-13.5 7.35C5.86 21.38 4.5 20.6 4.5 19.35V4.65Z"/></svg>',pause:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/></svg>',replay:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8"/><path d="M3 3v5h5"/></svg>',prev:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5.14v13.72a1 1 0 0 1-1.5.87l-9-6.86a1 1 0 0 1 0-1.74l9-6.86a1 1 0 0 1 1.5.87Z"/><rect x="4" y="4" width="3" height="16" rx="1.3"/></svg>',next:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l9-6.86a1 1 0 0 0 0-1.74l-9-6.86A1 1 0 0 0 8 5.14Z"/><rect x="17" y="4" width="3" height="16" rx="1.3"/></svg>',back:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',volumeHigh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',volumeLow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',volumeMute:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z" fill="currentColor"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>',fullscreen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',exitFullscreen:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>',pip:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6"/><rect x="2" y="13" width="10" height="7" rx="1.5" fill="currentColor" stroke="none"/></svg>',subtitle:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M6 13h6M16 13h2M6 16h3M13 16h5" stroke-width="2.2"/></svg>',settings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',lock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',unlock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.9-.9"/></svg>',airplay:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"/><path d="m12 15 5 6H7l5-6Z" fill="currentColor"/></svg>',check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',forward:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4a8 8 0 1 0 8 8"/><path d="M12 4 9 1m3 3-3 3"/><text x="12" y="15" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-weight="700">10</text></svg>',rewind:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4a8 8 0 1 1-8 8"/><path d="M12 4l3-3m-3 3 3 3"/><text x="12" y="15" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-weight="700">10</text></svg>',chevronLeft:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',chevronRight:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',chevronDown:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',brightness:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'};function x(s){if(!s||isNaN(s)||!isFinite(s)||s<0)return"00:00";let e=Math.floor(s),t=Math.floor(e/3600),i=Math.floor(e%3600/60),n=e%60,r=o=>o.toString().padStart(2,"0");return t>0?`${t}:${r(i)}:${r(n)}`:`${r(i)}:${r(n)}`}function h(s,e,t){return isNaN(s)?e:Math.min(t,Math.max(e,s))}var C=navigator.userAgent||"",z=/iPhone|iPad|iPod/i.test(C)||navigator.maxTouchPoints>1&&/Macintosh/i.test(C),G=z||/Android/i.test(C),ve=/^((?!chrome|android).)*safari/i.test(C);function X(){if(!ve&&!z)return!1;let s=document.createElement("video");return s.canPlayType("application/vnd.apple.mpegurl")!==""||s.canPlayType("application/x-mpegURL")!==""}var E="pictureInPictureEnabled"in document&&document.pictureInPictureEnabled,q=!!(document.fullscreenEnabled||document.webkitFullscreenEnabled||z||typeof document.createElement("video").webkitEnterFullscreen=="function");var me=6,be=3,I="1.6.16",fe=[`https://cdn.jsdelivr.net/npm/hls.js@${I}/dist/hls.min.js`,`https://unpkg.com/hls.js@${I}/dist/hls.min.js`,`https://fastly.jsdelivr.net/npm/hls.js@${I}/dist/hls.min.js`],L=null;function ye(s){return new Promise((e,t)=>{let i=document.createElement("script");i.src=s,i.async=!0,i.onload=()=>e(),i.onerror=()=>{i.remove(),t(new Error("\u811A\u672C\u52A0\u8F7D\u5931\u8D25\uFF1A"+s))},document.head.appendChild(i)})}function U(){if(window.Hls)return Promise.resolve(window.Hls);if(L)return L;let s=window.GYP_HLS_URL?[window.GYP_HLS_URL]:fe;return L=(async()=>{let e=null;for(let t of s)try{if(await ye(t),window.Hls)return window.Hls;e=new Error("hls.js \u5DF2\u52A0\u8F7D\u4F46\u672A\u6302\u8F7D\u5230 window.Hls\uFF1A"+t)}catch(i){e=i}throw L=null,e||new Error("hls.js \u52A0\u8F7D\u5931\u8D25\uFF1A\u6240\u6709 CDN \u5747\u4E0D\u53EF\u7528")})(),L}var $=class{constructor(e,t={},i={}){O(this,"_onNativeError",async()=>{if(this._destroyed)return;let e=this.video.error;if(this.native&&this._isHls&&!this._fallbackTried){this._fallbackTried=!0;try{let t=await U();if(this._destroyed)return;if(t.isSupported()){this.video.removeAttribute("src"),this.video.load(),await this._loadHls(this._url);return}}catch{}}this.callbacks.onError?.(e||new Error("\u539F\u751F\u64AD\u653E\u51FA\u9519"),!0)});this.video=e,this.callbacks=t,this.options=i,this.hls=null,this.native=!1,this._destroyed=!1,this._netRetries=0,this._mediaRetries=0}async load(e){await this.detach(),this._destroyed=!1,this._url=e,this._fallbackTried=!1;let t=/\.m3u8(\?|$)/i.test(e)||/application\/(vnd\.apple\.mpegurl|x-mpegURL)/i.test(e);if(this._isHls=t,!t||X()){this._loadNative(e);return}await this._loadHls(e)}_loadNative(e){this.native=!0,this.video.src=e;let t=()=>{this._destroyed||this.callbacks.onReady?.()};this.video.addEventListener("loadedmetadata",t,{once:!0}),this.video.addEventListener("error",this._onNativeError,{once:!0})}async _loadHls(e){let t;try{t=await U()}catch(i){this.callbacks.onError?.(i,!0);return}if(!this._destroyed){if(!t.isSupported()){this._loadNative(e);return}this.native=!1,this.hls=new t({maxBufferLength:30,maxMaxBufferLength:120,backBufferLength:30,abrEwmaDefaultEstimate:5e6,fragLoadingMaxRetry:6,manifestLoadingMaxRetry:4,levelLoadingMaxRetry:4,lowLatencyMode:!1,videoPreference:{preferHDR:this.options.preferHDR===!0,allowedVideoRanges:this.options.allowedVideoRanges||["SDR","PQ","HLG"]}}),this._Hls=t,this.hls.on(t.Events.MANIFEST_PARSED,()=>{this._destroyed||this.callbacks.onReady?.()}),this.hls.on(t.Events.FRAG_BUFFERED,()=>{this._netRetries=0,this._mediaRetries=0}),this.hls.on(t.Events.LEVEL_SWITCHED,(i,n)=>{this._destroyed||this.callbacks.onLevelSwitched?.(n.level)}),this.hls.on(t.Events.ERROR,(i,n)=>{this._destroyed||this._handleHlsError(n)}),this.hls.loadSource(e),this.hls.attachMedia(this.video)}}_handleHlsError(e){let t=this._Hls;if(e.fatal)switch(e.type){case t.ErrorTypes.NETWORK_ERROR:if(this._netRetries<me){this._netRetries++;let i=Math.min(1e3*this._netRetries,5e3);this._retryTimer=setTimeout(()=>{!this._destroyed&&this.hls&&this.hls.startLoad()},i),this.callbacks.onError?.(e,!1)}else this.callbacks.onError?.(e,!0);break;case t.ErrorTypes.MEDIA_ERROR:this._mediaRetries<be?(this._mediaRetries++,this.hls.recoverMediaError(),this.callbacks.onError?.(e,!1)):this.callbacks.onError?.(e,!0);break;default:this.callbacks.onError?.(e,!0);break}}getLevels(){return this.native||!this.hls?[]:this.hls.levels.map((e,t)=>({index:t,height:e.height||0,bitrate:e.bitrate||0,name:e.height?`${e.height}p`:`${Math.round((e.bitrate||0)/1e3)}k`}))}getCurrentLevel(){return this.native||!this.hls||this.hls.autoLevelEnabled?-1:this.hls.currentLevel}setLevel(e){this.native||!this.hls||(this.hls.currentLevel=e)}getAudioTracks(){if(this.hls)return(this.hls.audioTracks||[]).map(t=>({id:t.id,name:t.name||t.lang||`\u97F3\u8F68 ${t.id+1}`,lang:t.lang||""}));let e=this.video.audioTracks;return e&&e.length>1?Array.from(e).map((t,i)=>({id:i,name:t.label||t.language||`\u97F3\u8F68 ${i+1}`,lang:t.language||""})):[]}getCurrentAudioTrack(){if(this.hls)return this.hls.audioTrack;let e=this.video.audioTracks;if(e&&e.length>1){for(let t=0;t<e.length;t++)if(e[t].enabled)return t}return-1}setAudioTrack(e){if(this.hls){this.hls.audioTrack=e;return}let t=this.video.audioTracks;if(t&&t.length>1)for(let i=0;i<t.length;i++)t[i].enabled=i===e}async detach(){if(this._destroyed=!0,clearTimeout(this._retryTimer),this._netRetries=0,this._mediaRetries=0,this.hls){try{this.hls.destroy()}catch{}this.hls=null}if(this.video){this.video.removeEventListener("error",this._onNativeError);try{this.video.removeAttribute("src"),this.video.load()}catch{}}this.native=!1}};var D="gyp_";function S(s,e){try{localStorage.setItem(D+s,e)}catch{}}function T(s){try{return localStorage.getItem(D+s)}catch{return null}}function xe(s){try{localStorage.removeItem(D+s)}catch{}}function F(s,e){!s||!isFinite(e)||S("time_"+s,String(Math.floor(e)))}function Y(s){if(!s)return 0;let e=T("time_"+s),t=e?parseFloat(e):0;return isFinite(t)?t:0}function j(s){s&&xe("time_"+s)}function m(s){isFinite(s)&&S("volume",String(s))}function K(){let s=T("volume");if(s===null)return 1;let e=parseFloat(s);return isFinite(e)?Math.min(1,Math.max(0,e)):1}function M(s){S("muted",s?"1":"0")}function W(){return T("muted")==="1"}function Q(s){isFinite(s)&&S("rate",String(s))}function Z(){let s=T("rate");if(s===null)return 1;let e=parseFloat(s);return isFinite(e)&&e>0?e:1}function J(){S("gesture_guide_seen","1")}function ee(){return T("gesture_guide_seen")==="1"}function te(s,e){let t={signal:e},i=s.els;i.playBtn.addEventListener("click",()=>s.togglePlay(),t),i.backBtn.addEventListener("click",()=>{s.dispatchEvent(new CustomEvent("back"))},t),i.prevBtn.addEventListener("click",()=>s.dispatchEvent(new CustomEvent("prev")),t),i.nextBtn.addEventListener("click",()=>s.dispatchEvent(new CustomEvent("next")),t),i.fsBtn.addEventListener("click",()=>s.toggleFullscreen(),t),i.lockBtn.addEventListener("click",()=>s.toggleLock(),t),E&&i.pipBtn.addEventListener("click",()=>s.togglePiP(),t),i.speedBtn.addEventListener("click",()=>s.toggleMenu("speed"),t),i.qualityBtn.addEventListener("click",()=>s.toggleMenu("quality"),t),i.subtitleBtn.addEventListener("click",()=>s.toggleMenu("subtitle"),t),i.episodesBtn.addEventListener("click",()=>s.toggleEpisodePanel(),t),i.epClose.addEventListener("click",()=>s.toggleEpisodePanel(!1),t),i.sheetMask.addEventListener("click",()=>{s.closeMenu(),s.toggleEpisodePanel(!1)},t),i.epSeasonCurrent.addEventListener("click",a=>{a.stopPropagation(),i.epSeasons.classList.toggle("hidden")},t),i.epSeasons.addEventListener("click",a=>{let l=a.target.closest(".gyp-ep-option");l&&(s._activeSeason=l.dataset.season,i.epSeasons.classList.add("hidden"),s._renderEpisodePanel())},t);let n=a=>{let l=s._seasonKeys||[],u=l.indexOf(s._activeSeason),v=l[u+a];v&&(s._activeSeason=v,s._renderEpisodePanel())};i.epPrevSeason.addEventListener("click",()=>n(-1),t),i.epNextSeason.addEventListener("click",()=>n(1),t),i.epPanel.addEventListener("click",a=>{!i.epSeasons.contains(a.target)&&!i.epSeasonCurrent.contains(a.target)&&i.epSeasons.classList.add("hidden")},t),i.epSegments.addEventListener("click",a=>{let l=a.target.closest(".gyp-ep-seg");l&&(s._activeSeg=parseInt(l.dataset.seg,10),i.epSegments.querySelectorAll(".gyp-ep-seg").forEach(u=>u.classList.toggle("active",u===l)),s._renderEpisodeItems(),s.els.epList.scrollTop=0)},t),i.epList.addEventListener("click",a=>{let l=a.target.closest(".gyp-ep-item");l&&(s.dispatchEvent(new CustomEvent("selectepisode",{detail:{id:l.dataset.id}})),s.toggleEpisodePanel(!1))},t);let r="ontouchstart"in window,o=null;i.surface.addEventListener("click",()=>{if(s._menuOpen){s.closeMenu();return}if(r){s.toggleControls();return}o||(o=setTimeout(()=>{o=null,s.togglePlay()},220))},t),i.surface.addEventListener("dblclick",()=>{r||(o&&(clearTimeout(o),o=null),s.toggleFullscreen())},t);let d=()=>{let a=!!(document.fullscreenElement||document.webkitFullscreenElement);s.classList.toggle("gyp-fullscreen",a),i.fsBtn.innerHTML=a?p.exitFullscreen:p.fullscreen,a||s._unlockOrientation?.()};document.addEventListener("fullscreenchange",d,t),document.addEventListener("webkitfullscreenchange",d,t),ke(s,e),we(s,e);let g=()=>{s._controlsHovered=!0,s._showControls?.()},c=()=>{s._controlsHovered=!1,s._showControls?.()};i.bottom.addEventListener("mouseenter",g,t),i.bottom.addEventListener("mouseleave",c,t),i.top.addEventListener("mouseenter",g,t),i.top.addEventListener("mouseleave",c,t)}function ke(s,e){let t={signal:e},i=s.video,n=s.els.progress,r=!1,o=c=>{let a=n.getBoundingClientRect();return h((c-a.left)/a.width,0,1)},d=c=>{let a=o(c);return s.els.played.style.width=`${a*100}%`,s.els.thumb.style.left=`${a*100}%`,i.duration&&(s.els.timeCurrent.textContent=x(a*i.duration)),a},g=c=>{let a=o(c);i.duration&&(i.currentTime=a*i.duration)};n.addEventListener("mousedown",c=>{r=!0,n.classList.add("dragging"),d(c.clientX);let a=u=>{r&&d(u.clientX)},l=u=>{r=!1,n.classList.remove("dragging"),g(u.clientX),document.removeEventListener("mousemove",a),document.removeEventListener("mouseup",l)};document.addEventListener("mousemove",a),document.addEventListener("mouseup",l)},t),n.addEventListener("touchstart",c=>{r=!0,n.classList.add("dragging"),d(c.touches[0].clientX);let a=u=>{r&&d(u.touches[0].clientX)},l=u=>{r=!1,n.classList.remove("dragging"),g(u.changedTouches[0].clientX),document.removeEventListener("touchmove",a),document.removeEventListener("touchend",l)};document.addEventListener("touchmove",a,{passive:!0}),document.addEventListener("touchend",l)},{signal:e,passive:!0}),n.addEventListener("mousemove",c=>{if(!i.duration)return;let a=o(c.clientX);s.els.tip.textContent=x(a*i.duration);let l=n.getBoundingClientRect(),u=s.els.tip.offsetWidth/2/l.width*100,v=h(a*100,u,100-u);s.els.tip.style.left=`${v}%`},t),n.addEventListener("keydown",c=>{c.key==="ArrowLeft"?(s.seekBy(-5),c.preventDefault()):c.key==="ArrowRight"&&(s.seekBy(5),c.preventDefault())},t)}function we(s,e){let t={signal:e},i=s.video,n=s.els.volumeSlider;s.els.volumeBtn.addEventListener("click",()=>s.toggleMute(),t);let r=o=>{let d=n.getBoundingClientRect(),g=h((o-d.left)/d.width,0,1);i.volume=g,i.muted=!1,m(g),M(!1)};n.addEventListener("mousedown",o=>{r(o.clientX);let d=c=>r(c.clientX),g=()=>{document.removeEventListener("mousemove",d),document.removeEventListener("mouseup",g)};document.addEventListener("mousemove",d),document.addEventListener("mouseup",g),o.stopPropagation()},t),n.addEventListener("touchstart",o=>{r(o.touches[0].clientX);let d=c=>r(c.touches[0].clientX),g=()=>{document.removeEventListener("touchmove",d),document.removeEventListener("touchend",g)};document.addEventListener("touchmove",d,{passive:!0}),document.addEventListener("touchend",g)},{signal:e,passive:!0}),s.els.volume.addEventListener("wheel",o=>{o.preventDefault(),i.volume=h(i.volume+(o.deltaY>0?-.05:.05),0,1),i.muted=!1,m(i.volume),s.showHint(`\u97F3\u91CF ${Math.round(i.volume*100)}%`)},{signal:e,passive:!1})}var ie=16,_e=90,Ee=500,se=2,Le=300,N=10;function ne(s,e){if(!("ontouchstart"in window))return;let t=s.video,i=s.els.surface,n={signal:e},r=0,o=0,d=0,g=0,c=null,a=null,l=!1,u=1,v=0,B=0,P=f=>{if(s._locked||f.touches.length!==1)return;let b=f.touches[0];r=b.clientX,o=b.clientY,d=t.currentTime,g=t.volume,c=null,a=setTimeout(()=>{l=!0,u=t.playbackRate,t.playbackRate=se,s.showHintHold(`\u25B6\u25B6 ${se}x \u5FEB\u8FDB\u4E2D`)},Ee)},ce=f=>{if(s._locked||f.touches.length!==1||(clearTimeout(a),l))return;let b=f.touches[0],k=b.clientX-r,w=b.clientY-o;if(!c)if(Math.abs(k)>ie)c="seek";else if(Math.abs(w)>ie)c=b.clientX<s.clientWidth/2?"brightness":"volume";else return;if(c==="seek"){let y=k/s.clientWidth*_e,A=h(d+y,0,t.duration||0);t.currentTime=A,s.showHint(`${y>0?"+":""}${Math.round(y)}s`)}else if(c==="volume"){let y=-w/(s.clientHeight*.6);t.volume=h(g+y,0,1),t.muted=!1,m(t.volume);let A=t.volume===0?p.volumeMute:t.volume<.5?p.volumeLow:p.volumeHigh;s.showVSlide("volume",t.volume,A)}else if(c==="brightness"){if(s._brightness=h((s._brightness??1)+-w/(s.clientHeight*.6),.2,1.5),s.els.brightnessOverlay){let y=s._brightness<1;s.els.brightnessOverlay.style.background=y?"#000":"#fff",s.els.brightnessOverlay.style.opacity=String(y?(1-s._brightness)/.8*.75:(s._brightness-1)/.5*.18)}s.showVSlide("brightness",(s._brightness-.2)/1.3,p.brightness)}},ge=f=>{if(clearTimeout(a),l){t.playbackRate=u,l=!1,s.hideHint();return}if(!c){let b=Date.now(),k=f.changedTouches[0].clientX;if(b-v<Le&&Math.abs(k-B)<60){let w=k>s.clientWidth/2;s.seek(s.video.currentTime+(w?N:-N)),s.flashDoubleTap(w?"right":"left",N),v=0}else v=b,B=k}c=null};i.addEventListener("touchstart",P,{signal:e,passive:!0}),i.addEventListener("touchmove",ce,{signal:e,passive:!0}),i.addEventListener("touchend",ge,n),i.addEventListener("touchcancel",f=>{clearTimeout(a),l&&(t.playbackRate=u,l=!1,s.hideHint()),c=null},n)}var oe=10,R=30,re=.1;function le(s,e){let t=i=>{if(s._locked)return;let n=i.target.tagName;if(n==="INPUT"||n==="TEXTAREA"||i.target.isContentEditable)return;let r=s.video,o=s.speeds;switch(i.key){case" ":case"k":i.preventDefault(),s.togglePlay();break;case"ArrowLeft":i.preventDefault(),s.seekBy(i.shiftKey?-R:-oe);break;case"ArrowRight":i.preventDefault(),s.seekBy(i.shiftKey?R:oe);break;case"j":s.seekBy(-R);break;case"l":s.seekBy(R);break;case"ArrowUp":i.preventDefault(),r.volume=h(r.volume+re,0,1),r.muted=!1,m(r.volume),s.showHint(`\u97F3\u91CF ${Math.round(r.volume*100)}%`);break;case"ArrowDown":i.preventDefault(),r.volume=h(r.volume-re,0,1),m(r.volume),s.showHint(`\u97F3\u91CF ${Math.round(r.volume*100)}%`);break;case"m":s.toggleMute();break;case"f":s.toggleFullscreen();break;case"p":s.togglePiP();break;case">":case".":ae(s,o,1);break;case"<":case",":ae(s,o,-1);break;case"Escape":s._menuOpen?s.closeMenu():document.fullscreenElement||document.webkitFullscreenElement?s.toggleFullscreen():s.dispatchEvent(new CustomEvent("back"));break;default:/^[0-9]$/.test(i.key)&&r.duration&&(r.currentTime=parseInt(i.key,10)/10*r.duration);break}};document.addEventListener("keydown",t,{signal:e})}function ae(s,e,t){let i=s.video.playbackRate,n=e.indexOf(i);n===-1&&(n=e.reduce((o,d,g)=>Math.abs(d-i)<Math.abs(e[o]-i)?g:o,0));let r=h(n+t,0,e.length-1);s.setRate(e[r]),s.showHint(`${e[r]}x`)}var de=[.5,.75,1,1.25,1.5,2,3],Se=15,Te=5,Me=3e3,pe=10,_=60;function Be(s){if(!s)return"";try{return new Date(s).toLocaleDateString("zh-CN",{year:"numeric",month:"long",day:"numeric"})}catch{return""}}var H=class extends HTMLElement{static get observedAttributes(){return["src","title","video-id","autoplay","poster"]}constructor(){super(),this.attachShadow({mode:"open"}),this.engine=null,this._videoId=null,this._hideTimer=null,this._hintTimer=null,this._loadGen=0,this._lastSaveTime=-1,this._locked=!1,this._menuOpen=!1,this._ac=null}connectedCallback(){this._ac=new AbortController,this._render(),this._cacheEls(),this._initState(),te(this,this._ac.signal),ne(this,this._ac.signal),le(this,this._ac.signal),this._setupVideoEvents(),this._setupAutoHide(),this._setupMediaSession();let e=this.getAttribute("src");e&&this.loadStream(e)}disconnectedCallback(){this.destroy()}attributeChangedCallback(e,t,i){t!==i&&(e==="title"&&this._titleEl?this._titleEl.textContent=i||"":e==="src"&&i&&this.engine?this.loadStream(i):e==="poster"&&this.video&&(i?this.video.setAttribute("poster",i):this.video.removeAttribute("poster")))}_render(){let e=this.getAttribute("poster");this.shadowRoot.innerHTML=`
            <style>${V}</style>
            <video class="gyp-video" id="video" playsinline webkit-playsinline ${e?`poster="${e}"`:""}></video>
            <div class="gyp-brightness-overlay" id="brightnessOverlay"></div>
            <div class="gyp-surface" id="surface"></div>

            <div class="gyp-center" id="center"><div class="gyp-center-btn" id="centerBtn">${p.play}</div></div>
            <div class="gyp-hint" id="hint" aria-live="polite"></div>

            <!-- \u79FB\u52A8\u7AEF\u7AD6\u6ED1\u4EAE\u5EA6/\u97F3\u91CF\u53EF\u89C6\u5316\u6307\u793A\uFF08\u4E2D\u592E\u80F6\u56CA + \u8FDB\u5EA6\uFF09-->
            <div class="gyp-vslide hidden" id="vslide">
                <div class="gyp-vslide-icon" id="vslideIcon"></div>
                <div class="gyp-vslide-track"><div class="gyp-vslide-fill" id="vslideFill"></div></div>
            </div>

            <!-- \u79FB\u52A8\u7AEF\u53CC\u51FB\u5FEB\u8FDB/\u5FEB\u9000\u6D9F\u6F2A\u53CD\u9988\uFF08\u5DE6\u53F3\u4E24\u4FA7\uFF09-->
            <div class="gyp-dbltap gyp-dbltap-left hidden" id="dblTapLeft">
                <div class="gyp-dbltap-icon">${p.rewind}</div>
                <span class="gyp-dbltap-text">10 \u79D2</span>
            </div>
            <div class="gyp-dbltap gyp-dbltap-right hidden" id="dblTapRight">
                <div class="gyp-dbltap-icon">${p.forward}</div>
                <span class="gyp-dbltap-text">10 \u79D2</span>
            </div>
            <div class="gyp-buffering hidden" id="buffering"><div class="gyp-spinner"></div></div>
            <div class="gyp-loading hidden" id="loading">
                <img class="gyp-loading-logo hidden" id="loadingLogo" alt="" draggable="false">
                <div class="gyp-spinner"></div>
            </div>

            <div class="gyp-top" id="top">
                <button class="gyp-btn" id="backBtn" aria-label="\u8FD4\u56DE">${p.back}</button>
                <span class="gyp-title" id="title">${this.getAttribute("title")||""}</span>
            </div>

            <button class="gyp-btn gyp-lock" id="lockBtn" aria-label="\u9501\u5B9A">${p.lock}</button>

            <div class="gyp-resume hidden" id="resume">
                <span class="gyp-resume-text" id="resumeText"></span>
                <button class="gyp-resume-btn gyp-resume-yes" id="resumeYes">\u7EE7\u7EED\u64AD\u653E</button>
                <button class="gyp-resume-btn gyp-resume-no" id="resumeNo">\u4ECE\u5934\u5F00\u59CB</button>
            </div>

            <!-- \u79FB\u52A8\u7AEF\u9996\u6B21\u624B\u52BF\u5F15\u5BFC\uFF08\u4EC5\u89E6\u5C4F\u9996\u6B21\u64AD\u653E\u663E\u793A\u4E00\u6B21\uFF09-->
            <div class="gyp-guide hidden" id="guide">
                <div class="gyp-guide-card">
                    <div class="gyp-guide-title">\u624B\u52BF\u64CD\u4F5C</div>
                    <div class="gyp-guide-row"><span class="gyp-guide-ico">${p.forward}</span><span>\u6A2A\u6ED1\u5FEB\u8FDB / \u5FEB\u9000</span></div>
                    <div class="gyp-guide-row"><span class="gyp-guide-ico">${p.volumeHigh}</span><span>\u5DE6\u4FA7\u7AD6\u6ED1\u8C03\u4EAE\u5EA6 \xB7 \u53F3\u4FA7\u7AD6\u6ED1\u8C03\u97F3\u91CF</span></div>
                    <div class="gyp-guide-row"><span class="gyp-guide-ico">${p.rewind}</span><span>\u53CC\u51FB\u4E24\u4FA7\u5FEB\u9000 / \u5FEB\u8FDB 10 \u79D2</span></div>
                    <div class="gyp-guide-row"><span class="gyp-guide-ico">${p.play}</span><span>\u957F\u6309 2 \u500D\u901F\u64AD\u653E</span></div>
                    <button class="gyp-guide-btn" id="guideBtn">\u77E5\u9053\u4E86</button>
                </div>
            </div>

            <div class="gyp-menu hidden" id="menu"></div>

            <!-- \u79FB\u52A8\u7AEF\u62BD\u5C49\u906E\u7F69\uFF1A\u6253\u5F00\u83DC\u5355/\u9009\u96C6\u65F6\u70B9\u51FB\u5173\u95ED -->
            <div class="gyp-sheet-mask hidden" id="sheetMask"></div>

            <div class="gyp-mini" id="mini"><div class="gyp-mini-bar" id="miniBar"></div></div>

            <div class="gyp-scrim" id="scrim"></div>

            <div class="gyp-bottom" id="bottom">
                <div class="gyp-progress-bar">
                    <span class="gyp-time gyp-time-cur"><span id="timeCurrent">00:00</span></span>
                    <div class="gyp-progress" id="progress" role="slider" tabindex="0"
                         aria-label="\u64AD\u653E\u8FDB\u5EA6" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                        <div class="gyp-progress-track">
                            <div class="gyp-progress-buffered" id="buffered"></div>
                            <div class="gyp-progress-played" id="played"></div>
                        </div>
                        <div class="gyp-progress-thumb" id="thumb">
                            <div class="gyp-thumb-lens"></div>
                            <div class="gyp-thumb-overlay"></div>
                            <div class="gyp-thumb-specular"></div>
                        </div>
                        <div class="gyp-progress-tip" id="tip">00:00</div>
                    </div>
                    <span class="gyp-time gyp-time-dur"><span id="timeDuration">00:00</span></span>
                </div>
                <div class="gyp-btns">
                    <!-- \u6DB2\u6001\u73BB\u7483\u5C42\uFF08effect \u6298\u5C04 / tint \u67D3\u8272 / shine \u8FB9\u7F18\u9AD8\u5149\uFF09\uFF0C\u5185\u5BB9\u5728\u5176\u4E0A -->
                    <div class="gyp-glass" aria-hidden="true">
                        <div class="gyp-glass-effect"></div>
                        <div class="gyp-glass-tint"></div>
                        <div class="gyp-glass-shine"></div>
                    </div>
                    <button class="gyp-btn" id="playBtn" aria-label="\u64AD\u653E/\u6682\u505C">${p.play}</button>
                    <button class="gyp-btn hidden" id="prevBtn" aria-label="\u4E0A\u4E00\u96C6">${p.prev}</button>
                    <button class="gyp-btn hidden" id="nextBtn" aria-label="\u4E0B\u4E00\u96C6">${p.next}</button>
                    <div class="gyp-volume" id="volume">
                        <button class="gyp-btn" id="volumeBtn" aria-label="\u9759\u97F3">${p.volumeHigh}</button>
                        <div class="gyp-volume-slider" id="volumeSlider">
                            <div class="gyp-volume-track"></div>
                            <div class="gyp-volume-fill" id="volumeFill"></div>
                            <div class="gyp-volume-thumb" id="volumeThumb"></div>
                        </div>
                    </div>
                    <div class="gyp-spacer"></div>
                    <button class="gyp-btn gyp-btn-text hidden" id="episodesBtn" aria-label="\u9009\u96C6">\u9009\u96C6</button>
                    <button class="gyp-btn gyp-btn-text" id="speedBtn" aria-label="\u500D\u901F">1x</button>
                    <button class="gyp-btn gyp-btn-text" id="qualityBtn" aria-label="\u753B\u8D28">\u81EA\u52A8</button>
                    <button class="gyp-btn hidden" id="subtitleBtn" aria-label="\u5B57\u5E55">${p.subtitle}</button>
                    <button class="gyp-btn ${E?"":"hidden"}" id="pipBtn" aria-label="\u753B\u4E2D\u753B">${p.pip}</button>
                    <button class="gyp-btn ${q?"":"hidden"}" id="fsBtn" aria-label="\u5168\u5C4F">${p.fullscreen}</button>
                </div>
            </div>

            <!-- \u6DB2\u6001\u73BB\u7483 SVG \u7F6E\u6362\u6EE4\u955C\uFF08\u6CE8\u5165 Shadow DOM\uFF0C\u4F9B dock \u6298\u5C04\u5F15\u7528\uFF09-->
            <svg class="gyp-glass-svg" aria-hidden="true" width="0" height="0">
                <filter id="gyp-glass-distortion" x="0%" y="0%" width="100%" height="100%" filterUnits="objectBoundingBox">
                    <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="2" seed="5" result="turbulence"/>
                    <feGaussianBlur in="turbulence" stdDeviation="2" result="softMap"/>
                    <feDisplacementMap in="SourceGraphic" in2="softMap" scale="60" xChannelSelector="R" yChannelSelector="G"/>
                </filter>
                <!-- \u8FDB\u5EA6\u6761 thumb \u6DB2\u6001\u900F\u955C\uFF1A\u62D6\u52A8\u65F6\u653E\u5927\u6298\u5C04\u4E0B\u65B9\u8F68\u9053 -->
                <filter id="gyp-thumb-lens" x="-50%" y="-50%" width="200%" height="200%">
                    <feImage x="0" y="0" result="thumbNormal" xlink:href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><radialGradient id='m' cx='50%25' cy='50%25' r='75%25'><stop offset='0%25' stop-color='rgb(128,128,255)'/><stop offset='90%25' stop-color='rgb(255,255,255)'/></radialGradient><rect width='100%25' height='100%25' fill='url(%23m)'/></svg>"/>
                    <feDisplacementMap in="SourceGraphic" in2="thumbNormal" scale="-90" xChannelSelector="R" yChannelSelector="G"/>
                </filter>
            </svg>

            <!-- \u9009\u96C6\u4FA7\u6ED1\u9762\u677F -->
            <div class="gyp-ep-panel hidden" id="epPanel">
                <div class="gyp-ep-header">
                    <span class="gyp-ep-title">\u9009\u96C6</span>
                    <button class="gyp-btn" id="epClose" aria-label="\u5173\u95ED">${p.back}</button>
                </div>
                <div class="gyp-ep-nav hidden" id="epNav">
                    <button class="gyp-ep-arrow" id="epPrevSeason" data-dir="-1" aria-label="\u4E0A\u4E00\u5B63">${p.chevronLeft}</button>
                    <button class="gyp-ep-current" id="epSeasonCurrent">
                        <span class="gyp-ep-season-label"></span>
                        <span class="gyp-ep-caret">${p.chevronDown}</span>
                    </button>
                    <button class="gyp-ep-arrow" id="epNextSeason" data-dir="1" aria-label="\u4E0B\u4E00\u5B63">${p.chevronRight}</button>
                </div>
                <div class="gyp-ep-dropdown hidden" id="epSeasons" role="listbox"></div>
                <div class="gyp-ep-segments hidden" id="epSegments"></div>
                <div class="gyp-ep-list" id="epList"></div>
            </div>
        `}_cacheEls(){let e=t=>this.shadowRoot.getElementById(t);this.video=e("video"),this.els={surface:e("surface"),top:e("top"),bottom:e("bottom"),brightnessOverlay:e("brightnessOverlay"),center:e("center"),centerBtn:e("centerBtn"),hint:e("hint"),buffering:e("buffering"),loading:e("loading"),loadingLogo:e("loadingLogo"),backBtn:e("backBtn"),lockBtn:e("lockBtn"),playBtn:e("playBtn"),prevBtn:e("prevBtn"),nextBtn:e("nextBtn"),volume:e("volume"),volumeBtn:e("volumeBtn"),volumeSlider:e("volumeSlider"),volumeFill:e("volumeFill"),volumeThumb:e("volumeThumb"),speedBtn:e("speedBtn"),qualityBtn:e("qualityBtn"),subtitleBtn:e("subtitleBtn"),pipBtn:e("pipBtn"),fsBtn:e("fsBtn"),episodesBtn:e("episodesBtn"),epPanel:e("epPanel"),epClose:e("epClose"),epSeasons:e("epSeasons"),epNav:e("epNav"),epSeasonCurrent:e("epSeasonCurrent"),epPrevSeason:e("epPrevSeason"),epNextSeason:e("epNextSeason"),epSegments:e("epSegments"),epList:e("epList"),progress:e("progress"),played:e("played"),buffered:e("buffered"),thumb:e("thumb"),tip:e("tip"),timeCurrent:e("timeCurrent"),timeDuration:e("timeDuration"),mini:e("mini"),miniBar:e("miniBar"),menu:e("menu"),resume:e("resume"),resumeText:e("resumeText"),resumeYes:e("resumeYes"),resumeNo:e("resumeNo"),dblTapLeft:e("dblTapLeft"),dblTapRight:e("dblTapRight"),sheetMask:e("sheetMask"),vslide:e("vslide"),vslideIcon:e("vslideIcon"),vslideFill:e("vslideFill"),guide:e("guide"),guideBtn:e("guideBtn")},this._titleEl=e("title")}_initState(){let e=K(),t=W();this.video.volume=e,this.video.muted=t,this._rate=Z(),this.video.playbackRate=this._rate,this.els.speedBtn.textContent=`${this._rate}x`,this._updateVolumeUI()}_setupVideoEvents(){let e=this.video,t={signal:this._ac.signal};e.addEventListener("play",()=>{this.els.playBtn.innerHTML=p.pause,this._flashCenter(p.play),this._maybeShowGuide()},t),e.addEventListener("pause",()=>{this.els.playBtn.innerHTML=p.play,this._flashCenter(p.pause)},t),e.addEventListener("waiting",()=>this.els.buffering.classList.remove("hidden"),t),e.addEventListener("playing",()=>this.els.buffering.classList.add("hidden"),t),e.addEventListener("canplay",()=>this.els.buffering.classList.add("hidden"),t),e.addEventListener("loadedmetadata",()=>{this.els.timeDuration.textContent=x(e.duration)},t),e.addEventListener("timeupdate",()=>this._onTimeUpdate(),t),e.addEventListener("progress",()=>this._onBufferUpdate(),t),e.addEventListener("ended",()=>{this._ended=!0,this._disableStorage||j(this._videoId),this.els.playBtn.innerHTML=p.replay,this.dispatchEvent(new CustomEvent("ended",{detail:{videoId:this._videoId}}))},t),e.addEventListener("volumechange",()=>this._updateVolumeUI(),t)}_onTimeUpdate(){let e=this.video;if(!e.duration)return;let t=e.currentTime/e.duration*100;this.els.played.style.width=`${t}%`,this.els.thumb.style.left=`${t}%`,this.els.miniBar.style.width=`${t}%`,this.els.timeCurrent.textContent=x(e.currentTime),this.els.progress.setAttribute("aria-valuenow",Math.round(t));let i=e.currentTime;(this._lastSaveTime<0||Math.abs(i-this._lastSaveTime)>=Te)&&(this._lastSaveTime=i,this._disableStorage||F(this._videoId,i),this.dispatchEvent(new CustomEvent("progress",{detail:{videoId:this._videoId,currentTime:i,duration:e.duration,percent:t}})))}_onBufferUpdate(){let e=this.video;if(e.buffered.length>0&&e.duration){let t=e.buffered.end(e.buffered.length-1);this.els.buffered.style.width=`${t/e.duration*100}%`}}async loadStream(e,t={}){let i=++this._loadGen;this._ended=!1,this._lastSaveTime=-1,this._disableStorage=!!t.disableStorage,this.els.loading.classList.remove("hidden"),t.title!=null&&this.setTitle(t.title),this._videoId=t.videoId||this.getAttribute("video-id")||e,this._hideError();let n=0;if(typeof t.startTime=="number"&&t.startTime>0)n=t.startTime;else if(!this._disableStorage){let r=Y(this._videoId);if(r>Se&&(n=await this._promptResume(r),i!==this._loadGen))return}this.engine&&await this.engine.detach(),this.engine=new $(this.video,{onReady:()=>{i===this._loadGen&&(this.els.loading.classList.add("hidden"),n>0&&(this.video.currentTime=n),this.hasAttribute("autoplay")&&this.video.play().catch(()=>{}),this._refreshQualityLabel(),this._refreshTrackButton())},onError:(r,o)=>{i===this._loadGen&&(o&&(this.els.loading.classList.add("hidden"),this._showError(this._errorMessage(r))),this.dispatchEvent(new CustomEvent("error",{detail:r})))},onLevelSwitched:()=>this._refreshQualityLabel()},{preferHDR:t.preferHDR===!0,allowedVideoRanges:t.allowedVideoRanges}),await this.engine.load(e),i===this._loadGen&&this._loadSubtitles(t.subtitles||[])}_loadSubtitles(e){this.video.querySelectorAll("track").forEach(t=>t.remove()),e.forEach(t=>{let i=document.createElement("track");i.kind="subtitles",i.label=t.label||t.lang||"\u5B57\u5E55",i.srclang=t.lang||"und",i.src=t.url,t.default&&(i.default=!0),this.video.appendChild(i)}),this.els.subtitleBtn.classList.toggle("hidden",e.length===0),this._hasSubtitles=e.length>0}_refreshTrackButton(){let e=(this.video.textTracks?.length||0)>0,t=this.engine?this.engine.getAudioTracks().length>1:!1;this.els.subtitleBtn.classList.toggle("hidden",!e&&!t)}_promptResume(e){return new Promise(t=>{let{resume:i,resumeText:n,resumeYes:r,resumeNo:o}=this.els;n.textContent=`\u4E0A\u6B21\u770B\u5230 ${x(e)}`,i.classList.remove("hidden");let d=!1,g=c=>{d||(d=!0,i.classList.add("hidden"),t(c))};r.onclick=()=>g(e),o.onclick=()=>g(0),setTimeout(()=>g(e),6e3)})}_setupAutoHide(){let e=()=>{this._locked||(this.classList.remove("gyp-immersed"),clearTimeout(this._hideTimer),this._hideTimer=setTimeout(()=>{!this.video.paused&&!this._menuOpen&&!this._controlsHovered&&this.classList.add("gyp-immersed")},Me))};this._showControls=e;let t={signal:this._ac.signal};this.shadowRoot.addEventListener("mousemove",e,t),this.video.addEventListener("pause",e,t),e()}toggleControls(){this._locked||(this.classList.contains("gyp-immersed")?this._showControls?.():(clearTimeout(this._hideTimer),this.classList.add("gyp-immersed")))}_setupMediaSession(){if(!("mediaSession"in navigator))return;let e=navigator.mediaSession,t=this.video;t.addEventListener("play",()=>{e.metadata=new MediaMetadata({title:this.getAttribute("title")||"Video"}),e.playbackState="playing"},{signal:this._ac.signal}),t.addEventListener("pause",()=>{e.playbackState="paused"},{signal:this._ac.signal}),e.setActionHandler("play",()=>t.play()),e.setActionHandler("pause",()=>t.pause()),e.setActionHandler("seekbackward",()=>this.seekBy(-pe)),e.setActionHandler("seekforward",()=>this.seekBy(pe)),e.setActionHandler("previoustrack",()=>this.dispatchEvent(new CustomEvent("prev"))),e.setActionHandler("nexttrack",()=>this.dispatchEvent(new CustomEvent("next")))}togglePlay(){this._locked||(this.video.paused?this.video.play().catch(()=>{}):this.video.pause())}play(){return this.video.play()}pause(){this.video.pause()}seek(e){this.video.currentTime=h(e,0,this.video.duration||0)}seekBy(e){this.video.currentTime=h(this.video.currentTime+e,0,this.video.duration||0),this.showHint(`${e>0?"+":""}${e}s`)}setVolume(e){this.video.volume=h(e,0,1),this.video.muted=!1,m(this.video.volume),M(!1)}toggleMute(){this.video.muted=!this.video.muted,M(this.video.muted)}setRate(e){this._rate=e,this.video.playbackRate=e,this.els.speedBtn.textContent=`${e}x`,Q(e)}setTitle(e){this.setAttribute("title",e),this._titleEl&&(this._titleEl.textContent=e)}showNextButton(e){this.els.nextBtn.classList.toggle("hidden",!e)}showPrevButton(e){this.els.prevBtn.classList.toggle("hidden",!e)}setLogo(e){let t=this.els.loadingLogo;t&&(e?(t.src=e,t.classList.remove("hidden")):t.classList.add("hidden"))}setEpisodes(e,t){this._episodes=Array.isArray(e)?e:[],this._currentEpId=t||null;let i=this._episodes.length>0;this.els.episodesBtn.classList.toggle("hidden",!i),i&&this._renderEpisodePanel()}setCurrentEpisode(e){this._currentEpId=e,this._episodes?.length&&this._renderEpisodePanel()}_renderEpisodePanel(){let e=this._episodes,t={};e.forEach(a=>{let l=a.season||1;(t[l]||(t[l]=[])).push(a)});let i=Object.keys(t).sort((a,l)=>a-l),n=i.length>1,r=e.find(a=>a.id===this._currentEpId),o=this._activeSeason||(r?String(r.season||1):i[0]);if(this._activeSeason=o,this._seasonKeys=i,this.els.epNav.classList.toggle("hidden",!n),n){let a=i.indexOf(o),l=this.els.epSeasonCurrent.querySelector(".gyp-ep-season-label");l&&(l.textContent=`\u7B2C${o}\u5B63`),this.els.epPrevSeason.disabled=a<=0,this.els.epNextSeason.disabled=a>=i.length-1,this.els.epSeasons.innerHTML=i.map(u=>`<button class="gyp-ep-option ${u===o?"active":""}" data-season="${u}" role="option">\u7B2C${u}\u5B63</button>`).join("")}else this.els.epSeasons.classList.add("hidden");let d=(t[o]||[]).slice().sort((a,l)=>(a.episode||0)-(l.episode||0));this._epSeasonList=d;let g=Math.ceil(d.length/_),c=g>1;if(this._activeSegSeason!==o){let a=d.findIndex(l=>l.id===this._currentEpId);this._activeSeg=a>=0?Math.floor(a/_):0,this._activeSegSeason=o}if(this._activeSeg>=g&&(this._activeSeg=0),this.els.epSegments.classList.toggle("hidden",!c),c){let a="";for(let l=0;l<g;l++){let u=l*_,v=Math.min(u+_,d.length),B=d[u]?.episode??u+1,P=d[v-1]?.episode??v;a+=`<button class="gyp-ep-seg ${l===this._activeSeg?"active":""}" data-seg="${l}">${B}-${P}</button>`}this.els.epSegments.innerHTML=a}this._renderEpisodeItems()}_renderEpisodeItems(){let e=this._epSeasonList||[],t=(this._activeSeg||0)*_,i=e.slice(t,t+_);this.els.epList.innerHTML=i.map(n=>{let r=n.id===this._currentEpId?"active":"",o=n.available?"has-source":"",d=(n.title||`\u7B2C${n.episode}\u96C6`).replace(/</g,"&lt;"),g=Be(n.released);return`<button class="gyp-ep-item ${r} ${o}" data-id="${String(n.id).replace(/"/g,"&quot;")}" title="${d.replace(/"/g,"&quot;")}">
                <span class="gyp-ep-line">
                    <span class="gyp-ep-num">${n.episode||""}.</span>
                    <span class="gyp-ep-name">${d}</span>
                    ${n.available?'<span class="gyp-ep-dot" title="\u53EF\u64AD\u653E"></span>':""}
                </span>
                ${g?`<span class="gyp-ep-date">${g}</span>`:""}
            </button>`}).join("")}toggleEpisodePanel(e){let t=e??this.els.epPanel.classList.contains("hidden");t&&this.closeMenu?.(),this.els.epPanel.classList.toggle("hidden",!t),t&&(this._showSheetMask(),this.els.epList.querySelector(".gyp-ep-item.active")?.scrollIntoView({block:"center"})),this._syncSheetMask()}toggleFullscreen(){let e=document;e.fullscreenElement||e.webkitFullscreenElement?(e.exitFullscreen||e.webkitExitFullscreen).call(e):this.requestFullscreen?this.requestFullscreen().then(()=>this._lockLandscape()).catch(()=>this._iosFullscreen()):this._iosFullscreen()}_iosFullscreen(){this.video.webkitEnterFullscreen&&this.video.webkitEnterFullscreen()}_lockLandscape(){if(!G)return;let e=screen.orientation;if(!e||typeof e.lock!="function")return;let t=this.video.videoWidth||16;(this.video.videoHeight||9)>t||e.lock("landscape").catch(()=>{})}_unlockOrientation(){let e=screen.orientation;if(e&&typeof e.unlock=="function")try{e.unlock()}catch{}}togglePiP(){E&&(document.pictureInPictureElement?document.exitPictureInPicture():this.video.requestPictureInPicture().catch(()=>{}))}toggleLock(){this._locked=!this._locked,this.classList.toggle("gyp-locked",this._locked),this.els.lockBtn.innerHTML=this._locked?p.unlock:p.lock,this._locked||this._showControls?.()}get speeds(){return de}_updateVolumeUI(){let e=this.video.muted?0:this.video.volume;this.els.volumeFill.style.width=`${e*100}%`,this.els.volumeThumb.style.left=`${e*100}%`;let t=e===0?"mute":e<.5?"low":"high";t!==this._volTier&&(this._volTier=t,this.els.volumeBtn.innerHTML=t==="mute"?p.volumeMute:t==="low"?p.volumeLow:p.volumeHigh)}_refreshQualityLabel(){if(!this.engine)return;let e=this.engine.getCurrentLevel();if(e===-1)this.els.qualityBtn.textContent="\u81EA\u52A8";else{let t=this.engine.getLevels()[e];this.els.qualityBtn.textContent=t?t.name:"\u81EA\u52A8"}}showHint(e){this.els.hint.textContent=e,this.els.hint.classList.add("visible"),clearTimeout(this._hintTimer),this._hintTimer=setTimeout(()=>this.els.hint.classList.remove("visible"),700)}showHintHold(e){clearTimeout(this._hintTimer),this.els.hint.textContent=e,this.els.hint.classList.add("visible")}hideHint(){clearTimeout(this._hintTimer),this.els.hint.classList.remove("visible")}flashDoubleTap(e,t){let i=e==="left"?this.els.dblTapLeft:this.els.dblTapRight,n=e==="left"?this.els.dblTapRight:this.els.dblTapLeft;n.classList.add("hidden"),n.classList.remove("active"),this._dblTapSide===e&&this._dblTapTimer?this._dblTapAccum+=t:this._dblTapAccum=t,this._dblTapSide=e,i.querySelector(".gyp-dbltap-text").textContent=`${this._dblTapAccum} \u79D2`,i.classList.remove("hidden"),i.classList.remove("active"),i.offsetWidth,i.classList.add("active"),clearTimeout(this._dblTapTimer),this._dblTapTimer=setTimeout(()=>{i.classList.add("hidden"),i.classList.remove("active"),this._dblTapTimer=null,this._dblTapSide=null},600)}showVSlide(e,t,i){let n=h(t,0,1)*100;this.els.vslideIcon.innerHTML=i,this.els.vslideFill.style.width=`${n}%`,this.els.vslide.classList.remove("hidden"),clearTimeout(this._vslideTimer),this._vslideTimer=setTimeout(()=>{this.els.vslide.classList.add("hidden")},600)}hideVSlide(){clearTimeout(this._vslideTimer),this.els.vslide.classList.add("hidden")}_maybeShowGuide(){if(this._guideShown||!("ontouchstart"in window)||ee())return;this._guideShown=!0,J(),this.els.guide.classList.remove("hidden");let e=()=>{this.els.guide.classList.add("hidden"),clearTimeout(this._guideTimer)};this.els.guideBtn.addEventListener("click",e,{once:!0,signal:this._ac?.signal}),this._guideTimer=setTimeout(e,5e3)}_flashCenter(e){this.els.centerBtn.innerHTML=e,this.els.center.classList.remove("flash"),this.els.center.offsetWidth,this.els.center.classList.add("flash")}_showError(e){let t=this.shadowRoot.querySelector(".gyp-error");t||(t=document.createElement("div"),t.className="gyp-error",t.innerHTML='<div class="gyp-error-msg"></div><button class="gyp-error-btn">\u91CD\u8BD5</button>',t.querySelector(".gyp-error-btn").onclick=()=>{this._hideError();let i=this.getAttribute("src");i&&this.loadStream(i,{videoId:this._videoId})},this.shadowRoot.appendChild(t)),t.querySelector(".gyp-error-msg").textContent=e,t.classList.remove("hidden")}_hideError(){let e=this.shadowRoot.querySelector(".gyp-error");e&&e.classList.add("hidden")}_errorMessage(e){let t=e?.type;if(t&&/network/i.test(t))return"\u7F51\u7EDC\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u65E0\u6CD5\u52A0\u8F7D\u89C6\u9891";if(t&&/media/i.test(t))return"\u89C6\u9891\u89E3\u7801\u5931\u8D25\uFF0C\u683C\u5F0F\u53EF\u80FD\u4E0D\u53D7\u652F\u6301";let i=e?.code;return i===2?"\u7F51\u7EDC\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u65E0\u6CD5\u52A0\u8F7D\u89C6\u9891":i===3?"\u89C6\u9891\u89E3\u7801\u5931\u8D25\uFF0C\u683C\u5F0F\u53EF\u80FD\u4E0D\u53D7\u652F\u6301":i===4?"\u89C6\u9891\u6E90\u4E0D\u53EF\u7528\u6216\u683C\u5F0F\u4E0D\u652F\u6301":"\u89C6\u9891\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5"}toggleMenu(e){if(this._menuOpen===e){this.closeMenu();return}this.toggleEpisodePanel(!1),this._menuOpen=e,this.els.menu.classList.remove("hidden"),this._showSheetMask(),this.els.menu.innerHTML=this._buildMenu(e),this._bindMenuItems(e);let t=this.els.menu.querySelector(".gyp-menu-item");t&&(t.tabIndex=0,t.focus()),this._bindMenuKeys()}closeMenu(){this._menuOpen&&(this._menuOpen=!1,this.els.menu.classList.add("hidden"),this._syncSheetMask())}_showSheetMask(){this.els.sheetMask?.classList.remove("hidden")}_syncSheetMask(){let e=!this.els.epPanel.classList.contains("hidden"),t=!this.els.menu.classList.contains("hidden");this.els.sheetMask?.classList.toggle("hidden",!e&&!t)}_bindMenuKeys(){let e=Array.from(this.els.menu.querySelectorAll(".gyp-menu-item"));e.forEach((t,i)=>{t.tabIndex=0,t.onkeydown=n=>{n.key==="ArrowDown"?(n.preventDefault(),e[(i+1)%e.length].focus()):n.key==="ArrowUp"?(n.preventDefault(),e[(i-1+e.length)%e.length].focus()):(n.key==="Enter"||n.key===" ")&&(n.preventDefault(),t.click())}})}_buildMenu(e){return e==="speed"?this._menuSpeed():e==="quality"?this._menuQuality():e==="subtitle"?this._menuSubtitle():""}_menuSpeed(){let e=this.video.playbackRate;return'<div class="gyp-menu-title">\u64AD\u653E\u901F\u5EA6</div>'+de.map(t=>`<div class="gyp-menu-item ${t===e?"active":""}" data-speed="${t}">
                <span>${t===1?"\u6B63\u5E38":t+"x"}</span>${p.check.replace("<svg",'<svg class="gyp-menu-check"')}
            </div>`).join("")}_menuQuality(){let e=this.engine?this.engine.getLevels():[];if(e.length===0)return'<div class="gyp-menu-title">\u753B\u8D28</div><div class="gyp-menu-item active"><span>\u81EA\u52A8</span></div>';let t=this.engine.getCurrentLevel(),i=[...e].sort((o,d)=>d.height-o.height),n=p.check.replace("<svg",'<svg class="gyp-menu-check"'),r='<div class="gyp-menu-title">\u753B\u8D28</div>';return r+=`<div class="gyp-menu-item ${t===-1?"active":""}" data-level="-1"><span>\u81EA\u52A8</span>${n}</div>`,r+=i.map(o=>`<div class="gyp-menu-item ${t===o.index?"active":""}" data-level="${o.index}">
                <span>${o.name}</span>${n}
            </div>`).join(""),r}_menuSubtitle(){let e=Array.from(this.video.textTracks||[]),t=p.check.replace("<svg",'<svg class="gyp-menu-check"'),i=e.some(o=>o.mode==="showing"),n='<div class="gyp-menu-title">\u5B57\u5E55</div>';n+=`<div class="gyp-menu-item ${i?"":"active"}" data-sub="-1"><span>\u5173\u95ED</span>${t}</div>`,n+=e.map((o,d)=>`<div class="gyp-menu-item ${o.mode==="showing"?"active":""}" data-sub="${d}">
                <span>${o.label||o.language||`\u5B57\u5E55 ${d+1}`}</span>${t}
            </div>`).join("");let r=this.engine?this.engine.getAudioTracks():[];if(r.length>1){let o=this.engine.getCurrentAudioTrack();n+='<div class="gyp-menu-title">\u97F3\u8F68</div>',n+=r.map(d=>`<div class="gyp-menu-item ${d.id===o?"active":""}" data-audio="${d.id}">
                    <span>${d.name}</span>${t}
                </div>`).join("")}return n}_bindMenuItems(e){this.els.menu.querySelectorAll(".gyp-menu-item").forEach(t=>{t.addEventListener("click",()=>{if(e==="speed")this.setRate(parseFloat(t.dataset.speed));else if(e==="quality")this._applyQuality(parseInt(t.dataset.level,10));else if(e==="subtitle"){if(t.dataset.audio!=null){this._applyAudioTrack(parseInt(t.dataset.audio,10));return}this._applySubtitle(parseInt(t.dataset.sub,10))}this.closeMenu()})})}_applyQuality(e){this.engine&&this.engine.setLevel(e),this._refreshQualityLabel()}_applySubtitle(e){Array.from(this.video.textTracks||[]).forEach((i,n)=>{i.mode=n===e?"showing":"hidden"})}_applyAudioTrack(e){this.engine&&this.engine.setAudioTrack(e),this._menuOpen==="subtitle"&&(this.els.menu.innerHTML=this._buildMenu("subtitle"),this._bindMenuItems("subtitle"))}destroy(){this._saveProgress(),this.engine&&(this.engine.detach(),this.engine=null),this._ac&&(this._ac.abort(),this._ac=null),clearTimeout(this._hideTimer),clearTimeout(this._hintTimer)}_saveProgress(){if(!this.video||this._ended)return;let{currentTime:e,duration:t}=this.video,i=t&&t-e<10;if(this.dispatchEvent(new CustomEvent("progress",{detail:{videoId:this._videoId,currentTime:i?0:e,duration:t||0,percent:t?e/t*100:0,final:!0}})),!this._disableStorage){if(i){j(this._videoId);return}F(this._videoId,e)}}};customElements.get("gy-player")||customElements.define("gy-player",H);var st=H;export{H as GYPlayer,st as default};
