import React, { useEffect, useState } from 'react';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';

const BASE_WIDTH = 402;
const CONTACT_CARD_HEIGHT = 543;
const HOTLINE_CARD_HEIGHT = 254;
const CARD_GAP = 18;
// Reihenfolge: Hotline zuerst, danach die persönlichen Ansprechpartner
const HOTLINE_CARD_TOP = 242;
const FIRST_CARD_TOP = HOTLINE_CARD_TOP + HOTLINE_CARD_HEIGHT + CARD_GAP;
const SECOND_CARD_TOP = FIRST_CARD_TOP + CONTACT_CARD_HEIGHT + CARD_GAP;
const CONTACT_TO_FOOTER_GAP = 30;
const FOOTER_TOP = SECOND_CARD_TOP + CONTACT_CARD_HEIGHT + CONTACT_TO_FOOTER_GAP;
const FOOTER_HEIGHT = 40;
const BASE_HEIGHT = FOOTER_TOP + FOOTER_HEIGHT + 1;
const CONTENT_TOP = 221;
const CONTENT_HEIGHT = BASE_HEIGHT - CONTENT_TOP;

const screenBg = {
  backgroundImage:
    "radial-gradient(141.42% 207.32% at 0% 0%, #313701 0%, #191C00 22.83%, #0C0E00 34.24%, #000000 45.659%, #000000 83.626%, #000000 100%)",
};

// Contact Card Component
const ContactCard = ({ person, marker }) => {
  const { t } = useI18n();
  return (
  <div className="absolute w-[362px] h-[543px] bg-white" data-tutorial={marker}>
    {/* Photo placeholder with gray background */}
    <div className="absolute left-[12px] top-[12px] w-[338px] h-[244px] bg-[#d9d9d9] overflow-hidden flex items-center justify-center">
      <div className="text-gray-500 text-[48px] font-bold">
        {person.name.split(' ').map(n => n[0]).join('')}
      </div>
      {person.photo ? (
        <img
          src={person.photo}
          alt={person.name}
          className="absolute inset-0 w-full h-full object-cover"
          onError={(event) => { event.currentTarget.style.display = 'none'; }}
        />
      ) : null}
    </div>
    <div className="absolute left-[11px] top-[279px] text-black text-[30px] font-bold tracking-[0.5px] leading-none">
      {person.name}
    </div>
    <div className="absolute left-[12px] top-[317px] w-[338px] text-[12px] font-bold tracking-[0.5px] leading-4">
      <span className="block text-black">{person.role}</span>
      <span className="text-[#9a9a9a]">{person.description}</span>
    </div>
    <div className="absolute left-[13px] top-[386px] text-black text-[18px] font-bold tracking-[0.5px] leading-6">
      {person.hours}
    </div>
    <div className="absolute left-[12px] top-[408px] text-black text-[18px] font-bold tracking-[0.5px] leading-6">
      {person.email}
    </div>
    <button 
      type="button"
      className="absolute left-[12px] top-[457px] w-[338px] h-[56px] bg-[#E3F654] flex items-center justify-center gap-[10px]"
      onClick={() => window.location.href = `tel:${person.phone}`}
    >
      <span className="text-black text-[24px] font-bold tracking-[-0.5px]">{t('misc.getInTouch')}</span>
      {/* Call icon using svg path */}
      <div className="w-[35px] h-[35px] flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="black"/>
        </svg>
      </div>
    </button>
  </div>
  );
};

