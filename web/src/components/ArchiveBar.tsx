import { useEffect, useMemo, useRef, useState } from "react";
import {
  downloadJson,
  listArchives,
  parseBundle,
  saveImported,
  totalMatches,
} from "../lib/archive";
import type { MatchPayload } from "../lib/types";
import { QrCard } from "./QrCard";

interface Props {
  payload: MatchPayload | null;
  /** 每次存檔變動時遞增，用來重算「已存 N 份」 */
  version?: number;
  onImported: (items: MatchPayload[]) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = (): boolean => {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
};

const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function ArchiveBar({ payload, version, onImported, onNotice, onError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);
  const [matches, setMatches] = useState(0);
  const [busy, setBusy] = useState(false);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showHelp, setShowHelp] = useState(false);
  const [showQr, setShowQr] = useState(false);

  async function refreshCount() {
    try {
      const items = await listArchives();
      setCount(items.length);
      setMatches(totalMatches(items));
    } catch {
      /* 讀不到就維持原值 */
    }
  }

  useEffect(() => {
    void refreshCount();
  }, [payload, version]);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      onNotice("已安裝到主畫面，之後可以直接開 App");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [onNotice]);

  const exportable = count > 0 || !!payload;
  const summary = useMemo(
    () => (count ? `已存 ${count} 份・${matches} 場` : "尚未存檔"),
    [count, matches],
  );

  async function exportAll() {
    setBusy(true);
    try {
      const items = await listArchives();
      const use = items.length ? items : payload ? [payload] : [];
      if (!use.length) {
        onError("目前沒有可下載的存檔");
        return;
      }
      const name = downloadJson(use);
      onNotice(`已下載 ${name}（${use.length} 份・${totalMatches(use)} 場）`);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    try {
      const items = parseBundle(await file.text());
      await saveImported(items);
      await refreshCount();
      onImported(items);
      onNotice(`已匯入 ${items.length} 份存檔（${totalMatches(items)} 場）`);
    } catch (err) {
      onError(`匯入失敗：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    if (!installEvent) {
      setShowHelp((v) => !v);
      return;
    }
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      setInstallEvent(null);
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      setShowHelp(true);
    }
  }

  return (
    <section className="actionbar" aria-label="存檔與安裝">
      <div className="actionbar-buttons">
        <button
          type="button"
          className="btn ghost sm"
          onClick={exportAll}
          disabled={busy || !exportable}
          title="下載目前所有存檔（JSON），可匯入到手機或其他裝置"
        >
          ↓ 下載存檔
        </button>

        <button
          type="button"
          className="btn ghost sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="匯入先前下載的 JSON 存檔"
        >
          ↑ 匯入存檔
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onFile}
          hidden
        />

        {!installed && (
          <button type="button" className="btn ghost sm" onClick={install} title="安裝到手機主畫面">
            ▣ 安裝 App
          </button>
        )}

        <button
          type="button"
          className="btn ghost sm qr-btn"
          onClick={() => setShowQr((v) => !v)}
          title="用手機或平板掃描 QR code 開啟"
        >
          ▦ 手機開啟
        </button>
      </div>

      <span className="actionbar-note">
        {summary}
        <em>抓過的資料會留在這台裝置，不用重抓</em>
      </span>

      {showHelp && !installed && (
        <div className="install-help" role="dialog" aria-label="安裝說明">
          <strong>加到主畫面</strong>
          <ul>
            <li>
              <b>Android（Chrome）</b>：右上 ⋮ →「安裝應用程式」或「加到主畫面」
            </li>
            <li>
              <b>iPhone / iPad（Safari）</b>：下方分享 ⤴ →「加入主畫面」
            </li>
            <li>
              <b>電腦（Chrome / Edge）</b>：網址列右側的安裝圖示
            </li>
          </ul>
          {isIOS() && <p>iOS 只支援用 Safari 加到主畫面，Chrome／Firefox 不行。</p>}
          <button type="button" className="link" onClick={() => setShowHelp(false)}>
            關閉
          </button>
        </div>
      )}

      {showQr && (
        <div className="qr-help" role="dialog" aria-label="用手機或平板開啟">
          <QrCard compact size={148} />
          <button type="button" className="link" onClick={() => setShowQr(false)}>
            關閉
          </button>
        </div>
      )}
    </section>
  );
}
