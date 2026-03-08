"use client";

import styles from "./page.module.scss";
import { useTradeStore, WaitingTrade } from "../store/TradeStore";
import { useRouter } from "next/navigation";

export default function TradePage() {
  const router = useRouter();
  const { selection, addWaitingTradeFromSelection, waitingTrades } = useTradeStore();

  const isAlreadyWaiting = selection && waitingTrades.some((trade: WaitingTrade) => trade.symbol === selection.symbol);
  const buttonText = isAlreadyWaiting ? "UPDATE" : "ENTER";

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
          <summary className={styles.summary}>Target</summary>
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
            <div className={styles.instrumentPrice}>₹{selection?.price ?? "--"}</div>
          </div>

          <div className={styles.lotRow}>
            <div className={styles.lotLeft}>
              <div className={styles.lotLabel}>LOT :</div>
              <input className={styles.lotInput} defaultValue="5" />
            </div>

            <div className={styles.totalText}>
              Total : 200.00 * 325
              <span className={styles.totalEq}>= ₹65,000</span>
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
