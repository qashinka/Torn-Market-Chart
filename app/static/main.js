// --- State & Config ---
let chart;
let currentItemId = null;
let rawData = []; // Store raw API data
let allItems = []; // Store all item definitions

let seriesMap = {
    bazaarMin: null,
    bazaarAvg: null,
    marketMin: null,
    marketAvg: null
};

let seriesSettings = {
    bazaarMin: { visible: true, type: 'Candlestick', title: 'Bazaar Min', color: '#10b981', upColor: '#10b981', downColor: '#ef4444' },
    bazaarAvg: { visible: true, type: 'Line', title: 'Bazaar Avg', color: '#14b8a6', lineStyle: 2 },
    marketMin: { visible: true, type: 'Candlestick', title: 'Market Min', color: '#3b82f6', upColor: '#3b82f6', downColor: '#ef4444' },
    marketAvg: { visible: true, type: 'Line', title: 'Market Avg', color: '#6366f1', lineStyle: 2 }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    if (typeof LightweightCharts === 'undefined') {
        alert("Error: TradingView Library not loaded. Check internet connection.");
        return;
    }
    try {
        initChartBase();
    } catch (e) {
        console.error("Init Chart Failed:", e);
        alert("Init Chart Failed: " + e.message);
    }
    loadItems();

    // Fetch all item definitions immediately on load (triggers sync if needed on backend)
    fetchAllItems();

    // Autocomplete Init
    setupAutocomplete();

    new ResizeObserver(entries => {
        if (!chart || entries.length === 0 || entries[0].target !== document.getElementById('chart')) { return; }
        const newRect = entries[0].contentRect;
        chart.applyOptions({ width: newRect.width, height: newRect.height });
    }).observe(document.getElementById('chart'));
});

function initChartBase() {
    if (chart) return;
    const chartElement = document.getElementById('chart');
    if (!chartElement) return;

    chart = LightweightCharts.createChart(chartElement, {
        width: chartElement.clientWidth,
        height: chartElement.clientHeight,
        layout: {
            background: { type: 'solid', color: '#1e293b' },
            textColor: '#94a3b8',
        },
        grid: {
            vertLines: { color: '#334155' },
            horzLines: { color: '#334155' },
        },
        timeScale: {
            timeVisible: true,
            secondsVisible: false,
            // If timeframe is large, switch timeFormat? LWCharts handles auto-scale well.
        },
        rightPriceScale: {
            borderColor: '#334155',
        },
    });
    console.log("Chart Base Initialized");
}

// --- Data Resampling Logic ---

// Convert raw 1-min logs into aggregated candles/lines
function resampleData(data, intervalMinutes) {
    if (!data || data.length === 0) return [];

    const intervalSeconds = intervalMinutes * 60;
    const buckets = {};

    data.forEach(point => {
        const timeStr = point.time;
        const time = Number(timeStr);
        const bucketTime = Math.floor(time / intervalSeconds) * intervalSeconds; // floor to nearest bucket

        if (!buckets[bucketTime]) {
            buckets[bucketTime] = {
                time: bucketTime,
                b_min: [], b_avg: [],
                m_min: [], m_avg: []
            };
        }
        if (point.bazaar_min !== null) buckets[bucketTime].b_min.push(point.bazaar_min);
        if (point.bazaar_avg !== null) buckets[bucketTime].b_avg.push(point.bazaar_avg);
        if (point.market_min !== null) buckets[bucketTime].m_min.push(point.market_min);
        if (point.market_avg !== null) buckets[bucketTime].m_avg.push(point.market_avg);
    });

    // Flatten buckets
    const sortedTimes = Object.keys(buckets).sort((a, b) => a - b);

    return sortedTimes.map(t => {
        const b = buckets[t];
        return {
            time: Number(t),
            bazaar_min: getOHLC(b.b_min),
            bazaar_avg: getOHLC(b.b_avg),
            market_min: getOHLC(b.m_min),
            market_avg: getOHLC(b.m_avg),
        };
    });
}

function getOHLC(arr) {
    if (!arr || arr.length === 0) return null;
    return {
        open: arr[0],
        high: Math.max(...arr),
        low: Math.min(...arr),
        close: arr[arr.length - 1],
        value: arr[arr.length - 1] // Keep a 'value' prop for Line charts
    };
}

function getLast(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[arr.length - 1];
}

// --- Rendering ---

