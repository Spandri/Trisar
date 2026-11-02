import React from 'react';

const Footer = ({ centerLogoSrc }) => (
  <footer className="w-full bg-black">
    <div className="max-w-md mx-auto h-10 relative">
      <div className="w-28 h-5 left-0 top-[12px] absolute text-center text-yellow-300 text-[10px] font-medium">© impressum</div>
      {centerLogoSrc ? (
        <img src={centerLogoSrc} alt="Trisar" className="h-6 w-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
      ) : null}
      <div className="w-28 h-5 right-0 top-[12px] absolute text-center text-yellow-300 text-[10px] font-medium">support</div>
    </div>
  </footer>
);

export default Footer;
