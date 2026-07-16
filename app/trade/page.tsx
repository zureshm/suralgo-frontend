"use client";

import { useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";
import { useTradeStore, WaitingTrade } from "../store/TradeStore";
import { useRouter } from "next/navigation";
import { getPrices } from "@/lib/getPrices";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { STRATEGY_DEFAULTS } from "../../config/strategyDefaults";
import { addActiveStrategySymbol } from "@/lib/api";
import styles from "./page.module.scss";

const ANGELONE_API = process.env.NEXT_PUBLIC_TRADE_EXECUTION_URL || "http://localhost:5000";
const FLATTRADE_API = process.env.NEXT_PUBLIC_FLATTRADE_EXECUTION_URL || "http://localhost:5001";

function NumericInput({ value, onChange, onBlur, fallback = "0", ...props }: any) {
  const [local, setLocal] = useState<string>(value ? String(value) : "");
  useEffect(() => { setLocal(value ? String(value) : ""); }, [value]);
  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={local}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/\D/g, "");
        setLocal(cleaned);
        onChange(cleaned === "" ? 0 : Number(cleaned));
      }}
      onBlur={(e: any) => {
        if (!e.target.value) { setLocal(fallback); onChange(Number(fallback)); }
        onBlur?.(e);
      }}
    />
  );
}

function NumericField({ value, onChange, onBlur, fallback = "0", ...props }: any) {
  const [local, setLocal] = useState<string>(value ? String(value) : "");
  useEffect(() => { setLocal(value ? String(value) : ""); }, [value]);
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={local}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/\D/g, "");
        setLocal(cleaned);
        onChange(cleaned === "" ? 0 : Number(cleaned));
      }}
      onBlur={(e: any) => {
        if (!e.target.value) { setLocal(fallback); onChange(Number(fallback)); }
        onBlur?.(e);
      }}
    />
  );
}

