// "Ankuenfte bei mir" (17.11.): Restzeit an der Fahrtkarte, z. B. "5 min", "ca. 5 min" oder "da".
// Bei Abholung zusaetzlich "holt ab", damit klar ist, dass das Fahrzeug zum Abholen kommt.
import { useI18n } from '../../i18n';
import { restText } from '../../shared/ankunftMelden';

const HOLT_AB = { de: 'holt ab', en: 'pickup' };

export default function AnkunftPlakette({ eintrag }) {
  const { locale } = useI18n();
  const text = restText(eintrag, locale);
  if (!text) return null;
  const sprache = String(locale || 'de').slice(0, 2);
  return (
    <div className="mt-1 flex flex-col items-end gap-[2px]" data-tutorial="fahrt-ankunft-rest">
      <span className="px-[6px] py-[1px] bg-black text-[#E3F654] text-[13px] font-bold font-['Space_Grotesk'] leading-5 whitespace-nowrap">
        {text}
      </span>
      {eintrag?.art === 'abholung' ? (
        <span className="text-[11px] font-medium font-['Space_Grotesk'] leading-4 opacity-60">{HOLT_AB[sprache] || HOLT_AB.en}</span>
      ) : null}
    </div>
  );
}
