"use client";

import styles from "./page.module.scss";
import { useEffect, useState } from "react";
import { useTradeStore, WaitingTrade } from "../store/TradeStore";
import { useRouter } from "next/navigation";
import { getPrices } from "@/lib/getPrices";

export default function TradePage() {
  const router = useRouter();
  const { selection, addWaitingTradeFromSelection, waitingTrades } = useTradeStore();
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
  const buttonText = isAlreadyWaiting ? "UPDATE" : "ENTER";

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
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Stretegy</div>
            <select className={styles.select} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="nifty">NIFTY CE STRATEGY</option>
              <option value="banknifty">BANKNIFTY CE STRATEGY</option>
            </select>
          </div>
        </div>

        <div className={styles.divider} />

        <div className={styles.section}>
          <div className={styles.sectionHeaderWide}>
            <div className={styles.sectionTitle}>Number of Trades to take</div>
            <select className={styles.select} value={numberOfTrades} onChange={(e) => setNumberOfTrades(Number(e.target.value))}>
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.divider} />

        <details className={styles.details} open>
          <summary className={styles.summary}>Stop Loss Strategy</summary>
          <div className={styles.grid}>
            <label className={styles.checkRow}>
              <input type="checkbox" defaultChecked />
              <span>Based on number</span>
            </label>
            <input className={styles.input} value={stopLossNumber} onChange={(e) => setStopLossNumber(Number(e.target.value) || 0)} />

            <label className={styles.checkRow}>
              <input type="checkbox"  />
              <span>Based on percentage %</span>
            </label>
            <input className={styles.input} value={stopLossPercentage} onChange={(e) => setStopLossPercentage(Number(e.target.value) || 0)} />

            <label className={styles.checkRow}>
              <input type="checkbox"  />
              <span>Based on previous candle</span>
            </label>
            <select className={styles.selectSmall} value={stopLossCandle} onChange={(e) => setStopLossCandle(e.target.value)}>
              <option value="closing">Closing</option>
              <option value="open">Open</option>
              <option value="high">High</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className={styles.note}>(* Whichever first happens)</div>
        </details>

        <div className={styles.divider} />

        <details className={styles.details} open>
          <summary className={styles.summary}>Exit Strategy</summary>
          <div className={styles.grid}>
            <label className={styles.checkRow}>
              <input type="checkbox" defaultChecked />
              <span>Target Points</span>
            </label>
            <input className={styles.input} value={targetPoints} onChange={(e) => setTargetPoints(Number(e.target.value) || 0)} />

            <label className={styles.checkRow}>
              <input type="checkbox"  />
              <span>Minimum to hold</span>
            </label>
            <input className={styles.input} value={minToHold} onChange={(e) => setMinToHold(Number(e.target.value) || 0)} />

            <label className={styles.checkRow}>
              <input type="checkbox"  />
              <span>Trailing after target</span>
            </label>
            <input className={styles.input} value={trailing} onChange={(e) => setTrailing(Number(e.target.value) || 0)} />
          </div>
        </details>

        <div className={styles.divider} />

        <details className={styles.details} open>
          <summary className={styles.summary}>Range</summary>
          <div className={styles.rangeGrid}>
            <div className={styles.rangeRow}>
              <div className={styles.rangeLabel}>Time :</div>
              <input className={styles.inputSmall} value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
              <select className={styles.selectTiny} value={timeFromAmpm} onChange={(e) => setTimeFromAmpm(e.target.value)}>
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
              <div className={styles.rangeLabel}>To</div>
              <input className={styles.inputSmall} value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
              <select className={styles.selectTiny} value={timeToAmpm} onChange={(e) => setTimeToAmpm(e.target.value)}>
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
            </div>

            <div className={styles.rangeRow}>
              <div className={styles.rangeLabel}>Price :</div>
              <input className={styles.inputSmall} value={priceFrom} onChange={(e) => setPriceFrom(Number(e.target.value) || 0)} />
              <div className={styles.rangeLabel}>To</div>
              <input className={styles.inputSmall} value={priceTo} onChange={(e) => setPriceTo(Number(e.target.value) || 0)} />
            </div>
          </div>
        </details>

        <div className={styles.divider} />

        <div className={styles.tradeTaking}>
          <div className={styles.availableRow}>
            <div className={styles.availableLabel}>Available to Trade</div>
            <div className={styles.availableValue}>= ₹85,000</div>
          </div>

          <div className={styles.instrumentRow}>
            <div className={styles.instrumentSymbol}>
              {selection?.symbol ?? "Select a symbol from Watchlist"}
            </div>
            <div className={styles.instrumentPrice}>₹{currentPrice ?? selection?.price ?? "--"}</div>
          </div>

          <div className={styles.lotRow}>
            <div className={styles.lotLeft}>
              <div className={styles.lotLabel}>LOT  ({lotSize}) :</div>
              <input className={styles.lotInput} value={lotValue} onChange={(e) => setLotValue(Number(e.target.value) || 0)} />
            </div>

            <div className={styles.totalText}>
              Total : {price.toFixed(2)} * {lotSize * lotValue} = ₹{total.toFixed(2)}
            </div>
          </div>

          <div className={styles.tradeActions}>
            <button
              className={styles.buyBtn}
              type="button"
              onClick={() => {
                saveForm();
                addWaitingTradeFromSelection();
                router.push("/dashboard");
              }}
            >
              {buttonText}
            </button>
            <button className={styles.cancelBtn} type="button" onClick={() => router.push("/dashboard")}>
              CANCEL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