// Hotline Card Component – rund um die Uhr besetzte Zentrale
const HotlineCard = ({ hotline }) => {
  const { t } = useI18n();
  return (
  <div className="absolute w-[362px] h-[254px] bg-[#E3F654]" data-tutorial="support-hotline">
    <div className="absolute left-[12px] top-[24px] text-black text-[30px] font-bold tracking-[0.5px] leading-none whitespace-nowrap">
      {t('misc.centralHotline')}
    </div>
    <div className="absolute left-[12px] top-[70px] w-[338px] text-black opacity-60 text-[12px] font-bold tracking-[0.5px] leading-4">
      {hotline.description}
    </div>
    <div className="absolute left-[12px] top-[136px] text-black text-[18px] font-bold tracking-[0.5px] leading-6">
      {hotline.hours}
    </div>
    <button
      type="button"
      className="absolute left-[12px] top-[186px] w-[338px] h-[56px] bg-black flex items-center justify-center gap-[10px]"
      onClick={() => window.location.href = `tel:${hotline.phone}`}
    >
      <span className="text-[#E3F654] text-[24px] font-bold tracking-[-0.5px]">{t('misc.getInTouch')}</span>
      <div className="w-[35px] h-[35px] flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="#E3F654"/>
        </svg>
      </div>
    </button>
  </div>
  );
};

export default function AnsprechpartnerView({ setView, backView = 'profilFahrer' }) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Contact data
  const contacts = [
    {
      name: "Martin Sonneborn",
      photo: "/support/martin-sonneborn.jpg",
      role: t('misc.roleCustomerCare'),
      description: t('misc.roleCustomerCareDesc'),
      hours: "9:00 - 17:00",
      email: "martin.sonneborn@trisar-demo.de",
      phone: "+491234567891"
    },
    {
      name: "Anna Schubert",
      photo: "/support/anna-schubert.jpg",
      role: t('misc.roleDispatch'),
      description: t('misc.roleDispatchDesc'),
      hours: "6:00 - 22:00",
      email: "anna.schubert@trisar-demo.de",
      phone: "+491234567892"
    }
  ];

  const hotline = {
    number: "+49 123 456 78 00",
    description: t('misc.hotlineDesc'),
    hours: t('misc.staffed247'),
    phone: "+491234567800"
  };

  return (
    <div
      className="h-dvh w-full bg-black overflow-y-auto overflow-x-hidden overscroll-none flex justify-center"
      style={{
        WebkitTextSizeAdjust: 'none',
        WebkitOverflowScrolling: 'touch',
        textSizeAdjust: 'none',
        fontFamily: 'Space Grotesk, sans-serif',
      }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` }}>
        <div
          className="absolute left-0 top-0 w-[402px] origin-top-left overflow-hidden"
          style={{ ...screenBg, transform: `scale(${scale})`, height: `${BASE_HEIGHT}px` }}
        >
          {/* Rounded bottom section */}
          <div
            className="absolute left-0 w-[402px] bg-[#1a1a1a] rounded-tl-[12px] rounded-tr-[12px]"
            style={{ top: `${CONTENT_TOP}px`, height: `${CONTENT_HEIGHT}px` }}
          />

          {/* Back Button */}
          <ZurueckKnopf onClick={() => setView(backView)} marker="ansprechpartner-zurueck" />

          {/* Title */}
          <div className="absolute left-[20px] top-[140px] text-[#E2F754] text-[42px] font-bold tracking-[-0.5px] leading-[42px] whitespace-nowrap">
            {t('misc.support')}
          </div>

          {/* Hotline Card */}
          <div className="absolute left-[20px]" style={{ top: `${HOTLINE_CARD_TOP}px` }}>
            <HotlineCard hotline={hotline} />
          </div>

          {/* First Contact Card */}
          <div className="absolute left-[20px]" style={{ top: `${FIRST_CARD_TOP}px` }}>
            <ContactCard person={contacts[0]} index={0} marker="support-kontakt" />
          </div>

          {/* Second Contact Card */}
          <div className="absolute left-[20px]" style={{ top: `${SECOND_CARD_TOP}px` }}>
            <ContactCard person={contacts[1]} index={1} marker="support-kontakt-2" />
          </div>

        </div>
      </div>
      {/* Fußzeile fix am unteren Rand, wie auf den übrigen Seiten */}
      <div className="fixed bottom-0 left-0 right-0 z-[250] flex justify-center">
        <div className="w-[min(402px,100vw)]">
          <TrisarFooter className="relative h-10 bg-black" />
        </div>
      </div>
    </div>
  );
}
