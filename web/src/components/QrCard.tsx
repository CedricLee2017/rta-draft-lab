import { SITE_HOST, SITE_URL } from "../lib/site";

const QR_SRC = `${import.meta.env.BASE_URL}qr-live.svg`;

interface Props {
  /** QR 圖尺寸（px） */
  size?: number;
  /** 緊湊版：工具列彈出視窗用（垂直排列、文字置中） */
  compact?: boolean;
  className?: string;
}

/**
 * 首頁 QR code。
 *
 * 圖檔是 tools/make_qr.py 產生的靜態 SVG（web/public/qr-live.svg），
 * 內容固定指向正式站，不依賴外部 QR 服務，離線也能顯示。
 */
export function QrCard({ size = 132, compact = false, className = "" }: Props) {
  return (
    <div className={`qr-card${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}>
      <img
        src={QR_SRC}
        alt="掃描 QR code 用手機或平板開啟 RTA Draft Lab"
        width={size}
        height={size}
        decoding="async"
      />
      <div className="qr-copy">
        <strong>用手機／平板掃描</strong>
        <span>直接開啟 RTA Draft Lab</span>
        <a href={SITE_URL} target="_blank" rel="noreferrer noopener">
          {SITE_HOST}
        </a>
      </div>
    </div>
  );
}
