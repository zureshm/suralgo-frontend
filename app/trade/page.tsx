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

export default function TradePage() {
  const router = useRouter();
  const { selection, addWaitingTradeFromSelection, waitingTrades, activeTrades } = useTradeStore();
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [lotValue, setLotValue] = useState(1);

  // Form states
  const [strategy, setStrategy] = useState('nifty');
  const [numberOfTrades, setNumberOfTrades] = useState(5);
  const [stopLossNumberEnabled, setStopLossNumberEnabled] = useState(true);
  const [stopLossNumber, setStopLossNumber] = useState(15);
  const [stopLossPercentageEnabled, setStopLossPercentageEnabled] = useState(false);
  const [stopLossPercentage, setStopLossPercentage] = useState(10);
  const [targetPointsEnabled, setTargetPointsEnabled] = useState(true);
  const [targetPoints, setTargetPoints] = useState(20);
  const [waitStrategyEnabled, setWaitStrategyEnabled] = useState(false);
  const [minToHoldEnabled, setMinToHoldEnabled] = useState(false);
  const [minToHold, setMinToHold] = useState(8);
  const [isMinToHoldInfoOpen, setIsMinToHoldInfoOpen] = useState(false);
  const [trailingAfterTargetEnabled, setTrailingAfterTargetEnabled] = useState(false);
  const [trailingAfterTarget, setTrailingAfterTarget] = useState(15);
  const [isTrailingAfterInfoOpen, setIsTrailingAfterInfoOpen] = useState(false);
  const [rangeEnabled, setRangeEnabled] = useState(false);
  const [timeFrom, setTimeFrom] = useState('10:00');
  const [timeFromAmpm, setTimeFromAmpm] = useState('am');
  const [timeTo, setTimeTo] = useState('02:45');
  const [timeToAmpm, setTimeToAmpm] = useState('pm');

  const isAlreadyWaiting = selection && waitingTrades.some((trade: WaitingTrade) => trade.symbol === selection.symbol);
  const isAlreadyActive = selection && activeTrades.some((trade) => trade.symbol === selection.symbol && trade.status === "ACTIVE");
  const buttonText = isAlreadyActive ? "TRADE RUNNING" : (isAlreadyWaiting ? "UPDATE" : "ENTER");
  const isButtonDisabled = isAlreadyActive;

  const lotSize: number = 65;

  const price = Number(currentPrice || selection?.price || 0);
  const total = price * (lotSize * lotValue);

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
      setMinToHoldEnabled(Boolean(data.minToHoldEnabled ?? false));
      setMinToHold(data.minToHold || 8);
      setTrailingAfterTargetEnabled(Boolean(data.trailingAfterTargetEnabled ?? false));
      setTrailingAfterTarget(data.trailingAfterTarget || 15);
      setRangeEnabled(Boolean(data.rangeEnabled ?? false));
      setTimeFrom(data.timeFrom || '10:00');
      setTimeFromAmpm(data.timeFromAmpm || 'am');
      setTimeTo(data.timeTo || '02:45');
      setTimeToAmpm(data.timeToAmpm || 'pm');
      setLotValue(data.lotValue || 1);
    } else {
      // Reset to defaults
      setStrategy('nifty');
      setNumberOfTrades(5);
      setStopLossNumberEnabled(true);
      setStopLossNumber(15);
      setStopLossPercentageEnabled(false);
      setStopLossPercentage(10);
      setTargetPointsEnabled(true);
      setTargetPoints(20);
      setWaitStrategyEnabled(false);
      setMinToHoldEnabled(false);
      setMinToHold(8);
      setTrailingAfterTargetEnabled(false);
      setTrailingAfterTarget(15);
      setRangeEnabled(false);
      setTimeFrom('10:00');
      setTimeFromAmpm('am');
      setTimeTo('02:45');
      setTimeToAmpm('pm');
      setLotValue(1);
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
      waitStrategyEnabled,
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
    };
    localStorage.setItem('tradeForm_' + selection.symbol, JSON.stringify(formData));
  };

  return (
    <div className="min-h-screen p-4 bg-[#f1f5f9] w-full max-w-[420px] mx-auto">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-lg font-bold">Trade Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* Strategy Selection */}
          <div className="space-y-2">
            <label htmlFor="strategy" className="text-sm font-medium">Strategy</label>
            <select 
              id="strategy"
              value={strategy} 
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full h-10 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="nifty">NIFTY CE STRATEGY</option>
              <option value="banknifty">BANKNIFTY CE STRATEGY</option>
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
                  <Input 
                    id="stopLossNumber"
                    type="number" 
                    value={stopLossNumber} 
                    onChange={(e) => setStopLossNumber(Number(e.target.value) || 0)}
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
                  <Input 
                    id="stopLossPercentageValue"
                    type="number" 
                    value={stopLossPercentage} 
                    onChange={(e) => setStopLossPercentage(Number(e.target.value) || 0)}
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
            <div className="rounded-md border border-gray-200 p-3">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="waitStrategyEnabled"
                  checked={waitStrategyEnabled}
                  onChange={(e) => setWaitStrategyEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="waitStrategyEnabled" className="text-sm font-medium">
                  Wait when candle size ≥ stoploss size
                </label>
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
                  <Input 
                    id="targetPoints"
                    type="number" 
                    value={targetPoints} 
                    onChange={(e) => setTargetPoints(Number(e.target.value) || 0)}
                    className="w-20 h-8"
                    disabled={!targetPointsEnabled}
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
                    <label htmlFor="minToHoldEnabled" className="text-sm font-medium">Minimum target</label>
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
                        Example: buy at 200 with trailing target 8. Once price hits 208 (trail level) plus 2 more points, we drag the stop loss up to 208 so even if it rallies to 219 and drops back, we still capture those 8 points.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-2 pl-6">
                  <label htmlFor="minToHoldValue" className={`text-sm ${minToHoldEnabled ? "" : "text-gray-400"}`}>Points</label>
                  <Input 
                    id="minToHoldValue"
                    type="number" 
                    value={minToHold} 
                    onChange={(e) => setMinToHold(Number(e.target.value) || 0)}
                    className="w-20 h-8"
                    disabled={!minToHoldEnabled}
                  />
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
                      Trailing after target
                    </label>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-gray-500 hover:text-gray-700"
                      onClick={() => setIsTrailingAfterInfoOpen((prev) => !prev)}
                      aria-label="Trailing after target info"
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
                        Once your primary target is hit, this keeps following price by the number of points you set. If price reverses by that amount, profits are locked automatically.
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
                  <Input
                    id="trailingAfterTargetValue"
                    type="number"
                    value={trailingAfterTarget}
                    onChange={(e) => setTrailingAfterTarget(Number(e.target.value) || 0)}
                    className="w-20 h-8"
                    disabled={!trailingAfterTargetEnabled}
                  />
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
              <span className="text-base font-medium">Range</span>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <label className="text-sm w-12">Time:</label>
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

          {/* Trade Taking Section */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-sm">Available to Trade</label>
              <span className="text-sm font-semibold">≥ ₹85,000</span>
            </div>

            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">
                  {selection?.symbol ?? "Select a symbol from Watchlist"}
                </span>
                <span className="text-sm font-bold">
                  ₹{currentPrice ?? selection?.price ?? "--"}
                </span>
              </div>

              <div className="flex justify-between items-center mb-2">
                <label className="text-sm">LOT ({lotSize}):</label>
                <Input 
                  type="number" 
                  value={lotValue} 
                  onChange={(e) => setLotValue(Number(e.target.value) || 0)}
                  className="w-16 h-8 text-sm"
                />
              </div>

              <div className="text-sm text-gray-600">
                Total: {price.toFixed(2)} × {lotSize * lotValue} = ₹{total.toFixed(2)}
              </div>
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={() => {
                  if (!isButtonDisabled) {
                    saveForm();
                    addWaitingTradeFromSelection();
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
