import React, { useEffect, useState } from 'react';
import TrisarFooter from '../ui/TrisarFooter';
import BackCircleButton from '../ui/BackCircleButton';
import { useI18n } from '../../i18n';

const BASE_WIDTH = 402;
const CONTACT_CARD_HEIGHT = 543;
const HOTLINE_CARD_HEIGHT = 254;
const CARD_GAP = 12;
// Reihenfolge: Hotline zuerst, danach die persönlichen Ansprechpartner
// Dunkle Flaeche 24 px unter dem Titel (140 + 42 + 24), Karten mit 24 px Innenrand.
const HOTLINE_CARD_TOP = 230;
const FIRST_CARD_TOP = HOTLINE_CARD_TOP + HOTLINE_CARD_HEIGHT + CARD_GAP;
const SECOND_CARD_TOP = FIRST_CARD_TOP + CONTACT_CARD_HEIGHT + CARD_GAP;
const CONTACT_TO_FOOTER_GAP = 24;
const FOOTER_TOP = SECOND_CARD_TOP + CONTACT_CARD_HEIGHT + CONTACT_TO_FOOTER_GAP;
const FOOTER_HEIGHT = 40;
const BASE_HEIGHT = FOOTER_TOP + FOOTER_HEIGHT + 1;
const CONTENT_TOP = 206;
const CONTENT_HEIGHT = BASE_HEIGHT - CONTENT_TOP;

const screenBg = {
  backgroundImage:
    'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
};

const ContactCard = ({ person, ctaLabel }) => (
  <div className="absolute w-[362px] h-[543px] bg-white">
    <div className="absolute left-[12px] top-[12px] w-[338px] h-[244px] bg-[#d9d9d9] overflow-hidden flex items-center justify-center">
      <div className="text-gray-500 text-[48px] font-bold">{person.name.split(' ').map((n) => n[0]).join('')}</div>
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
      onClick={() => {
        window.location.href = `tel:${person.phone}`;
      }}
    >
      <span className="text-black text-[24px] font-bold tracking-[-0.5px]">{ctaLabel}</span>
      <div className="w-[35px] h-[35px] flex items-center justify-center">
        <img src="/icon/_Icon_Schwarz/contact-phone.svg" alt="" className="w-6 h-6" />
      </div>
    </button>
  </div>
);

// Hotline Card – rund um die Uhr besetzte Zentrale
const HotlineCard = ({ hotline, title, ctaLabel }) => (
  <div className="absolute w-[362px] h-[254px] bg-[#E3F654]">
    <div className="absolute left-[12px] top-[24px] text-black text-[30px] font-bold tracking-[0.5px] leading-none whitespace-nowrap">
      {title}
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
      onClick={() => {
        window.location.href = `tel:${hotline.phone}`;
      }}
    >
      <span className="text-[#E3F654] text-[24px] font-bold tracking-[-0.5px]">{ctaLabel}</span>
      <div className="w-[35px] h-[35px] flex items-center justify-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" fill="#E3F654" />
        </svg>
      </div>
    </button>
  </div>
);

export default function AnsprechpartnerView({ setView, backView = 'profilKoordinator' }) {
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

  const contacts = [
    {
      name: 'Samira Chengula',
      photo: '/support/samira-chengula.jpg',
      role: t('sonstige.contact1Role'),
      description: t('sonstige.contact1Description'),
      hours: '9:00 - 17:00',
      email: 'samira.chengula@trisar-demo.de',
      phone: '+491234567891',
    },
    {
      name: 'Anna Schubert',
      photo: '/support/anna-schubert.jpg',
      role: t('sonstige.contact2Role'),
      description: t('sonstige.contact2Description'),
      hours: '6:00 - 22:00',
      email: 'anna.schubert@trisar-demo.de',
      phone: '+491234567892',
    },
  ];

  const hotline = {
    number: '+49 123 456 78 00',
    description: t('sonstige.hotlineDescription'),
    hours: t('sonstige.hotlineHours'),
    phone: '+491234567800',
  };

  return (
    <div
      className="h-dvh w-full bg-black overflow-y-auto overflow-x-hidden flex justify-center overscroll-none"
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
          <div
            className="absolute left-0 w-[402px] bg-[#1a1a1a] rounded-tl-[12px] rounded-tr-[12px]"
            style={{ top: `${CONTENT_TOP}px`, height: `${CONTENT_HEIGHT}px` }}
          />

          <BackCircleButton onClick={() => setView(backView)} className="absolute left-[20px] top-[60px]" marker="ansprechpartner-zurueck" />

          <div className="absolute left-[20px] top-[140px] text-[#E2F754] text-[42px] font-bold tracking-[-0.5px] leading-[42px] whitespace-nowrap">
            {t('sonstige.supportTitle')}
          </div>

          <div className="absolute left-[20px]" style={{ top: `${HOTLINE_CARD_TOP}px` }}>
            <HotlineCard hotline={hotline} title={t('sonstige.zentraleHotline')} ctaLabel={t('sonstige.getInTouch')} />
          </div>

          <div className="absolute left-[20px]" style={{ top: `${FIRST_CARD_TOP}px` }}>
            <ContactCard person={contacts[0]} ctaLabel={t('sonstige.getInTouch')} />
          </div>

          <div className="absolute left-[20px]" style={{ top: `${SECOND_CARD_TOP}px` }}>
            <ContactCard person={contacts[1]} ctaLabel={t('sonstige.getInTouch')} />
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
