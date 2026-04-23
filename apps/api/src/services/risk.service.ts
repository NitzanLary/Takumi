/**
 * Risk Service — computes portfolio risk metrics.
 *
 * - Herfindahl concentration index (from current positions)
 * - Max drawdown (from portfolio snapshots time series)
 * - Sharpe ratio (annualized, from daily snapshot returns)
 * - Sortino ratio (using downside deviation only)
 */

import { getOpenPositions } from './position.service.js';
import { getSnapshots } from './snapshot.service.js';
import type { RiskMetrics } from '@takumi/types';

const RISK_FREE_RATE = 0.045; // ~4.5% annual (Bank of Israel rate, approximate)
const TRADING_DAYS_PER_YEAR = 252;
const MIN_DATA_POINTS = 10;

/**
 * Compute all risk metrics for the portfolio.
 */
export async function getRiskMetrics(userId: string): Promise<RiskMetrics> {
  const [positions, snapshots] = await Promise.all([
    getOpenPositions(userId),
    getSnapshots(userId),
  ]);

  const dataPoints = snapshots.length;

  // Herfindahl — from current positions
  const herfindahlIndex = computeHerfindahl(positions.map((p) => p.weight / 100));

  // Top concentration
  const sortedWeights = positions
    .map((p) => p.weight / 100)
    .sort((a, b) => b - a);
  const topConcentration = positions.length >= 3
    ? {
        top3: sortedWeights.slice(0, 3).reduce((s, w) => s + w, 0),
        top5: sortedWeights.slice(0, 5).reduce((s, w) => s + w, 0),
      }
    : null;

  // Time-series metrics require enough snapshots
  if (dataPoints < MIN_DATA_POINTS) {
    return {
      herfindahlIndex,
      maxDrawdown: null,
      sharpeRatio: null,
      sortinoRatio: null,
      topConcentration,
      dataPoints,
    };
  }

  const values = snapshots.map((s) => s.totalValue);
  const dailyReturns = computeDailyReturns(values);

  return {
    herfindahlIndex,
    maxDrawdown: computeMaxDrawdown(values),
    sharpeRatio: computeSharpe(dailyReturns),
    sortinoRatio: computeSortino(dailyReturns),
    topConcentration,
    dataPoints,
  };
}

/**
 * Herfindahl-Hirschman Index: sum of squared position weights.
 * Range 0-1. Higher = more concentrated.
 * For N equal positions: HHI = 1/N
 */
function computeHerfindahl(weights: number[]): number {
  if (weights.length === 0) return 0;
  return weights.reduce((sum, w) => sum + w * w, 0);
}

/**
 * Maximum drawdown: largest peak-to-trough decline.
 * Returns a negative number (e.g., -0.18 for -18%).
 */
function computeMaxDrawdown(values: number[]): number {
  if (values.length < 2) return 0;

  let peak = values[0];
  let maxDd = 0;

  for (const value of values) {
    if (value > peak) peak = value;
    const dd = (value - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }

  return maxDd;
}

/**
 * Daily returns from a time series of values.
 */
function computeDailyReturns(values: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] !== 0) {
      returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }
  }
  return returns;
}

/**
 * Sharpe ratio: (annualized return - risk free rate) / annualized volatility.
 */
function computeSharpe(dailyReturns: number[]): number {
  if (dailyReturns.length === 0) return 0;

  const avgReturn = mean(dailyReturns);
  const stdDev = standardDeviation(dailyReturns);
  if (stdDev === 0) return 0;

  const annualReturn = avgReturn * TRADING_DAYS_PER_YEAR;
  const annualVol = stdDev * Math.sqrt(TRADING_DAYS_PER_YEAR);

  return (annualReturn - RISK_FREE_RATE) / annualVol;
}

/**
 * Sortino ratio: like Sharpe but uses only downside deviation.
 */
function computeSortino(dailyReturns: number[]): number {
  if (dailyReturns.length === 0) return 0;

  const avgReturn = mean(dailyReturns);
  const dailyRfr = RISK_FREE_RATE / TRADING_DAYS_PER_YEAR;
  const downsideReturns = dailyReturns
    .map((r) => Math.min(r - dailyRfr, 0))
    .map((r) => r * r);
  const downsideDeviation = Math.sqrt(mean(downsideReturns));

  if (downsideDeviation === 0) return 0;

  const annualReturn = avgReturn * TRADING_DAYS_PER_YEAR;
  const annualDownside = downsideDeviation * Math.sqrt(TRADING_DAYS_PER_YEAR);

  return (annualReturn - RISK_FREE_RATE) / annualDownside;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function standardDeviation(arr: number[]): number {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const squaredDiffs = arr.map((v) => (v - avg) ** 2);
  return Math.sqrt(squaredDiffs.reduce((s, v) => s + v, 0) / (arr.length - 1));
}
