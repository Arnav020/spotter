"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Phone } from "./Icons";

/** Desktop only: a QR code that opens the same procedure on a phone, so the phone becomes the camera. */
export default function PhoneHandoff({ presetId }: { presetId?: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [touch, setTouch] = useState(true);

  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    const url = new URL(window.location.origin);
    if (presetId) url.searchParams.set("p", presetId);
    QRCode.toDataURL(url.toString(), { margin: 1, width: 220, color: { dark: "#161b26", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [presetId]);

  if (touch || !qr) return null;
  return (
    <details>
      <summary>Use your phone as the camera</summary>
      <div className="tip" style={{ marginTop: 12, alignItems: "center" }}>
        <img src={qr} alt="QR code that opens Spotter on your phone" width={108} height={108} style={{ borderRadius: 10, flex: "none" }} />
        <span>
          <Phone size={16} /> Scan to open {presetId ? "this procedure" : "Spotter"} on your phone. The rear camera works best: prop it up above the work area.
          {window.location.hostname === "localhost" && " (Needs the deployed HTTPS URL; phones can't open localhost.)"}
        </span>
      </div>
    </details>
  );
}
