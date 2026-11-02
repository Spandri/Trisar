import { useI18n } from '../../i18n';

// Wallet-Karten der Einsatzplanung (362 px breit).
//   - TagesWalletKarte: Figma 2571:12781 — Lime, Kennzahlen eines Tages
//   - GesamtWalletKarte: Figma 2596:12648 — Lime-Rahmen auf dunklem Grund,
//     Kennzahlen des ganzen Einsatzes ohne Start- und Endzeit

export const TAGES_KARTE_HOEHE = 433;
export const GESAMT_KARTE_HOEHE = 389;

const LIME = '#e3f654';

function Zeilen({ zeilen, labelOben, farbe }) {
  return zeilen.map(([lLabel, lWert, rLabel, rWert], zeile) => (
    <div key={`zeile-${zeile}`}>
      <div className="absolute left-[20px] -translate-y-1/2 text-[13px] font-medium leading-[24px] tracking-[0.5px] opacity-40 whitespace-nowrap" style={{ top: `${labelOben + zeile * 68}px`, color: farbe }}>{lLabel}</div>
      <div className="absolute left-[20px] -translate-y-1/2 text-[22px] font-medium leading-[24px] tracking-[0.5px] whitespace-nowrap" style={{ top: `${labelOben + 24 + zeile * 68}px`, color: farbe }}>{lWert}</div>
      <div className="absolute right-[20px] -translate-y-1/2 text-right text-[13px] font-medium leading-[24px] tracking-[0.5px] opacity-40 whitespace-nowrap" style={{ top: `${labelOben + zeile * 68}px`, color: farbe }}>{rLabel}</div>
      <div className="absolute right-[20px] -translate-y-1/2 text-right text-[22px] font-medium leading-[24px] tracking-[0.5px] whitespace-nowrap" style={{ top: `${labelOben + 24 + zeile * 68}px`, color: farbe }}>{rWert}</div>
    </div>
  ));
}

function Co2Label() {
  const { t } = useI18n();
  return (
    <>
      CO
      <span className="text-[8.385px]">2 </span>
      {t('planer.walletCo2')}
    </>
  );
}

export function TagesWalletKarte({ titel, wallet, marker, className = '', style }) {
  const { t } = useI18n();
  return (
    <div className={`absolute w-[362px] h-[433px] ${className}`} style={style} data-tutorial={marker}>
      <img src="/icon/_Icon_Planung/wallet.svg" alt="" className="absolute inset-0 block w-full h-full" />
      <img src="/icon/_Icon_Planung/wallet_logo.svg" alt="trisar" className="absolute left-[117px] top-[26px] block w-[128.081px] h-[19px]" />
      <img src="/icon/_Icon_Planung/wallet_strich.svg" alt="" className="absolute left-[29px] top-[78.5px] block w-[70.5px] h-px" />
      <img src="/icon/_Icon_Planung/wallet_strich.svg" alt="" className="absolute left-[260px] top-[78.5px] block w-[70.5px] h-px" />
      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[18px] font-bold leading-[24px] tracking-[0.5px] text-black whitespace-nowrap" style={{ top: '79px' }}>{titel}</div>

      <Zeilen
        farbe="#000"
        labelOben={111}
        zeilen={[
          [t('planer.walletStart'), wallet.start, t('planer.walletEnd'), wallet.ende],
          [t('planer.walletDrivers'), wallet.fahrer, t('planer.walletCustomers'), wallet.kunden],
          [t('planer.walletAvg'), wallet.schnitt, t('planer.walletRides'), wallet.fahrten],
          [t('planer.walletKm'), wallet.km, <Co2Label key="co2" />, wallet.co2],
        ]}
      />

      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[13px] font-medium leading-[24px] tracking-[0.5px] text-black opacity-40 whitespace-nowrap" style={{ top: '372px' }}>{t('planer.walletVat')}</div>
      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[32px] font-bold leading-[24px] tracking-[0.5px] text-black whitespace-nowrap" style={{ top: '397px' }}>{wallet.preis}</div>
      <img src="/icon/_Icon_Planung/wallet_strich.svg" alt="" className="absolute left-[33px] top-[396.5px] block w-[70.5px] h-px" />
      <img src="/icon/_Icon_Planung/wallet_strich.svg" alt="" className="absolute left-[260px] top-[396.5px] block w-[70.5px] h-px" />
    </div>
  );
}

export function GesamtWalletKarte({ titel, wallet, marker, className = '', style }) {
  const { t } = useI18n();
  return (
    <div className={`absolute w-[362px] h-[389px] ${className}`} style={style} data-tutorial={marker}>
      <img src="/icon/_Icon_Planung/gesamt_rahmen.svg" alt="" className="absolute inset-0 block w-full h-full" />
      <img src="/icon/_Icon_Planung/gesamt_logo.svg" alt="trisar" className="absolute left-[117px] top-[26px] block w-[128.081px] h-[19px]" />
      <img src="/icon/_Icon_Planung/gesamt_strich_kurz.svg" alt="" className="absolute left-[32px] top-[78.5px] block w-[35.5px] h-px" />
      <img src="/icon/_Icon_Planung/gesamt_strich_kurz.svg" alt="" className="absolute left-[295px] top-[78.5px] block w-[35.5px] h-px" />
      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[18px] font-bold leading-[24px] tracking-[0.5px] whitespace-nowrap" style={{ top: '79px', color: LIME }}>{titel}</div>

      <Zeilen
        farbe={LIME}
        labelOben={129}
        zeilen={[
          [t('planer.walletDrivers'), wallet.fahrer, t('planer.walletCustomers'), wallet.kunden],
          [t('planer.walletAvg'), wallet.schnitt, t('planer.walletRides'), wallet.fahrten],
          [t('planer.walletKm'), wallet.km, <Co2Label key="co2" />, wallet.co2],
        ]}
      />

      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[13px] font-medium leading-[24px] tracking-[0.5px] opacity-40 whitespace-nowrap" style={{ top: '322px', color: LIME }}>{t('planer.walletVat')}</div>
      <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 text-[32px] font-bold leading-[24px] tracking-[0.5px] whitespace-nowrap" style={{ top: '347px', color: LIME }}>{wallet.preis}</div>
      <img src="/icon/_Icon_Planung/gesamt_strich.svg" alt="" className="absolute left-[33px] top-[346.5px] block w-[70.5px] h-px" />
      <img src="/icon/_Icon_Planung/gesamt_strich.svg" alt="" className="absolute left-[260px] top-[346.5px] block w-[70.5px] h-px" />
    </div>
  );
}