function updateChartRaw() {
    if (!rawData || rawData.length === 0) return;
    if (!chart) initChartBase();

    const tfIdx = document.getElementById('timeframeSelect').value;
    const tfMinutes = parseInt(tfIdx);

    // 1. Resample Data
    const processed = resampleData(rawData, tfMinutes);

    // 2. Remove Old Series
    if (seriesMap.bazaarMin) chart.removeSeries(seriesMap.bazaarMin);
    if (seriesMap.bazaarAvg) chart.removeSeries(seriesMap.bazaarAvg);
    if (seriesMap.marketMin) chart.removeSeries(seriesMap.marketMin);
    if (seriesMap.marketAvg) chart.removeSeries(seriesMap.marketAvg);

    seriesMap = { bazaarMin: null, bazaarAvg: null, marketMin: null, marketAvg: null };

    // 3. Create Series based on settings
    Object.keys(seriesSettings).forEach(key => {
        const s = seriesSettings[key];
        if (s.type === 'Candlestick') {
            seriesMap[key] = chart.addCandlestickSeries({
                title: s.title,
                upColor: s.upColor || s.color,
                downColor: s.downColor || '#ef4444',
                borderVisible: false,
                wickUpColor: s.upColor || s.color,
                wickDownColor: s.downColor || '#ef4444'
            });
        } else {
            seriesMap[key] = chart.addLineSeries({
                title: s.title,
                color: s.color,
                lineWidth: s.lineWidth || 2,
                lineStyle: s.lineStyle || 0
            });
        }
    });

    // 4. Map Data to Series Format
    const dataMap = {
        bazaarMin: [],
        bazaarAvg: [],
        marketMin: [],
        marketAvg: []
    };

    processed.forEach(p => {
        // Map raw data keys to settings keys
        const rawKeys = {
            bazaarMin: p.bazaar_min,
            bazaarAvg: p.bazaar_avg,
            marketMin: p.market_min,
            marketAvg: p.market_avg
        };

        Object.keys(seriesSettings).forEach(key => {
            const rawVal = rawKeys[key];
            if (rawVal) {
                if (seriesSettings[key].type === 'Candlestick') {
                    dataMap[key].push({
                        time: p.time,
                        open: rawVal.open,
                        high: rawVal.high,
                        low: rawVal.low,
                        close: rawVal.close
                    });
                } else {
                    dataMap[key].push({
                        time: p.time,
                        value: rawVal.value
                    });
                }
            }
        });
    });

    // 5. Set Data
    Object.keys(seriesMap).forEach(key => {
        if (seriesMap[key]) {
            seriesMap[key].setData(dataMap[key]);
        }
    });

    // 6. Apply Visibility
    Object.keys(seriesMap).forEach(key => {
        if (seriesMap[key]) {
            seriesMap[key].applyOptions({ visible: seriesSettings[key].visible });
        }
    });

    // 7. Fit Content
    chart.timeScale().fitContent();
}

// --- Chart Settings Modal Logic ---

function openChartSettings() {
    document.getElementById('chartSettingsModal').classList.add('open');
    renderChartSettings();
}

function closeChartSettings() {
    document.getElementById('chartSettingsModal').classList.remove('open');
}

function renderChartSettings() {
    const content = document.getElementById('chartSettingsContent');
    content.innerHTML = '';

    Object.keys(seriesSettings).forEach(key => {
        const setting = seriesSettings[key];
        const div = document.createElement('div');
        div.className = 'settings-list-item';
        div.style.display = 'flex';
        div.style.gap = '1rem';
        div.style.justifyContent = 'space-between';

        div.innerHTML = `
            <div style="flex: 1; display: flex; align-items: center; gap: 0.5rem;">
                <input type="checkbox" id="visible-${key}" ${setting.visible ? 'checked' : ''} onchange="updateSeriesSetting('${key}', 'visible', this.checked)">
                <span style="color: ${setting.color}; font-weight: bold;">${setting.title}</span>
            </div>
            <div>
                <select onchange="updateSeriesSetting('${key}', 'type', this.value)">
                    <option value="Line" ${setting.type === 'Line' ? 'selected' : ''}>Line</option>
                    <option value="Candlestick" ${setting.type === 'Candlestick' ? 'selected' : ''}>Candlestick</option>
                </select>
            </div>
        `;
        content.appendChild(div);
    });
}

function updateSeriesSetting(key, field, value) {
    if (seriesSettings[key]) {
        seriesSettings[key][field] = value;
        updateChartRaw();
    }
}


// --- API & UI Logic ---

async function loadItems() {
    const res = await fetch('/api/items');
    const items = await res.json();
    const list = document.getElementById('itemList');
    list.innerHTML = '';
    items.forEach(item => {
        const li = document.createElement('li');

        const img = document.createElement('img');
        img.src = `https://www.torn.com/images/items/${item.item_id}/large.png`;
        img.className = 'item-icon';

        const span = document.createElement('span');
        span.textContent = `${item.item_name} (${item.item_id})`;

        li.appendChild(img);
        li.appendChild(span);

        li.onclick = () => selectItem(item.item_id, li);
        list.appendChild(li);
    });
    renderSettingsItems(items);
}