export default function TradePage() {
  const router = useRouter();
  const { selection, addWaitingTradeFromSelection, waitingTrades, activeTrades } = useTradeStore();
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [lotValue, setLotValue] = useState(1);
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);

  // Fetch real balance from whichever broker is connected
  useEffect(() => {
    const fetchBalance = async () => {
      // Try to get active broker URL from server
      let brokerUrl: string | null = null;
      try {
        const res = await fetch("/next-api/broker/active");
        const data = await res.json();
        if (data.url) brokerUrl = data.url;
      } catch {}

      // If no active broker set, check both brokers for a logged-in session
      if (!brokerUrl) {
        for (const url of [ANGELONE_API, FLATTRADE_API]) {
          try {
            const res = await fetch(`${url}/auth/status`);
            const data = await res.json();
            if (data.isLoggedIn) { brokerUrl = url; break; }
          } catch {}
        }
      }

      if (!brokerUrl) return;

      try {
        const res = await fetch(`${brokerUrl}/auth/funds`);
        const data = await res.json();
        if (data.success) {
          setAvailableBalance(data.availableCash ?? data.availableMargin ?? null);
        }
      } catch {}
    };
    fetchBalance();
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, []);

  // Apply strategy defaults
  const applyStrategyDefaults = (strategyKey: string) => {
    const defaults = STRATEGY_DEFAULTS[strategyKey as keyof typeof STRATEGY_DEFAULTS];
    if (!defaults) return;

    setNumberOfTrades(defaults.numberOfTrades);
    setStopLossNumberEnabled(defaults.stopLossNumberEnabled);
    setStopLossNumber(defaults.stopLossNumber);
    setStopLossPercentageEnabled(defaults.stopLossPercentageEnabled);
    setStopLossPercentage(defaults.stopLossPercentage);
    setTargetPointsEnabled(defaults.targetPointsEnabled);
    setTargetPoints(defaults.targetPoints);
    setWaitStrategyEnabled(defaults.waitStrategyEnabled);
    setBuyOverrideSize(defaults.buyOverrideSize);
    setWaitAfterSellEnabled(defaults.waitAfterSellEnabled);
    setWaitAfterSellCandles(defaults.waitAfterSellCandles);
    if ('sellWhenLossCandlesEnabled' in defaults) setSellWhenLossCandlesEnabled((defaults as any).sellWhenLossCandlesEnabled);
    if ('sellWhenLossCandles' in defaults) setSellWhenLossCandles((defaults as any).sellWhenLossCandles);
    setMinToHoldEnabled(defaults.minToHoldEnabled);
    setMinToHold(defaults.minToHold);
    if ('minToHoldTrigger' in defaults) setMinToHoldTrigger((defaults as any).minToHoldTrigger);
    setMinToHoldTrailing(defaults.minToHoldTrailing ? "yes" : "no");
    setTrailingAfterTargetEnabled(defaults.trailingAfterTargetEnabled);
    setTrailingAfterTarget(defaults.trailingAfterTarget);
    setTargetMode(defaults.targetMode as "live" | "candleClose");
    setTrailingMode(defaults.trailingMode as "live" | "candleClose");
    setPriceMode(defaults.targetMode as "live" | "candleClose");
    setRangeEnabled(defaults.rangeEnabled);
    setTimeFrom(defaults.timeFrom);
    setTimeFromAmpm(defaults.timeFromAmpm);
    setTimeTo(defaults.timeTo);
    setTimeToAmpm(defaults.timeToAmpm);
    setLotValue(defaults.lotValue);
    if ('maxProfitLossEnabled' in defaults) setMaxProfitLossEnabled((defaults as any).maxProfitLossEnabled);
    if ('maxProfit' in defaults) setMaxProfit((defaults as any).maxProfit);
    if ('maxLoss' in defaults) setMaxLoss((defaults as any).maxLoss);
    if ('reEntryAfterTargetEnabled' in defaults) setReEntryAfterTargetEnabled((defaults as any).reEntryAfterTargetEnabled);
    if ('reEntryCandles' in defaults) setReEntryCandles((defaults as any).reEntryCandles);
    if ('reEntryPoints' in defaults) setReEntryPoints((defaults as any).reEntryPoints);
    if ('signalReEntryEnabled' in defaults) setSignalReEntryEnabled((defaults as any).signalReEntryEnabled ?? true);
    if ('reEntryAsTrailingEnabled' in defaults) setReEntryAsTrailingEnabled((defaults as any).reEntryAsTrailingEnabled ?? true);
    if ('reEntryTrailingPoints' in defaults) setReEntryTrailingPoints((defaults as any).reEntryTrailingPoints ?? defaults.trailingAfterTarget ?? 10);
    if ('reEntryMinTargetEnabled' in defaults) setReEntryMinTargetEnabled((defaults as any).reEntryMinTargetEnabled ?? false);
    if ('reEntryMinTargetPoints' in defaults) setReEntryMinTargetPoints((defaults as any).reEntryMinTargetPoints ?? 8);
    if ('reEntryMinTargetTrigger' in defaults) setReEntryMinTargetTrigger((defaults as any).reEntryMinTargetTrigger ?? 2);
    if ('reEntryMinTargetTrailing' in defaults) setReEntryMinTargetTrailing((defaults as any).reEntryMinTargetTrailing ? "yes" : "no");
  };

  // Handle strategy change
  const handleStrategyChange = (newStrategy: string) => {
    setStrategy(newStrategy);
    applyStrategyDefaults(newStrategy);
  };
  const [strategy, setStrategy] = useState('default');
  const [numberOfTrades, setNumberOfTrades] = useState(5);
  const [stopLossNumberEnabled, setStopLossNumberEnabled] = useState(true);
  const [stopLossNumber, setStopLossNumber] = useState(15);
  const [stopLossPercentageEnabled, setStopLossPercentageEnabled] = useState(false);
  const [stopLossPercentage, setStopLossPercentage] = useState(10);
  const [targetPointsEnabled, setTargetPointsEnabled] = useState(true);
  const [targetPoints, setTargetPoints] = useState(20);
  const [waitStrategyEnabled, setWaitStrategyEnabled] = useState(false);
  const [buyOverrideSize, setBuyOverrideSize] = useState(15);
  const [waitAfterSellEnabled, setWaitAfterSellEnabled] = useState(true);
  const [waitAfterSellCandles, setWaitAfterSellCandles] = useState(8);
  const [sellWhenLossCandlesEnabled, setSellWhenLossCandlesEnabled] = useState(false);
  const [sellWhenLossCandles, setSellWhenLossCandles] = useState(5);
  const [minToHoldEnabled, setMinToHoldEnabled] = useState(false);
  const [minToHold, setMinToHold] = useState(8);
  const [minToHoldTrigger, setMinToHoldTrigger] = useState(2);
  const [minToHoldTrailing, setMinToHoldTrailing] = useState("no");
  const [isMinToHoldInfoOpen, setIsMinToHoldInfoOpen] = useState(false);
  const [trailingAfterTargetEnabled, setTrailingAfterTargetEnabled] = useState(false);
  const [trailingAfterTarget, setTrailingAfterTarget] = useState(15);
  const [isTrailingAfterInfoOpen, setIsTrailingAfterInfoOpen] = useState(false);
  const [rangeEnabled, setRangeEnabled] = useState(true);
  const [timeFrom, setTimeFrom] = useState('10:00');
  const [timeFromAmpm, setTimeFromAmpm] = useState('am');
  const [timeTo, setTimeTo] = useState('02:45');
  const [timeToAmpm, setTimeToAmpm] = useState('pm');
  const [maxProfitLossEnabled, setMaxProfitLossEnabled] = useState(true);
  const [maxProfit, setMaxProfit] = useState(1100);
  const [maxLoss, setMaxLoss] = useState(900);
  const [reEntryAfterTargetEnabled, setReEntryAfterTargetEnabled] = useState(false);
  const [reEntryCandles, setReEntryCandles] = useState(5);
  const [reEntryPoints, setReEntryPoints] = useState(3);
  const [isReEntryInfoOpen, setIsReEntryInfoOpen] = useState(false);
  const [signalReEntryEnabled, setSignalReEntryEnabled] = useState(true);
  const [isSignalReEntryInfoOpen, setIsSignalReEntryInfoOpen] = useState(false);
  const [reEntryAsTrailingEnabled, setReEntryAsTrailingEnabled] = useState(true);
  const [reEntryTrailingPoints, setReEntryTrailingPoints] = useState(10);
  const [isReEntryTrailingInfoOpen, setIsReEntryTrailingInfoOpen] = useState(false);
  const [reEntryMinTargetEnabled, setReEntryMinTargetEnabled] = useState(false);
  const [reEntryMinTargetPoints, setReEntryMinTargetPoints] = useState(8);
  const [reEntryMinTargetTrigger, setReEntryMinTargetTrigger] = useState(2);
  const [reEntryMinTargetTrailing, setReEntryMinTargetTrailing] = useState("no");
  const [isReEntryMinTargetInfoOpen, setIsReEntryMinTargetInfoOpen] = useState(false);
  const [isCandleSizeInfoOpen, setIsCandleSizeInfoOpen] = useState(false);
  const [targetMode, setTargetMode] = useState<"live" | "candleClose">("live");
  const [trailingMode, setTrailingMode] = useState<"live" | "candleClose">("live");
  const [priceMode, setPriceMode] = useState<"live" | "candleClose">("live");

  const isAlreadyWaiting = selection && waitingTrades.some((trade: WaitingTrade) => trade.symbol === selection.symbol);
  const isAlreadyActive = selection && activeTrades.some((trade) => trade.symbol === selection.symbol && trade.status === "ACTIVE");

  const lotSize: number = selection?.symbol?.startsWith("SENSEX") ? 20 : 65;
  const price = Number(currentPrice || selection?.price || 0);
  const quantity = lotSize * lotValue;
  const total = price * quantity;
  // For NRML options full premium is blocked; for MIS/intraday brokers block ~50% margin
  const marginRequired = total;
  const hasFetchedBalance = availableBalance !== null;
  const insufficientBalance = hasFetchedBalance && marginRequired > 0 && marginRequired > availableBalance!;
  const noSymbol = !selection?.symbol;

  const buttonText = isAlreadyActive
    ? "TRADE RUNNING"
    : insufficientBalance
      ? "INSUFFICIENT BALANCE"
      : isAlreadyWaiting
        ? "UPDATE"
        : "ENTER";
  const isButtonDisabled = isAlreadyActive || insufficientBalance || noSymbol;

  useEffect(() => {
    if (!stopLossPercentageEnabled || !Number.isFinite(price) || price <= 0) return;

    const calculatedStopLossPoints = Number(((price * stopLossPercentage) / 100).toFixed(2));
    setStopLossNumber(calculatedStopLossPoints);
  }, [price, stopLossPercentage, stopLossPercentageEnabled]);

  useEffect(() => {
    if (!selection?.symbol) {
      setCurrentPrice(null);
      return;
    }

    const fetchPrice = async () => {
      const prices = await getPrices([selection.symbol]);
      if (prices.length > 0) {
        setCurrentPrice(prices[0].ltp?.toString() ?? null);
      }
    };

    fetchPrice();

    const interval = setInterval(fetchPrice, 1000);

    return () => clearInterval(interval);
  }, [selection?.symbol]);

  useEffect(() => {
    if (!selection?.symbol) return;

    const saved = localStorage.getItem('tradeForm_' + selection.symbol);
    if (saved) {
      const data = JSON.parse(saved);
      setStrategy(data.strategy || 'nifty');
      setNumberOfTrades(data.numberOfTrades || 5);
      setStopLossNumberEnabled(Boolean(data.stopLossNumberEnabled ?? true));
      setStopLossNumber(data.stopLossNumber || 15);
      setStopLossPercentageEnabled(Boolean(data.stopLossPercentageEnabled ?? false));
      setStopLossPercentage(data.stopLossPercentage || 10);
      setTargetPointsEnabled(Boolean(data.targetPointsEnabled ?? true));
      setTargetPoints(data.targetPoints || 20);
      setWaitStrategyEnabled(Boolean(data.waitStrategyEnabled ?? false));
      setBuyOverrideSize(data.buyOverrideSize || 15);
      setWaitAfterSellEnabled(Boolean(data.waitAfterSellEnabled ?? true));
      setWaitAfterSellCandles(data.waitAfterSellCandles || 8);
      setSellWhenLossCandlesEnabled(Boolean(data.sellWhenLossCandlesEnabled ?? false));
      setSellWhenLossCandles(data.sellWhenLossCandles || 5);
      setMinToHoldEnabled(Boolean(data.minToHoldEnabled ?? false));
      setMinToHold(data.minToHold || 8);
      setMinToHoldTrigger(data.minToHoldTrigger || 2);
      setMinToHoldTrailing(data.minToHoldTrailing === true ? "yes" : "no");
      setTrailingAfterTargetEnabled(Boolean(data.trailingAfterTargetEnabled ?? false));
      setTrailingAfterTarget(data.trailingAfterTarget || 15);
      setRangeEnabled(Boolean(data.rangeEnabled ?? false));
      setTimeFrom(data.timeFrom || '10:00');
      setTimeFromAmpm(data.timeFromAmpm || 'am');
      setTimeTo(data.timeTo || '02:45');
      setTimeToAmpm(data.timeToAmpm || 'pm');
      setLotValue(data.lotValue || 1);
      setMaxProfitLossEnabled(Boolean(data.maxProfitLossEnabled ?? false));
      setMaxProfit(data.maxProfit || 1100);
      setMaxLoss(data.maxLoss || 900);
      setReEntryAfterTargetEnabled(Boolean(data.reEntryAfterTargetEnabled ?? false));
      setReEntryCandles(data.reEntryCandles || 5);
      setReEntryPoints(data.reEntryPoints || 3);
      setSignalReEntryEnabled(Boolean(data.signalReEntryEnabled ?? true));
      setReEntryAsTrailingEnabled(Boolean(data.reEntryAsTrailingEnabled ?? true));
      setReEntryTrailingPoints(data.reEntryTrailingPoints || data.trailingAfterTarget || 10);
      setReEntryMinTargetEnabled(Boolean(data.reEntryMinTargetEnabled ?? false));
      setReEntryMinTargetPoints(data.reEntryMinTargetPoints || 8);
      setReEntryMinTargetTrigger(data.reEntryMinTargetTrigger || 2);
      setReEntryMinTargetTrailing(data.reEntryMinTargetTrailing === true ? "yes" : "no");
      const savedTargetMode = data.targetMode === "candleClose" ? "candleClose" : "live";
      const savedTrailingMode = data.trailingMode === "candleClose" ? "candleClose" : "live";
      setTargetMode(savedTargetMode);
      setTrailingMode(savedTrailingMode);
      setPriceMode(savedTargetMode);
    } else {
      // Reset to defaults
      setStrategy('default');
      applyStrategyDefaults('default');
    }
  }, [selection?.symbol]);

  const saveForm = () => {
    if (!selection?.symbol) return;
    const formData = {
      strategy,
      numberOfTrades,
      stopLossNumberEnabled: stopLossNumberEnabled || stopLossPercentageEnabled,
      stopLossNumber,
      stopLossPercentageEnabled,
      stopLossPercentage,
      targetPointsEnabled,
      targetPoints,
      minToHoldEnabled,
      minToHold,
      minToHoldTrigger,
      waitStrategyEnabled,
      buyOverrideSize,
      waitAfterSellEnabled,
      waitAfterSellCandles,
      sellWhenLossCandlesEnabled,
      sellWhenLossCandles,
      trailingAfterTargetEnabled,
      trailingAfterTarget,
      rangeEnabled,
      timeFrom,
      timeFromAmpm,
      timeTo,
      timeToAmpm,
      symbol: selection.symbol,
      lotValue,
      lotSize,
      takenPrice: price,
      maxProfitLossEnabled,
      maxProfit,
      maxLoss,
      reEntryAfterTargetEnabled,
      reEntryCandles,
      reEntryPoints,
      signalReEntryEnabled,
      reEntryAsTrailingEnabled,
      reEntryTrailingPoints,
      reEntryMinTargetEnabled,
      reEntryMinTargetPoints,
      reEntryMinTargetTrigger,
      reEntryMinTargetTrailing: reEntryMinTargetTrailing === "yes",
      minToHoldTrailing: minToHoldTrailing === "yes",
      targetMode,
      trailingMode,
    };
    localStorage.setItem('tradeForm_' + selection.symbol, JSON.stringify(formData));
  };

  return (
    <div className={`min-h-screen p-4 w-full max-w-[420px] mx-auto ${styles.tradePage}`} style={{ backgroundColor: "var(--theme-trade-page-bg)" }}>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-lg font-bold">Trade Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* Strategy Selection */}
          <div className="space-y-2">
            <label htmlFor="strategy" className="text-sm font-medium">Strategy Presets</label>
            <select 
              id="strategy"
              value={strategy} 
              onChange={(e) => handleStrategyChange(e.target.value)}
              className="w-full h-10 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="default">Default</option>
              <option value="low">Strict Low</option>
              <option value="medium">Free Low</option>
              <option value="high">High Target</option>
              <option value="allclear">All Clear</option>
            </select>
          </div>

          <Separator />

          {/* Number of Trades */}
          <div className="space-y-2">
            <label htmlFor="trades" className="text-sm font-medium">Number of Trades to take</label>
            <select 
              id="trades"
              value={numberOfTrades.toString()} 
              onChange={(e) => setNumberOfTrades(Number(e.target.value))}
              className="w-full h-10 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>

          <Separator />

          {/* Stop Loss Strategy */}
          <div className="space-y-4">
            <div className="text-base font-medium">Stop Loss Strategies</div>
            
            <div className="space-y-3">
              <div className="rounded-md border border-gray-200 p-3 space-y-3">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="stopLossNumberEnabled"
                    checked={stopLossNumberEnabled || stopLossPercentageEnabled}
                    onChange={(e) => setStopLossNumberEnabled(e.target.checked)}
                    className="h-4 w-4"
                    disabled={stopLossPercentageEnabled}
                  />
                  <label htmlFor="stopLossNumberEnabled" className="text-sm font-medium">Based on number</label>
                </div>

                <div className="flex items-center space-x-2 pl-6">
                  <label htmlFor="stopLossNumber" className={`text-sm ${stopLossNumberEnabled ? "" : "text-gray-400"}`}>Points</label>
                  <NumericInput
                    id="stopLossNumber"
                    value={stopLossNumber}
                    onChange={setStopLossNumber}
                    className="w-20 h-8"
                    disabled={!stopLossNumberEnabled && !stopLossPercentageEnabled}
                    readOnly={stopLossPercentageEnabled}
                  />
                </div>
              </div>

              <div className="rounded-md border border-gray-200 p-3 space-y-3">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="stopLossPercentageEnabled"
                    checked={stopLossPercentageEnabled}
                    onChange={(e) => setStopLossPercentageEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="stopLossPercentageEnabled" className="text-sm font-medium">Based on percentage %</label>
                </div>

                <div className="flex items-center space-x-2 pl-6">
                  <label htmlFor="stopLossPercentageValue" className={`text-sm ${stopLossPercentageEnabled ? "" : "text-gray-400"}`}>Percentage</label>
                  <NumericInput
                    id="stopLossPercentageValue"
                    value={stopLossPercentage}
                    onChange={setStopLossPercentage}
                    className="w-20 h-8"
                    disabled={!stopLossPercentageEnabled}
                  />
                </div>
              </div>

            </div>

            <p className="text-xs text-gray-500">If no stop loss strategy is checked, stop loss will not be applied for this trade.</p>
          </div>

          <Separator />

          {/* Wait Strategy */}
          <div className="space-y-2">
            <div className="text-base font-medium">Wait Strategy</div>
            <div className="rounded-md border border-gray-200 p-3 space-y-3">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="waitStrategyEnabled"
                  checked={waitStrategyEnabled}
                  onChange={(e) => setWaitStrategyEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="waitStrategyEnabled" className="text-sm font-medium">
                  Wait when candle size ≥
                </label>
                <div className="relative inline-flex">
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:text-gray-700"
                    onClick={() => setIsCandleSizeInfoOpen((prev) => !prev)}
                    aria-label="Wait candle size info"
                  >
                    <HelpCircle className="h-3 w-3" />
                  </button>
                  {isCandleSizeInfoOpen && (
                    <div
                      className="absolute right-0 top-7 w-56 rounded-md p-3 text-white shadow-lg"
                      style={{ zIndex: 9999, background: "rgba(0,0,0,0.9)", fontSize: "11px", lineHeight: "16px", maxHeight: "200px", overflowY: "auto" }}
                    >
                      When a BUY signal is skipped because the candle is too large, the trade remembers this. If the next signal before any other BUY is a REENTER from the strategy, it will enter at that point as if a BUY had occurred.
                    </div>
                  )}
                </div>
                <NumericField
                  value={buyOverrideSize}
                  onChange={setBuyOverrideSize}
                  className="w-16 border rounded px-2 py-1 text-sm"
                />
              </div>
              
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="waitAfterSellEnabled"
                  checked={waitAfterSellEnabled}
                  onChange={(e) => setWaitAfterSellEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="waitAfterSellEnabled" className="text-sm font-medium">After a SELL wait for</label>
                <NumericField
                  value={waitAfterSellCandles}
                  onChange={setWaitAfterSellCandles}
                  className="w-14 h-8 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 ml-2"
                  min="1"
                  max="99"
                  disabled={!waitAfterSellEnabled}
                />
                <span className="text-sm ml-2">candles</span>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="sellWhenLossCandlesEnabled"
                  checked={sellWhenLossCandlesEnabled}
                  onChange={(e) => setSellWhenLossCandlesEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="sellWhenLossCandlesEnabled" className="text-sm font-medium">SELL when in loss for</label>
                <NumericField
                  value={sellWhenLossCandles}
                  onChange={setSellWhenLossCandles}
                  className="w-14 h-8 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500 ml-2"
                  min="1"
                  max="99"
                  disabled={!sellWhenLossCandlesEnabled}
                />
                <span className="text-sm ml-2">candles</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Target / Profit Strategy */}
          <div className="space-y-4">
            <div className="text-base font-medium">Target / Profit Strategies</div>
            
            <div className="space-y-3">
              <div className="rounded-md border border-gray-200 p-3 space-y-3">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="targetPointsEnabled"
                    checked={targetPointsEnabled}
                    onChange={(e) => setTargetPointsEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="targetPointsEnabled" className="text-sm font-medium">Target Points</label>
                </div>

                <div className="flex items-center space-x-2 pl-6">
                  <label htmlFor="targetPoints" className={`text-sm ${targetPointsEnabled ? "" : "text-gray-400"}`}>Points</label>
                  <NumericInput
                    id="targetPoints"
                    value={targetPoints}
                    onChange={setTargetPoints}
                    className="w-20 h-8"
                    disabled={!targetPointsEnabled}
                  />
                </div>

                <div className="flex items-center space-x-4 pl-6 pt-1">
                  <label className={`text-sm ${targetPointsEnabled ? "" : "text-gray-400"}`}>Use price:</label>
                  <label className={`flex items-center space-x-1 text-sm ${targetPointsEnabled ? "" : "text-gray-400"}`}>
                    <input
                      type="radio"
                      name="priceMode"
                      value="live"
                      checked={priceMode === "live"}
                      onChange={(e) => {
                        const mode = e.target.value as "live" | "candleClose";
                        setPriceMode(mode);
                        setTargetMode(mode);
                        setTrailingMode(mode);
                      }}
                      className="h-3 w-3"
                      disabled={!targetPointsEnabled}
                    />
                    <span>LTP</span>
                  </label>
                  <label className={`flex items-center space-x-1 text-sm ${targetPointsEnabled ? "" : "text-gray-400"}`}>
                    <input
                      type="radio"
                      name="priceMode"
                      value="candleClose"
                      checked={priceMode === "candleClose"}
                      onChange={(e) => {
                        const mode = e.target.value as "live" | "candleClose";
                        setPriceMode(mode);
                        setTargetMode(mode);
                        setTrailingMode(mode);
                      }}
                      className="h-3 w-3"
                      disabled={!targetPointsEnabled}
                    />
                    <span>Candle close</span>
                  </label>
                </div>
              </div>

              <div className="rounded-md border border-gray-200 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="trailingAfterTargetEnabled"
                      checked={trailingAfterTargetEnabled}
                      onChange={(e) => setTrailingAfterTargetEnabled(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <label htmlFor="trailingAfterTargetEnabled" className="text-sm font-medium">
                      Trailing SL <span className="text-xs text-gray-500 font-normal">({priceMode === "candleClose" ? "Candle close" : "Live price"})</span>
                    </label>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:text-gray-700"
                      onClick={() => setIsTrailingAfterInfoOpen((prev) => !prev)}
                      aria-label="Trailing SL info"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                    {isTrailingAfterInfoOpen && (
                      <div
                        className="absolute right-0 mt-2 w-60 rounded-md p-2 text-white shadow-lg"
                        style={{
                          zIndex: 9,
                          background: "rgba(0, 0, 0, 0.8)",
                          fontSize: "11px",
                          lineHeight: "18px",
                        }}
                      >
                        Once your primary target is hit, this trailing stop-loss keeps following price by the number of points you set. If price reverses by that amount, profits are locked automatically.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2 pl-6">
                  <label
                    htmlFor="trailingAfterTargetValue"
                    className={`text-sm ${trailingAfterTargetEnabled ? "" : "text-gray-400"}`}
                  >
                    Points
                  </label>
                  <NumericInput
                    id="trailingAfterTargetValue"
                    value={trailingAfterTarget}
                    onChange={setTrailingAfterTarget}
                    className="w-20 h-8"
                    disabled={!trailingAfterTargetEnabled}
                  />
                </div>
              </div>

              <div className="rounded-md border border-gray-200 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="minToHoldEnabled"
                      checked={minToHoldEnabled}
                      onChange={(e) => setMinToHoldEnabled(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <label htmlFor="minToHoldEnabled" className="text-sm font-medium" style={{color:'green'}}>Minimum target</label>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:text-gray-700"
                      onClick={() => setIsMinToHoldInfoOpen((prev) => !prev)}
                      aria-label="Minimum to hold info"
                    >
                      <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                    {isMinToHoldInfoOpen && (
                      <div
                        className="absolute right-0 mt-2 w-56 rounded-md p-2 text-white shadow-lg"
                        style={{
                          zIndex: 9,
                          background: "rgba(0, 0, 0, 0.8)",
                          fontSize: "11px",
                          lineHeight: "18px",
                        }}
                      >
                        Example: buy at 200 with minimum target {minToHold} and trigger @ {minToHoldTrigger}. Once price hits {200 + minToHold + minToHoldTrigger} ({200 + minToHold} + {minToHoldTrigger}), we lock the exit at {200 + minToHold}. Even if it rallies higher and drops back, you still capture those {minToHold} points.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2 pl-6">
                  <label htmlFor="minToHoldValue" className={`text-sm ${minToHoldEnabled ? "" : "text-gray-400"}`}>Points</label>
                  <NumericInput
                    id="minToHoldValue"
                    value={minToHold}
                    onChange={setMinToHold}
                    className="w-20 h-8"
                    disabled={!minToHoldEnabled}
                  />
                  <label htmlFor="minToHoldTrigger" className={`text-sm ${minToHoldEnabled ? "" : "text-gray-400"}`}>Trigger @</label>
                  <NumericInput
                    id="minToHoldTrigger"
                    value={minToHoldTrigger}
                    onChange={setMinToHoldTrigger}
                    className="w-16 h-8"
                    disabled={!minToHoldEnabled}
                  />
                </div>

                <div className="flex items-center space-x-4 pl-6">
                  <label className={`text-sm ${minToHoldEnabled ? "" : "text-gray-400"}`}>Trailing</label>
                  <div className="flex items-center space-x-2">
                    <label className="flex items-center space-x-1 cursor-pointer">
                      <input
                        type="radio"
                        name="minToHoldTrailing"
                        value="yes"
                        checked={minToHoldTrailing === "yes"}
                        onChange={(e) => setMinToHoldTrailing(e.target.value)}
                        disabled={!minToHoldEnabled}
                        className="h-4 w-4"
                      />
                      <span className={`text-sm ${minToHoldEnabled ? "" : "text-gray-400"}`}>Yes</span>
                    </label>
                    <label className="flex items-center space-x-1 cursor-pointer">
                      <input
                        type="radio"
                        name="minToHoldTrailing"
                        value="no"
                        checked={minToHoldTrailing === "no"}
                        onChange={(e) => setMinToHoldTrailing(e.target.value)}
                        disabled={!minToHoldEnabled}
                        className="h-4 w-4"
                      />
                      <span className={`text-sm ${minToHoldEnabled ? "" : "text-gray-400"}`}>No</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* ReEntry After Target */}
            <div className="space-y-2 border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="reEntryAfterTargetEnabled"
                    checked={reEntryAfterTargetEnabled}
                    onChange={(e) => setReEntryAfterTargetEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="reEntryAfterTargetEnabled" className="text-sm font-medium" style={{color:'red'}}>Auto Re-entry</label>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:text-gray-700"
                    onClick={() => setIsReEntryInfoOpen((prev) => !prev)}
                    aria-label="ReEntry after target info"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                  {isReEntryInfoOpen && (
                    <div
                      className="absolute right-0 mt-2 w-64 rounded-md p-2 text-white shadow-lg"
                      style={{
                        zIndex: 9,
                        background: "rgba(0, 0, 0, 0.8)",
                        fontSize: "11px",
                        lineHeight: "18px",
                      }}
                    >
                      After exiting with a profit (target, trailing SL, or minimum target), if the price trends back up and exceeds the exit price within the specified candles, a new buy is triggered. Does not apply for stop-loss or loss exits.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2 pl-6">
                <label className={`text-sm ${reEntryAfterTargetEnabled ? "" : "text-gray-400"}`}>Plus</label>
                <NumericField
                  value={reEntryPoints}
                  onChange={setReEntryPoints}
                  className="w-14 h-8 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  min="1"
                  max="99"
                  disabled={!reEntryAfterTargetEnabled}
                />
                <span className={`text-sm ${reEntryAfterTargetEnabled ? "" : "text-gray-400"}`}>Pts After Target</span>
              </div>

              <div className="flex items-center space-x-2 pl-6">
                <label className={`text-sm ${reEntryAfterTargetEnabled ? "" : "text-gray-400"}`}>Uptrend within</label>
                <NumericField
                  value={reEntryCandles}
                  onChange={setReEntryCandles}
                  className="w-14 h-8 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  min="1"
                  max="99"
                  disabled={!reEntryAfterTargetEnabled}
                />
                <span className={`text-sm ${reEntryAfterTargetEnabled ? "" : "text-gray-400"}`}>Candles</span>
              </div>
            </div>

            {/* Signal Re-entry */}
            <div className="rounded-md border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="signalReEntryEnabled"
                    checked={signalReEntryEnabled}
                    onChange={(e) => setSignalReEntryEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="signalReEntryEnabled" className="text-sm font-medium" style={{color:'red'}}>Signal Re-entry</label>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:text-gray-700"
                    onClick={() => setIsSignalReEntryInfoOpen((prev) => !prev)}
                    aria-label="Signal Re-entry info"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                  {isSignalReEntryInfoOpen && (
                    <div
                      className="absolute right-0 mt-2 w-64 rounded-md p-2 text-white shadow-lg"
                      style={{ zIndex: 9, background: "rgba(0,0,0,0.8)", fontSize: "11px", lineHeight: "18px" }}
                    >
                      After any exit (Target, Trailing SL, Stop-loss, or Minimum Target), if the strategy sends a REENTER signal, the trade will re-enter only if the current price is higher than the last exit price. Applies configured guards (candle size, time range, wait-after-sell) if they are enabled. If the strategy sends a REEXIT signal while in a re-entry position, the trade will exit that cycle immediately.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ReEnter as Trailing */}
            <div className="rounded-md border border-gray-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="reEntryAsTrailingEnabled"
                    checked={reEntryAsTrailingEnabled}
                    onChange={(e) => setReEntryAsTrailingEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="reEntryAsTrailingEnabled" className="text-sm font-medium" style={{color:'red'}}>ReEnter as Trailing</label>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:text-gray-700"
                    onClick={() => setIsReEntryTrailingInfoOpen((prev) => !prev)}
                    aria-label="ReEnter as Trailing info"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                  {isReEntryTrailingInfoOpen && (
                    <div
                      className="absolute right-0 mt-2 w-64 rounded-md p-2 text-white shadow-lg"
                      style={{ zIndex: 9, background: "rgba(0,0,0,0.8)", fontSize: "11px", lineHeight: "18px" }}
                    >
                      When enabled, both Auto Re-entry and Signal Re-entry will immediately arm trailing SL at the re-entry price. If price drops by the trailing points from the highest point reached, the trade exits automatically.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2 pl-6">
                <label className={`text-sm ${reEntryAsTrailingEnabled ? "" : "text-gray-400"}`}>Trail</label>
                <NumericField
                  value={reEntryTrailingPoints}
                  onChange={setReEntryTrailingPoints}
                  className="w-14 h-8 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500"
                  min="1"
                  max="99"
                  disabled={!reEntryAsTrailingEnabled}
                />
                <span className={`text-sm ${reEntryAsTrailingEnabled ? "" : "text-gray-400"}`}>Points</span>
              </div>
            </div>

            {/* ReEntry Minimum Target */}
            <div className="rounded-md border border-gray-200 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="reEntryMinTargetEnabled"
                    checked={reEntryMinTargetEnabled}
                    onChange={(e) => setReEntryMinTargetEnabled(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="reEntryMinTargetEnabled" className="text-sm font-medium" style={{color:'green'}}>ReEntry Minimum Target</label>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:text-gray-700"
                    onClick={() => setIsReEntryMinTargetInfoOpen((prev) => !prev)}
                    aria-label="ReEntry Minimum Target info"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                  {isReEntryMinTargetInfoOpen && (
                    <div
                      className="absolute right-0 mt-2 w-56 rounded-md p-2 text-white shadow-lg"
                      style={{
                        zIndex: 9,
                        background: "rgba(0, 0, 0, 0.8)",
                        fontSize: "11px",
                        lineHeight: "18px",
                      }}
                    >
                      Applies only to re-entry trades (Auto Re-entry and Signal Re-entry). When a re-entry occurs, this minimum target overrides the normal Minimum Target. Normal BUY entries continue to use the standard Minimum Target settings.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-2 pl-6">
                <label htmlFor="reEntryMinTargetPoints" className={`text-sm ${reEntryMinTargetEnabled ? "" : "text-gray-400"}`}>Points</label>
                <NumericInput
                  id="reEntryMinTargetPoints"
                  value={reEntryMinTargetPoints}
                  onChange={setReEntryMinTargetPoints}
                  className="w-20 h-8"
                  disabled={!reEntryMinTargetEnabled}
                />
                <label htmlFor="reEntryMinTargetTrigger" className={`text-sm ${reEntryMinTargetEnabled ? "" : "text-gray-400"}`}>Trigger</label>
                <NumericInput
                  id="reEntryMinTargetTrigger"
                  value={reEntryMinTargetTrigger}
                  onChange={setReEntryMinTargetTrigger}
                  className="w-20 h-8"
                  disabled={!reEntryMinTargetEnabled}
                />
              </div>

              <div className="flex items-center space-x-4 pl-6">
                <label className={`text-sm ${reEntryMinTargetEnabled ? "" : "text-gray-400"}`}>Trailing</label>
                <div className="flex items-center space-x-2">
                  <label className="flex items-center space-x-1 cursor-pointer">
                    <input
                      type="radio"
                      name="reEntryMinTargetTrailing"
                      value="yes"
                      checked={reEntryMinTargetTrailing === "yes"}
                      onChange={(e) => setReEntryMinTargetTrailing(e.target.value)}
                      disabled={!reEntryMinTargetEnabled}
                      className="h-4 w-4"
                    />
                    <span className={`text-sm ${reEntryMinTargetEnabled ? "" : "text-gray-400"}`}>Yes</span>
                  </label>
                  <label className="flex items-center space-x-1 cursor-pointer">
                    <input
                      type="radio"
                      name="reEntryMinTargetTrailing"
                      value="no"
                      checked={reEntryMinTargetTrailing === "no"}
                      onChange={(e) => setReEntryMinTargetTrailing(e.target.value)}
                      disabled={!reEntryMinTargetEnabled}
                      className="h-4 w-4"
                    />
                    <span className={`text-sm ${reEntryMinTargetEnabled ? "" : "text-gray-400"}`}>No</span>
                  </label>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-500">If no target/profit strategy is checked, target booking will not be applied for this trade.</p>
          </div>

          <Separator />

          {/* Range */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={rangeEnabled}
                onChange={(e) => setRangeEnabled(e.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              <span className="text-base font-medium">Time Range</span>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Input 
                  type="text" 
                  value={timeFrom} 
                  onChange={(e) => setTimeFrom(e.target.value)}
                  className="w-16 h-8 text-sm"
                  disabled={!rangeEnabled}
                />
                <select 
                  value={timeFromAmpm} 
                  onChange={(e) => setTimeFromAmpm(e.target.value)}
                  className="w-14 h-8 px-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  disabled={!rangeEnabled}
                >
                  <option value="am">AM</option>
                  <option value="pm">PM</option>
                </select>
                <label className="text-sm w-8">To</label>
                <Input 
                  type="text" 
                  value={timeTo} 
                  onChange={(e) => setTimeTo(e.target.value)}
                  className="w-16 h-8 text-sm"
                  disabled={!rangeEnabled}
                />
                <select 
                  value={timeToAmpm} 
                  onChange={(e) => setTimeToAmpm(e.target.value)}
                  className="w-14 h-8 px-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  disabled={!rangeEnabled}
                >
                  <option value="am">AM</option>
                  <option value="pm">PM</option>
                </select>
              </div>

            </div>
          </div>

          <Separator />

          {/* SL / TG Range to Leave */}
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={maxProfitLossEnabled}
                onChange={(e) => setMaxProfitLossEnabled(e.target.checked)}
                className="accent-blue-600 w-4 h-4"
              />
              <span className="text-base font-medium">SL / TG Range to Leave</span>
            </div>

            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <label className={`text-sm w-24 ${maxProfitLossEnabled ? '' : 'text-gray-400'}`}>Max Profit</label>
                <NumericInput
                  value={maxProfit}
                  onChange={setMaxProfit}
                  className="w-24 h-8 text-sm"
                  disabled={!maxProfitLossEnabled}
                />
              </div>
              <div className="flex items-center space-x-2">
                <label className={`text-sm w-24 ${maxProfitLossEnabled ? '' : 'text-gray-400'}`}>Max Loss</label>
                <NumericInput
                  value={maxLoss}
                  onChange={setMaxLoss}
                  className="w-24 h-8 text-sm"
                  disabled={!maxProfitLossEnabled}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Trade Taking Section */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium">Available to Trade</label>
              <span className={`text-sm font-bold ${
                availableBalance === null
                  ? "text-muted-foreground"
                  : insufficientBalance
                    ? "text-red-600"
                    : "text-green-600"
              }`}>
                {availableBalance !== null
                  ? `₹${availableBalance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : "Not connected"}
              </span>
            </div>

            <div className={`p-3 rounded-lg ${insufficientBalance ? "bg-red-50 border border-red-200" : "bg-gray-50"}`}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">
                  {selection?.symbol ?? "Select a symbol from Watchlist"}
                </span>
                <span className="text-sm font-bold">
                  {price > 0 ? `₹${price.toFixed(2)}` : "--"}
                </span>
              </div>

              <div className="flex justify-between items-center mb-2">
                <label className="text-sm">LOT ({lotSize}):</label>
                <NumericInput
                  value={lotValue}
                  onChange={setLotValue}
                  fallback="1"
                  className="w-16 h-8 text-sm"
                  min={1}
                />
              </div>

              <div className="flex justify-between items-center text-sm text-gray-600 mb-1">
                <span>Qty</span>
                <span>{quantity}</span>
              </div>

              <div className="flex justify-between items-center text-sm font-medium">
                <span>Total Required</span>
                <span className={insufficientBalance ? "text-red-600 font-bold" : ""}>
                  ₹{total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {insufficientBalance && (
                <p className="text-xs text-red-600 mt-2">
                  You need ₹{((marginRequired - availableBalance!)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} more to place this trade.
                </p>
              )}
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={() => {
                  if (!isButtonDisabled && selection?.symbol) {
                      // Tell angel-feed backend to add this symbol to active strategy symbols (max 2)
                      addActiveStrategySymbol(selection.symbol).catch(() => {});

                      saveForm();
                      addWaitingTradeFromSelection();

                      const tradePayload = {
                        symbol: selection.symbol,
                        price: price,
                        stateText: "...WAITING",
                        logs: ["Strategy initialized - waiting for signals"],
                        lotSize,
                        lotValue,
                        numberOfTrades,
                        stopLossNumberEnabled: stopLossNumberEnabled || stopLossPercentageEnabled,
                        stopLossNumber,
                        targetPointsEnabled,
                        targetPoints,
                        minToHoldEnabled,
                        minToHold,
                        minToHoldTrigger,
                        minToHoldTrailing: minToHoldTrailing === "yes",
                        trailingAfterTargetEnabled,
                        trailingAfterTarget,
                        rangeEnabled,
                        timeFrom,
                        timeFromAmpm,
                        timeTo,
                        timeToAmpm,
                        buyOverride: waitStrategyEnabled ? (buyOverrideSize || undefined) : undefined,
                        waitAfterSellEnabled,
                        waitAfterSellCandles,
                        sellWhenLossCandlesEnabled,
                        sellWhenLossCandles,
                        maxProfitLossEnabled,
                        maxProfit,
                        maxLoss,
                        reEntryAfterTargetEnabled,
                        reEntryCandles,
                        reEntryPoints,
                        reEntryAsTrailingEnabled,
                        reEntryTrailingPoints,
                        reEntryMinTargetEnabled,
                        reEntryMinTargetPoints,
                        reEntryMinTargetTrigger,
                        reEntryMinTargetTrailing: reEntryMinTargetTrailing === "yes",
                        signalReEntryEnabled,
                      };

                      // PUT to update existing waiting trade, POST to add new one
                      fetch("/next-api/trades", {
                        method: isAlreadyWaiting ? "PUT" : "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(tradePayload),
                      }).catch(() => {});

                    router.push("/dashboard");
                  }
                }}
                className="flex-1"
                disabled={isButtonDisabled || false}
              >
                {buttonText}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => router.push("/dashboard")}
                className="flex-1"
              >
                CANCEL
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
