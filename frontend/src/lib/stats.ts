import { PricePoint } from "./api";

export interface EnrichedPricePoint extends PricePoint {
    market_price_ma?: number;
    bazaar_price_ma?: number;
}

/**
 * Calculates a Moving Average (MA) for the given dataset.
 * @param data Array of PricePoints, sorted chronologically (Old -> New)
 * @param windowHours The time window in hours (e.g., 24)
 * @returns Array of PricePoints with added moving average fields
 */
export function calculateMovingAverage(data: PricePoint[], windowHours: number = 24): EnrichedPricePoint[] {
    if (!data || data.length === 0) return [];

    const windowMs = windowHours * 60 * 60 * 1000;

    return data.map((point, index) => {
        const currentTimestamp = new Date(point.timestamp).getTime();
        const cutoffTimestamp = currentTimestamp - windowMs;

        // Optimized approach: 
        // Since data is sorted, we can look backwards from the current index 
        // until we hit the time limit.
        let marketSum = 0;
        let bazaarSum = 0;
        let count = 0;

        for (let i = index; i >= 0; i--) {
            const prevPoint = data[i];
            const prevTimestamp = new Date(prevPoint.timestamp).getTime();

            if (prevTimestamp < cutoffTimestamp) break;

            if (prevPoint.market_price) {
                marketSum += prevPoint.market_price;
            }
            if (prevPoint.bazaar_price) {
                bazaarSum += prevPoint.bazaar_price;
            }
            // Increase count only if we have data? 
            // Or assume count corresponds to all data points tracked? 
            // Use simple count for non-zero points if we want to skip zeros?
            // Usually we just care about count of points in window.
            // But if price is 0 (failed fetch), we might want to exclude it or treat as is.
            // Let's assume price 0 is bad data and skip it for average if possible, 
            // but the PricePoint interface doesn't strictly say nullable.
            // The API might return 0 on fail.
            count++;
        }

        // Actually, simple average of points in window:
        // Refining logic: Filter out 0 prices if appropriate, but keeping it simple for now.
        // Let's stick to including everything in the window for O(N) roughly overall if window is small relative to total history.
        // Actually this loop is strictly local.

        // Let's rewrite the logic inside to be clearer and just filter the subset.
        // But preventing O(N^2) for large history is good.
        // The loop back approach is efficient enough for typical chart data (1-2k points).

        // Re-calcing sums:
        let mSum = 0;
        let bSum = 0;
        let mCount = 0;
        let bCount = 0;

        for (let i = index; i >= 0; i--) {
            const p = data[i];
            const time = new Date(p.timestamp).getTime();
            if (time < cutoffTimestamp) break;

            if (p.market_price > 0) {
                mSum += p.market_price;
                mCount++;
            }
            if (p.bazaar_price > 0) {
                bSum += p.bazaar_price;
                bCount++;
            }
        }

        return {
            ...point,
            market_price_ma: mCount > 0 ? Math.round(mSum / mCount) : undefined,
            bazaar_price_ma: bCount > 0 ? Math.round(bSum / bCount) : undefined
        };
    });
}