async function selectItem(id, elem) {
    document.querySelectorAll('.item-list li').forEach(el => el.classList.remove('active'));
    if (elem) elem.classList.add('active');

    currentItemId = id;
    document.getElementById('loading').textContent = 'Loading...';
    document.getElementById('loading').style.display = 'block';

    try {
        // Fetch History
        const resHist = await fetch(`/api/history/${id}`);
        const dataHist = await resHist.json();

        // Fetch Market Depth
        const resDepth = await fetch(`/api/market-depth/${id}`);
        const dataDepth = await resDepth.json();

        // Store globally so we can resample later
        rawData = dataHist;

        document.getElementById('loading').style.display = 'none';

        if (dataHist.length === 0) {
            document.getElementById('loading').textContent = 'No chart data available yet.';
            document.getElementById('loading').style.display = 'block';
        } else {
            updateChartRaw(); // This handles processing and rendering
        }

        // Update Order Book & Status
        updateOrderBookPanel(dataDepth);

    } catch (e) {
        console.error(e);
        // alert("Error loading data");
    }
}

function updateOrderBookPanel(data) {
    const priceEl = document.getElementById('currentPrice');
    const changeEl = document.getElementById('priceChange');
    const listEl = document.getElementById('orderBookList');

    if (data.current_price) {
        priceEl.textContent = `$${data.current_price.toLocaleString()}`;
    } else {
        priceEl.textContent = '--';
    }

    if (data.change_24h !== null && data.change_24h !== undefined) {
        const val = data.change_24h;
        const sign = val >= 0 ? '+' : '';
        changeEl.textContent = `${sign}${val.toFixed(2)}%`;

        changeEl.className = 'price-change';
        if (val > 0) changeEl.classList.add('positive');
        else if (val < 0) changeEl.classList.add('negative');
    } else {
        changeEl.textContent = '--%';
        changeEl.className = 'price-change';
    }

    listEl.innerHTML = '';
    if (data.listings && data.listings.length > 0) {
        data.listings.forEach(l => {
            const li = document.createElement('li');
            li.className = 'order-book-item';

            // source icon or text could be added
            // Seller name if bazaar?

            li.innerHTML = `
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:bold; color:var(--text-primary);">$${l.price.toLocaleString()}</span>
                    <span style="font-size:0.8rem; color:var(--text-secondary);">${l.source}</span>
                </div>
                <div>${l.quantity.toLocaleString()}</div>
                <div>
                    <a href="${l.link}" target="_blank" class="buy-btn">BUY</a>
                </div>
            `;
            listEl.appendChild(li);
        });
    } else {
        listEl.innerHTML = '<div style="padding:1rem; text-align:center; color:var(--text-secondary);">No active listings</div>';
    }
}

// --- Settings Modal ---
function openSettings() {
    document.getElementById('settingsModal').classList.add('open');
    loadApiKeys();
    loadItems();
    loadCrawlerSettings();
    // fetchAllItems is now called on DOMContentLoaded
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('open');
}

async function loadApiKeys() {
    const res = await fetch('/api/keys');
    const keys = await res.json();
    const list = document.getElementById('apiKeyList');
    list.innerHTML = '';
    keys.forEach(k => {
        const div = document.createElement('div');
        div.className = 'settings-list-item';
        div.innerHTML = `
        <span>...${k.key.slice(-4)} (${k.is_active ? 'Active' : 'Inactive'})</span>
        <button class="btn-danger" onclick="deleteKey(${k.id})">Delete</button>
    `;
        list.appendChild(div);
    });
}

async function addApiKey() {
    const input = document.getElementById('apiKeyInput');
    const key = input.value.trim();
    if (!key) return;

    const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
    });
    if (res.ok) {
        input.value = '';
        loadApiKeys();
    } else {
        alert('Error adding key');
    }
}

async function deleteKey(id) {
    if (!confirm('Are you sure?')) return;
    await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    loadApiKeys();
}

// --- Crawler Settings ---
async function loadCrawlerSettings() {
    try {
        const res = await fetch('/api/config/scan_target_hours');
        if (res.ok) {
            const data = await res.json();
            document.getElementById('crawlerTargetHours').value = data.value;
        } else {
            // Default
            document.getElementById('crawlerTargetHours').value = 24;
        }
    } catch (e) {
        console.error("Failed to load crawler settings", e);
    }
}

