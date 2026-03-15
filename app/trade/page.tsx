"use client";

import { useEffect, useState } from "react";
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
  const [lotValue, setLotValue] = useState(5);

  // Form states
  const [strategy, setStrategy] = useState('nifty');
  const [numberOfTrades, setNumberOfTrades] = useState(3);
  const [stopLossNumber, setStopLossNumber] = useState(15);
  const [stopLossPercentage, setStopLossPercentage] = useState(10);
  const [stopLossCandle, setStopLossCandle] = useState('closing');
  const [targetPoints, setTargetPoints] = useState(20);
  const [minToHold, setMinToHold] = useState(8);
  const [trailing, setTrailing] = useState(15);
  const [timeFrom, setTimeFrom] = useState('10:15');
  const [timeFromAmpm, setTimeFromAmpm] = useState('am');
  const [timeTo, setTimeTo] = useState('02:45');
  const [timeToAmpm, setTimeToAmpm] = useState('pm');
  const [priceFrom, setPriceFrom] = useState(180);
  const [priceTo, setPriceTo] = useState(220);

  const isAlreadyWaiting = selection && waitingTrades.some((trade: WaitingTrade) => trade.symbol === selection.symbol);
  const isAlreadyActive = selection && activeTrades.some((trade) => trade.symbol === selection.symbol && trade.status === "ACTIVE");
  const buttonText = isAlreadyActive ? "TRADE RUNNING" : (isAlreadyWaiting ? "UPDATE" : "ENTER");
  const isButtonDisabled = isAlreadyActive;

  const lotSize: number = 65;

  const price = Number(currentPrice || selection?.price || 0);
  const total = price * (lotSize * lotValue);

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
      setNumberOfTrades(data.numberOfTrades || 3);
      setStopLossNumber(data.stopLossNumber || 15);
      setStopLossPercentage(data.stopLossPercentage || 10);
      setStopLossCandle(data.stopLossCandle || 'closing');
      setTargetPoints(data.targetPoints || 20);
      setMinToHold(data.minToHold || 8);
      setTrailing(data.trailing || 15);
      setTimeFrom(data.timeFrom || '10:15');
      setTimeFromAmpm(data.timeFromAmpm || 'am');
      setTimeTo(data.timeTo || '02:45');
      setTimeToAmpm(data.timeToAmpm || 'pm');
      setPriceFrom(data.priceFrom || 180);
      setPriceTo(data.priceTo || 220);
      setLotValue(data.lotValue || 5);
    } else {
      // Reset to defaults
      setStrategy('nifty');
      setStopLossNumber(15);
      setStopLossPercentage(10);
      setStopLossCandle('closing');
      setTargetPoints(20);
      setMinToHold(8);
      setTrailing(15);
      setTimeFrom('10:15');
      setTimeFromAmpm('am');
      setTimeTo('02:45');
      setTimeToAmpm('pm');
      setPriceFrom(180);
      setPriceTo(220);
      setLotValue(5);
    }
  }, [selection?.symbol]);

  const saveForm = () => {
    if (!selection?.symbol) return;
    const formData = {
      strategy,
      numberOfTrades,
      stopLossNumber,
      stopLossPercentage,
      stopLossCandle,
      targetPoints,
      minToHold,
      trailing,
      timeFrom,
      timeFromAmpm,
      timeTo,
      timeToAmpm,
      priceFrom,
      priceTo,
      symbol: selection.symbol,
      lotValue,
      lotSize,
      takenPrice: price,
    };
    localStorage.setItem('tradeForm_' + selection.symbol, JSON.stringify(formData));
  };

  return (
    <div className="min-h-screen p-4 bg-white">
      <Card className="w-full max-w-md mx-auto">
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
            <div className="text-base font-medium">Stop Loss Strategy</div>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <input type="checkbox" id="stopLossNumber" defaultChecked className="h-4 w-4" />
                <label htmlFor="stopLossNumber" className="text-sm">Based on number</label>
                <Input 
                  type="number" 
                  value={stopLossNumber} 
                  onChange={(e) => setStopLossNumber(Number(e.target.value) || 0)}
                  className="w-20 h-8"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input type="checkbox" id="stopLossPercentage" disabled className="h-4 w-4" />
                <label htmlFor="stopLossPercentage" className="text-sm text-gray-400">Based on percentage %</label>
                <Input 
                  type="number" 
                  value={stopLossPercentage} 
                  onChange={(e) => setStopLossPercentage(Number(e.target.value) || 0)}
                  className="w-20 h-8"
                  disabled
                />
              </div>

              <div className="flex items-center space-x-2">
                <input type="checkbox" id="stopLossCandle" disabled className="h-4 w-4" />
                <label htmlFor="stopLossCandle" className="text-sm text-gray-400">Based on previous candle</label>
                <select 
                  value={stopLossCandle} 
                  onChange={(e) => setStopLossCandle(e.target.value)}
                  className="w-24 h-8 px-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled-select"
                  disabled
                >
                  <option value="closing">Closing</option>
                  <option value="open">Open</option>
                  <option value="high">High</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
            
            <p className="text-xs text-gray-500">* Whichever first happens</p>
          </div>

          <Separator />

          {/* Exit Strategy */}
          <div className="space-y-4">
            <div className="text-base font-medium">Exit Strategy</div>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <input type="checkbox" id="targetPoints" defaultChecked className="h-4 w-4" />
                <label htmlFor="targetPoints" className="text-sm">Target Points</label>
                <Input 
                  type="number" 
                  value={targetPoints} 
                  onChange={(e) => setTargetPoints(Number(e.target.value) || 0)}
                  className="w-20 h-8"
                />
              </div>

              <div className="flex items-center space-x-2">
                <input type="checkbox" id="minToHold" disabled className="h-4 w-4" />
                <label htmlFor="minToHold" className="text-sm text-gray-400">Minimum to hold</label>
                <Input 
                  type="number" 
                  value={minToHold} 
                  onChange={(e) => setMinToHold(Number(e.target.value) || 0)}
                  className="w-20 h-8"
                  disabled
                />
              </div>

              <div className="flex items-center space-x-2">
                <input type="checkbox" id="trailing" disabled className="h-4 w-4" />
                <label htmlFor="trailing" className="text-sm text-gray-400">Trailing after target</label>
                <Input 
                  type="number" 
                  value={trailing} 
                  onChange={(e) => setTrailing(Number(e.target.value) || 0)}
                  className="w-20 h-8"
                  disabled
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Range */}
          <div className="space-y-4">
            <div className="text-base font-medium">Range</div>
            
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-400 w-12">Time:</label>
                <Input 
                  type="text" 
                  value={timeFrom} 
                  onChange={(e) => setTimeFrom(e.target.value)}
                  className="w-16 h-8 text-sm"
                  disabled
                />
                <select 
                  value={timeFromAmpm} 
                  onChange={(e) => setTimeFromAmpm(e.target.value)}
                  className="w-14 h-8 px-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm disabled-select"
                  disabled
                >
                  <option value="am">AM</option>
                  <option value="pm">PM</option>
                </select>
                <label className="text-sm text-gray-400 w-8">To</label>
                <Input 
                  type="text" 
                  value={timeTo} 
                  onChange={(e) => setTimeTo(e.target.value)}
                  className="w-16 h-8 text-sm"
                  disabled
                />
                <select 
                  value={timeToAmpm} 
                  onChange={(e) => setTimeToAmpm(e.target.value)}
                  className="w-14 h-8 px-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm disabled-select"
                  disabled
                >
                  <option value="am">AM</option>
                  <option value="pm">PM</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-400 w-12">Price:</label>
                <Input 
                  type="number" 
                  value={priceFrom} 
                  onChange={(e) => setPriceFrom(Number(e.target.value) || 0)}
                  className="w-20 h-8 text-sm"
                  disabled
                />
                <label className="text-sm text-gray-400 w-8">To</label>
                <Input 
                  type="number" 
                  value={priceTo} 
                  onChange={(e) => setPriceTo(Number(e.target.value) || 0)}
                  className="w-20 h-8 text-sm"
                  disabled
                />
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
