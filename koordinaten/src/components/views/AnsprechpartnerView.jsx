import React, { useEffect, useState } from 'react';
import TrisarFooter from '../ui/TrisarFooter';
import BackCircleButton from '../ui/BackCircleButton';

const BASE_WIDTH = 402;
const CONTACT_CARD_HEIGHT = 543;
const FIRST_CARD_TOP = 242;
const SECOND_CARD_TOP = 803;
const CONTACT_TO_FOOTER_GAP = 30;
const FOOTER_TOP = SECOND_CARD_TOP + CONTACT_CARD_HEIGHT + CONTACT_TO_FOOTER_GAP;
const FOOTER_HEIGHT = 40;
const BASE_HEIGHT = FOOTER_TOP + FOOTER_HEIGHT + 1;
const CONTENT_TOP = 221;
const CONTENT_HEIGHT = BASE_HEIGHT - CONTENT_TOP;

const screenBg = {
  backgroundImage:
    'radial-gradient(141.42% 207.32% at 0% 0%, #313701 0%, #191C00 22.83%, #0C0E00 34.24%, #000000 45.659%, #000000 83.626%, #000000 100%)',
};

const ContactCard = ({ person }) => (
  <div className="absolute w-[362px] h-[543px] bg-white">
    <div className="absolute left-[12px] top-[12px] w-[338px] h-[244px] bg-[#d9d9d9] flex items-center justify-center">
      <div className="text-gray-500 text-[48px] font-bold">{person.name.split(' ').map((n) => n[0]).join('')}</div>
    </div>
    <div className="absolute left-[11px] top-[279px] text-black text-[30px] font-bold tracking-[0.5px] leading-none">
      {person.name}
    </div>
    <div className="absolute left-[12px] top-[317px] w-[338px] text-[#9a9a9a] text-[12px] font-bold tracking-[0.5px] leading-4">
      {person.description}
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
      <span className="text-black text-[24px] font-bold tracking-[-0.5px]">Get in touch</span>
      <div className="w-[35px] h-[35px] flex items-center justify-center">
        <img src="/icon/_Icon_Schwarz/contact-phone.svg" alt="" className="w-6 h-6" />
      </div>
    </button>
  </div>
);

export default function AnsprechpartnerView({ setView, backView = 'profilKoordinator' }) {
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
      name: 'Martin Sonneborn',
      description: 'Hey i am the Manager from Client XY, if you need help with anything just call me.',
      hours: '9:00 - 17:00',
      email: 'martin-sonneborn-xy@yx.com',
      phone: '+491234567891',
    },
    {
      name: 'Anna Schubert',
      description: 'Hey i am the Manager from Client XY, if you need help with anything just call me.',
      hours: '9:00 - 17:00',
      email: 'anna-schubert-xy@yx.com',
      phone: '+491234567892',
    },
  ];

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

          <BackCircleButton onClick={() => setView(backView)} className="absolute left-[20px] top-[60px]" />

          <div className="absolute left-[20px] top-[140px] text-[#E2F754] text-[42px] font-bold tracking-[-0.5px] leading-[42px] whitespace-nowrap">
            Support
          </div>

          <div className="absolute left-[20px]" style={{ top: `${FIRST_CARD_TOP}px` }}>
            <ContactCard person={contacts[0]} />
          </div>

          <div className="absolute left-[20px]" style={{ top: `${SECOND_CARD_TOP}px` }}>
            <ContactCard person={contacts[1]} />
          </div>

          <TrisarFooter className="absolute left-0 right-0 h-10 bg-black" style={{ top: `${FOOTER_TOP}px` }} />
        </div>
      </div>
    </div>
  );
}