async function saveCrawlerSettings() {
    const hours = document.getElementById('crawlerTargetHours').value;
    if (!hours || hours <= 0) {
        alert("Please enter a valid number of hours.");
        return;
    }

    try {
        const res = await fetch('/api/config/scan_target_hours', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: hours.toString() })
        });
        if (res.ok) {
            alert("Settings saved!");
        } else {
            alert("Failed to save settings.");
        }
    } catch (e) {
        console.error("Failed to save crawler settings", e);
        alert("Error saving settings.");
    }
}

// --- Sync & Autocomplete Logic ---

async function fetchAllItems() {
    try {
        const res = await fetch('/api/all-items');
        if (res.ok) {
            allItems = await res.json();
            console.log(`Loaded ${allItems.length} item definitions for autocomplete.`);
        }
    } catch (e) {
        console.error("Failed to fetch item definitions", e);
    }
}

function setupAutocomplete() {
    const input = document.getElementById('itemNameInput');
    const idInput = document.getElementById('itemIdInput');

    // Create dropdown container if not exists (though styles assume it does or created dynamically)
    // We'll create logic to manage the dropdown div

    let currentFocus = -1;

    input.addEventListener("input", function(e) {
        const val = this.value;
        closeAllLists();
        if (!val) return false;

        currentFocus = -1;

        // Filter items
        // Since we might have 1000s, filter carefully.
        // Limit to top 10 matches
        const matches = allItems.filter(item =>
            item.name.toLowerCase().includes(val.toLowerCase())
        ).slice(0, 10);

        if (matches.length === 0) return;

        const listDiv = document.createElement("div");
        listDiv.setAttribute("id", this.id + "autocomplete-list");
        listDiv.setAttribute("class", "autocomplete-items");
        this.parentNode.appendChild(listDiv);

        matches.forEach(item => {
            const div = document.createElement("div");
            // Bold matching part? simplified for now
            div.innerHTML = `${item.name} <small>(${item.item_id})</small>`;
            div.innerHTML += `<input type='hidden' value='${item.item_id}'>`;
            div.innerHTML += `<input type='hidden' value='${item.name}'>`; // Store name too to fill input

            div.addEventListener("click", function(e) {
                input.value = this.getElementsByTagName("input")[1].value;
                idInput.value = this.getElementsByTagName("input")[0].value;
                closeAllLists();
            });
            listDiv.appendChild(div);
        });
    });

    input.addEventListener("keydown", function(e) {
        let x = document.getElementById(this.id + "autocomplete-list");
        if (x) x = x.getElementsByTagName("div");
        if (e.keyCode == 40) { // Down
            currentFocus++;
            addActive(x);
        } else if (e.keyCode == 38) { // Up
            currentFocus--;
            addActive(x);
        } else if (e.keyCode == 13) { // Enter
            e.preventDefault();
            if (currentFocus > -1) {
                if (x) x[currentFocus].click();
            }
        }
    });

    function addActive(x) {
        if (!x) return false;
        removeActive(x);
        if (currentFocus >= x.length) currentFocus = 0;
        if (currentFocus < 0) currentFocus = (x.length - 1);
        x[currentFocus].classList.add("autocomplete-active");
    }

    function removeActive(x) {
        for (var i = 0; i < x.length; i++) {
            x[i].classList.remove("autocomplete-active");
        }
    }

    function closeAllLists(elmnt) {
        const x = document.getElementsByClassName("autocomplete-items");
        for (var i = 0; i < x.length; i++) {
            if (elmnt != x[i] && elmnt != input) {
                x[i].parentNode.removeChild(x[i]);
            }
        }
    }

    document.addEventListener("click", function (e) {
        closeAllLists(e.target);
    });
}


async function addItem() {
    const idInput = document.getElementById('itemIdInput');
    const nameInput = document.getElementById('itemNameInput');
    const item_id = idInput.value;

    // We don't send name anymore, backend looks it up or creates default
    if (!item_id) {
        alert("Please select an item from the list.");
        return;
    }

    const res = await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: parseInt(item_id) })
    });

    if (res.ok) {
        idInput.value = '';
        nameInput.value = '';
        loadItems();
    } else {
        const err = await res.json();
        alert('Error adding item: ' + (err.detail || 'Unknown error'));
    }
}

async function deleteItem(item_id) {
    if (!confirm('Stop tracking this item?')) return;
    // Updated to use item_id instead of db_id
    await fetch(`/api/items/${item_id}`, { method: 'DELETE' });
    loadItems();
}

function renderSettingsItems(items) {
    const list = document.getElementById('trackedItemList');
    list.innerHTML = '';
    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'settings-list-item';
        div.innerHTML = `
        <span>${item.item_name} [${item.item_id}]</span>
        <button class="btn-danger" onclick="deleteItem(${item.item_id})">Remove</button>
    `;
        list.appendChild(div);
    });
}
