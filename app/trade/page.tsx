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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>Stretegy</div>
            <select className={styles.select} defaultValue="nifty">
              <option value="nifty">NIFTY CE STRATEGY</option>
              <option value="banknifty">BANKNIFTY CE STRATEGY</option>
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
            <input className={styles.input} defaultValue="15" />

            <label className={styles.checkRow}>
              <input type="checkbox" defaultChecked />
              <span>Based on percentage %</span>
            </label>
            <input className={styles.input} defaultValue="10" />

            <label className={styles.checkRow}>
              <input type="checkbox" defaultChecked />
              <span>Based on previous candle</span>
            </label>
            <select className={styles.selectSmall} defaultValue="closing">
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
            <input className={styles.input} defaultValue="20" />

            <label className={styles.checkRow}>
              <input type="checkbox" defaultChecked />
              <span>Minimum to hold</span>
            </label>
            <input className={styles.input} defaultValue="8" />

            <label className={styles.checkRow}>
              <input type="checkbox" defaultChecked />
              <span>Trailing after target</span>
            </label>
            <input className={styles.input} defaultValue="15" />
          </div>
        </details>

        <div className={styles.divider} />

        <details className={styles.details} open>
          <summary className={styles.summary}>Range</summary>
          <div className={styles.rangeGrid}>
            <div className={styles.rangeRow}>
              <div className={styles.rangeLabel}>Time :</div>
              <input className={styles.inputSmall} defaultValue="10:15" />
              <select className={styles.selectTiny} defaultValue="am">
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
              <div className={styles.rangeLabel}>To</div>
              <input className={styles.inputSmall} defaultValue="02:45" />
              <select className={styles.selectTiny} defaultValue="pm">
                <option value="am">AM</option>
                <option value="pm">PM</option>
              </select>
            </div>

            <div className={styles.rangeRow}>
              <div className={styles.rangeLabel}>Price :</div>
              <input className={styles.inputSmall} defaultValue="180" />
              <div className={styles.rangeLabel}>To</div>
              <input className={styles.inputSmall} defaultValue="220" />
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
