// ==UserScript==
// @name         Torn Market Chart Injector (Final)
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Injects a price chart from local Torn Market Chart app into the official Torn Item Market page.
// @author       You
// @match        https://www.torn.com/page.php?sid=ItemMarket*
// @match        https://www.torn.com/bazaar.php*
// @require      https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    const APP_URL = 'http://127.0.0.1:8080';
    let chartContainer = null;
    let chart = null;
    let currentItemId = null;
    let resizeObserver = null;
    let focusInterval = null;

    console.log('TORN MARKET CHART: Injector loaded');

    // --- UTILS ---

    function getQueryParam(url, param) {
        if (!url.includes('#')) return null;
        const hash = url.split('#')[1];
        const parts = hash.split('&');
        for (const part of parts) {
            const [key, value] = part.split('=');
            if (key === param) return value;
        }
        return null;
    }

    // --- API ---

    function fetchHistory(itemId) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `${APP_URL}/api/v1/items/${itemId}/history?interval=1h&days=30&type=bazaar`,
                onload: function (response) {
                    if (response.status === 200) {
                        try {
                            const data = JSON.parse(response.responseText);
                            if (!Array.isArray(data)) {
                                reject('Invalid data format (not an array)');
                                return;
                            }
                            resolve(data);
                        } catch (e) {
                            console.error('TMC: JSON Parse Error', e);
                            reject(`JSON Parse Error: ${e.message}`);
                        }
                    } else {
                        console.error('TMC: API Error Status', response.status, response.responseText);
                        reject(`API Error: ${response.status} ${response.statusText}`);
                    }
                },
                onerror: function (err) {
                    console.error('TMC: Network Error Details', err);
                    reject(`Network Error (Check Console)`);
                },
                ontimeout: function () {
                    console.error('TMC: Timeout');
                    reject('Request Timed Out');
                }
            });
        });
    }

    // --- UI ---

    function createChartContainer() {
        if (document.getElementById('tmc-chart-container')) return document.getElementById('tmc-chart-container');

        const container = document.createElement('div');
        container.id = 'tmc-chart-container';
        container.style.width = '100%';
        container.style.height = '300px';
        container.style.backgroundColor = '#131722';
        container.style.border = '1px solid #333';
        container.style.borderRadius = '5px';
        container.style.marginBottom = '10px';
        container.style.marginTop = '10px';
        container.style.position = 'relative';
        container.style.zIndex = '999';

        // Header for status
        const header = document.createElement('div');
        header.style.padding = '5px 10px';
        header.style.color = '#888';
        header.style.fontSize = '12px';
        header.style.borderBottom = '1px solid #333';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';

        const title = document.createElement('span');
        title.id = 'tmc-chart-title';
        title.innerText = 'Torn Market Chart';
        title.style.fontWeight = 'bold';
        header.appendChild(title);

        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '10px';
        controls.style.alignItems = 'center';

        // Focus Mode Toggle
        const focusBtn = document.createElement('button');
        focusBtn.innerText = 'Focus Mode';
        focusBtn.style.background = '#2a2e39';
        focusBtn.style.border = '1px solid #444';
        focusBtn.style.color = '#ccc';
        focusBtn.style.padding = '2px 8px';
        focusBtn.style.cursor = 'pointer';
        focusBtn.style.borderRadius = '3px';
        focusBtn.style.fontSize = '11px';

        // Load saved state
        const savedFocus = localStorage.getItem('tmc-focus-mode') === 'true';
        toggleFocusMode(savedFocus);
        if (savedFocus) {
            focusBtn.style.background = '#26a69a';
            focusBtn.style.color = '#fff';
        }

        focusBtn.onclick = () => {
            const isFocused = localStorage.getItem('tmc-focus-mode') === 'true';
            const newState = !isFocused;
            toggleFocusMode(newState);
            localStorage.setItem('tmc-focus-mode', newState);

            if (newState) {
                focusBtn.style.background = '#26a69a';
                focusBtn.style.color = '#fff';
            } else {
                focusBtn.style.background = '#2a2e39';
                focusBtn.style.color = '#ccc';
            }
        };
        controls.appendChild(focusBtn);

        // Fit Button
        const fitBtn = document.createElement('button');
        fitBtn.innerText = 'Fit Chart';
        fitBtn.style.background = '#2a2e39';
        fitBtn.style.border = '1px solid #444';
        fitBtn.style.color = '#ccc';
        fitBtn.style.padding = '2px 8px';
        fitBtn.style.cursor = 'pointer';
        fitBtn.style.borderRadius = '3px';
        fitBtn.style.fontSize = '11px';
        fitBtn.onclick = () => {
            if (chart && document.getElementById('tmc-chart-container')) {
                const container = document.getElementById('tmc-chart-container');
                chart.applyOptions({ width: container.clientWidth, height: container.clientHeight - 30 });
                chart.timeScale().fitContent();
            }
        };
        controls.appendChild(fitBtn);

        const status = document.createElement('span');
        status.id = 'tmc-chart-status';
        status.innerText = 'Waiting...';
        controls.appendChild(status);

        header.appendChild(controls);

        container.appendChild(header);

        // Chart div
        const chartDiv = document.createElement('div');
        chartDiv.id = 'tmc-chart-canvas';
        chartDiv.style.width = '100%';
        chartDiv.style.height = 'calc(100% - 30px)';
        container.appendChild(chartDiv);

        return container;
    }

    function renderChart(data) {
        const canvas = document.getElementById('tmc-chart-canvas');
        if (!canvas) return;

        // Cleanup old chart
        if (chart) {
            chart.remove();
            chart = null;
        }
        canvas.innerHTML = '';

        if (!data || data.length === 0) {
            document.getElementById('tmc-chart-status').innerText = 'No Data Available';
            return;
        }

        document.getElementById('tmc-chart-status').innerText = `Loaded ${data.length} candles`;

        // Create Chart
        chart = LightweightCharts.createChart(canvas, {
            layout: {
                background: { color: '#131722' },
                textColor: '#d1d5db',
            },
            grid: {
                vertLines: { color: '#2B2B43' },
                horzLines: { color: '#2B2B43' },
            },
            width: canvas.clientWidth,
            height: canvas.clientHeight,
            localization: {
                priceFormatter: (price) => {
                    // Custom formatter to avoid potential broken Number.prototype.toFixed on the page
                    return '$' + Math.round(price).toLocaleString();
                },
            },
        });

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
            priceFormat: {
                type: 'custom',
                formatter: (price) => '$' + Math.round(price).toLocaleString(),
            }
        });

        const volumeSeries = chart.addHistogramSeries({
            color: '#26a69a',
            priceFormat: {
                type: 'volume',
            },
            priceScaleId: '',
        });

        volumeSeries.priceScale().applyOptions({
            scaleMargins: {
                top: 0.8,
                bottom: 0,
            },
        });

        // Map data with explicit number casting
        const chartData = data.map(d => ({
            time: Number(new Date(d.time).getTime() / 1000),
            open: Number(d.open),
            high: Number(d.high),
            low: Number(d.low),
            close: Number(d.close),
            volume: Number(d.volume || 0),
        })).sort((a, b) => a.time - b.time);

        // Filter invalid data
        const validData = chartData.filter(d =>
            !isNaN(d.time) && !isNaN(d.open) && !isNaN(d.high) && !isNaN(d.low) && !isNaN(d.close)
        );

        candlestickSeries.setData(validData);

        const volumeData = validData.map(d => ({
            time: d.time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
        }));

        volumeSeries.setData(volumeData);
        chart.timeScale().fitContent();

        // Handle resize - Removed internal observer to avoid conflict with main loop
        // if (resizeObserver) resizeObserver.disconnect();
        // ...

        // Force a resize after a short delay
        setTimeout(() => {
            if (chart) {
                chart.applyOptions({ width: canvas.clientWidth, height: canvas.clientHeight });
                chart.timeScale().fitContent();
            }
        }, 100);
    }

    async function updateChart(itemId) {
        if (!itemId) return;

        const container = document.getElementById('tmc-chart-container');
        if (!container) return;

        document.getElementById('tmc-chart-status').innerText = 'Loading...';
        document.getElementById('tmc-chart-status').style.color = '#888';
        document.getElementById('tmc-chart-title').innerText = `Item ID: ${itemId}`;

        try {
            const data = await fetchHistory(itemId);
            renderChart(data);
        } catch (err) {
            console.error('TMC Error:', err);
            const statusEl = document.getElementById('tmc-chart-status');
            statusEl.innerText = `Error: ${err}`;
            statusEl.style.color = '#ff4444';
        }
    }

    // --- UI HELPERS ---

    function toggleFocusMode(enable) {
        const styleId = 'tmc-focus-style';
        let style = document.getElementById(styleId);

        if (focusInterval) {
            clearInterval(focusInterval);
            focusInterval = null;
        }

        if (enable) {
            if (!style) {
                style = document.createElement('style');
                style.id = styleId;
                style.innerHTML = `
                    /* --- HIDE EVERYTHING ELSE --- */
                    #sidebarroot, #header-root, #chatRoot, .sidebar, .header-wrapper-top, .content-title, footer, .d .sidebar, .d .header-wrapper-top {
                        display: none !important;
                    }
                    /* Additional hiding based on dump */
                    div[class*="appHeaderWrapper"],
                    div[class*="titleContainer"],
                    div[class*="linksContainer"],
                    div[class*="categoriesWrapper"],
                    div[class*="filter-container"] {
                        display: none !important;
                    }

                    /* --- LAYOUT RESET --- */
                    body, html {
                        background-color: #131722 !important; 
                        overflow: hidden !important;
                        position: relative !important;
                        width: 100vw !important;
                        height: 100vh !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    }

                    /* --- LEFT COLUMN: CHART --- */
                    #tmc-chart-container {
                        position: fixed !important;
                        top: 0 !important;
                        left: 0 !important;
                        width: 80vw !important;
                        height: 100vh !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        border: none !important;
                        border-right: 1px solid #333 !important;
                        z-index: 10000 !important;
                        border-radius: 0 !important;
                        background-color: #131722 !important;
                        max-width: none !important;
                        min-width: 0 !important;
                    }
                    #tmc-chart-canvas {
                        height: calc(100% - 30px) !important;
                        width: 100% !important;
                        max-width: none !important;
                    }
                    /* Override Torn's global max-width on chart library internals */
                    #tmc-chart-canvas *,
                    #tmc-chart-canvas table,
                    #tmc-chart-canvas td,
                    #tmc-chart-canvas tr,
                    #tmc-chart-canvas canvas {
                        max-width: none !important;
                        box-sizing: border-box !important;
                    }
                `;
                document.head.appendChild(style);
            }

            // --- JS FORCE LAYOUT LOOP ---
            focusInterval = setInterval(() => {

                // Target marketWrapper (proven working) - CSS hides non-list content
                let targetCandidate = document.querySelector('div[class*="marketWrapper"]');

                if (targetCandidate) {

                    // 1. CLEAR ANCESTOR TRANSFORMS & DISPLAY
                    let parent = targetCandidate.parentElement;
                    while (parent && parent !== document.body) {
                        const computed = window.getComputedStyle(parent);
                        if (computed.display !== 'contents') {
                            parent.style.display = 'contents';
                            parent.style.transform = 'none';
                            parent.style.willChange = 'auto';
                        }
                        parent = parent.parentElement;
                    }

                    // 2. ENFORCE STYLES on sellerListWrapper
                    targetCandidate.style.cssText = `
                            position: fixed !important;
                            top: 0 !important;
                            left: 80vw !important;
                            right: 0 !important;
                            bottom: 0 !important;
                            width: 20vw !important;
                            height: 100vh !important;
                            overflow-y: auto !important;
                            background-color: #131722 !important;
                            z-index: 9999 !important;
                            padding: 10px !important;
                            margin: 0 !important;
                            transform: none !important;
                            max-width: none !important;
                            min-width: 0 !important;
                            float: none !important;
                            display: block !important;
                            border: none !important;
                        `;

                    // Fix children layout
                    const children = targetCandidate.querySelectorAll('div[class*="item___"]');
                    children.forEach(c => {
                        c.style.display = 'flex';
                        c.style.flexWrap = 'wrap';
                        c.style.width = '100%';
                    });
                }

                // Resize Chart - Smart check
                if (chart && document.getElementById('tmc-chart-container')) {
                    const container = document.getElementById('tmc-chart-container');
                    const rect = container.getBoundingClientRect();
                    const width = Math.floor(rect.width);
                    const height = Math.floor(rect.height - 30);

                    // Display debug info
                    const title = document.getElementById('tmc-chart-title');

                    if (width > 0 && height > 0) {
                        // Debug info
                        if (title) title.innerText = `Torn Market Chart (${width}x${height})`;

                        // Use chart.resize() - the PROPER API for resizing.
                        // Do NOT touch any library-internal DOM elements.
                        chart.resize(width, height);

                        // Fit content only when size changes significantly
                        if (!window.tmcLastWidth || Math.abs(window.tmcLastWidth - width) > 20) {
                            chart.timeScale().fitContent();
                            window.tmcLastWidth = width;
                        }
                    }
                }

            }, 500); // Check every 500ms

        } else {
            if (style) {
                style.remove();
            }
            if (focusInterval) clearInterval(focusInterval);
            setTimeout(() => {
                if (chart && document.getElementById('tmc-chart-container')) {
                    const container = document.getElementById('tmc-chart-container');
                    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight - 30 });
                }
            }, 100);
        }
    }

    // --- MAIN LOOP ---

    function checkPage() {
        const url = window.location.href;
        const newItemId = getQueryParam(url, 'itemID');

        if (!newItemId) return;

        // --- Injection Logic ---

        let injectionTarget = document.querySelector('div[class*="marketWrapper"]');
        let targetName = 'marketWrapper';

        if (!injectionTarget) {
            injectionTarget = document.querySelector('.content-wrapper') || document.body.firstChild;
            targetName = 'fallback';
        }

        if (!injectionTarget) return;

        // Check if we already injected
        let container = document.getElementById('tmc-chart-container');

        if (!container) {
            console.log(`TMC: Injecting chart container near ${targetName}...`);
            container = createChartContainer();

            if (injectionTarget.parentNode) {
                injectionTarget.parentNode.insertBefore(container, injectionTarget);
            }
        }

        // Update if ID changed
        if (newItemId !== currentItemId) {
            // Force resize chart if we switched to focus mode recently
            if (chart && document.getElementById('tmc-focus-style')) {
                chart.timeScale().fitContent();
            }
            console.log(`TMC: Item ID changed from ${currentItemId} to ${newItemId}`);
            currentItemId = newItemId;
            updateChart(currentItemId);
        }
    }

    // --- INIT ---

    let debounceTimer = null;

    // Observer for SPA changes
    const observer = new MutationObserver((mutations) => {
        // Filter out our own mutations to prevent infinite loops
        const isSelfMutation = mutations.every(m => {
            return (m.target.id === 'tmc-debug-overlay' ||
                m.target.id === 'tmc-chart-container' ||
                (m.target.closest && m.target.closest('#tmc-chart-container')));
        });

        if (isSelfMutation) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            checkPage();
        }, 500); // 500ms debounce
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Also check on hash change
    window.addEventListener('hashchange', checkPage);

    // Initial check
    setTimeout(checkPage, 1000);

})();
